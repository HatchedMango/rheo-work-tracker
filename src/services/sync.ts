import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Actor } from '../shared/contracts.js';
import {
  syncEventSchema,
  queueReportSchema,
  type SyncSession,
  type SyncStatus,
} from '../shared/sync.js';
import { hash } from './auth.js';
import { ensure } from './errors.js';
import { allowFeedback } from './feedback.js';
import type { OversightService } from './oversight.js';
export class SyncService {
  constructor(public oversight: OversightService) {}
  get streams() {
    return this.oversight.streams;
  }
  get work() {
    return this.streams.work;
  }
  get raw() {
    return this.work.store.raw;
  }
  session(a: Actor, sessionId: string) {
    this.streams.allow(a, ['agent']);
    ensure(a.credentialId, 403, 'A connection credential is required.');
    return this.raw
      .prepare('SELECT * FROM workflow_sessions WHERE credentialId=? AND sessionId=?')
      .get(a.credentialId, sessionId) as SyncSession | undefined;
  }
  status(row: SyncSession): SyncStatus {
    const { credentialId, ...rest } = row;
    return {
      ...rest,
      state: row.needsCheckpoint || row.pendingWrites ? 'needs_update' : 'recorded',
    };
  }
  list(a: Actor, streamId?: string) {
    this.streams.allow(a);
    const rows = this.raw
      .prepare(
        `SELECT s.* FROM workflow_sessions s JOIN credentials c ON c.id=s.credentialId WHERE c.revokedAt IS NULL AND (? IS NULL OR s.streamId=? OR s.changeId IN (SELECT workId FROM change_meta WHERE streamId=?)) ${a.scope === 'agent' ? 'AND s.credentialId=?' : ''} ORDER BY s.lastEventAt DESC,s.id LIMIT 30`,
      )
      .all(
        streamId ?? null,
        streamId ?? null,
        streamId ?? null,
        ...(a.scope === 'agent' ? [a.credentialId ?? ''] : []),
      ) as SyncSession[];
    return { items: rows.map((r) => this.status(r)) };
  }
  permission(a: Actor, credentialId: string, enabled: boolean) {
    ensure(
      a.scope === 'owner' && a.id === 'owner',
      403,
      'Only the owner can manage chat synchronization.',
    );
    ensure(
      this.raw
        .prepare("SELECT id FROM credentials WHERE id=? AND scope='agent' AND revokedAt IS NULL")
        .get(credentialId),
      404,
      'Active agent credential not found.',
    );
    this.raw
      .prepare(
        'INSERT INTO workflow_permissions VALUES (?,?,?) ON CONFLICT(credentialId) DO UPDATE SET relayFeedback=excluded.relayFeedback,updatedAt=excluded.updatedAt',
      )
      .run(credentialId, Number(enabled), this.streams.now());
    return { relayFeedback: enabled };
  }
  queue(a: Actor, input: z.input<typeof queueReportSchema>) {
    const p = queueReportSchema.parse(input);
    this.session(a, p.sessionId);
    this.raw
      .prepare(
        'UPDATE workflow_sessions SET pendingWrites=?,queueReportedAt=? WHERE credentialId=? AND sessionId=? AND (queueReportedAt IS NULL OR queueReportedAt<=?)',
      )
      .run(p.pendingWrites, p.observedAt, a.credentialId, p.sessionId, p.observedAt);
    return { ok: true };
  }
  event(a: Actor, input: z.input<typeof syncEventSchema>) {
    this.streams.allow(a, ['agent']);
    ensure(a.credentialId, 403, 'A connection credential is required.');
    const p = syncEventSchema.parse(input);
    ensure(p.streamId || p.changeId, 400, 'Select a stream or change explicitly.');
    ensure(
      (p.event === 'checkpoint') === !!p.checkpoint,
      400,
      'Only checkpoint events carry a structured checkpoint.',
    );
    return this.work.tx(() => {
      const fingerprint = hash(JSON.stringify(p));
      const prior = this.raw
        .prepare(
          'SELECT fingerprint,response FROM workflow_receipts WHERE credentialId=? AND eventId=?',
        )
        .get(a.credentialId, p.eventId) as { fingerprint: string; response: string } | undefined;
      if (prior) {
        ensure(
          prior.fingerprint === fingerprint,
          409,
          'Event ID was already used with different content.',
        );
        return JSON.parse(prior.response);
      }
      const change = p.changeId ? this.work.get(a, p.changeId) : null;
      const streamId = p.streamId ?? change?.tracking.streamId ?? undefined;
      if (p.streamId && change)
        ensure(
          change.tracking.streamId === p.streamId,
          409,
          'Change does not belong to the selected stream.',
        );
      if (streamId) this.streams.get(a, streamId);
      let session = this.session(a, p.sessionId);
      ensure(
        !session || (session.project === p.project && session.client === p.client),
        409,
        'Session selection changed. Use the original project/client.',
      );
      const selectionChanged =
        !!session &&
        (session.streamId !== (streamId ?? null) || session.changeId !== (p.changeId ?? null));
      ensure(
        !selectionChanged || (p.event === 'start' && p.occurredAt > session!.lastEventAt),
        409,
        'Session selection changed. Explicitly select the work before continuing.',
      );
      const now = this.streams.now();
      ensure(p.occurredAt <= now + 60_000, 400, 'Event timestamp is in the future.');
      if (selectionChanged) {
        this.raw
          .prepare(
            "UPDATE workflow_sessions SET streamId=?,changeId=?,turnId=?,lastCheckpointAt=NULL,checkpointTurnId=NULL,needsCheckpoint=1,summary='' WHERE id=?",
          )
          .run(streamId ?? null, p.changeId ?? null, p.turnId, session!.id);
        session = this.session(a, p.sessionId)!;
      }
      if (!session) {
        ensure(
          p.event !== 'checkpoint',
          409,
          'Load session context before recording a checkpoint.',
        );
        this.raw
          .prepare(
            'INSERT INTO workflow_sessions(id,credentialId,sessionId,client,project,streamId,changeId,turnId,lastEvent,lastEventAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            a.credentialId,
            p.sessionId,
            p.client,
            p.project,
            streamId ?? null,
            p.changeId ?? null,
            p.turnId,
            p.event,
            p.occurredAt,
          );
        session = this.session(a, p.sessionId)!;
      }
      ensure(
        p.event !== 'checkpoint' || session.turnId === p.turnId,
        409,
        'The chat has moved to another turn. Reconcile this checkpoint before retrying.',
      );
      const current = p.occurredAt >= session.lastEventAt;
      if (p.checkpoint) {
        ensure(
          current,
          409,
          'This checkpoint predates newer lifecycle events. Reconcile before retrying.',
        );
        const cp = p.checkpoint,
          source = { client: p.client, sessionId: p.sessionId, messageId: cp.messageId };
        if (cp.feedback.length) allowFeedback(this.work.store, a, source);
        for (const [i, f] of cp.feedback.entries()) {
          const key = `${p.eventId}:${i}`;
          // Feedback is deliberately limited to the selected stream's requests,
          // or to the explicitly selected ungrouped change.
          const targetStream =
            f.kind === 'question'
              ? this.streams.entry(a, f.id).streamId
              : f.kind === 'human_action'
                ? this.oversight.action(a, f.id).streamId
                : f.kind === 'stream_decision'
                  ? f.id
                  : this.work.get(a, f.id).tracking.streamId;
          ensure(
            streamId
              ? targetStream === streamId
              : f.kind === 'work_decision' && f.id === p.changeId,
            403,
            'Feedback target is outside this session selection.',
          );
          if (f.kind === 'question')
            this.oversight.answer(
              a,
              f.id,
              { revision: f.revision, answer: f.answer, idempotencyKey: key },
              source,
            );
          else if (f.kind === 'human_action')
            this.oversight.respond(
              a,
              f.id,
              { revision: f.revision, state: f.state, response: f.response, idempotencyKey: key },
              source,
            );
          else if (f.kind === 'work_decision')
            this.work.action(
              a,
              f.id,
              { revision: f.revision, action: f.action, message: f.response },
              source,
            );
          else this.streams.action(a, f.id, { revision: f.revision, action: f.action }, source);
        }
        if (cp.change) {
          ensure(p.changeId, 400, 'Select a change to report its progress.');
          this.streams.updateChange(a, p.changeId, {
            revision: cp.change.revision,
            progress: cp.change.progress,
            progressNote: cp.change.note,
          });
        }
        if (cp.stream) {
          ensure(streamId, 400, 'Select a stream to report its progress.');
          this.oversight.report(a, streamId, {
            streamRevision: cp.stream.revision,
            summary: cp.stream.summary,
          });
        }
        for (const [i, e] of cp.findings.entries()) {
          ensure(streamId, 400, 'Findings require a selected stream.');
          this.streams.recordContext(a, streamId, {
            ...e,
            idempotencyKey: `${p.eventId}:finding:${i}`,
          });
        }
        this.raw
          .prepare(
            'UPDATE workflow_sessions SET lastCheckpointAt=?,checkpointTurnId=?,needsCheckpoint=0,summary=? WHERE id=?',
          )
          .run(now, p.turnId, cp.summary, session.id);
        if (streamId)
          this.streams.event(a, streamId, 'workflow_checkpoint', cp.summary, {
            eventId: p.eventId,
            source,
            changeId: p.changeId,
            reconciles: cp.reconciles,
          });
        else if (p.changeId)
          this.work.event(p.changeId, a, 'workflow_checkpoint', cp.summary, [], {
            eventId: p.eventId,
            source,
          });
      }
      if (current) {
        this.raw
          .prepare(
            "UPDATE workflow_sessions SET turnId=?,lastEvent=?,lastEventAt=?,needsCheckpoint=CASE WHEN ? IN ('start','prompt','compact','interrupt') THEN 1 ELSE needsCheckpoint END WHERE id=?",
          )
          .run(p.turnId, p.event, p.occurredAt, p.event, session.id);
      }
      const context = ['start', 'prompt', 'compact'].includes(p.event)
        ? this.streams.context(a, { streamId, changeId: p.changeId, project: p.project, limit: 6 })
        : undefined;
      if (context && current)
        this.raw
          .prepare('UPDATE workflow_sessions SET lastContextAt=? WHERE id=?')
          .run(now, session.id);
      const result = {
        eventId: p.eventId,
        session: this.status(this.session(a, p.sessionId)!),
        ...(context ? { context } : {}),
        relayFeedback: !!(
          this.raw
            .prepare('SELECT relayFeedback FROM workflow_permissions WHERE credentialId=?')
            .get(a.credentialId) as { relayFeedback: number } | undefined
        )?.relayFeedback,
      };
      this.raw
        .prepare('INSERT INTO workflow_receipts VALUES (?,?,?,?,?)')
        .run(a.credentialId, p.eventId, fingerprint, JSON.stringify(result), now);
      return result;
    });
  }
}
