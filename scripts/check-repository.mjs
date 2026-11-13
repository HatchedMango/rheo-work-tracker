import { execFileSync } from 'node:child_process';
const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options });
const privatePath =
  /(^|\/)(node_modules|dist|release|\.data|\.work-inbox|backups|test-results|playwright-report)\/|(^|\/)\.env(?:\.[^/]*)?$|\.(?:sqlite(?:-wal|-shm)?|pem|key)$|(^|\/)(?:AGENTS|CLAUDE)\.md$|(^|\/)\.(?:codex\/hooks\.json|claude\/settings\.local\.json|agents\/skills\/work-inbox\/|claude\/skills\/work-inbox\/)/;
const paths = git(['ls-files', '-z']).split('\0').filter(Boolean);
const failures = paths.filter((p) => privatePath.test(p) && p !== '.env.example');
if (process.argv.includes('--history')) {
  const history = git(['rev-list', '--objects', '--all']).split('\n');
  for (const line of history) {
    const path = line.slice(line.indexOf(' ') + 1);
    if (line.includes(' ') && privatePath.test(path) && path !== '.env.example')
      failures.push(path);
  }
}
const ignored = [
  '.data/connections/private.json',
  '.work-inbox/codex.json',
  'AGENTS.md',
  'CLAUDE.md',
  '.codex/hooks.json',
  '.claude/settings.local.json',
  '.agents/skills/work-inbox/SKILL.md',
  '.claude/skills/work-inbox/SKILL.md',
  'release/installer.dmg',
  'backups/local/work.sqlite',
  '.env.local',
];
let matched = [];
try {
  matched = git(['check-ignore', '--no-index', '--stdin'], { input: ignored.join('\n') + '\n' })
    .trim()
    .split('\n');
} catch {
  /* Report missing exclusions below without printing local content. */
}
for (const path of ignored) if (!matched.includes(path)) failures.push(`Missing ignore: ${path}`);
if (failures.length) {
  console.error(
    'Private/generated paths must stay outside the shared source:\n' +
      [...new Set(failures)].join('\n'),
  );
  process.exitCode = 1;
} else
  console.log(
    `Repository paths and local exclusions checked (${paths.length} tracked files${process.argv.includes('--history') ? ', all local Git history' : ''}). Secret-content scanning is a separate check.`,
  );
