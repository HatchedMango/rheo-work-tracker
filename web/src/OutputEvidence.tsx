import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { OutputEvidence } from '../../src/shared/output-evidence.js';
import type { SessionRequest } from './Sessions.js';

export function OutputEvidenceView({
  workId,
  version,
  request,
}: {
  workId: string;
  version: string;
  request: SessionRequest;
}) {
  // A completed request for a previous selection must not replace this work's evidence.
  return <SelectedOutputEvidence key={`${workId}:${version}`} workId={workId} request={request} />;
}

function SelectedOutputEvidence({ workId, request }: { workId: string; request: SessionRequest }) {
  const [data, setData] = useState<OutputEvidence | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    request<OutputEvidence>(`/work/${workId}/output-evidence`)
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setError('Output evidence could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [workId, request]);
  async function check(id: string, revision: number) {
    setBusy(id);
    setError('');
    try {
      await request(`/work/${workId}/outputs/${id}/observe`, { revision });
      setData(await request<OutputEvidence>(`/work/${workId}/output-evidence`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GitLab could not be checked.');
    } finally {
      setBusy(null);
    }
  }
  if (!data && !error)
    return (
      <p className="muted" role="status">
        Loading output evidence…
      </p>
    );
  return (
    <div className="output-evidence-list">
      {!!data?.omittedOutputs && (
        <small className="muted">{data.omittedOutputs} older outputs are outside this view.</small>
      )}
      {data?.outputs.map((output) => {
        const observed = output.observation;
        return (
          <article className="output" key={output.id}>
            <a href={output.url} target="_blank" rel="noopener noreferrer">
              {output.label}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            <small className="muted">
              {output.state} · reported by {output.actorName}
            </small>
            <details className="output-evidence">
              <summary>Reported evidence</summary>
              <small>
                {output.kind} · {new Date(output.reportedAt).toLocaleString()}
              </small>
              {output.codeRevision && <code>{output.codeRevision}</code>}
            </details>
            {observed && (
              <p className="output-observation">
                {observed.status === 'observed'
                  ? `GitLab: ${observed.mrState}`
                  : 'GitLab check unavailable'}
                {observed.status === 'observed' && observed.pipelineStatus
                  ? ` · pipeline ${observed.pipelineStatus}`
                  : ''}
                <small className="muted">
                  Checked {new Date(observed.checkedAt).toLocaleString()}
                  {!observed.applicable ? ' · earlier or different output revision' : ''}
                </small>
                {observed.codeRevision && (
                  <code title={observed.codeRevision}>{observed.codeRevision.slice(0, 12)}</code>
                )}
                {observed.status === 'observed' ? (
                  <small className="mr-readiness">
                    {observed.mergeStatus
                      ? `Merge status: ${observed.mergeStatus.replaceAll('_', ' ')}`
                      : 'Merge status unavailable'}
                    {' · '}
                    {observed.hasConflicts === true
                      ? 'Conflicts detected'
                      : observed.hasConflicts === false
                        ? 'No conflicts reported'
                        : 'Conflicts not confirmed'}
                    {' · '}
                    {observed.discussionsResolved === true
                      ? 'Blocking discussions resolved'
                      : observed.discussionsResolved === false
                        ? 'Unresolved blocking discussions'
                        : 'Discussion status unavailable'}
                    {observed.draft === true ? ' · Draft' : ''}
                  </small>
                ) : (
                  <small>{observed.message}</small>
                )}
              </p>
            )}
            {output.kind === 'mr' && (
              <>
                {data.configured ? (
                  <button
                    className="text-button"
                    disabled={busy !== null}
                    onClick={() => void check(output.id, output.revision)}
                  >
                    {busy === output.id ? 'Checking GitLab…' : 'Check GitLab'}
                  </button>
                ) : (
                  <small className="muted">
                    Set up read-only GitLab access in Connections to check this MR.
                  </small>
                )}
              </>
            )}
          </article>
        );
      })}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}

type GitLabStatus = {
  configured: boolean;
  origin: string | null;
  managed: boolean;
  storage: 'keychain' | 'file';
};
export function GitLabConnection({ request }: { request: SessionRequest }) {
  const [status, setStatus] = useState<GitLabStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [origin, setOrigin] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request<GitLabStatus>('/integrations/gitlab')
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setError('GitLab access settings could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [request]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setStatus(await request<GitLabStatus>('/integrations/gitlab', { origin, token }));
      setToken('');
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GitLab access could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      setStatus(await request<GitLabStatus>('/integrations/gitlab/disconnect', {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GitLab access could not be removed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="settings-card gitlab-connection">
      <h2>GitLab evidence</h2>
      <p>
        Check linked merge requests and pipelines. Rheo only reads GitLab; reported work and daily
        progress stay separate.
      </p>
      {status?.configured && (
        <p>Access saved for {status.origin}. An MR check verifies whether the access works.</p>
      )}
      {status && (
        <p className="muted">
          {status.storage === 'keychain'
            ? 'Tokens are stored in macOS Keychain.'
            : 'Tokens use protected local files on this installation.'}
        </p>
      )}
      {status?.managed ? (
        <p className="muted">Access is managed outside Rheo on this Mac.</p>
      ) : !editing ? (
        <div className="button-row">
          <button
            className="secondary"
            disabled={!status || busy}
            onClick={() => {
              setOrigin(status?.origin ?? 'https://gitlab.com');
              setEditing(true);
            }}
          >
            {status?.configured ? 'Update GitLab access' : 'Set up GitLab'}
          </button>
          {status?.configured && (
            <button className="text-button" disabled={busy} onClick={() => void disconnect()}>
              Remove GitLab access
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={(e) => void save(e)}>
          <label>
            GitLab URL
            <input
              type="url"
              required
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://gitlab.example.com"
            />
          </label>
          <label>
            Read-only access token
            <input
              type="password"
              autoComplete="off"
              required
              minLength={10}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p className="muted">
            Use read_api access, preferably scoped to the project. The token stays in{' '}
            {status?.storage === 'keychain' ? 'macOS Keychain' : 'protected local storage'}.
          </p>
          <div className="button-row">
            <button className="primary" disabled={busy}>
              Save GitLab access
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setToken('');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
