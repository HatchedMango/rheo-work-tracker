import { conversationLink } from './conversation.js';
import type { WorkSession } from './sessions.js';
export function sessionConversation(client: WorkSession['client'], sessionId: string) {
  return client === 'codex' ? conversationLink(`codex://threads/${sessionId}`) : null;
}

// Deliberately separate from conversationLink: task content cannot mint draft links.
export function codexDraftLink(prompt: string, project: string): string | null {
  if (
    !prompt ||
    prompt.length > 8000 ||
    !project.startsWith('/') ||
    project.includes('\0') ||
    project.length > 2000
  )
    return null;
  return `codex://new?${new URLSearchParams({ prompt, path: project })}`;
}
