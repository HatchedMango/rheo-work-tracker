import type { DependencyAssessment } from '../../src/shared/dependency-assessments.js';
import { relationshipLabel } from '../../src/shared/dependency-presentation.js';
import { BriefContent } from './WorkContent.js';
export function DependencyAssessmentView({ assessment: a }: { assessment: DependencyAssessment }) {
  return (
    <details className="relationship-details">
      <summary>{relationshipLabel(a)}</summary>
      {a.state === 'unassessed' && <p>Prerequisites have not been assessed.</p>}
      {a.state === 'legacy' && (
        <p>An earlier assessment has no explicit start and delivery report.</p>
      )}
      {a.state === 'stale' && <p>Related work or scope changed after this assessment.</p>}
      {a.coverage === 'partial' && <p>Only part of the scope was reviewed.</p>}
      {(['start', 'deliver'] as const).map((stage) => {
        const s = a[stage];
        return (
          s && (
            <div key={stage} className="relationship-stage">
              <h4>
                {stage === 'start' ? 'Before starting' : 'Before delivering'} ·{' '}
                {s.result === 'none'
                  ? 'None identified'
                  : s.result === 'linked'
                    ? 'Prerequisites recorded'
                    : 'Uncertain'}
              </h4>
              <BriefContent text={s.reason} limit={180} />
              {s.result === 'uncertain' && (
                <BriefContent text={'Next: ' + s.nextStep} limit={180} />
              )}
            </div>
          )
        );
      })}
      {a.id && (
        <p className="fine">
          Assessed within {a.scopeTitle} · {a.actorName}
          {a.reportedAt
            ? ' · ' +
              new Date(a.reportedAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
            : ''}
          . This is a reported assessment.
        </p>
      )}
    </details>
  );
}
