import { useEffect, useState } from 'react';
import type { DesignContextPage, DesignTarget } from '../../src/shared/design-context.js';
import type { SessionRequest } from './Sessions.js';
import { WorkContent } from './WorkContent.js';
export function DesignContextView({
  target,
  version,
  request,
}: {
  target: DesignTarget;
  version: string;
  request: SessionRequest;
}) {
  return (
    <SelectedDesignContext
      key={`${target.kind}:${target.id}:${version}`}
      target={target}
      request={request}
    />
  );
}
function SelectedDesignContext({
  target,
  request,
}: {
  target: DesignTarget;
  request: SessionRequest;
}) {
  const [page, setPage] = useState<DesignContextPage | null>(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPage(null);
    setError('');
    request<DesignContextPage>(
      `/design-context?kind=${target.kind}&id=${target.id}&offset=${offset}`,
    )
      .then((data) => {
        if (active) setPage(data);
      })
      .catch(() => {
        if (active) setError('Design context could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [target.kind, target.id, offset, request]);
  if (error) return <p role="alert">{error}</p>;
  if (!page || (!page.total && !page.reviewTotal)) return null;
  return (
    <section className="detail-section design-context" aria-label="Design context">
      <h3>Design context</h3>
      {page.reviews
        .filter((r) => r.needsReview)
        .map((r) => (
          <div className="design-review" key={r.assumptionId} role="status">
            <strong>Assumption changed — review this work</strong>
            <WorkContent text={r.statement} />
            <p>
              Reviewed revision {r.assumptionRevision}; current revision {r.currentRevision} ·{' '}
              {r.status}. Work status is unchanged.
            </p>
          </div>
        ))}
      {page.items.map(
        ({
          id,
          record,
          revision,
          actorName,
          target: scope,
          inherited,
          linked,
          criterionChanged,
        }) => (
          <details className="context-entry" key={id}>
            <summary>
              {record.kind === 'verification'
                ? `Criterion ${record.criterionIndex + 1}: ${record.result}${criterionChanged ? ' · criterion changed' : ''}`
                : `${record.kind === 'invariant' ? 'Invariant' : 'Assumption'}: ${record.statement}`}
            </summary>
            <p className="muted">
              {scope.kind} scope
              {inherited
                ? ' · inherited invariant'
                : linked
                  ? ' · explicitly linked assumption'
                  : ''}{' '}
              · revision {revision} · {actorName}
            </p>
            {record.kind === 'assumption' && (
              <>
                <p>
                  <strong>Status:</strong> {record.status}
                </p>
                <h4>Evidence</h4>
                <WorkContent text={record.evidence} />
                <h4>Would be invalidated by</h4>
                <WorkContent text={record.invalidatedBy} />
              </>
            )}
            {record.kind === 'invariant' && (
              <>
                <p>
                  <strong>Applies to:</strong> {record.applicability}
                </p>
                <p>
                  {record.status} ·{' '}
                  {record.inherit ? 'Includes this stream’s descendants' : 'Exact scope only'}
                </p>
              </>
            )}
            {record.kind === 'verification' && (
              <>
                <WorkContent text={record.criterion} />
                {criterionChanged && (
                  <p role="status">This evidence describes an older criterion.</p>
                )}
                <p>
                  {record.method} · checked {new Date(record.checkedAt).toLocaleString()} · code{' '}
                  {record.codeRevision}
                </p>
                <h4>Evidence</h4>
                <WorkContent text={record.evidence} />
                <h4>Conditions</h4>
                <WorkContent text={record.conditions} />
                <h4>Limitations</h4>
                <WorkContent text={record.limitations} />
                <p className="muted">
                  Reported evidence for these conditions; does not establish delivery.
                </p>
              </>
            )}
            {record.references.map((ref) => (
              <a
                className="reference"
                key={ref.system + ref.url}
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ref.system}
              </a>
            ))}
          </details>
        ),
      )}
      {(offset > 0 || page.nextOffset !== null || page.reviewNextOffset !== null) && (
        <div className="action-buttons">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 12))}>
            Previous context
          </button>
          <button
            disabled={page.nextOffset === null && page.reviewNextOffset === null}
            onClick={() => setOffset(offset + 12)}
          >
            More context
          </button>
        </div>
      )}
    </section>
  );
}
