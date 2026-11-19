import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FolderOpen, X } from 'lucide-react';
import type { AgentConnection } from '../../src/services/connections.js';
import type { ExistingWorkPlan, ExistingWorkStatus } from '../../src/services/existing-work.js';
import { clientLabels } from '../../src/shared/connection-clients.js';

type Request = <T>(path: string, body?: unknown) => Promise<T>;

export function ExistingWorkSetup({
  connection,
  request,
  onClose,
}: {
  connection: AgentConnection;
  request: Request;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const folderInput = useRef<HTMLTextAreaElement>(null);
  const [folders, setFolders] = useState('');
  const [plan, setPlan] = useState<ExistingWorkPlan | null>(null);
  const [since, setSince] = useState(0);
  const [status, setStatus] = useState<ExistingWorkStatus | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const draftKey = `work-inbox.existing-work.${connection.id}`;
  const endpoint = `/connections/${connection.id}/existing-work`;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    folderInput.current?.focus();
    return () => element.close();
  }, []);

  useEffect(() => {
    if (plan)
      dialog.current?.querySelector<HTMLButtonElement>('.existing-projects button')?.focus();
  }, [plan]);

  useEffect(() => {
    let disposed = false;
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (
        draft &&
        Array.isArray(draft.projects) &&
        draft.projects.every((x: unknown) => typeof x === 'string') &&
        Number.isSafeInteger(draft.since) &&
        draft.since >= 0 &&
        draft.since <= Date.now()
      ) {
        setFolders(draft.projects.join('\n'));
        setBusy(true);
        void request<ExistingWorkPlan>(endpoint, { projects: draft.projects })
          .then((result) => {
            if (!disposed) {
              setPlan(result);
              setSince(draft.since);
            }
          })
          .catch((e) => {
            if (!disposed) setError((e as Error).message);
          })
          .finally(() => {
            if (!disposed) setBusy(false);
          });
      }
    } catch {
      /* Browser storage is optional. */
    }
    return () => {
      disposed = true;
    };
  }, [draftKey, endpoint, request]);

  useEffect(() => {
    if (!plan) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ projects: plan.projects.map((p) => p.project), since }),
      );
    } catch {
      /* Prompts and credentials are never stored in the browser draft. */
    }
  }, [plan, since, draftKey]);

  useEffect(() => {
    if (!plan) return;
    let disposed = false;
    const poll = async () => {
      try {
        const result = await request<ExistingWorkStatus>(`${endpoint}/status`, {
          projects: plan.projects.map((p) => p.project),
          since,
        });
        if (!disposed) {
          setStatus(result);
          setStatusError('');
        }
      } catch (e) {
        if (!disposed) setStatusError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!document.hidden) void poll();
    }, 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [plan, since, endpoint, request]);

  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const result = await request<ExistingWorkPlan>(endpoint, {
        projects: folders
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
      });
      setSince(result.preparedAt);
      setPlan(result);
      setStatus(null);
      setCopied('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(project: ExistingWorkPlan['projects'][number]) {
    try {
      await navigator.clipboard.writeText(project.prompt);
      setCopied(project.project);
      setError('');
    } catch {
      setError('Clipboard unavailable. Open the project prompt below to copy it manually.');
    }
  }

  function close() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog
      className="compose-dialog existing-work-dialog"
      ref={dialog}
      aria-labelledby="existing-work-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="connection-step">
            {clientLabels[connection.client]} · {connection.name}
          </span>
          <h2 id="existing-work-title">Set up existing work</h2>
        </div>
        <button className="icon-button" aria-label="Close existing work setup" onClick={close}>
          <X size={18} />
        </button>
      </div>
      {!plan ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void prepare();
          }}
        >
          <p>Bring your active projects into Rheo with the context your agent already has.</p>
          <label>
            Project folders
            <textarea
              ref={folderInput}
              rows={4}
              value={folders}
              onChange={(e) => setFolders(e.target.value)}
              placeholder={'/Users/you/projects/client-app\n/Users/you/projects/api'}
              required
              maxLength={40960}
              aria-describedby="project-folder-help"
            />
          </label>
          <p className="fine" id="project-folder-help">
            Paste one full folder path per line, up to 10 projects. In Finder, select a folder and
            press ⌥⌘C to copy its path.
          </p>
          <p className="fine">
            Each project gets a prompt for its existing agent chat. Your agent captures current work
            and reuses matching streams.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <button type="button" className="secondary" onClick={close}>
              Later
            </button>
            <button className="primary" disabled={busy || !folders.trim()}>
              {busy ? 'Preparing…' : 'Prepare project prompts'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            Open each project’s current {clientLabels[connection.client]} chat and paste its prompt.
            Your agent will capture unfinished work, keep important decisions, and set up ongoing
            tracking.
          </p>
          <ul className="existing-projects">
            {plan.projects.map((project) => {
              const progress = status?.projects.find((p) => p.project === project.project);
              return (
                <li key={project.project}>
                  <div className="existing-project-heading">
                    <FolderOpen size={18} />
                    <h3>{project.project.split('/').filter(Boolean).at(-1) || project.project}</h3>
                  </div>
                  <p className="existing-project-path">{project.project}</p>
                  <button className="primary" onClick={() => void copy(project)}>
                    <Copy size={14} />
                    {copied === project.project ? 'Copied' : 'Copy project prompt'}
                  </button>
                  <div className="existing-project-progress" role="status">
                    <span className={progress?.contextAt ? 'observed' : ''}>
                      {progress?.contextAt ? (
                        <Check size={14} />
                      ) : (
                        <span className="progress-dot" />
                      )}
                      Context {progress?.contextAt ? 'received' : 'not received yet'}
                    </span>
                    <span className={progress?.checkpointAt ? 'observed' : ''}>
                      {progress?.checkpointAt ? (
                        <Check size={14} />
                      ) : (
                        <span className="progress-dot" />
                      )}
                      {progress?.checkpointAt
                        ? 'Checkpoint saved'
                        : progress?.needsUpdate
                          ? 'Waiting for the chat’s latest checkpoint'
                          : 'Checkpoint not received yet'}
                    </span>
                  </div>
                  <details>
                    <summary>View project prompt</summary>
                    <pre className="connection-code" tabIndex={0}>
                      {project.prompt}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ul>
          <p className="fine">
            These signals show what Rheo has received since setup began. Your agent will explain any
            remaining client reload or hook setup.
          </p>
          {statusError && (
            <p className="error" role="alert">
              Progress could not refresh: {statusError}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <button
              className="secondary"
              onClick={() => {
                setPlan(null);
                setError('');
                setStatusError('');
              }}
            >
              Change projects
            </button>
            <button className="primary" onClick={close}>
              Done for now
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
