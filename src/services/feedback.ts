import type { Store } from '../db/index.js';
import type { Actor } from '../shared/contracts.js';
import type { FeedbackOrigin } from '../shared/sync.js';
import { ensure } from './errors.js';
// Only shared domain transitions may use this capability; an HTTP payload never
// becomes an owner Actor. All resulting records retain the reporting agent.
export function allowFeedback(store: Store, a: Actor, source?: FeedbackOrigin) {
  if (!source) {
    ensure(
      a.scope === 'owner' && a.id === 'owner',
      403,
      'This credential cannot perform that action. Only the local owner can respond directly.',
    );
    return;
  }
  const permission = a.credentialId
    ? (store.raw
        .prepare(
          "SELECT p.relayFeedback FROM workflow_permissions p JOIN credentials c ON c.id=p.credentialId WHERE p.credentialId=? AND c.actorId=? AND c.scope='agent' AND c.revokedAt IS NULL",
        )
        .get(a.credentialId, a.id) as { relayFeedback: number } | undefined)
    : undefined;
  ensure(
    a.scope === 'agent' && a.ownerId === 'owner' && permission?.relayFeedback === 1,
    403,
    'Chat feedback synchronization is not enabled for this connection.',
  );
}
