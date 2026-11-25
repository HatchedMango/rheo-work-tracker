import { memo, useId, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Intake is untrusted. Keep HTML escaped, never fetch embedded images, and allow
// only ordinary web links. Work content gets no access to a native bridge.
export function safeContentUrl(value: string) {
  try {
    const url = new URL(value, 'http://127.0.0.1');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? value
      : '';
  } catch {
    return '';
  }
}
export const WorkContent = memo(function WorkContent({ text }: { text: string }) {
  return (
    <div className="work-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeContentUrl}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target={href.startsWith('#') ? undefined : '_blank'}
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span className="image-description">{alt || 'Image'}</span>,
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h4>{children}</h4>,
          h4: ({ children }) => <h5>{children}</h5>,
          h5: ({ children }) => <h5>{children}</h5>,
          h6: ({ children }) => <h6>{children}</h6>,
          table: ({ children }) => (
            <div className="content-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
export function workPreview(text: string) {
  return text
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s?)/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}
export function briefText(text: string, limit = 180) {
  const plain = workPreview(text);
  if (plain.length <= limit) return plain;
  const cut = plain.lastIndexOf(' ', limit);
  return `${plain.slice(0, cut > limit / 2 ? cut : limit).trimEnd()}…`;
}
export function BriefContent({ text, limit = 240 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const long =
    workPreview(text).length > limit || text.split('\n').filter((line) => line.trim()).length > 5;
  return (
    <div className="brief-content">
      {long && !expanded ? <p>{briefText(text, limit)}</p> : <WorkContent text={text} />}
      {long && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}
export const ActivityContent = memo(function ActivityContent({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const long = text.length > 480 || text.split('\n').length > 9;
  return (
    <div className="activity-content">
      <div id={id}>
        {long && !expanded ? (
          <p className="activity-excerpt">{workPreview(text).slice(0, 300)}…</p>
        ) : (
          <WorkContent text={text} />
        )}
      </div>
      {long && (
        <button
          className="text-button expand-content"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
});
export function ContextChanges({
  data,
  design = false,
}: {
  data: Record<string, unknown>;
  design?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const before =
    data.before && typeof data.before === 'object' ? (data.before as Record<string, unknown>) : {};
  const after =
    data.after && typeof data.after === 'object' ? (data.after as Record<string, unknown>) : {};
  const fields: Record<string, string> = design
    ? {
        statement: 'Statement',
        status: 'Status',
        evidence: 'Evidence',
        invalidatedBy: 'Invalidated by',
        applicability: 'Applies to',
        inherit: 'Include descendants',
        criterion: 'Criterion',
        result: 'Result',
        method: 'Method',
        conditions: 'Conditions',
        limitations: 'Limitations',
        codeRevision: 'Code revision',
        checkedAt: 'Checked at',
        references: 'References',
      }
    : {
        title: 'Title',
        objective: 'Details',
        acceptanceCriteria: 'Done when',
        priority: 'Priority',
        references: 'References',
      };
  function display(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);
    if (!Array.isArray(value)) return 'None';
    return (
      value
        .map((item) =>
          typeof item === 'string'
            ? `- ${item}`
            : item && typeof item === 'object' && typeof item.url === 'string'
              ? `- ${item.url}`
              : '',
        )
        .filter(Boolean)
        .join('\n') || 'None'
    );
  }
  return (
    <details className="edit-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Context changes</summary>
      {open && (
        <div className="context-changes">
          {Object.entries(fields)
            .filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
            .map(([key, label]) => (
              <div key={key} className="context-change">
                <h4>{label}</h4>
                <div className="change-before">
                  <span>Before</span>
                  <WorkContent text={display(before[key])} />
                </div>
                <div>
                  <span>After</span>
                  <WorkContent text={display(after[key])} />
                </div>
              </div>
            ))}
        </div>
      )}
    </details>
  );
}
