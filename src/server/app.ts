import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionService } from '../services/connections.js';
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
  },
) {
  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] }
      : false,
    bodyLimit: 64 * 1024,
  });
  const auth = new Auth(store, options.clock);
  const service = new WorkService(store, options.clock, options.allowSimulation);
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
  return { app, auth, service, connections };
}
