import { useEffect, useRef, useState } from 'react';
import { X, Copy, ArrowUpRight, Check } from 'lucide-react';
import type { AgentConnection, AgentSetup } from '../../src/services/connections.js';
import type { ConnectionClient } from '../../src/shared/connections.js';
import { clientLabels } from '../../src/shared/connection-clients.js';

type Request = <T>(path: string, body?: unknown) => Promise<T>;
const stateLabels = {
  pending: 'Awaiting agent',
  detected: 'Client detected',
  verified: 'Verified',
  disconnected: 'Disconnected',
};
const docs = {
  codex: 'https://developers.openai.com/codex/mcp',
  'claude-code': 'https://code.claude.com/docs/en/mcp',
  'claude-desktop': 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
  other: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
};
const draftKey = 'work-inbox.connection-setup';
const testPrompt = 'Use Work Inbox to list my work.';
function date(n: number) {
  return new Date(n).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export function Connections({ request }: { request: Request }) {
  const [items, setItems] = useState<AgentConnection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<'choose' | 'configure' | 'verify' | null>(null);
  const [client, setClient] = useState<ConnectionClient>('codex');
  const [name, setName] = useState('');
  const [setup, setSetup] = useState<AgentSetup | null>(null);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [refresh, setRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const result = await request<{ items: AgentConnection[] }>('/connections');
        if (!disposed) {
          setItems(result.items);
          setLoaded(true);
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [request, refresh]);
  useEffect(() => {
    let disposed = false;
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (draft && typeof draft.id === 'string')
        void request<AgentSetup>(`/connections/${encodeURIComponent(draft.id)}/setup`)
          .then((result) => {
            if (disposed) return;
            if (result.completedAt !== null) {
              localStorage.removeItem(draftKey);
              return;
            }
            setSetup(result);
            setPhase(draft.phase === 'verify' ? 'verify' : 'configure');
          })
          .catch(() => {
            if (!disposed) localStorage.removeItem(draftKey);
          });
    } catch {
      /* Browser storage is optional; setup still works without it. */
    }
    return () => {
      disposed = true;
    };
  }, [request]);
  useEffect(() => {
    if (!phase || !setup || setup.completedAt !== null) return;
    let disposed = false;
    const poll = async () => {
      try {
        const latest = await request<AgentConnection>(`/connections/${setup.id}`);
        if (!disposed)
          setSetup((previous) =>
            previous?.id === latest.id ? { ...previous, ...latest } : previous,
          );
      } catch (error) {
        if (!disposed) setError((error as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!document.hidden) void poll();
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [request, phase, setup?.id, setup?.completedAt]);
  useEffect(() => {
    if (setup?.completedAt === null && (phase === 'configure' || phase === 'verify')) {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ id: setup.id, phase }));
      } catch {
        /* No secret is stored here. */
      }
    }
  }, [setup?.id, setup?.completedAt, phase]);
  useEffect(() => {
    if (phase) dialog.current?.showModal();
    else dialog.current?.close();
  }, [phase]);
  function begin(row?: AgentConnection) {
    key.current = crypto.randomUUID();
    setClient(row?.client || 'codex');
    setName(row?.name || '');
    setSetup(null);
    setCheck(null);
    setError('');
    setCopied('');
    setPhase('choose');
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function clearDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {}
  }
  async function closeSetup() {
    if (busy) return;
    if (setup?.completedAt === null) {
      await perform(async () => {
        await request(`/connections/${setup.id}/disconnect`, {});
        clearDraft();
        setSetup(null);
        setPhase(null);
      });
    } else {
      clearDraft();
      setPhase(null);
    }
  }
  async function finishSetup() {
    if (!setup) return;
    await perform(async () => {
      await request(`/connections/${setup.id}/complete`, {});
      clearDraft();
      setSetup(null);
      setPhase(null);
    });
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setError('Clipboard unavailable. Select the text below and copy it manually.');
    }
  }
  const current = items.find((i) => i.id === setup?.id) || setup;
  return (
    <section className="settings-page connections-page">
      <article className="settings-card">
        <div className="connection-section-heading">
          <h2>Agent intake</h2>
          <button className="primary" onClick={() => begin()}>
            Connect an agent
          </button>
        </div>
        {!loaded ? (
          <p role="status">Loading connections…</p>
        ) : items.length === 0 ? (
          <p>No agents configured.</p>
        ) : (
          <ul className="connection-list">
            {items.map((row) => (
              <li key={row.id}>
                <div className="connection-row">
                  <div>
                    <strong>{row.name}</strong>
                    <span className="connection-client">{clientLabels[row.client]}</span>
                  </div>
                  <span className={`badge ${row.state}`}>{stateLabels[row.state]}</span>
                </div>
                <p className="fine">
                  {row.state === 'disconnected'
                    ? 'Access revoked. Remove this server entry from your client.'
                    : row.lastToolAt
                      ? `Last tool call ${date(row.lastToolAt)} · ${row.lastTool}`
                      : row.initializedAt
                        ? `Client reached Work Inbox ${date(row.initializedAt)}. No tool calls yet.`
                        : `Created ${date(row.createdAt)}`}
                </p>
                <p className="fine">
                  {row.workflowRead
                    ? `Context retrieved ${date(row.workflowRead.lastReadAt)}${row.workflowRead.project ? ` · ${row.workflowRead.project}` : ''}`
                    : 'No workflow context retrieved yet.'}
                </p>
                <div className="connection-actions">
                  {row.state === 'disconnected' ? (
                    <button className="text-button" onClick={() => begin(row)}>
                      Connect again
                    </button>
                  ) : (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            const result = await request<AgentSetup>(
                              `/connections/${row.id}/setup`,
                            );
                            setSetup(result);
                            setCheck(null);
                            setCopied('');
                            setPhase('configure');
                          })
                        }
                      >
                        Setup
                      </button>
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await request(`/connections/${row.id}/disconnect`, {});
                            if (setup?.id === row.id) setPhase(null);
                          })
                        }
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
      <article className="settings-card">
        <h2>Execution worker</h2>
        <p>No execution worker connected</p>
      </article>
      {error && !phase && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <dialog
        className="compose-dialog connection-dialog"
        ref={dialog}
        aria-labelledby="connection-title"
        onCancel={(event) => {
          event.preventDefault();
          void closeSetup();
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="connection-step">
              {phase === 'choose' ? '1 / 3' : phase === 'configure' ? '2 / 3' : '3 / 3'}
            </span>
            <h2 id="connection-title">
              {phase === 'choose'
                ? 'Choose your agent'
                : phase === 'configure'
                  ? 'Add Work Inbox to your agent'
                  : 'Verify the connection'}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close connection setup"
            title={setup?.completedAt === null ? 'Cancel unfinished setup' : 'Close'}
            disabled={busy}
            onClick={() => void closeSetup()}
          >
            <X size={18} />
          </button>
        </div>
        {phase === 'choose' && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const result = await request<AgentSetup>('/connections', {
                  client,
                  name: name.trim() || clientLabels[client],
                  idempotencyKey: key.current,
                });
                setSetup(result);
                setPhase('configure');
              });
            }}
          >
            <label>
              Client
              <select
                value={client}
                onChange={(event) => {
                  setClient(event.target.value as ConnectionClient);
                  key.current = crypto.randomUUID();
                }}
              >
                {Object.entries(clientLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Connection name <span className="optional">optional</span>
              <input
                maxLength={80}
                placeholder={clientLabels[client]}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  key.current = crypto.randomUUID();
                }}
              />
            </label>
            <p className="fine">
              Can submit work, maintain agent context, and coordinate claims. Human acceptance and
              completion stay with you.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="dialog-footer">
              <button className="primary" disabled={busy}>
                {busy ? 'Preparing…' : 'Continue'}
              </button>
            </div>
          </form>
        )}
        {phase === 'configure' && setup && (
          <>
            <p>
              Copy this prompt into an agent that can manage local configuration on this computer.
            </p>
            <div className="config-label">
              <strong>Setup prompt</strong>
              <button
                className="primary"
                onClick={() => void copy(setup.setupPrompt, 'setup-prompt')}
              >
                <Copy size={13} />
                {copied === 'setup-prompt' ? 'Copied' : 'Copy setup prompt'}
              </button>
            </div>
            <pre className="connection-code setup-prompt" tabIndex={0}>
              {setup.setupPrompt}
            </pre>
            <p className="fine">
              If the agent cannot change local settings, use the manual setup below.
            </p>
            <details className="manual-config">
              <summary>Manual setup</summary>
              {setup.command ? (
                <>
                  <p>
                    Run this command in a terminal on this computer, then restart your client’s MCP
                    connection.
                  </p>
                  <div className="config-label">
                    <strong>{clientLabels[setup.client]} setup command</strong>
                    <button
                      className="text-button"
                      onClick={() => void copy(setup.command!, 'command')}
                    >
                      <Copy size={13} />
                      {copied === 'command' ? 'Copied' : 'Copy command'}
                    </button>
                  </div>
                  <pre className="connection-code" tabIndex={0}>
                    {setup.command}
                  </pre>
                  <details className="manual-config">
                    <summary>
                      {setup.client === 'codex' ? 'TOML configuration' : 'JSON configuration'}
                    </summary>
                    <p>
                      {setup.client === 'codex' ? (
                        <>
                          Add this entry to <code>~/.codex/config.toml</code>, keeping existing
                          entries.
                        </>
                      ) : (
                        <>Merge only this server entry into the supported client configuration.</>
                      )}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => void copy(setup.configuration, 'config')}
                    >
                      <Copy size={13} />
                      {copied === 'config' ? 'Copied' : 'Copy configuration'}
                    </button>
                    <pre className="connection-code" tabIndex={0}>
                      {setup.configuration}
                    </pre>
                  </details>
                </>
              ) : (
                <>
                  <p>
                    {setup.client === 'claude-desktop'
                      ? 'In Claude Desktop, open Settings → Developer → Edit Config. Merge this server entry into the configuration, keeping existing entries. Save, fully quit Claude Desktop, and reopen it.'
                      : 'Add the following stdio server to your client’s MCP configuration. This example uses the mcpServers JSON format; adapt the outer structure if your client uses another format. Reload the MCP connection afterward.'}
                  </p>
                  <div className="config-label">
                    <strong>MCP configuration</strong>
                    <button
                      className="text-button"
                      onClick={() => void copy(setup.configuration, 'config')}
                    >
                      <Copy size={13} />
                      {copied === 'config' ? 'Copied' : 'Copy configuration'}
                    </button>
                  </div>
                  <pre className="connection-code" tabIndex={0}>
                    {setup.configuration}
                  </pre>
                </>
              )}
            </details>
            {setup.workflowPrompt && (
              <details className="manual-config">
                <summary>Project workflow</summary>
                <p>
                  Give this prompt to your agent to add project guidance
                  {setup.client === 'claude-code' ? ' and a startup context hook' : ''}. MCP
                  connectivity alone does not install it.
                </p>
                <button
                  className="text-button"
                  onClick={() => void copy(setup.workflowPrompt!, 'workflow')}
                >
                  {copied === 'workflow' ? 'Copied' : 'Copy workflow prompt'}
                </button>
                <pre className="connection-code" tabIndex={0}>
                  {setup.workflowPrompt}
                </pre>
              </details>
            )}
            <p className="fine">
              Keep Work Inbox running while your agent connects. Credentials stay in a protected
              local file.
            </p>
            <a
              className="reference"
              href={docs[setup.client]}
              target="_blank"
              rel="noopener noreferrer"
            >
              Official setup guide
              <ArrowUpRight size={12} />
            </a>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="dialog-footer">
              {setup.completedAt === null && (
                <button className="secondary" disabled={busy} onClick={() => void closeSetup()}>
                  Cancel setup
                </button>
              )}
              <button
                className="primary"
                onClick={() => {
                  setError('');
                  setPhase('verify');
                }}
              >
                Continue to verification
              </button>
            </div>
          </>
        )}
        {phase === 'verify' && setup && (
          <>
            <div className="verification-status">
              <span className={`badge ${current?.state}`}>
                {stateLabels[current?.state || 'pending']}
              </span>
              {current?.lastToolAt && (
                <p className="fine">
                  Last tool call {date(current.lastToolAt)} · {current.lastTool}
                </p>
              )}
            </div>
            {current?.state === 'disconnected' ? (
              <p>Access revoked. Create a new connection to set up your agent again.</p>
            ) : current?.state === 'verified' ? (
              <p>
                <Check size={15} /> Your agent successfully used Work Inbox.
              </p>
            ) : (
              <>
                <p>Ask your configured agent:</p>
                <div className="config-label">
                  <strong>Test prompt</strong>
                  <button className="text-button" onClick={() => void copy(testPrompt, 'prompt')}>
                    <Copy size={13} />
                    {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
                  </button>
                </div>
                <pre className="connection-code">{testPrompt}</pre>
                <p className="fine">
                  This page updates after a successful agent tool call. No test work item is
                  created.
                </p>
              </>
            )}
            {current?.state !== 'verified' && current?.state !== 'disconnected' && (
              <details className="connection-troubleshooting">
                <summary>Having trouble?</summary>
                <p>
                  Keep Work Inbox running, confirm the setup entry was saved, and reload your
                  client’s MCP connection. A local check can verify the launcher and credential
                  without marking your agent verified.
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const result = await request<{ ok: boolean; message: string }>(
                        `/connections/${setup.id}/check`,
                        {},
                      );
                      setCheck(result);
                    })
                  }
                >
                  {busy ? 'Checking…' : 'Check local setup'}
                </button>
                {check && (
                  <p role="status" className={check.ok ? 'fine' : 'error'}>
                    {check.message}
                  </p>
                )}
              </details>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="dialog-footer">
              <button
                className="secondary"
                disabled={current?.state === 'disconnected'}
                onClick={() => setPhase('configure')}
              >
                Back to setup
              </button>
              <button
                className="primary"
                disabled={busy || current?.state !== 'verified'}
                onClick={() =>
                  setup.completedAt === null ? void finishSetup() : void closeSetup()
                }
              >
                {setup.completedAt === null ? 'Finish connection' : 'Done'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
