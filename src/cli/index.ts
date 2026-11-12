import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { desc } from 'drizzle-orm';
import { dataDir, origin } from '../config.js';
import { openStore } from '../db/index.js';
import { credentials, actors } from '../db/schema.js';
import { Auth } from '../services/auth.js';
import { WorkService } from '../services/work.js';
import { createSchema } from '../shared/contracts.js';
import { StreamService } from '../services/streams.js';
import { OversightService } from '../services/oversight.js';
import { SyncService } from '../services/sync.js';
import { z } from 'zod';
const store = openStore(join(dataDir, 'work.sqlite'));
const auth = new Auth(store);
const command = process.argv[2];
try {
  if (command === 'setup') {
    console.log(
      `Work Inbox initialized. Data: ${dataDir}\nStart the app with npm run build && npm start.`,
    );
    console.log(`Open ${origin} to use your local workspace. No sign-in is needed.`);
  } else if (command === 'agent') {
    const name = process.argv[3] || 'Local agent';
    const c = auth.register(command, name);
    const path = join(dataDir, `${command}.json`);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      path,
      JSON.stringify(
        { url: origin, token: c.secret, credentialId: c.id, actorId: c.actorId },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    chmodSync(path, 0o600);
    console.log(
      `${command} registered: ${name}\nCredential file: ${path}\nCredential ID: ${c.id}\nRevoke with: npm run revoke -- ${c.id}\nStart with: npm run --silent mcp\nIf this replaces a previous credential file, revoke its old credential using npm run credentials.`,
    );
  } else if (command === 'sync-feedback') {
    const connectionId = z.uuid().parse(process.argv[3]),
      enabled = z.enum(['on', 'off']).parse(process.argv[4]);
    const row = store.raw
      .prepare('SELECT credentialId FROM agent_connections WHERE id=?')
      .get(connectionId) as { credentialId: string } | undefined;
    if (!row) throw new Error('Connection not found.');
    const sync = new SyncService(new OversightService(new StreamService(new WorkService(store))));
    sync.permission(
      { id: 'owner', scope: 'owner', ownerId: 'owner' },
      row.credentialId,
      enabled === 'on',
    );
    console.log(
      `Chat feedback synchronization ${enabled === 'on' ? 'enabled' : 'disabled'} for this connection.`,
    );
  } else if (command === 'credentials') {
    const rows = store.db
      .select({
        id: credentials.id,
        actorId: credentials.actorId,
        scope: credentials.scope,
        createdAt: credentials.createdAt,
        expiresAt: credentials.expiresAt,
        revokedAt: credentials.revokedAt,
      })
      .from(credentials)
      .orderBy(desc(credentials.createdAt))
      .all();
    console.table(rows);
    console.table(
      store.db.select({ id: actors.id, name: actors.name, kind: actors.kind }).from(actors).all(),
    );
  } else if (command === 'revoke') {
    if (!process.argv[3]) throw new Error('Provide the credential ID.');
    auth.revoke(process.argv[3]);
    console.log('Credential revoked.');
  } else if (command === 'demo') {
    const service = new WorkService(store);
    store.db
      .insert(actors)
      .values({
        id: 'demo-source',
        workspaceId: 'local',
        ownerId: 'owner',
        kind: 'integration',
        name: 'Demo source',
      })
      .onConflictDoNothing()
      .run();
    const source = { id: 'demo-source', scope: 'agent' as const, ownerId: 'owner' };
    for (const item of [
      {
        title: '[Demo] Investigate flaky authentication test',
        objective: 'Investigate the cause of a flaky authentication test and record the findings.',
      },
      {
        title: '[Demo] Refactor date picker later',
        objective: 'Capture a follow-up for review after the current work.',
      },
    ])
      service.create(source, createSchema.parse({ ...item, idempotencyKey: item.title }));
    console.log('Two labeled demo items are available.');
  } else throw new Error('Use setup, agent, credentials, revoke, or demo.');
} finally {
  store.close();
}
