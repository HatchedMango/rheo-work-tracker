import type { DependencyAssessment } from './dependency-assessments.js';
export function relationshipLabel(a: DependencyAssessment) {
  if (a.state === 'stale') return 'Links need rechecking';
  if (a.state === 'uncertain') return 'Links uncertain';
  if (a.state === 'legacy') return 'Not fully assessed';
  if (a.state === 'unassessed') return 'Links unassessed';
  return a.start?.result === 'none' && a.deliver?.result === 'none'
    ? 'No prerequisites'
    : 'Dependencies recorded';
}
