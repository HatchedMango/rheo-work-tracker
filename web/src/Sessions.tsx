import { useEffect, useState } from 'react';
import { MessageCircle, Copy, ArrowUpRight } from 'lucide-react';
import type { SessionPage, SessionLink, SessionLinks } from '../../src/shared/sessions.js';
import { sessionConversation } from '../../src/shared/session-navigation.js';
export type SessionRequest = <T>(path: string, body?: unknown) => Promise<T>;
function ChatLink({ session }: { session: SessionLink }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const client = session.client === 'codex' ? 'Codex' : 'Claude';
  const short = session.sessionId.slice(-6);
  const url = sessionConversation(session.client, session.sessionId);
  const label = `${url ? 'Open' : 'Copy'} ${client} ${url ? 'chat' : 'session ID'} ${short}`;
  const content = (
    <>
      <MessageCircle size={12} aria-hidden="true" />
      <span>{client}</span>
      <small>{short}</small>
      {url ? <ArrowUpRight size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
    </>
  );
  return (
    <span className="chat-link-wrap">
      {url ? (
        <a
          className="chat-link"
          href={url}
          aria-label={label}
          title={label}
          target="_blank"
          rel="noopener noreferrer"
        >
          {content}
        </a>
      ) : (
        <button
          type="button"
          className="chat-link"
          aria-label={label}
          title={label}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(session.sessionId);
              setCopied(true);
              setFailed(false);
            } catch {
              setFailed(true);
            }
          }}
        >
          {content}
        </button>
      )}
      {copied && (
        <span className="chat-feedback" role="status">
          Copied
        </span>
      )}
      {failed && (
        <span className="chat-copy-fallback" role="status">
          Copy this session ID: <code>{session.sessionId}</code>
        </span>
      )}
    </span>
  );
}
export function SessionChips({
  sessions,
  onMore,
}: {
  sessions?: SessionLinks;
  onMore?: () => void;
}) {
  if (!sessions?.items.length) return null;
  return (
    <div className="chat-links" role="group" aria-label="Related chats">
      {sessions.items.map((s) => (
        <ChatLink key={s.id} session={s} />
      ))}
      {sessions.total > sessions.items.length && onMore && (
        <button
          type="button"
          className="chat-more"
          onClick={onMore}
          aria-label={`Show all ${sessions.total} related chats`}
        >
          +{sessions.total - sessions.items.length}
        </button>
      )}
    </div>
  );
}
export function Sessions({
  request,
  streamId,
  changeId,
}: {
  request: SessionRequest;
  streamId?: string;
  changeId?: string;
}) {
  const selection = streamId ? `streamId=${streamId}&directOnly=true` : `changeId=${changeId}`;
  return <ChatHistory key={selection} request={request} selection={selection} />;
}
function ChatHistory({ request, selection }: { request: SessionRequest; selection: string }) {
  const [page, setPage] = useState<SessionPage | null>(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await request<SessionPage>(
          `/sessions?${selection}&limit=5&offset=${offset}`,
        );
        if (alive) {
          setPage(result);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [request, selection, offset, retry]);
  if (error)
    return (
      <div className="chat-links">
        <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
          Retry chat links
        </button>
      </div>
    );
  if (!page?.total) return null;
  return (
    <div className="related-chats" role="group" aria-label="Related chats">
      {page.items.map((s) => (
        <ChatLink key={s.id} session={s} />
      ))}
      {(offset > 0 || page.nextOffset !== null) && (
        <span className="chat-pager">
          {offset > 0 && (
            <button className="chat-more" onClick={() => setOffset(Math.max(0, offset - 5))}>
              Newer chats
            </button>
          )}
          {page.nextOffset !== null && (
            <button className="chat-more" onClick={() => setOffset(page.nextOffset!)}>
              Older chats
            </button>
          )}
        </span>
      )}
    </div>
  );
}
