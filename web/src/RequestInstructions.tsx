import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { RequestGuidance } from '../../src/shared/request-guidance.js';
import { WorkContent } from './WorkContent.js';
export function RequestInstructions({
  guidance,
  background = '',
  doneWhen = '',
}: {
  guidance?: RequestGuidance;
  background?: string;
  doneWhen?: string;
}) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const focused = !!(
    guidance?.steps.length ||
    guidance?.copy ||
    guidance?.why ||
    guidance?.recommendation
  );
  const instruction = guidance?.copy;
  useEffect(() => {
    setCopied(false);
    setCopyError(false);
  }, [instruction?.text]);
  return (
    <div className="request-instructions">
      {!focused && background && <WorkContent text={background} />}
      {!!guidance?.steps.length && (
        <ol className="request-steps" aria-label="How to do this">
          {guidance.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {instruction && (
        <div className="request-copy">
          <pre>
            <code>{instruction.text}</code>
          </pre>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(instruction.text);
                setCopied(true);
                setCopyError(false);
              } catch {
                setCopyError(true);
              }
            }}
          >
            <Copy size={13} aria-hidden="true" />
            {/^copy\b/i.test(instruction.label) ? instruction.label : `Copy ${instruction.label}`}
          </button>
          {copied && (
            <span className="fine" role="status">
              Copied
            </span>
          )}
          {copyError && (
            <p role="status" className="fine">
              Select and copy the text above; clipboard access was unavailable.
            </p>
          )}
        </div>
      )}
      {guidance?.recommendation && (
        <p className="request-recommendation">
          <strong>Recommended:</strong> {guidance.recommendation}
        </p>
      )}
      {guidance?.why && <p className="request-why">{guidance.why}</p>}
      {((focused && background) || doneWhen) && (
        <details className="request-background">
          <summary>Details</summary>
          {focused && background && <WorkContent text={background} />}
          {doneWhen && (
            <>
              <h4>Finished when</h4>
              <WorkContent text={doneWhen} />
            </>
          )}
        </details>
      )}
    </div>
  );
}
