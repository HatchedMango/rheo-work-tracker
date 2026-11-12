import type { ReactNode } from 'react';
import { CircleCheck } from 'lucide-react';
import type { Status } from '../../src/services/work.js';

const tones: Record<string, string> = {
  active: 'info',
  covered: 'info',
  working: 'info',
  running: 'info',
  claimed: 'info',
  detected: 'info',
  current: 'info',
  available: 'info',
  integrated: 'info',
  delivered: 'info',
  proposed: 'attention',
  needs_decision: 'attention',
  pending: 'attention',
  review: 'attention',
  awaiting_review: 'attention',
  blocked: 'attention',
  stale: 'attention',
  completed: 'success',
  closed: 'success',
  verified: 'success',
  accepted: 'success',
  done: 'success',
  failed: 'danger',
};
export function StatusBadge({
  state,
  label,
  children,
  className = '',
}: {
  state: string;
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const content = children ?? label ?? state.replaceAll('_', ' ');
  const text =
    typeof content === 'string' ? content.charAt(0).toUpperCase() + content.slice(1) : content;
  return (
    <span className={`badge ${state} ${className}`.trim()} data-tone={tones[state] ?? 'neutral'}>
      {state === 'verified' && <CircleCheck size={13} aria-hidden="true" />}
      {text}
    </span>
  );
}
export function WorkerStatus({ workers = [] }: { workers?: Status['workers'] }) {
  const connected = workers.some((worker) => worker.online);
  return (
    <span className="worker-status">
      <span className={`dot${connected ? ' online' : ''}`} aria-hidden="true" />
      <span>{connected ? 'Execution worker connected' : 'No execution worker connected'}</span>
    </span>
  );
}
