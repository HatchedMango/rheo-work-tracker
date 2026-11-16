import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Play, RotateCcw, X } from 'lucide-react';
import type { WorkChat } from '../../src/shared/work-chat.js';
import type { SessionRequest } from './Sessions.js';
export function StartWork({
  id,
  request,
  resumable,
}: {
  id: string;
  request: SessionRequest;
  resumable?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  const [data, setData] = useState<WorkChat | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState('');
  const [project, setProject] = useState(''),
    [client, setClient] = useState<'codex' | 'claude-code'>('codex');
  useEffect(() => {
    if (resumable !== undefined) return;
    let alive = true;
    request<WorkChat>(`/work/${id}/chat`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, request, resumable]);
  async function prepare(options?: { project: string; client: 'codex' | 'claude-code' }) {
    setBusy(true);
    setError('');
    setCopied('');
    try {
      const d = await request<WorkChat>(`/work/${id}/chat`, options);
      setData(d);
      setProject(d.destination.project);
      setClient(d.destination.client);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare this chat.');
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied`);
    } catch {
      setError('Copy was unavailable. Select and copy the text below.');
    }
  }
  const resume = resumable ?? data?.mode === 'resume';
  return (
    <>
      <button
        type="button"
        className="work-chat-action"
        onClick={() => {
          setData(null);
          dialog.current?.showModal();
          void prepare();
        }}
      >
        {resume ? (
          <RotateCcw size={12} aria-hidden="true" />
        ) : (
          <Play size={12} aria-hidden="true" />
        )}
        {resume ? 'Resume work' : 'Start work'}
      </button>
      <dialog
        className="compose-dialog work-chat-dialog"
        ref={dialog}
        aria-labelledby={titleId}
        onCancel={() => dialog.current?.close()}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{data?.mode === 'resume' ? 'Resume work' : 'Start work'}</h2>
          <button
            className="icon-button"
            aria-label="Close chat handoff"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        {busy && <p role="status">Preparing current work context…</p>}
        {error && (
          <p className="error" role="alert">
            {error}{' '}
            <button className="text-button" onClick={() => void prepare()}>
              Retry
            </button>
          </p>
        )}
        {data && !busy && (
          <>
            <h3>{data.title}</h3>
            <p>
              {data.mode === 'start'
                ? 'A fresh chat will receive a focused brief for this change.'
                : 'Continue this change in its existing chat with the current brief.'}
            </p>
            {data.mode === 'start' && (
              <form
                className="chat-destination"
                onSubmit={(e) => {
                  e.preventDefault();
                  void prepare({ project, client });
                }}
              >
                <label>
                  Open with
                  <select
                    value={client}
                    onChange={(e) => {
                      const selected = e.target.value as typeof client;
                      setClient(selected);
                      if (project && !data.projectRequired)
                        void prepare({ project, client: selected });
                    }}
                  >
                    <option value="codex">Codex</option>
                    <option value="claude-code">Claude Code</option>
                  </select>
                </label>
                {data.projectRequired && (
                  <>
                    <label>
                      Project folder
                      <input
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                        placeholder="/absolute/path/to/project"
                        required
                      />
                    </label>
                    <button className="secondary" type="submit">
                      Use this folder
                    </button>
                  </>
                )}
              </form>
            )}
            {data.projectRequired && data.mode === 'resume' && (
              <p className="error">This chat’s project folder is unavailable.</p>
            )}
            {data.draftUrl && (
              <a
                className="button work-chat-primary"
                href={data.draftUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Codex draft <ArrowUpRight size={14} />
              </a>
            )}
            {data.mode === 'resume' && data.destination.client === 'codex' && (
              <div className="button-row">
                <button className="primary" onClick={() => void copy(data.brief, 'Current brief')}>
                  Copy current brief
                </button>
                {data.conversationUrl ? (
                  <a
                    className="work-chat-primary"
                    href={data.conversationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open existing chat <ArrowUpRight size={14} />
                  </a>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => void copy(data.sessionId!, 'Session ID')}
                  >
                    Copy session ID
                  </button>
                )}
              </div>
            )}
            {data.command && (
              <button
                className="primary"
                onClick={() => void copy(data.command!, 'Terminal command')}
              >
                Copy {data.mode === 'resume' ? 'resume' : 'start'} command
              </button>
            )}
            {data.mode === 'resume' && data.destination.client === 'codex' && (
              <p className="fine">Paste the current brief into the chat before continuing.</p>
            )}
            {data.destination.client === 'claude-code' && (
              <p className="fine">
                Run the command in your terminal to{' '}
                {data.mode === 'resume' ? 'resume this session' : 'start a fresh session'} with this
                brief.
              </p>
            )}
            {copied && (
              <p className="fine" role="status">
                {copied}
              </p>
            )}
            <details className="starting-brief">
              <summary>Current brief</summary>
              <textarea aria-label="Current work brief" value={data.brief} readOnly rows={12} />
              <button
                className="text-button"
                onClick={() => void copy(data.brief, 'Current brief')}
              >
                Copy brief
              </button>
            </details>
            {data.command && (
              <details>
                <summary>Terminal command</summary>
                <textarea
                  aria-label="Chat terminal command"
                  value={data.command}
                  readOnly
                  rows={4}
                />
              </details>
            )}
            <p className="fine">
              Preparing or opening a chat leaves the work’s status unchanged. Codex drafts are not
              sent automatically.
            </p>
          </>
        )}
      </dialog>
    </>
  );
}
