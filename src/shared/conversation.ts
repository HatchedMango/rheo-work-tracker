// Existing chats only: never dispatch commands, create chats, or configure a client.
export function conversationLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  if (
    /^codex:\/\/threads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
