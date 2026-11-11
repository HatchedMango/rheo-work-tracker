export const activeStatuses = [
  'backlog',
  'accepted',
  'queued',
  'running',
  'review',
  'failed',
  'declined',
  'blocked',
] as const;
export const historyStatuses = ['delivered', 'completed', 'cancelled'] as const;
export const workStatuses = [...activeStatuses, ...historyStatuses] as const;
export type WorkStatus = (typeof workStatuses)[number];
export const statusLabels: Record<WorkStatus, string> = {
  backlog: 'Unstarted',
  accepted: 'Accepted',
  queued: 'Queued',
  running: 'Running',
  review: 'Review',
  failed: 'Failed',
  declined: 'Declined',
  blocked: 'Blocked',
  delivered: 'Delivered · reported',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export function workStatus(
  work: { lifecycle: string; tracking?: { progress: string } },
  run?: { state: string } | null,
  assignment?: { state: string } | null,
): WorkStatus {
  if (work.lifecycle !== 'open') return work.lifecycle as WorkStatus;
  if (work.tracking?.progress === 'delivered') return 'delivered';
  if (assignment?.state === 'covered') return 'accepted';
  if (run?.state === 'claimed' || run?.state === 'running') return 'running';
  if (run?.state === 'awaiting_review') return 'review';
  if (run?.state === 'queued' || run?.state === 'failed') return run.state;
  if (assignment?.state === 'accepted' || assignment?.state === 'declined') return assignment.state;
  return 'backlog';
}
