import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'work-inbox-chat-links-'));
try {
  // Compile the same allowlist used by the actual window, without creating a UI or opening URLs.
  writeFileSync(
    join(dir, 'main.swift'),
    `import Foundation
let good = ["https://claude.ai/chat/example", "http://example.com/chat", "codex://threads/12345678-1234-1234-1234-123456789abc"]
let bad = ["javascript:alert(1)", "file:///tmp/private", "codex://settings", "codex://threads/new", "codex://new?prompt=run", "codex://plugins/install/test", "codex://threads/12345678-1234-1234-1234-123456789abc?prompt=run", "codex://threads/12345678-1234-1234-1234-123456789abc#extra", "https://user:secret@example.com/chat", "otherapp://run"]
for value in good { precondition(allowedChatDestination(URL(string:value)!)) }
for value in bad { precondition(!allowedChatDestination(URL(string:value)!)) }
print("PASS: compiled native chat-link allowlist accepts existing chats and rejects commands, credentials and arbitrary schemes.")
`,
  );
  const binary = join(dir, 'verify');
  execFileSync(
    'xcrun',
    ['swiftc', resolve('desktop/InboxWindow.swift'), join(dir, 'main.swift'), '-o', binary],
    { stdio: 'pipe' },
  );
  process.stdout.write(execFileSync(binary));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
