import { DependencyAssessmentView } from './DependencyAssessment.js';
import { StatusBadge } from './UI.js';
import { ChevronRight, ArrowUpRight } from 'lucide-react';
import type { Detail } from '../../src/db/schema.js';
import { WorkContent, BriefContent } from './WorkContent.js';
const date = (n: number) =>
  new Date(n).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export function ChangeTrackingView({
  work,
  onStream,
  onChange,
}: {
  work: Detail;
  onStream: (id: string) => void;
  onChange: (id: string) => void;
}) {
  const m = work.tracking;
  return (
    <>
      {m.streamId && (
        <button className="text-button stream-link" onClick={() => onStream(m.streamId!)}>
          Stream: {m.streamTitle}
          <ChevronRight size={14} />
        </button>
      )}
      {m.progressNote && (
        <section className="detail-section" aria-label="Latest update">
          <h3>Latest update</h3>
          <BriefContent text={m.progressNote} />
        </section>
      )}
      {m.prerequisites.some((d) => !d.satisfied) && (
        <section className="detail-section" aria-label="Waiting on">
          <h3>Waiting on</h3>
          {m.prerequisites
            .filter((d) => !d.satisfied)
            .map((d) => (
              <div className="dependency" key={d.source.id + d.stage}>
                <button
                  className="text-button"
                  onClick={() =>
                    d.source.kind === 'change'
                      ? onChange(d.source.id)
                      : m.streamId &&
                        onStream(d.source.kind === 'stream' ? d.source.id : m.streamId)
                  }
                >
                  {d.title}
                  <ChevronRight size={14} />
                </button>
                <BriefContent text={d.reason} limit={160} />
              </div>
            ))}
        </section>
      )}
      {m.outputs.length > 0 && (
        <section className="detail-section" aria-label="Reported outputs">
          <h3>
            Outputs <span className="subtle-count">{m.outputs.length}</span>
          </h3>
          {m.outputs.map((o) => (
            <article className="output" key={o.id}>
              <a href={o.url} target="_blank" rel="noopener noreferrer">
                {o.label}
                <ArrowUpRight size={14} />
              </a>
              <details className="output-evidence">
                <summary>Evidence</summary>
                <small>
                  {o.kind} · {o.state} reported by {o.actorName} · {date(o.reportedAt)}
                </small>
                {o.codeRevision && <code>{o.codeRevision}</code>}
              </details>
            </article>
          ))}
        </section>
      )}
      {(m.expectedOutput ||
        m.progress !== 'unreported' ||
        m.claim ||
        m.assessmentState !== 'unknown' ||
        m.prerequisites.length > 0 ||
        m.areas.length > 0 ||
        m.resources.length > 0 ||
        m.baseRef ||
        m.streamId) && (
        <details className="detail-section tracking-details" aria-label="Change tracking">
          <summary>Tracking details</summary>
          {m.expectedOutput && (
            <>
              <h4>Expected output</h4>
              <WorkContent text={m.expectedOutput} />
            </>
          )}
          {m.progress !== 'unreported' && (
            <div className="reported-progress">
              <StatusBadge state={m.progress} label={m.progress} />
              <small>
                Reported by {m.reporterName}
                {m.reportedAt ? ` · ${date(m.reportedAt)}` : ''}
              </small>
              {m.progressNote && <WorkContent text={m.progressNote} />}
            </div>
          )}
          {m.claim && (
            <p className="claim-summary">
              {m.claim.state === 'active'
                ? `Claimed by ${m.claim.actorName} until ${date(m.claim.expiresAt)}`
                : `${m.claim.actorName} · claim ${m.claim.state}`}{' '}
              {m.claim.planRevision !== m.planRevision && <span>· Plan changed since claim</span>}
            </p>
          )}
          <DependencyAssessmentView assessment={m.dependencyAssessment} />
          {m.dependencyAssessment.state === 'legacy' && (
            <div className="dependency-heading">
              <h4>Prerequisites</h4>
              <StatusBadge className="assessment" state={m.assessmentState}>
                {m.assessmentState === 'unknown'
                  ? 'Not assessed'
                  : m.assessmentState === 'stale'
                    ? 'Assessment stale'
                    : 'Agent assessed'}
              </StatusBadge>
            </div>
          )}
          {!m.prerequisites.length && m.assessmentState !== 'unknown' && (
            <p className="muted">No prerequisites recorded.</p>
          )}
          {m.coverageApprovalId && (
            <p className="muted">
              Historical scope coverage
              {m.coverage ? ` · scope ${m.coverage.scopeRevision}` : ''}
            </p>
          )}
          {m.prerequisites
            .filter((d) => d.source.kind !== 'change')
            .map((d) => (
              <div className="dependency" key={d.source.id + d.stage}>
                <button
                  className="text-button"
                  onClick={() =>
                    m.streamId && onStream(d.source.kind === 'stream' ? d.source.id : m.streamId)
                  }
                >
                  {d.title}
                  <ChevronRight size={14} />
                </button>
                <p>
                  {d.stage === 'start' ? 'Before starting' : 'Before delivering'}:{' '}
                  {d.condition.replaceAll('_', ' ')} ·{' '}
                  {d.satisfied ? `${d.evidence} satisfied` : 'unconfirmed'}
                </p>
                <WorkContent text={d.reason} />
              </div>
            ))}
          {m.dependencies.map((d) => (
            <div className="dependency" key={`${d.requiresId}:${d.stage}`}>
              <button className="text-button" onClick={() => onChange(d.requiresId)}>
                {d.title}
                <ChevronRight size={14} />
              </button>
              <p>
                {d.stage === 'start' ? 'Before starting' : 'Before integrating'}:{' '}
                {d.condition === 'integrated' ? 'integrated' : 'output available'} ·{' '}
                {d.satisfied ? 'reported satisfied' : 'unconfirmed'}
              </p>
              <WorkContent text={d.reason} />
            </div>
          ))}
          {m.areas.length > 0 && <p className="tracking-meta">Areas: {m.areas.join(', ')}</p>}
          {m.resources.length > 0 && (
            <p className="tracking-meta">Exclusive resources: {m.resources.join(', ')}</p>
          )}
          {m.baseRef && <p className="tracking-meta">Base: {m.baseRef}</p>}
        </details>
      )}
    </>
  );
}
