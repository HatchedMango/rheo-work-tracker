import { WorkChatService } from '../services/work-chat.js';
import { OutputEvidenceService } from '../services/output-evidence.js';
import { observeOutputSchema } from '../shared/output-evidence.js';
import { DailyProgressService } from '../services/daily-progress.js';
import { dailyProgressQuerySchema } from '../shared/daily-progress.js';
import { workChatSchema } from '../shared/work-chat.js';
import { sessionListSchema } from '../shared/sessions.js';
import { DependencyAssessmentService } from '../services/dependency-assessments.js';
import * as assessmentContracts from '../shared/dependency-assessments.js';
import { OversightService } from '../services/oversight.js';
import { SyncService } from '../services/sync.js';
import { syncEventSchema, queueReportSchema } from '../shared/sync.js';
import * as oversightContracts from '../shared/oversight.js';
import { StreamService } from '../services/streams.js';
import * as streamContracts from '../shared/streams.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionService } from '../services/connections.js';
import { ExistingWorkService } from '../services/existing-work.js';
import { connectionCreateSchema, agentActivitySchema } from '../shared/connections.js';
import { z, ZodError } from 'zod';
import { Auth } from '../services/auth.js';
import { WorkService } from '../services/work.js';
import { AppError, ensure } from '../services/errors.js';
import type { Store } from '../db/index.js';
import {
  actionSchema,
  contentSchema,
  createSchema,
  listSchema,
  runUpdateSchema,
  updateSchema,
  type Actor,
} from '../shared/contracts.js';
export async function createApp(
  store: Store,
  options: {
    origin: string;
    development?: boolean;
    clock?: () => number;
    publicDir?: string;
    logger?: boolean;
    allowSimulation?: boolean;
    connectionDir?: string;
    mcpEntry?: string;
    mcpLauncher?: string;
    integrationDir?: string;
    gitlabFetch?: typeof fetch;
  },
) {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers.set-cookie',
            'req.body.token',
          ],
        }
      : false,
    bodyLimit: 64 * 1024,
  });
  const auth = new Auth(store, options.clock);
  const service = new WorkService(store, options.clock, options.allowSimulation);
  const streams = new StreamService(service);
  const oversight = new OversightService(streams);
  const sync = new SyncService(oversight);
  const workChats = new WorkChatService(streams);
  const dailyProgress = new DailyProgressService(store, options.clock);
  const assessments = new DependencyAssessmentService(streams);
  const outputEvidence = new OutputEvidenceService(
    streams,
    options.integrationDir,
    options.gitlabFetch,
  );
  const connections = new ConnectionService(store, {
    origin: options.origin,
    directory:
      options.connectionDir ||
      (store.raw.name !== ':memory:' ? resolve(dirname(store.raw.name), 'connections') : undefined),
    entry:
      options.mcpLauncher ||
      options.mcpEntry ||
      fileURLToPath(new URL('../../dist/mcp/index.js', import.meta.url)),
    standalone: Boolean(options.mcpLauncher),
    clock: options.clock,
  });
  await app.register(cookie);
  const host = new URL(options.origin).host;
  const origins = [options.origin, ...(options.development ? ['http://127.0.0.1:5173'] : [])];
  app.addHook('onRequest', async (req, reply) => {
    ensure(req.headers.host === host, 403, 'Unrecognized local host.');
    if (req.headers.origin)
      ensure(origins.includes(req.headers.origin), 403, 'Origin not allowed.');
    if (req.url.startsWith('/api')) {
      const site = req.headers['sec-fetch-site'];
      ensure(site !== 'cross-site', 403, 'Cross-site API requests are not allowed.');
      if (site === 'same-site') {
        ensure(
          typeof req.headers.origin === 'string' && origins.includes(req.headers.origin),
          403,
          'Untrusted same-site API request.',
        );
      }
    }
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (req.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({
        message: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
      });
    if (err instanceof AppError) return reply.code(err.status).send({ message: err.message });
    const error = err as Error & { statusCode?: number };
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({ message: error.message });
    req.log.error({ err: error }, 'Request failed');
    reply
      .code(500)
      .send({ message: 'The request failed. Your work was not changed; try refreshing.' });
  });
  function authenticate(req: {
    headers: Record<string, unknown>;
    cookies: Record<string, string | undefined>;
  }): Actor {
    const authorization = req.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer '))
      return auth.actor(authorization.slice(7), 'bearer');
    ensure(req.cookies.session, 401, 'Local browser session required.');
    return auth.actor(req.cookies.session, 'cookie');
  }
  function browserWrite(req: { headers: Record<string, unknown> }) {
    ensure(
      typeof req.headers.origin === 'string' && origins.includes(req.headers.origin),
      403,
      'Browser writes require the local Origin.',
    );
    jsonBody(req);
  }
  function jsonBody(req: { headers: Record<string, unknown> }) {
    ensure(
      typeof req.headers['content-type'] === 'string' &&
        req.headers['content-type'].split(';')[0].trim().toLowerCase() === 'application/json',
      415,
      'Send application/json.',
    );
  }
  function writeActor(req: Parameters<typeof authenticate>[0]): Actor {
    if (req.headers.authorization) jsonBody(req);
    else browserWrite(req);
    return authenticate(req);
  }
  const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.post('/api/session', async (req, reply) => {
    // Never let a scoped bearer credential turn into an owner session.
    ensure(!req.headers.authorization, 403, 'This endpoint is for the local browser only.');
    browserWrite(req);
    z.object({}).strict().parse(req.body);
    const session = auth.localSession(req.cookies.session);
    if (session)
      reply.setCookie('session', session, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 7 * 24 * 3600,
      });
    return { ok: true };
  });
  app.get('/api/status', async (req) => service.status(authenticate(req)));
  app.get('/api/daily-progress', async (req) => {
    const q = dailyProgressQuerySchema.parse(req.query);
    return dailyProgress.get(
      authenticate(req),
      q.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
  app.post('/api/daily-progress/target', async (req) =>
    dailyProgress.setTarget(writeActor(req), req.body),
  );
  app.get('/api/sessions', async (req) =>
    sync.workSessions(authenticate(req), sessionListSchema.parse(req.query)),
  );
  app.get('/api/sync', async (req) =>
    sync.list(
      authenticate(req),
      z.object({ streamId: z.uuid().optional() }).parse(req.query).streamId,
    ),
  );
  app.post('/api/sync/events', async (req) =>
    sync.event(writeActor(req), syncEventSchema.parse(req.body)),
  );
  app.post('/api/sync/queue', async (req) =>
    sync.queue(writeActor(req), queueReportSchema.parse(req.body)),
  );
  app.post('/api/connections/:id/sync', async (req) => {
    const actor = writeActor(req);
    connections.owner(actor);
    const body = z.object({ relayFeedback: z.boolean() }).strict().parse(req.body);
    return sync.permission(
      actor,
      connections.row(idOf(req.params)).connection.credentialId,
      body.relayFeedback,
    );
  });
  app.get('/api/connections', async (req) => ({ items: connections.list(authenticate(req)) }));
  app.post('/api/connections', async (req, reply) => {
    const actor = writeActor(req);
    connections.owner(actor);
    const setup = connections.create(actor, connectionCreateSchema.parse(req.body));
    reply.code(201);
    return setup;
  });
  app.get('/api/connections/:id', async (req) =>
    connections.get(authenticate(req), idOf(req.params)),
  );
  app.post('/api/connections/:id/complete', async (req) => {
    const actor = writeActor(req);
    connections.owner(actor);
    z.object({}).strict().parse(req.body);
    return connections.complete(actor, idOf(req.params));
  });
  app.get('/api/connections/:id/setup', async (req) =>
    connections.setup(authenticate(req), idOf(req.params)),
  );
  const existingWork = new ExistingWorkService(connections);
  app.post('/api/connections/:id/existing-work', async (req) =>
    existingWork.prepare(writeActor(req), idOf(req.params), req.body),
  );
  app.post('/api/connections/:id/existing-work/status', async (req) =>
    existingWork.status(writeActor(req), idOf(req.params), req.body),
  );
  app.post('/api/connections/:id/check', async (req) => {
    const actor = writeActor(req);
    connections.owner(actor);
    z.object({}).strict().parse(req.body);
    return connections.check(actor, idOf(req.params));
  });
  app.post('/api/connections/:id/disconnect', async (req) => {
    const actor = writeActor(req);
    connections.owner(actor);
    z.object({}).strict().parse(req.body);
    return connections.revoke(actor, idOf(req.params));
  });
  app.post('/api/agent/activity', async (req) => {
    const actor = writeActor(req);
    return connections.activity(actor, agentActivitySchema.parse(req.body));
  });

  app.get('/api/work', async (req) => service.list(authenticate(req), listSchema.parse(req.query)));
  app.post('/api/work', async (req, reply) => {
    const item = service.create(writeActor(req), createSchema.parse(req.body));
    reply.code(201);
    return item;
  });
  app.get('/api/work/:id/chat', async (req) =>
    workChats.prepare(authenticate(req), idOf(req.params)),
  );
  app.post('/api/work/:id/chat', async (req) =>
    workChats.prepare(writeActor(req), idOf(req.params), workChatSchema.parse(req.body)),
  );
  app.get('/api/work/:id', async (req) => service.get(authenticate(req), idOf(req.params)));
  app.put('/api/work/:id', async (req) => {
    const body = contentSchema.extend({ revision: z.number().int().positive() }).parse(req.body);
    return service.edit(writeActor(req), idOf(req.params), body.revision, body);
  });
  app.post('/api/work/:id/actions', async (req) =>
    service.action(writeActor(req), idOf(req.params), actionSchema.parse(req.body)),
  );
  app.post('/api/work/:id/updates', async (req) => {
    const actor = writeActor(req);
    const body = updateSchema.parse(req.body);
    return service.note(actor, idOf(req.params), body.message, body.references);
  });
  app.get('/api/work/:id/events', async (req) => {
    const p = pageSchema.parse(req.query);
    return service.history(authenticate(req), idOf(req.params), p.limit, p.offset);
  });
  app.get('/api/work/:id/outputs', async (req) => {
    const p = pageSchema.parse(req.query);
    return streams.outputs(authenticate(req), idOf(req.params), p.limit, p.offset);
  });
  app.get('/api/work/:id/output-evidence', async (req) =>
    outputEvidence.list(authenticate(req), idOf(req.params)),
  );
  app.get('/api/integrations/gitlab', async (req) => outputEvidence.status(authenticate(req)));
  app.post('/api/integrations/gitlab', async (req) =>
    outputEvidence.configure(writeActor(req), req.body),
  );
  app.post('/api/integrations/gitlab/disconnect', async (req) => {
    z.object({}).strict().parse(req.body);
    return outputEvidence.disconnect(writeActor(req));
  });
  app.post('/api/work/:id/outputs/:outputId/observe', async (req) => {
    const params = z.object({ id: z.uuid(), outputId: z.uuid() }).parse(req.params);
    const input = observeOutputSchema.parse(req.body);
    return outputEvidence.observe(writeActor(req), params.id, params.outputId, input.revision);
  });
  app.get('/api/streams', async (req) =>
    streams.list(authenticate(req), streamContracts.streamListSchema.parse(req.query)),
  );
  app.post('/api/streams', async (req, reply) => {
    const item = streams.submit(
      writeActor(req),
      streamContracts.submitStreamSchema.parse(req.body),
    );
    reply.code(201);
    return item;
  });
  app.get('/api/streams/:id', async (req) => streams.get(authenticate(req), idOf(req.params)));
  app.post('/api/streams/:id/update', async (req) =>
    streams.update(
      writeActor(req),
      idOf(req.params),
      streamContracts.streamUpdateSchema.parse(req.body),
    ),
  );
  app.post('/api/streams/:id/actions', async (req) =>
    streams.action(
      writeActor(req),
      idOf(req.params),
      streamContracts.streamActionSchema.parse(req.body),
    ),
  );
  const pageSchema = z.object({
    limit: z.coerce.number().int().min(1).max(30).default(30),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  });
  app.get('/api/oversight/streams', async (req) => {
    const p = pageSchema
      .extend({ view: z.enum(['active', 'history', 'all']).default('active') })
      .parse(req.query);
    return oversight.overview(authenticate(req), p.view, p.limit, p.offset);
  });
  app.get('/api/attention', async (req) => {
    const p = pageSchema.extend({ streamId: z.uuid().optional() }).parse(req.query);
    return oversight.attention(authenticate(req), p.limit, p.offset, p.streamId);
  });
  app.get('/api/streams/:id/map', async (req) =>
    oversight.map(authenticate(req), idOf(req.params)),
  );
  app.get('/api/streams/:id/overview', async (req) => {
    const p = pageSchema.parse(req.query);
    return oversight.detail(authenticate(req), idOf(req.params), p.limit, p.offset);
  });
  app.post('/api/dependencies', async (req) =>
    oversight.dependencies(
      writeActor(req),
      oversightContracts.setDependenciesSchema.parse(req.body),
    ),
  );
  app.post('/api/human-actions', async (req) =>
    oversight.createAction(writeActor(req), oversightContracts.humanActionSchema.parse(req.body)),
  );
  app.get('/api/human-actions/:id', async (req) =>
    oversight.action(authenticate(req), idOf(req.params)),
  );
  app.post('/api/human-actions/:id/update', async (req) =>
    oversight.reviseAction(
      writeActor(req),
      idOf(req.params),
      oversightContracts.reviseHumanActionSchema.parse(req.body),
    ),
  );
  app.post('/api/human-actions/:id/respond', async (req) =>
    oversight.respond(
      writeActor(req),
      idOf(req.params),
      oversightContracts.humanResponseSchema.parse(req.body),
    ),
  );
  app.post('/api/context/:id/answer', async (req) =>
    oversight.answer(
      writeActor(req),
      idOf(req.params),
      oversightContracts.answerSchema.parse(req.body),
    ),
  );
  app.post('/api/streams/:id/report', async (req) =>
    oversight.report(
      writeActor(req),
      idOf(req.params),
      oversightContracts.streamReportSchema.parse(req.body),
    ),
  );
  app.post('/api/streams/:id/move', async (req) =>
    oversight.move(
      writeActor(req),
      idOf(req.params),
      oversightContracts.moveStreamSchema.parse(req.body),
    ),
  );
  app.post('/api/streams/:id/coverage', async (req) =>
    oversight.cover(
      writeActor(req),
      idOf(req.params),
      oversightContracts.coverageSchema.parse(req.body),
    ),
  );
  app.get('/api/streams/:id/outputs', async (req) => {
    const p = pageSchema.parse(req.query);
    return oversight.outputs(authenticate(req), idOf(req.params), p.limit, p.offset);
  });
  app.get('/api/streams/:id/human-actions', async (req) => {
    const p = pageSchema.parse(req.query);
    return oversight.actions(authenticate(req), idOf(req.params), p.limit, p.offset);
  });
  app.post('/api/streams/:id/outputs', async (req) =>
    oversight.output(
      writeActor(req),
      idOf(req.params),
      streamContracts.outputSchema.parse(req.body),
    ),
  );
  app.get('/api/streams/:id/context', async (req) => {
    const p = pageSchema.parse(req.query);
    return streams.contextEntries(authenticate(req), idOf(req.params), p.limit, p.offset);
  });
  app.get('/api/streams/:id/events', async (req) => {
    const p = pageSchema.parse(req.query);
    return streams.events(authenticate(req), idOf(req.params), p.limit, p.offset);
  });
  app.post('/api/streams/:id/context', async (req) =>
    streams.recordContext(
      writeActor(req),
      idOf(req.params),
      streamContracts.contextEntrySchema.parse(req.body),
    ),
  );
  app.get('/api/context/:id', async (req) => streams.entry(authenticate(req), idOf(req.params)));
  app.post('/api/context/:id/resolve', async (req) =>
    streams.resolveContext(
      writeActor(req),
      idOf(req.params),
      streamContracts.resolveContextSchema.parse(req.body),
    ),
  );
  app.post('/api/work/:id/tracking', async (req) =>
    streams.updateChange(
      writeActor(req),
      idOf(req.params),
      streamContracts.changeUpdateSchema.parse(req.body),
    ),
  );
  app.post('/api/work/:id/outputs', async (req) =>
    streams.recordOutput(
      writeActor(req),
      idOf(req.params),
      streamContracts.outputSchema.parse(req.body),
    ),
  );
  app.get('/api/dependency-assessment', async (req) =>
    assessments.read(
      authenticate(req),
      assessmentContracts.assessmentTargetSchema.parse(req.query),
    ),
  );
  app.post('/api/dependencies/review', async (req) =>
    assessments.review(writeActor(req), assessmentContracts.assessmentReviewSchema.parse(req.body)),
  );
  app.post('/api/dependencies/assess', async (req) =>
    assessments.report(writeActor(req), assessmentContracts.assessmentReportSchema.parse(req.body)),
  );
  app.post('/api/work/:id/claims', async (req) =>
    streams.claim(writeActor(req), idOf(req.params), streamContracts.claimSchema.parse(req.body)),
  );
  app.post('/api/claims/:id', async (req) =>
    streams.renew(
      writeActor(req),
      idOf(req.params),
      streamContracts.renewClaimSchema.parse(req.body),
    ),
  );
  app.get('/api/workflow', async (req) => {
    streams.allow(authenticate(req));
    return {
      version: streamContracts.WORKFLOW_VERSION,
      instructions: streamContracts.workflowInstructions,
      loopProtocol: streamContracts.loopProtocol,
      capabilities: streamContracts.workflowCapabilities,
    };
  });
  app.get('/api/context', async (req) =>
    streams.context(
      authenticate(req),
      streamContracts.streamContextSchema.parse(req.query),
      req.headers['x-work-inbox-diagnostic'] === '1',
    ),
  );
  app.post('/api/worker/claim', async (req) => {
    const a = writeActor(req);
    z.object({}).strict().parse(req.body);
    return { run: service.claim(a) };
  });
  app.post('/api/worker/runs/:id', async (req) =>
    service.runUpdate(writeActor(req), idOf(req.params), runUpdateSchema.parse(req.body)),
  );
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api'))
      return reply.code(404).send({ message: 'API route not found.' });
    return reply.code(404).send({ message: 'Page not found. Open /.' });
  });
  if (options.publicDir && existsSync(options.publicDir))
    await app.register(serveStatic, { root: options.publicDir });
  return { app, auth, service, connections, streams, oversight, sync, dailyProgress };
}
