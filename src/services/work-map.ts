import type { Actor } from '../shared/contracts.js';
import type { MapNode, WorkMap, MapEdge } from '../shared/work-map.js';
import type { Node, HumanAction } from '../shared/oversight.js';
import type { ContextEntry } from '../shared/streams.js';
import type { StreamService } from './streams.js';
import { flowDependencies } from './flow.js';
import { readTracking } from './stream-data.js';
const GROUP_LIMIT = 40,
  NODE_LIMIT = 160,
  EDGE_LIMIT = 320,
  REFERENCE_LIMIT = 40;
const short = (value: string, limit = 600) =>
  value.length > limit ? value.slice(0, limit - 1) + '…' : value;
const placeholders = (values: unknown[]) => values.map(() => '?').join(',');
export function readWorkMap(streams: StreamService, actor: Actor, rootId: string): WorkMap {
  const store = streams.work.store,
    db = store.raw;
  return db
    .transaction(() => {
      streams.get(actor, rootId);
      const foundGroups = db
        .prepare(
          `WITH RECURSIVE tree(id,parentId,title,depth,path) AS (
      SELECT id,parentId,title,0,','||id||',' FROM streams WHERE id=?
      UNION ALL SELECT s.id,s.parentId,s.title,t.depth+1,t.path||s.id||',' FROM streams s JOIN tree t ON s.parentId=t.id
      WHERE t.depth<64 AND instr(t.path,','||s.id||',')=0 ORDER BY 4,1 LIMIT ?
    ) SELECT id,parentId,title,depth FROM tree`,
        )
        .all(rootId, GROUP_LIMIT + 1) as WorkMap['groups'];
      const groups = foundGroups.slice(0, GROUP_LIMIT),
        ids = groups.map((g) => g.id);
      const slots = NODE_LIMIT - groups.length;
      const candidates = db
        .prepare(
          `SELECT w.id,'change' kind,m.streamId groupId,
      CASE WHEN m.deliveredAt IS NOT NULL OR w.lifecycle!='open' THEN 2 WHEN m.progress='working' THEN 0 ELSE 1 END priority,w.title
      FROM work w JOIN change_meta m ON m.workId=w.id WHERE m.streamId IN (${placeholders(ids)})
      UNION ALL SELECT id,'human_action',streamId,CASE WHEN state IN ('open','in_progress') THEN 0 ELSE 2 END,title
      FROM human_actions WHERE streamId IN (${placeholders(ids)})
      UNION ALL SELECT id,'question',streamId,CASE WHEN state='open' THEN 0 ELSE 2 END,substr(body,1,180) FROM stream_context WHERE kind='question' AND needsHuman=1 AND streamId IN (${placeholders(ids)}) ORDER BY priority,title,id LIMIT ?`,
        )
        .all(...ids, ...ids, ...ids, slots + 1) as {
        id: string;
        kind: MapNode['kind'];
        groupId: string;
      }[];
      const total = db
        .prepare(
          `SELECT (SELECT count(*) FROM change_meta WHERE streamId IN (${placeholders(ids)})) +
      (SELECT count(*) FROM human_actions WHERE streamId IN (${placeholders(ids)})) + (SELECT count(*) FROM stream_context WHERE kind='question' AND needsHuman=1 AND streamId IN (${placeholders(ids)})) n`,
        )
        .get(...ids, ...ids, ...ids) as { n: number };
      const nodeCache = new Map<string, MapNode>();
      function node(id: string, kind: MapNode['kind'], reference = false): MapNode {
        const cached = nodeCache.get(id);
        if (cached) return cached;
        let result: MapNode;
        if (kind === 'stream') {
          const s = streams.get(actor, id);
          result = {
            id,
            kind,
            groupId: reference ? 'linked' : id,
            streamId: id,
            title: short(s.title, 180),
            purpose: short(s.outcome),
            update: short(s.progressSummary),
            status:
              s.state === 'proposed' ? 'Planned' : s.state[0].toUpperCase() + s.state.slice(1),
            tone: ['closed', 'declined'].includes(s.state)
              ? 'quiet'
              : s.state === 'paused'
                ? 'waiting'
                : 'planned',
            quiet: ['closed', 'declined'].includes(s.state),
            assessment: s.assessmentState,
            prerequisiteCount: s.dependencies.length,
            reference,
            conversationUrl: null,
            outputs: (
              db
                .prepare(
                  'SELECT label,url FROM stream_outputs WHERE streamId=? ORDER BY reportedAt DESC,id LIMIT 2',
                )
                .all(id) as { label: string; url: string }[]
            ).map((o) => ({ label: short(o.label, 180), url: o.url })),
          };
        } else if (kind === 'change') {
          const w = db
            .prepare(
              'SELECT title,objective,lifecycle,(SELECT state FROM assignments WHERE workId=work.id) assignment FROM work WHERE id=?',
            )
            .get(id) as {
            title: string;
            objective: string;
            lifecycle: string;
            assignment: string;
          };
          const m = readTracking(store, id, streams.now());
          const unmet = m.prerequisites.filter((d) => !d.satisfied);
          const quiet =
            (m.progress === 'delivered' && w.lifecycle === 'open') ||
            ['completed', 'cancelled'].includes(w.lifecycle) ||
            ['declined', 'withdrawn'].includes(w.assignment);
          const status =
            w.lifecycle === 'blocked'
              ? 'Waiting'
              : w.assignment === 'declined'
                ? 'Declined earlier'
                : w.assignment === 'withdrawn'
                  ? 'Withdrawn'
                  : quiet
                    ? m.progress === 'delivered' && w.lifecycle === 'open'
                      ? 'Delivered'
                      : w.lifecycle[0].toUpperCase() + w.lifecycle.slice(1)
                    : m.progress === 'working'
                      ? 'In progress'
                      : m.progress === 'blocked'
                        ? 'Waiting'
                        : unmet.some((d) => d.stage === 'start')
                          ? 'Waiting to start'
                          : unmet.length && m.progress === 'review'
                            ? 'Waiting to deliver'
                            : m.progress === 'review'
                              ? 'Ready'
                              : m.assessmentState === 'current' && !unmet.length
                                ? 'Ready'
                                : 'Planned';
          result = {
            id,
            kind,
            groupId: reference ? 'linked' : m.streamId!,
            streamId: m.streamId,
            title: short(w.title, 180),
            purpose: short(w.objective),
            update: short(m.progressNote),
            status,
            tone: quiet
              ? 'quiet'
              : status === 'In progress'
                ? 'active'
                : status.startsWith('Waiting')
                  ? 'waiting'
                  : 'planned',
            quiet,
            assessment: m.assessmentState,
            prerequisiteCount: m.prerequisites.length,
            reference,
            conversationUrl: null,
            outputs: m.outputs.slice(0, 2).map((o) => ({ label: short(o.label, 180), url: o.url })),
          };
        } else if (kind === 'question') {
          const q = streams.entry(actor, id) as ContextEntry;
          result = {
            id,
            kind,
            groupId: q.streamId,
            streamId: q.streamId,
            title: short(q.body, 180),
            purpose: short(q.body),
            update: short(q.answer ?? ''),
            status:
              q.state === 'open' ? 'Needs you' : q.state === 'resolved' ? 'Answered' : 'Superseded',
            tone: q.state === 'open' ? 'attention' : 'quiet',
            quiet: q.state !== 'open',
            assessment: 'unknown',
            prerequisiteCount: 0,
            reference: false,
            conversationUrl: q.conversationUrl,
            outputs: [],
          };
        } else {
          const h = db.prepare('SELECT * FROM human_actions WHERE id=?').get(id) as HumanAction;
          result = {
            id,
            kind,
            groupId: reference ? 'linked' : h.streamId,
            streamId: h.streamId,
            title: short(h.title, 180),
            purpose: short(h.description || 'Needed: ' + h.doneWhen),
            update: short(h.response),
            status:
              h.state === 'done'
                ? 'Done'
                : h.state === 'cancelled'
                  ? 'Cancelled'
                  : h.state === 'in_progress'
                    ? 'In progress'
                    : 'Needs you',
            tone: ['done', 'cancelled'].includes(h.state) ? 'quiet' : 'attention',
            quiet: ['done', 'cancelled'].includes(h.state),
            assessment: 'unknown',
            prerequisiteCount: 0,
            reference,
            conversationUrl: h.conversationUrl,
            outputs: [],
          };
        }
        nodeCache.set(id, result);
        return result;
      }
      const nodes = groups.map((g) => node(g.id, 'stream'));
      for (const c of candidates.slice(0, slots)) nodes.push(node(c.id, c.kind));
      const coreIds = nodes.map((n) => n.id),
        included = new Set(coreIds);
      const rawEdges = db
        .prepare(
          `SELECT d.*,n.kind sourceKind,t.kind targetKind FROM flow_dependencies d
      JOIN oversight_nodes n ON n.id=d.sourceId JOIN oversight_nodes t ON t.id=d.targetId
      WHERE d.targetId IN (${placeholders(coreIds)}) OR d.sourceId IN (${placeholders(coreIds)}) ORDER BY d.targetId,d.sourceId,d.stage LIMIT ?`,
        )
        .all(...coreIds, ...coreIds, EDGE_LIMIT + 1) as {
        sourceId: string;
        targetId: string;
        sourceKind: Node['kind'];
        targetKind: Node['kind'];
        stage: string;
      }[];
      const edgeTotal = db
        .prepare(
          `SELECT count(*) n FROM flow_dependencies WHERE targetId IN (${placeholders(coreIds)}) OR sourceId IN (${placeholders(coreIds)})`,
        )
        .get(...coreIds, ...coreIds) as { n: number };
      const edges: MapEdge[] = [],
        dependencies = new Map<string, ReturnType<typeof flowDependencies>>();
      let references = 0;
      for (const row of rawEdges.slice(0, EDGE_LIMIT)) {
        const needed = [
          { id: row.sourceId, kind: row.sourceKind },
          { id: row.targetId, kind: row.targetKind },
        ].filter((n) => !included.has(n.id));
        if (references + needed.length > REFERENCE_LIMIT) continue;
        for (const n of needed) {
          nodes.push(node(n.id, n.kind, true));
          included.add(n.id);
          references++;
        }
        if (!dependencies.has(row.targetId))
          dependencies.set(row.targetId, flowDependencies(store, row.targetId));
        const d = dependencies
          .get(row.targetId)!
          .find((d) => d.source.id === row.sourceId && d.stage === row.stage)!;
        edges.push({
          sourceId: row.sourceId,
          targetId: row.targetId,
          stage: d.stage,
          condition: d.condition,
          reason: short(d.reason),
          satisfied: d.satisfied,
          evidence: d.evidence,
        });
      }
      const depthLimit = groups.some(
        (g) =>
          g.depth === 64 && db.prepare('SELECT 1 FROM streams WHERE parentId=? LIMIT 1').get(g.id),
      );
      const moreStreams = foundGroups.length > GROUP_LIMIT || depthLimit;
      return {
        rootId,
        groups,
        nodes,
        edges,
        omittedNodes: Math.max(0, total.n - slots),
        omittedEdges: Math.max(0, edgeTotal.n - edges.length),
        moreStreams,
        complete: !moreStreams && total.n <= slots && edgeTotal.n === edges.length,
      };
    })
    .deferred();
}
