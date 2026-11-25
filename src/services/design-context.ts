import { designSelection, designVersion } from './design-context-data.js';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Actor } from '../shared/contracts.js';
import * as c from '../shared/design-context.js';
import type { StreamService } from './streams.js';
import { ensure } from './errors.js';

type Row = {
  id: string;
  targetKind: c.DesignTarget['kind'];
  targetId: string;
  kind: string;
  content: string;
  revision: number;
  createdBy: string;
  actorName: string;
  updatedAt: number;
};
export class DesignContextService {
  constructor(public streams: StreamService) {}
  get raw() {
    return this.streams.raw;
  }
  target(a: Actor, target: c.DesignTarget) {
    this.streams.allow(a);
    if (target.kind === 'stream') this.streams.get(a, target.id);
    else this.streams.work.row(a, target.id);
  }
  row(a: Actor, id: string) {
    this.streams.allow(a);
    const row = this.raw
      .prepare(
        'SELECT d.*,a.name actorName FROM design_records d JOIN actors a ON a.id=d.updatedBy WHERE d.id=?',
      )
      .get(id) as Row | undefined;
    ensure(row, 404, 'Design record not found.');
    this.target(a, { kind: row.targetKind, id: row.targetId });
    return row;
  }
  read(a: Actor, id: string, limit = 12, offset = 0) {
    const record = this.present(this.row(a, id));
    const p = c.designQuerySchema.parse({ target: record.target, limit, offset });
    if (record.record.kind !== 'assumption') return { ...record, dependents: null };
    const total = (
      this.raw
        .prepare('SELECT count(*) n FROM assumption_reviews WHERE assumptionId=?')
        .get(id) as { n: number }
    ).n;
    const rows = this.raw
      .prepare(
        'SELECT r.changeId,w.title,r.assumptionRevision,d.revision currentRevision,r.assumptionRevision<>d.revision needsReview,r.note FROM assumption_reviews r JOIN work w ON w.id=r.changeId JOIN design_records d ON d.id=r.assumptionId WHERE r.assumptionId=? ORDER BY (r.assumptionRevision<>d.revision) DESC,r.changeId LIMIT ? OFFSET ?',
      )
      .all(id, p.limit, p.offset) as {
      changeId: string;
      title: string;
      assumptionRevision: number;
      currentRevision: number;
      needsReview: number;
      note: string;
    }[];
    return {
      ...record,
      dependents: {
        items: rows.map((r) => ({ ...r, needsReview: !!r.needsReview })),
        total,
        nextOffset: p.offset + rows.length < total ? p.offset + rows.length : null,
      },
    };
  }
  present(row: Row, selected?: c.DesignTarget): c.DesignRecord {
    const record = c.designRecordSchema.parse(JSON.parse(row.content));
    const work =
      record.kind === 'verification'
        ? (this.raw.prepare('SELECT acceptanceCriteria FROM work WHERE id=?').get(row.targetId) as {
            acceptanceCriteria: string;
          })
        : null;
    return {
      id: row.id,
      target: { kind: row.targetKind, id: row.targetId },
      record,
      revision: row.revision,
      createdBy: row.createdBy,
      actorName: row.actorName,
      updatedAt: row.updatedAt,
      inherited:
        record.kind === 'invariant' &&
        !!selected &&
        (selected.id !== row.targetId || selected.kind !== row.targetKind),
      linked:
        record.kind === 'assumption' &&
        !!selected &&
        (selected.id !== row.targetId || selected.kind !== row.targetKind),
      criterionChanged:
        record.kind === 'verification' &&
        JSON.parse(work!.acceptanceCriteria)[record.criterionIndex] !== record.criterion,
    };
  }
  event(
    a: Actor,
    target: c.DesignTarget,
    type: string,
    message: string,
    data: Record<string, unknown>,
    references: { system: string; url: string }[] = [],
  ) {
    if (target.kind === 'stream')
      this.streams.event(a, target.id, type, message, { ...data, references });
    else this.streams.work.event(target.id, a, type, message, references, data);
  }
  save(a: Actor, input: z.input<typeof c.saveDesignRecordSchema>) {
    this.streams.allow(a);
    const p = c.saveDesignRecordSchema.parse(input);
    return this.streams.tx(() => {
      this.target(a, p.target);
      return this.streams.retry(
        a,
        'design-record',
        p.idempotencyKey,
        p,
        () => {
          const old = p.id ? this.row(a, p.id) : null;
          if (old) {
            ensure(
              old.revision === p.revision,
              409,
              'Design record changed. Reload and reconcile.',
            );
            ensure(
              a.scope === 'owner' || old.createdBy === a.id,
              403,
              'Only the author or owner can revise this record.',
            );
            ensure(
              old.targetId === p.target.id &&
                old.targetKind === p.target.kind &&
                old.kind === p.record.kind,
              400,
              'Record kind and scope cannot change. Create a separate record.',
            );
          }
          if (p.record.kind === 'invariant')
            ensure(
              !p.record.inherit || p.target.kind === 'stream',
              400,
              'Only stream invariants can apply to a subtree.',
            );
          if (p.record.kind === 'verification') {
            ensure(p.target.kind === 'change', 400, 'Verification must name a change criterion.');
            const w = this.streams.work.row(a, p.target.id);
            ensure(
              w.acceptanceCriteria[p.record.criterionIndex] === p.record.criterion,
              409,
              'Criterion changed or does not exist. Reload the exact criterion before recording evidence.',
            );
            ensure(
              p.record.checkedAt <= this.streams.now(),
              400,
              'Verification cannot be dated in the future.',
            );
          }
          const content = JSON.stringify(p.record);
          if (old && old.content === content) return old.id;
          if (!old)
            ensure(
              (
                this.raw
                  .prepare(
                    'SELECT count(*) n FROM design_records WHERE targetId=? AND targetKind=?',
                  )
                  .get(p.target.id, p.target.kind) as { n: number }
              ).n < 1000,
              409,
              'Design record limit reached for this scope.',
            );
          const id = old?.id ?? randomUUID(),
            now = this.streams.now();
          if (old)
            this.raw
              .prepare(
                'UPDATE design_records SET content=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?',
              )
              .run(content, a.id, now, id);
          else
            this.raw
              .prepare(
                'INSERT INTO design_records(id,targetKind,targetId,kind,content,createdBy,updatedBy,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
              )
              .run(id, p.target.kind, p.target.id, p.record.kind, content, a.id, a.id, now, now);
          this.event(
            a,
            p.target,
            'design_context_changed',
            `${old ? 'Updated' : 'Recorded'} ${p.record.kind}: ${p.reason}`,
            {
              recordId: id,
              before: old ? JSON.parse(old.content) : null,
              after: p.record,
              revision: (old?.revision ?? 0) + 1,
            },
            p.record.references,
          );
          return id;
        },
        (id) => this.read(a, id),
      );
    });
  }
  review(a: Actor, input: z.input<typeof c.reviewAssumptionSchema>) {
    this.streams.allow(a);
    const p = c.reviewAssumptionSchema.parse(input);
    return this.streams.tx(() =>
      this.streams.retry(
        a,
        'assumption-review',
        p.idempotencyKey,
        p,
        () => {
          this.target(a, { kind: 'change', id: p.changeId });
          const source = this.row(a, p.assumptionId);
          ensure(
            source.kind === 'assumption',
            400,
            'Only assumptions can be reviewed for dependent work.',
          );
          ensure(
            source.revision === p.assumptionRevision,
            409,
            'Assumption changed. Review its current revision.',
          );
          const old = this.raw
            .prepare('SELECT revision FROM assumption_reviews WHERE changeId=? AND assumptionId=?')
            .get(p.changeId, p.assumptionId) as { revision: number } | undefined;
          ensure(
            (old?.revision ?? 0) === p.revision,
            409,
            'Assumption review changed. Reload and reconcile.',
          );
          this.raw
            .prepare(
              `INSERT INTO assumption_reviews(changeId,assumptionId,assumptionRevision,note,reviewedBy,reviewedAt) VALUES (?,?,?,?,?,?) ON CONFLICT(changeId,assumptionId) DO UPDATE SET assumptionRevision=excluded.assumptionRevision,revision=assumption_reviews.revision+1,note=excluded.note,reviewedBy=excluded.reviewedBy,reviewedAt=excluded.reviewedAt`,
            )
            .run(
              p.changeId,
              p.assumptionId,
              p.assumptionRevision,
              p.note,
              a.id,
              this.streams.now(),
            );
          this.event(a, { kind: 'change', id: p.changeId }, 'assumption_reviewed', p.note, {
            assumptionId: p.assumptionId,
            assumptionRevision: p.assumptionRevision,
          });
          return p.assumptionId;
        },
        (id) => {
          const r = this.reviewRow(p.changeId, id);
          return { ...r, needsReview: !!r.needsReview };
        },
      ),
    );
  }
  reviewRow(changeId: string, id: string): c.AssumptionReview {
    return this.raw
      .prepare(
        `SELECT r.assumptionId,r.changeId,r.revision,r.assumptionRevision,d.revision currentRevision,d.revision<>r.assumptionRevision needsReview,json_extract(d.content,'$.statement') statement,json_extract(d.content,'$.status') status,r.note,r.reviewedAt,a.name actorName FROM assumption_reviews r JOIN design_records d ON d.id=r.assumptionId JOIN actors a ON a.id=r.reviewedBy WHERE r.changeId=? AND r.assumptionId=?`,
      )
      .get(changeId, id) as c.AssumptionReview;
  }
  list(a: Actor, input: z.input<typeof c.designQuerySchema>): c.DesignContextPage {
    this.streams.allow(a);
    const p = c.designQuerySchema.parse(input);
    this.target(a, p.target);
    const { where, args } = this.selection(p.target);
    const total = (
      this.raw.prepare(`SELECT count(*) n FROM design_records d WHERE ${where}`).get(...args) as {
        n: number;
      }
    ).n;
    const rows = this.raw
      .prepare(
        `SELECT d.*,a.name actorName FROM design_records d JOIN actors a ON a.id=d.updatedBy WHERE ${where} ORDER BY d.updatedAt DESC,d.id LIMIT ? OFFSET ?`,
      )
      .all(...args, p.limit, p.offset) as Row[];
    const reviewIds =
      p.target.kind === 'change'
        ? (this.raw
            .prepare(
              'SELECT r.assumptionId FROM assumption_reviews r JOIN design_records d ON d.id=r.assumptionId WHERE r.changeId=? ORDER BY (r.assumptionRevision<>d.revision) DESC,r.assumptionId LIMIT ? OFFSET ?',
            )
            .all(p.target.id, p.limit, p.offset) as { assumptionId: string }[])
        : [];
    const reviewTotal =
      p.target.kind === 'change'
        ? (
            this.raw
              .prepare('SELECT count(*) n FROM assumption_reviews WHERE changeId=?')
              .get(p.target.id) as { n: number }
          ).n
        : 0;
    return {
      items: rows.map((row) => this.present(row, p.target)),
      total,
      nextOffset: p.offset + rows.length < total ? p.offset + rows.length : null,
      reviews: reviewIds.map((x) => {
        const r = this.reviewRow(p.target.id, x.assumptionId);
        return { ...r, needsReview: !!r.needsReview };
      }),
      reviewTotal,
      reviewNextOffset:
        p.offset + reviewIds.length < reviewTotal ? p.offset + reviewIds.length : null,
    };
  }
  selection(target: c.DesignTarget) {
    return designSelection(this.streams.work.store, target);
  }
  fingerprint(a: Actor, target: c.DesignTarget) {
    this.target(a, target);
    return designVersion(this.streams.work.store, target);
  }
  summary(a: Actor, target: c.DesignTarget) {
    const page = this.list(a, { target, limit: 4 });
    const needsReview =
      target.kind === 'change'
        ? (
            this.raw
              .prepare(
                'SELECT count(*) n FROM assumption_reviews r JOIN design_records d ON d.id=r.assumptionId WHERE r.changeId=? AND r.assumptionRevision<>d.revision',
              )
              .get(target.id) as { n: number }
          ).n
        : 0;
    return {
      total: page.total,
      needsReview,
      detail: `/api/design-context?kind=${target.kind}&id=${target.id}`,
      items: page.items.map((r) => ({
        id: r.id,
        kind: r.record.kind,
        revision: r.revision,
        inherited: r.inherited,
        linked: r.linked,
        criterionChanged: r.criterionChanged,
        detail: `/api/design-records/${r.id}`,
      })),
    };
  }
}
