import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { actors, credentials } from '../db/schema.js';
import type { Store } from '../db/index.js';
import type { Actor, Scope } from '../shared/contracts.js';
import { AppError, ensure } from './errors.js';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export class Auth {
  constructor(
    public store: Store,
    public clock: () => number = Date.now,
  ) {}
  issue(scope: 'agent' | 'worker' | 'session', actorId = 'owner', expiresAt: number | null = null) {
    const secret = randomBytes(32).toString('base64url');
    const id = randomUUID();
    this.store.db
      .insert(credentials)
      .values({ id, actorId, hash: hash(secret), scope, createdAt: this.clock(), expiresAt })
      .run();
    return { id, secret };
  }
  register(scope: 'worker' | 'agent', name: string) {
    return this.store.raw
      .transaction(() => {
        const actorId = randomUUID();
        this.store.db
          .insert(actors)
          .values({ id: actorId, workspaceId: 'local', kind: scope, name, ownerId: 'owner' })
          .run();
        return { ...this.issue(scope, actorId), actorId };
      })
      .immediate();
  }
  lookup(secret: string) {
    const c = this.store.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.hash, hash(secret)), isNull(credentials.revokedAt)))
      .get();
    ensure(
      c && (c.expiresAt === null || c.expiresAt > this.clock()),
      401,
      'Local session expired or credential is invalid.',
    );
    return c;
  }
  actor(secret: string, transport: 'bearer' | 'cookie'): Actor {
    const c = this.lookup(secret);
    ensure(
      transport === 'cookie' ? c.scope === 'session' : ['agent', 'worker'].includes(c.scope),
      403,
      'Credential is not valid for this interface.',
    );
    const a = this.store.db.select().from(actors).where(eq(actors.id, c.actorId)).get();
    ensure(a, 401, 'Unknown actor.');
    return {
      id: a.id,
      scope: c.scope === 'session' ? 'owner' : (c.scope as Scope),
      ownerId: a.ownerId,
      credentialId: c.id,
    };
  }
  // Browser access is local and automatic. This cookie isolates the API from other sites;
  // it is not an account login or a barrier against processes running as the local user.
  localSession(existing?: string): string | null {
    if (existing) {
      try {
        const actor = this.actor(existing, 'cookie');
        if (actor.id === 'owner' && actor.ownerId === 'owner') return null;
      } catch (error) {
        if (!(error instanceof AppError && [401, 403].includes(error.status))) throw error;
      }
    }
    return this.issue('session', 'owner', this.clock() + 7 * 24 * 3600_000).secret;
  }
  revoke(id: string) {
    this.store.db
      .update(credentials)
      .set({ revokedAt: this.clock() })
      .where(eq(credentials.id, id))
      .run();
  }
}
