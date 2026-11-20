import { sessionListSchema, type SessionPage, type WorkSession } from '../shared/sessions.js';
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
import { WORKFLOW_VERSION } from '../shared/streams.js';
import { ensure } from './errors.js';
import { allowFeedback } from './feedback.js';
import { dependencyScopeFingerprint } from './dependency-assessments.js';
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
  compactContext(
    a: Actor,
    streamId: string | undefined,
    changeId: string | undefined,
    project: string,
  ) {
    // A refresh is explicitly incomplete: targeted current data, not a dependency review.
    const stream = streamId ? this.streams.get(a, streamId) : null;
    const change = changeId ? this.work.get(a, changeId) : null;
    const clip = (value: string, bytes: number) => {
      if (Buffer.byteLength(JSON.stringify(value)) <= bytes) return value;
      let prefix = '',
        used = 0;
      for (const point of value) {
        const width = Buffer.byteLength(JSON.stringify(point)) - 2;
        if (used + width > bytes - 3) break;
        prefix += point;
        used += width;
      }
      return prefix + '…';
    };
    const questions = streamId
      ? (this.raw
          .prepare(
            "SELECT id,revision,body,conversationUrl FROM stream_context WHERE streamId=? AND kind='question' AND needsHuman=1 AND state='open' ORDER BY updatedAt DESC,id LIMIT 4",
          )
          .all(streamId) as {
          id: string;
          revision: number;
          body: string;
          conversationUrl: string | null;
        }[])
      : [];
    const actions = streamId
      ? this.raw
          .prepare(
            "SELECT id,revision,title,state,conversationUrl FROM human_actions WHERE streamId=? AND state IN ('open','in_progress') ORDER BY updatedAt DESC,id LIMIT 4",
          )
          .all(streamId)
      : [];
    const refresh = {
      mode: 'compact',
      complete: false,
      workflowVersion: WORKFLOW_VERSION,
      freshness: hash(
        JSON.stringify({
          stream,
          change,
          scope:
            changeId || streamId
              ? dependencyScopeFingerprint(this.work.store, {
                  id: (changeId ?? streamId)!,
                  kind: changeId ? 'change' : 'stream',
                })
              : null,
          entries: streamId
            ? this.raw
                .prepare(
                  'SELECT id,revision,state FROM stream_context WHERE streamId=? ORDER BY id',
                )
                .all(streamId)
            : [],
          actions: streamId
            ? this.raw
                .prepare('SELECT id,revision,state FROM human_actions WHERE streamId=? ORDER BY id')
                .all(streamId)
            : [],
          observation: changeId
            ? this.raw
                .prepare(
                  'SELECT o.id FROM output_observations o JOIN change_outputs c ON c.id=o.outputId WHERE c.workId=? ORDER BY o.rowid DESC LIMIT 1',
                )
                .get(changeId)
            : null,
        }),
      ),
      project: clip(project, 500),
      stream: stream
        ? {
            id: stream.id,
            title: clip(stream.title, 180),
            revision: stream.revision,
            scopeRevision: stream.scopeRevision,
            outcome: clip(stream.outcome, 500),
            progressSummary: clip(stream.progressSummary, 500),
            dependencyAssessment: {
              state: stream.dependencyAssessment.state,
              id: stream.dependencyAssessment.id,
            },
          }
        : null,
      change: change
        ? {
            id: change.id,
            title: clip(change.title, 180),
            objective: clip(change.objective, 500),
            revision: change.tracking.revision,
            planRevision: change.tracking.planRevision,
            progress: change.tracking.progress,
            note: clip(change.tracking.progressNote, 500),
            dependencyAssessment: {
              state: change.tracking.dependencyAssessment.state,
              id: change.tracking.dependencyAssessment.id,
            },
            claim: change.tracking.claim
              ? {
                  id: change.tracking.claim.id,
                  purpose: change.tracking.claim.purpose,
                  state: change.tracking.claim.state,
                  expiresAt: change.tracking.claim.expiresAt,
                }
              : null,
          }
        : null,
      questions: questions.map((q) => ({ ...q, body: clip(q.body, 400) })),
      actions: actions as unknown[],
      requestsComplete: false,
      trimmedForBudget: false,
      recovery:
        'Compact refresh only; request lists may be incomplete and text shortened. If scope/plan/assessment changed, or after interruption/resume/compaction/handoff, call get_stream_context for this selection and retrieve relevant full records/pages. This is not a complete dependency review. Reuse current reports only while current.',
    };
    while (
      Buffer.byteLength(JSON.stringify(refresh)) > 8192 &&
      (refresh.questions.length || refresh.actions.length)
    ) {
      if (refresh.actions.length) refresh.actions.pop();
      else refresh.questions.pop();
      refresh.trimmedForBudget = true;
    }
    return refresh;
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
  workSessions(a: Actor, input: z.input<typeof sessionListSchema>): SessionPage {
    this.streams.allow(a);
    const p = sessionListSchema.parse(input);
    if (p.streamId) this.streams.get(a, p.streamId);
    if (p.changeId) this.work.get(a, p.changeId);
    const where = `WHERE ${p.changeId ? 'h.changeId=?' : 'h.streamId=?'} ${p.directOnly ? 'AND h.changeId IS NULL' : ''} ${a.scope === 'agent' ? 'AND s.credentialId=?' : ''}`;
    const params = [
      p.changeId ?? p.streamId!,
      ...(a.scope === 'agent' ? [a.credentialId ?? ''] : []),
    ];
    // A stream shows each native session once; a change always gets its own handoff.
    const query = `WITH related AS (
      SELECT h.*,s.sessionId,s.client,s.project,
      CASE WHEN s.intent='working' AND h.streamId IS s.streamId AND h.changeId IS s.changeId THEN 1 ELSE 0 END selected,
      CASE WHEN c.revokedAt IS NULL AND (c.expiresAt IS NULL OR c.expiresAt>?) THEN 1 ELSE 0 END connectionActive,
      coalesce(w.title,st.title,'Selected work') title,
      ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY h.lastSeenAt DESC,h.id) rank,
      COUNT(*) OVER (PARTITION BY s.id) relatedWorkCount
      FROM session_work h JOIN workflow_sessions s ON s.id=h.workflowSessionId
      JOIN credentials c ON c.id=s.credentialId
      LEFT JOIN work w ON w.id=h.changeId LEFT JOIN streams st ON st.id=h.streamId ${where}
    )`;
    const total = (
      this.raw
        .prepare(query + ' SELECT COUNT(*) total FROM related WHERE rank=1')
        .get(this.streams.now(), ...params) as { total: number }
    ).total;
    const rows = this.raw
      .prepare(
        query +
          ` SELECT id,sessionId,client,project,streamId,changeId,title,firstSeenAt,lastSeenAt,lastEvent,summary,lastCheckpointAt,selected,connectionActive,relatedWorkCount FROM related WHERE rank=1 ORDER BY lastSeenAt DESC,id LIMIT ? OFFSET ?`,
      )
      .all(this.streams.now(), ...params, p.limit, p.offset) as (Omit<
      WorkSession,
      'selected' | 'connectionActive'
    > & { selected: number; connectionActive: number })[];
    return {
      items: rows.map((r) => ({
        ...r,
        selected: !!r.selected,
        connectionActive: !!r.connectionActive,
      })),
      total,
      nextOffset: p.offset + p.limit < total ? p.offset + p.limit : null,
    };
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
      const intent = p.checkpoint
        ? 'working'
        : (p.intent ?? session?.intent ?? p.defaultIntent ?? 'working');
      ensure(
        !(session?.intent === 'working' && session.needsCheckpoint && p.intent === 'reading'),
        409,
        'Save the outstanding work checkpoint before switching to reading.',
      );
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
            "UPDATE workflow_sessions SET intent=?,turnId=?,lastEvent=?,lastEventAt=?,needsCheckpoint=CASE WHEN ?='reading' THEN 0 WHEN ? THEN 1 WHEN ? IN ('start','prompt','compact','interrupt') THEN 1 ELSE needsCheckpoint END WHERE id=?",
          )
          .run(
            intent,
            p.turnId,
            p.event,
            p.occurredAt,
            intent,
            Number(intent === 'working' && session.intent === 'reading' && !p.checkpoint),
            p.event,
            session.id,
          );
      }
      const context = ['start', 'prompt', 'compact'].includes(p.event)
        ? p.contextMode === 'compact' && p.event === 'prompt'
          ? this.compactContext(a, streamId, p.changeId, p.project)
          : this.streams.context(a, {
              streamId,
              changeId: p.changeId,
              project: p.project,
              limit: 6,
            })
        : undefined;
      if (context && current)
        this.raw
          .prepare('UPDATE workflow_sessions SET lastContextAt=? WHERE id=?')
          .run(now, session.id);
      if (current && intent === 'working') {
        this.raw
          .prepare(
            `INSERT INTO session_work(id,workflowSessionId,selectionKey,streamId,changeId,firstSeenAt,lastSeenAt,lastEvent,summary,lastCheckpointAt)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(workflowSessionId,selectionKey) DO UPDATE SET
          lastSeenAt=excluded.lastSeenAt,lastEvent=excluded.lastEvent,
          summary=CASE WHEN ? THEN excluded.summary ELSE session_work.summary END,
          lastCheckpointAt=CASE WHEN ? THEN excluded.lastCheckpointAt ELSE session_work.lastCheckpointAt END`,
          )
          .run(
            randomUUID(),
            session.id,
            `${streamId ?? ''}:${p.changeId ?? ''}`,
            streamId ?? null,
            p.changeId ?? null,
            p.occurredAt,
            p.occurredAt,
            p.event,
            p.checkpoint?.summary ?? '',
            p.checkpoint ? now : null,
            Number(!!p.checkpoint),
            Number(!!p.checkpoint),
          );
      }
      const result = {
        eventId: p.eventId,
        session: this.status(this.session(a, p.sessionId)!),
        ...(context
          ? {
              context,
              contextFreshness:
                p.contextMode === 'compact' && p.event === 'prompt'
                  ? (context as { freshness?: string }).freshness
                  : this.compactContext(a, streamId, p.changeId, p.project).freshness,
            }
          : {}),
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
