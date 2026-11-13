import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
async function openDisclosure(target: Page | Locator, label: string) {
  const summary = target.getByText(label, { exact: true });
  if ((await summary.locator('..').getAttribute('open', { timeout: 5000 })) === null)
    await summary.click();
}
async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Streams', level: 1 })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Changes', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^(New work|Create work|Capture work)/ }),
  ).toHaveCount(0);
}
async function capture(title: string, objective: string, extra: Record<string, unknown> = {}) {
  const config = JSON.parse(readFileSync('.data/e2e/agent.json', 'utf8'));
  // Intake happens outside the UI, through the same scoped HTTP interface used by MCP.
  const response = await fetch(`${config.url}/api/work`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      objective,
      acceptanceCriteria: ['Preserve the context.'],
      idempotencyKey: randomUUID(),
      ...extra,
    }),
  });
  expect(response.status).toBe(201);
  const item = await response.json();
  expect(item.attention.map((a: { kind: string }) => a.kind)).toEqual([]);
  return item;
}
async function receive(page: Page, title: string, objective: string, legacyDestination?: string) {
  const item = await capture(title, objective, { destination: legacyDestination });
  await page.goto(`/?view=active&work=${item.id}`);
  await expect(
    page
      .getByRole('region', { name: 'Work detail' })
      .getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
}
async function queueFixtureRun(page: Page) {
  const code = await page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('work');
    const detail = await (await fetch(`/api/work/${id}`)).json();
    return (
      await fetch(`/api/work/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', revision: detail.revision }),
      })
    ).status;
  });
  expect(code).toBe(200);
}
test('externally submitted work, context edits, notes, and manual completion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openWorkspace(page);
  await receive(
    page,
    'Plan the next usable slice',
    '<script>window.workInboxUnsafe=true</script> Capture meaningful outcomes.',
  );
  await expect(
    page
      .getByText('<script>window.workInboxUnsafe=true</script> Capture meaningful outcomes.', {
        exact: true,
      })
      .last(),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, 'workInboxUnsafe'))).toBe(false);
  await page.getByRole('button', { name: 'Edit context', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Objective', exact: true })
    .fill('Updated objective with durable context.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Details', exact: true })
      .getByText('Updated objective with durable context.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept work', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run simulation' })).toHaveCount(0);
  await openDisclosure(page, 'Manage change');
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toBeVisible();
  await openDisclosure(page, 'Activity');
  await page.getByLabel('Add a note', { exact: true }).fill('A useful decision to keep.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(
    page.locator('.timeline').getByText('A useful decision to keep.', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-work.png', fullPage: true });
  await page.reload();
  await openDisclosure(page, 'Activity');
  await expect(
    page.locator('.timeline').getByText('A useful decision to keep.', { exact: true }),
  ).toBeVisible();
  await openDisclosure(page, 'Manage change');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.locator('.detail-meta .badge')).toHaveText('Completed');
  await page.getByText('Context changes', { exact: true }).click();
  await expect(page.locator('.context-changes').getByText('Before', { exact: true })).toBeVisible();
  await expect(page.locator('.context-changes').getByText('After', { exact: true })).toBeVisible();
  await expect(page.locator('.context-changes pre')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('queued work waits offline, actual worker posts a result, and review requires a decision', async ({
  page,
}) => {
  await openWorkspace(page);
  await receive(
    page,
    'Investigate flaky authentication test',
    'Use the safe stub to demonstrate execution approval and review.',
  );
  await expect(page.getByRole('button', { name: 'Accept work', exact: true })).toHaveCount(0);
  await queueFixtureRun(page);
  await expect(page.getByRole('heading', { name: 'Queued', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Work detail' }).getByText('No execution worker connected'),
  ).toBeVisible();
  const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/worker.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      WORK_INBOX_CREDENTIAL_FILE: resolve('.data/e2e/worker.json'),
    },
    stdio: 'pipe',
  });
  const logs: string[] = [];
  worker.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  try {
    await expect(page.getByRole('heading', { name: 'Review result' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText('SIMULATED REPORT', { exact: false })).toBeVisible();
    await expect(page.locator('.sidebar-note')).toContainText('Execution worker connected');
    await page.screenshot({ path: 'test-results/desktop-review.png', fullPage: true });
    await page
      .getByLabel('Changes needed')
      .fill('Add actual evidence before treating this as completed.');
    await page.getByRole('button', { name: 'Request changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Run simulation' })).toHaveCount(0);
    await openDisclosure(page, 'Manage change');
    await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toBeVisible();
    await queueFixtureRun(page);
    await expect(page.getByRole('heading', { name: 'Review result' })).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole('button', { name: 'Approve result & complete', exact: true }).click();
    await expect(page.locator('.detail-meta .badge')).toHaveText('Completed');
  } finally {
    worker.kill('SIGTERM');
    await new Promise<void>((r) => {
      if (worker.exitCode !== null) return r();
      worker.once('exit', () => r());
    });
  }
});
test('legacy submissions track quietly; mobile search and manual completion still work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  await receive(
    page,
    'Refactor date picker later',
    'Track work from an older agent without another acceptance step.',
    'backlog',
  );
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Changes', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search work' }).fill('date picker');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: 'Refactor date picker later' }) })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Refactor date picker later', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
  await openDisclosure(page, 'Manage change');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.locator('.detail-meta .badge')).toHaveText('Completed');
  await page.screenshot({ path: 'test-results/mobile-work.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('empty search and connections are usable', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('textbox', { name: 'Search work' }).fill('a-title-that-does-not-exist');
  await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connections', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Execution worker', level: 2 })).toBeVisible();
});

test('a failed context edit preserves input and can be retried', async ({ page }) => {
  await openWorkspace(page);
  await receive(page, 'Keep my context', 'Context received from an agent.');
  await page.getByRole('button', { name: 'Edit context', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Objective', exact: true })
    .fill('This context must survive a failed edit.');
  await page.route('**/api/work/*', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { message: 'Temporary save failure. Please retry.' } })
      : route.continue(),
  );
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Temporary save failure. Please retry.');
  await expect(dialog.getByRole('textbox', { name: 'Objective', exact: true })).toHaveValue(
    'This context must survive a failed edit.',
  );
  await page.screenshot({ path: 'test-results/save-error.png', fullPage: true });
  await page.unroute('**/api/work/*');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Work detail' })
      .getByRole('region', { name: 'Details', exact: true })
      .getByText('This context must survive a failed edit.', { exact: true }),
  ).toBeVisible();
});

test('opening directly and renewing a cleared cookie needs no user interaction', async ({
  page,
}) => {
  let bootstraps = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/session')) bootstraps++;
  });
  await openWorkspace(page);
  expect(bootstraps).toBe(1);
  await receive(
    page,
    'Automatic local access',
    'Keep this item through session renewal.',
    'backlog',
  );
  const initialized = bootstraps;
  await page.context().clearCookies();
  await openDisclosure(page, 'Activity');
  await page.getByLabel('Add a note', { exact: true }).fill('Still here after silent renewal.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(
    page.locator('.timeline').getByText('Still here after silent renewal.', { exact: true }),
  ).toBeVisible();
  expect(bootstraps).toBe(initialized + 1);
  await page.context().clearCookies();
  await page.reload();
  await openDisclosure(page, 'Activity');
  await expect(
    page.locator('.timeline').getByText('Still here after silent renewal.', { exact: true }),
  ).toBeVisible();
  expect(bootstraps).toBe(initialized + 2);
  await page.screenshot({ path: 'test-results/automatic-local-access.png', fullPage: true });
});

test('another local website cannot bootstrap owner access or submit work', async ({ page }) => {
  const attacker = 'http://127.0.0.1:4399/';
  await page.route(attacker, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Other site</title><p>Untrusted local site</p>',
    }),
  );
  await page.goto(attacker);
  await page.evaluate(async () => {
    await fetch('http://127.0.0.1:4318/api/session', {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    }).catch(() => null);
  });
  expect(
    (await page.context().cookies('http://127.0.0.1:4318')).some(
      (cookie) => cookie.name === 'session',
    ),
  ).toBe(false);
  await openWorkspace(page);
  await page.goto(attacker);
  await page.evaluate(async () => {
    await fetch('http://127.0.0.1:4318/api/work', {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        title: 'Injected from untrusted site',
        objective: 'This must not be created.',
      }),
    }).catch(() => null);
  });
  await openWorkspace(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Changes', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search work' }).fill('Injected from untrusted site');
  await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
});

test('empty work explains external intake without a creation form', async ({ page }) => {
  await openWorkspace(page);
  await page.goto('/?view=cancelled');
  await expect(page.getByRole('heading', { name: 'No cancelled work' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(New work|Create work|Capture work)/ }),
  ).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Connections', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Agent intake' })).toBeVisible();
});

test('Work has Active/History views and a persistent, scoped status filter', async ({ page }) => {
  await openWorkspace(page);
  await receive(page, 'Filter fixture: completed', 'A finished request.');
  await expect(page.getByRole('button', { name: 'Accept work', exact: true })).toHaveCount(0);
  await openDisclosure(page, 'Manage change');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await receive(page, 'Filter fixture: open', 'An unstarted request.');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Changes', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search work' }).fill('Filter fixture:');
  const list = page.getByRole('region', { name: 'Work items' });
  await expect(
    list.getByRole('heading', { name: 'Filter fixture: open', exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole('heading', { name: 'Filter fixture: completed', exact: true }),
  ).toHaveCount(0);
  const views = page.getByRole('group', { name: 'Work views' });
  await expect(views.getByRole('button')).toHaveCount(2);
  const status = page.getByRole('combobox', { name: 'Filter by status' });
  await status.selectOption('backlog');
  await expect(page).toHaveURL(/view=active.*status=backlog/);
  await expect(
    list.getByRole('heading', { name: 'Filter fixture: open', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(status).toHaveValue('backlog');
  await views.getByRole('button', { name: /History/ }).click();
  await expect(status).toHaveValue('any');
  await expect(status.getByRole('option')).toHaveCount(4);
  await page.getByRole('textbox', { name: 'Search work' }).fill('Filter fixture:');
  await status.selectOption('completed');
  await expect(
    list.getByRole('heading', { name: 'Filter fixture: completed', exact: true }),
  ).toBeVisible();
  await expect(list.locator('.work-card')).toHaveCount(1);
  await expect(
    list.getByRole('heading', { name: 'Filter fixture: open', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: 'test-results/work-history-filter.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-work-filter.png', fullPage: true });
  await page.goBack();
  await expect(status).toHaveValue('any');
});

test('guided agent setup checks locally, verifies an actual MCP tool call, and disconnects', async ({
  page,
}) => {
  await openWorkspace(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Connections', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connect an agent', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Client', exact: true }).selectOption('codex');
  await dialog.getByRole('textbox', { name: 'Connection name' }).fill('Browser setup agent');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/connections') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  const setup = await (await created).json();
  await expect(dialog.getByRole('heading', { name: 'Add Work Inbox to your agent' })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Copy setup prompt', exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('.setup-prompt')).toContainText(
    'Set up Work Inbox as a local MCP server in Codex',
  );
  await expect(dialog.getByText('Codex setup command', { exact: true })).not.toBeVisible();
  await dialog.getByText('Manual setup', { exact: true }).click();
  await expect(dialog.getByText('Codex setup command', { exact: true })).toBeVisible();
  await dialog.getByText('Manual setup', { exact: true }).click();
  await page.screenshot({ path: 'test-results/connection-setup-prompt.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Continue to verification' }).click();
  await expect(dialog.getByText('Awaiting agent', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Finish connection', exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator('.connection-list li').filter({ hasText: 'Browser setup agent' }),
  ).toHaveCount(0);
  await dialog.getByText('Having trouble?', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Check local setup', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Local setup passed');
  await expect(dialog.getByText('Awaiting agent', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/connection-setup-pending.png', fullPage: true });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const agent = new Client({ name: 'browser-onboarding-agent', version: '1.0' });
  try {
    await agent.connect(
      new StdioClientTransport({
        ...setup.launch,
        env: { ...setup.launch.env, WORK_INBOX_SYNC_HOME: resolve('.data/e2e/sync') },
        stderr: 'pipe',
      }),
    );
    const result = await agent.callTool({ name: 'list_work', arguments: { limit: 1 } });
    expect(result.isError).not.toBe(true);
    await expect(dialog.getByText('Verified', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Your agent successfully used Work Inbox.')).toBeVisible();
    await page.screenshot({ path: 'test-results/connection-setup-verified.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Finish connection', exact: true }).click();
    const row = page.getByRole('listitem').filter({ hasText: 'Browser setup agent' });
    await expect(row.getByText('Verified', { exact: true })).toBeVisible();
    await expect(row.getByText('No progress checkpoint recorded.')).toBeVisible();
    await row.getByLabel('Sync decisions from my chats').check();
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await agent.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const tracked = await call('submit_stream', {
      title: 'Chat-synchronized outcome',
      outcome: 'A plan and human feedback stay current',
      idempotencyKey: randomUUID(),
    });
    const question = await call('record_context', {
      streamId: tracked.id,
      kind: 'question',
      body: 'Which API should this use?',
      needsHuman: true,
      idempotencyKey: randomUUID(),
    });
    const identity = {
      sessionId: randomUUID(),
      client: 'codex',
      project: resolve('.data/e2e'),
      streamId: tracked.id,
      turnId: randomUUID(),
    };
    expect(
      (
        await call('sync_work', {
          ...identity,
          eventId: randomUUID(),
          event: 'start',
          occurredAt: Date.now(),
        })
      ).recorded,
    ).toBe(true);
    await expect(row.getByText(/Latest chat turn needs an update/)).toBeVisible();
    const checkpoint = await call('sync_work', {
      ...identity,
      eventId: randomUUID(),
      event: 'checkpoint',
      occurredAt: Date.now(),
      checkpoint: {
        summary: 'Plan approved and API choice recorded in chat',
        feedback: [
          {
            kind: 'stream_decision',
            id: tracked.id,
            revision: tracked.revision,
            action: 'accept',
            response: 'Use this plan',
          },
          {
            kind: 'question',
            id: question.id,
            revision: question.revision,
            answer: 'Use the sandbox API',
          },
        ],
      },
    });
    expect(checkpoint.recorded).toBe(true);
    await expect(row.getByText(/Last progress checkpoint/)).toBeVisible();
    await expect(row.getByText(/Latest chat turn needs an update/)).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/mobile-connections.png', fullPage: true });
    await page.goto(`/?view=streams&stream=${tracked.id}`);
    await expect(page.getByText(/Progress recorded/)).not.toBeVisible();
    await openDisclosure(page, 'Details & history');
    await expect(page.getByText(/Progress recorded/)).toBeVisible();
    await expect(
      page.locator('.request-card').filter({ hasText: 'Which API should this use?' }),
    ).toHaveCount(0);
    await page.getByText(/Progress recorded/).click();
    await expect(
      page.getByText('Plan approved and API choice recorded in chat', { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: 'test-results/sync-stream-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'Connections', exact: true })
      .click();
    await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(row.getByText('Disconnected', { exact: true })).toBeVisible();
    expect((await agent.callTool({ name: 'list_work', arguments: {} })).isError).toBe(true);
  } finally {
    await agent.close();
  }
  await page.getByRole('button', { name: 'Connect an agent', exact: true }).click();
  await dialog
    .getByRole('combobox', { name: 'Client', exact: true })
    .selectOption('claude-desktop');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.locator('.setup-prompt')).toContainText('Claude Desktop');
  await expect(dialog.getByText(/Developer → Edit Config/)).not.toBeVisible();
  await dialog.getByText('Manual setup', { exact: true }).click();
  await expect(dialog.getByText(/Developer → Edit Config/)).toBeVisible();
});

test('unfinished setup resumes on refresh, stays out of connections, and cancellation discards it', async ({
  page,
}) => {
  await openWorkspace(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Connections', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connect an agent', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Connection name' }).fill('Unfinished setup');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/connections') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  const setup = await (await response).json();
  await expect(dialog.getByRole('button', { name: 'Copy setup prompt' })).toBeVisible();
  await expect(
    page.locator('.connection-list li').filter({ hasText: 'Unfinished setup' }),
  ).toHaveCount(0);
  await page.reload();
  await expect(dialog.getByRole('button', { name: 'Copy setup prompt' })).toBeVisible();
  await expect(dialog.locator('.setup-prompt')).toContainText(setup.serverName);
  await dialog.getByRole('button', { name: 'Close connection setup' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator('.connection-list li').filter({ hasText: 'Unfinished setup' }),
  ).toHaveCount(0);
  await page.reload();
  await expect(dialog).not.toBeVisible();
  const rows = await page.evaluate(async () => await (await fetch('/api/connections')).json());
  expect(rows.items.some((r: { id: string }) => r.id === setup.id)).toBe(false);
  const stale = await page.request.get(`/api/connections/${setup.id}/setup`);
  expect(stale.status()).toBe(409);
});

test('work presentation prioritizes decisions and safely formats long context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWorkspace(page);
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('untrusted-image.example')) imageRequests.push(request.url());
  });
  const item = await capture(
    'Presentation: Make setup easier',
    [
      'Make the **first connection** easy to understand.',
      '',
      '### Context',
      '',
      'Keep the existing server and improve the setup flow.',
      '',
      '- Preserve existing connections.',
      '- Show one clear next step.',
      '',
      'Use `list_work` to confirm the connection.',
      '',
      '```sh',
      'work-inbox-mcp',
      '```',
      '',
      '| Check | Expected |',
      '| --- | --- |',
      '| Existing work | Preserved |',
      '',
      '[Documentation](https://example.com/guide)',
      '',
      '[Unsafe link](javascript:alert(1))',
      '',
      '![Remote image](https://untrusted-image.example/pixel.png)',
    ].join('\n'),
    {
      acceptanceCriteria: [
        'The **existing connection** continues working.',
        'The setup instructions include `list_work`.',
      ],
      priority: 'high',
    },
  );
  await capture(
    'Presentation: Preserve work when offline',
    'Retain new work while the laptop is asleep.',
  );
  const credential = JSON.parse(readFileSync('.data/e2e/agent.json', 'utf8'));
  const update = await fetch(`${credential.url}/api/work/${item.id}/updates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:
        'Implementation context. '.repeat(35) + '\n\n**Final decision:** Keep the current server.',
    }),
  });
  expect(update.status).toBe(200);
  await page.goto('/?view=active');
  await page.getByRole('textbox', { name: 'Search work' }).fill('Presentation:');
  const list = page.getByRole('region', { name: 'Work items' });
  await expect(list.locator('.work-card')).toHaveCount(2);
  await expect(list.getByText('External capture agent', { exact: true })).toHaveCount(0);
  await expect(
    list.getByText('Retain new work while the laptop is asleep.', { exact: true }),
  ).toHaveCount(0);
  await expect(list.getByText('Planned', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Select a work item', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/work-presentation-list.png', fullPage: true });
  await list.getByRole('heading', { name: 'Presentation: Make setup easier', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Work detail' });
  await expect(detail.getByRole('heading', { name: 'Context', level: 4 })).not.toBeVisible();
  await detail
    .getByRole('region', { name: 'Details', exact: true })
    .getByRole('button', { name: 'More', exact: true })
    .click();
  await expect(detail.getByRole('heading', { name: 'Context', level: 4 })).toBeVisible();
  await expect(detail.locator('strong').filter({ hasText: 'first connection' })).toBeVisible();
  await expect(detail.locator('pre code')).toHaveText('work-inbox-mcp\n');
  await expect(detail.getByRole('table')).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Documentation', exact: true })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect(detail.getByRole('link', { name: 'Unsafe link', exact: true })).toHaveCount(0);
  await expect(detail.locator('img')).toHaveCount(0);
  expect(imageRequests).toEqual([]);
  await expect(detail.getByRole('button', { name: 'Accept work', exact: true })).toHaveCount(0);
  await expect(
    detail.getByRole('button', { name: 'Mark complete', exact: true }),
  ).not.toBeVisible();
  await page.screenshot({ path: 'test-results/work-presentation-detail.png', fullPage: true });
  await openDisclosure(detail, 'Activity');
  await expect(detail.getByText('Keep the current server.', { exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(detail.getByText('Keep the current server.', { exact: false }).last()).toBeVisible();
  await detail.getByRole('button', { name: 'Show less', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(detail.getByRole('button', { name: 'Accept work', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/work-presentation-mobile.png', fullPage: true });
});

test('streams track directly and show explicit questions, outputs and dependencies', async ({
  page,
}) => {
  await openWorkspace(page);
  const config = JSON.parse(readFileSync('.data/e2e/agent.json', 'utf8'));
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${config.url}/api${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };
  const stream = await post('/streams', {
    title: 'A durable delivery stream',
    outcome: 'Agents can resume with the current outcome and decisions.',
    constraints: 'Track work without granting execution permission.',
    context: 'Current focus: the local workflow.',
    idempotencyKey: randomUUID(),
  });
  const first = await capture('Publish the contract', 'A reviewable interface.', {
    streamId: stream.id,
    expectedOutput: 'One contract MR',
  });
  const next = await capture('Build the consumer', 'Use the published contract.', {
    streamId: stream.id,
  });
  const planned = await post(`/work/${next.id}/tracking`, {
    revision: 1,
    dependencies: [
      {
        requiresId: first.id,
        stage: 'start',
        condition: 'output_available',
        reason: 'Implement against the published contract.',
      },
    ],
    progress: 'planned',
  });
  await post(`/work/${next.id}/tracking`, {
    revision: planned.tracking.revision,
    assessmentFingerprint: planned.tracking.assessmentFingerprint,
    assessDependencies: true,
  });
  await post(`/work/${first.id}/outputs`, {
    kind: 'mr',
    url: 'https://example.com/mr/42',
    label: 'Contract MR',
    codeRevision: 'abc123',
    state: 'available',
    idempotencyKey: randomUUID(),
  });
  const questionRecord = await post(`/streams/${stream.id}/context`, {
    kind: 'question',
    body: 'Which repository should publish the contract?',
    needsHuman: true,
    conversationUrl: 'https://claude.ai/chat/test-conversation',
    idempotencyKey: randomUUID(),
  });
  for (let i = 0; i < 31; i++)
    await post(`/streams/${stream.id}/context`, {
      kind: 'finding',
      body: `Routine finding ${i}`,
      idempotencyKey: randomUUID(),
    });
  await page.goto(`/?view=streams&stream=${stream.id}`);
  const detail = page.getByRole('region', { name: 'Stream detail' });
  const nodes = detail.locator('.work-map-node');
  await expect(nodes).toHaveCount(3);
  await expect(detail.locator(`[data-map-node="${first.id}"]`)).toBeVisible();
  await expect(nodes.filter({ hasText: next.title })).toBeVisible();
  const inspector = detail.getByRole('complementary', { name: 'Selected work' });
  const question = nodes.filter({ hasText: 'Which repository should publish the contract?' });
  await expect(question).toBeVisible();
  await expect(question.getByRole('button', { name: /Answer|Respond|Accept|Decline/ })).toHaveCount(
    0,
  );
  await expect(inspector.getByRole('link', { name: 'Open chat' })).toHaveAttribute(
    'href',
    'https://claude.ai/chat/test-conversation',
  );
  await page.evaluate(async (q) => {
    const r = await fetch(`/api/context/${q.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: q.revision,
        answer: 'Use the current repository.',
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!r.ok) throw new Error('Answer not recorded');
  }, questionRecord);
  await expect(question).toContainText('Answered');
  await expect(inspector).toContainText('Use the current repository.');
  await expect(detail.getByRole('button', { name: 'Approve stream', exact: true })).toHaveCount(0);
  await expect(
    detail.getByRole('button', { name: 'Finish stream', exact: true }),
  ).not.toBeVisible();
  await expect(detail.getByRole('button', { name: 'Next', exact: true }).first()).not.toBeVisible();
  await openDisclosure(detail, 'Details & history');
  await expect(detail.getByText(stream.outcome, { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Next', exact: true }).first().click();
  await expect(detail.getByText('31–32 of 32', { exact: true })).toBeVisible();
  await expect(nodes).toHaveCount(3);
  await expect(question).toBeVisible();
  await openDisclosure(detail, 'Manage stream');
  await expect(detail.getByRole('button', { name: 'Finish stream', exact: true })).toBeVisible();
  await detail.getByText('Details & history', { exact: true }).click();
  await nodes.filter({ hasText: 'Build the consumer' }).click();
  await expect(inspector).toContainText('Relationships need checking against newer work.');
  await expect(inspector).toContainText('Recorded satisfied');
  await expect(detail.locator('.work-map-edge.selected')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/stream-desktop.png', fullPage: true });
  await detail.getByRole('button', { name: 'List', exact: true }).click();
  await expect(detail.locator('.mode-list')).toBeVisible();
  await expect(nodes).toHaveCount(3);
  await page.reload();
  await expect(detail.locator('.mode-list')).toBeVisible();
  await expect(inspector.getByRole('heading', { name: next.title, exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Map', exact: true }).click();
  await inspector.getByRole('button', { name: 'Open change' }).click();
  const change = page.getByRole('region', { name: 'Work detail' });
  await expect(change.getByText('Assessment stale', { exact: true })).not.toBeVisible();
  await openDisclosure(change, 'Tracking details');
  await expect(change.getByText('Assessment stale', { exact: true })).toBeVisible();
  await expect(
    change.getByText('Before starting: output available · reported satisfied', { exact: true }),
  ).toBeVisible();
  await expect(change.getByRole('button', { name: 'Accept work', exact: true })).toHaveCount(0);
  await openDisclosure(change, 'Manage change');
  await expect(change.getByRole('button', { name: 'Mark complete', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/change-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await change.getByRole('button', { name: 'Publish the contract', exact: true }).click();
  await expect(change.getByRole('link', { name: 'Contract MR' })).toBeVisible();
  await expect(change.getByText(/available reported by/)).not.toBeVisible();
  await openDisclosure(change, 'Evidence');
  await expect(change.getByText(/available reported by/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Contract MR' })).toBeVisible();
});

test('tracked streams stay quiet while a simple human request links to chat and a parallel branch keeps moving', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Streams', level: 1 })).toBeVisible();
  const config = JSON.parse(readFileSync('.data/e2e/agent.json', 'utf8'));
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${config.url}/api${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r.ok).toBe(true);
    return r.json();
  };
  const root = await post('/streams', {
    title: 'Ship connected intake',
    outcome: 'A reliable integration that can be used daily.',
    idempotencyKey: randomUUID(),
  });
  await page.goto(`/?view=streams&stream=${root.id}`);
  await expect(page.getByRole('button', { name: 'Approve stream', exact: true })).toHaveCount(0);
  await openDisclosure(page, 'Details & history');
  await openDisclosure(page, 'Manage stream');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const a = await post('/streams', {
      title: 'Connect the API',
      outcome: 'Working API connection',
      parentId: root.id,
      scopeIntent: 'within_scope',
      idempotencyKey: randomUUID(),
    }),
    b = await post('/streams', {
      title: 'Document the workflow',
      outcome: 'A usable guide',
      parentId: root.id,
      scopeIntent: 'within_scope',
      idempotencyKey: randomUUID(),
    });
  const w = await post('/work', {
      title: 'Implement API bridge',
      objective: 'Connect with available access',
      streamId: a.id,
      scopeIntent: 'within_scope',
    }),
    parallel = await post('/work', {
      title: 'Write the guide',
      objective: 'Document setup',
      streamId: b.id,
      scopeIntent: 'within_scope',
    });
  expect(w.assignment.state).toBe('tracked');
  await page.goto(`/?view=active&work=${w.id}`);
  await expect(page.locator('.detail-meta .badge')).toHaveText('Planned');
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).not.toBeVisible();
  await expect(page.getByText('Covered by stream approval', { exact: false })).not.toBeVisible();
  await post(`/work/${parallel.id}/tracking`, { revision: 1, progress: 'working' });
  const h = await post('/human-actions', {
    streamId: root.id,
    title: 'Get API access from Bob',
    conversationUrl: 'codex://threads/12345678-1234-1234-1234-123456789abc',
    doneWhen: 'Access is available in the local credential store',
    waitingOn: 'Bob',
    idempotencyKey: randomUUID(),
  });
  await post('/dependencies', {
    target: { id: w.id, kind: 'change' },
    revision: 1,
    dependencies: [
      {
        source: { id: h.id, kind: 'human_action' },
        stage: 'start',
        condition: 'done',
        reason: 'Cannot connect without access',
      },
    ],
  });
  await page.goto(`/?view=streams&stream=${root.id}`);
  const map = page.getByRole('region', { name: 'Stream work' });
  await expect(map.locator('.work-map-node').filter({ hasText: w.title })).toContainText(
    'Waiting to start',
  );
  await expect(map.locator('.work-map-node').filter({ hasText: parallel.title })).toContainText(
    'In progress',
  );
  await map.locator('.work-map-node').filter({ hasText: h.title }).click();
  await expect(map.getByRole('complementary')).toContainText('Implement API bridge');
  await expect(
    map.getByRole('complementary').getByRole('link', { name: 'Open chat' }),
  ).toHaveAttribute('href', h.conversationUrl);
  await expect(map.locator('.work-map-edge.selected')).toHaveCount(1);
  // A link to the blocked branch must not visually pass through unrelated work.
  expect(
    await map.evaluate((el) => {
      const unrelated = [...el.querySelectorAll('.work-map-node')]
        .find((n) => n.textContent?.includes('Write the guide'))!
        .getBoundingClientRect();
      const path = el.querySelector('.work-map-edge.selected') as SVGPathElement;
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      for (let i = 0; i <= 100; i++) {
        const point = path.getPointAtLength((length * i) / 100).matrixTransform(matrix);
        if (
          point.x > unrelated.left &&
          point.x < unrelated.right &&
          point.y > unrelated.top &&
          point.y < unrelated.bottom
        )
          return false;
      }
      return true;
    }),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/stream-branches.png', fullPage: true });
  await page.goto('/');
  const card = page.locator('.outcome-card').filter({ hasText: root.title });
  await expect(card).toContainText('In progress');
  await expect(card).toContainText('Partly blocked');
  await expect(card).not.toContainText('No progress report yet');
  await expect(card).not.toContainText('Reported by');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: /Needs you/ })
    .click();
  const request = page.locator('.request-card').filter({ hasText: h.title });
  await expect(request).toHaveCount(1);
  await expect(request).toContainText('Implement API bridge');
  await expect(request).toContainText(root.title);
  await expect(request.getByRole('link', { name: 'Open chat' })).toHaveAttribute(
    'href',
    'codex://threads/12345678-1234-1234-1234-123456789abc',
  );
  await expect(page.locator('.request-card').filter({ hasText: parallel.title })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/visual-human-request.png', fullPage: true });
  await expect(request.locator('form')).toHaveCount(0);
  await page.evaluate(async (h) => {
    const r = await fetch(`/api/human-actions/${h.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: h.revision,
        state: 'done',
        response: 'Bob enabled access in the existing local store.',
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!r.ok) throw new Error('Human response not saved');
  }, h);
  await expect(request).toHaveCount(0);
  const detail = await fetch(`${config.url}/api/work/${w.id}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  }).then((r) => r.json());
  expect(detail.tracking.prerequisites[0].satisfied).toBe(true);
  await post(`/work/${w.id}/tracking`, {
    revision: detail.tracking.revision,
    progress: 'delivered',
  });
  await page.goto(`/?view=streams&stream=${root.id}`);
  const region = page.getByRole('region', { name: 'Stream detail' });
  const nodes = region.locator('.work-map-node');
  await expect(nodes.filter({ hasText: w.title })).toBeVisible();
  await expect(nodes.filter({ hasText: w.title })).toContainText('Delivered');
  await expect(nodes.filter({ hasText: parallel.title })).toContainText('In progress');
  await region.locator('.work-map-group-heading button').filter({ hasText: a.title }).click();
  await region.getByRole('complementary').getByRole('button', { name: 'Open stream' }).click();
  await expect(page.getByRole('heading', { name: a.title, exact: true })).toBeVisible();
  await page.locator('.work-map-node').filter({ hasText: w.title }).click();
  await page.getByRole('complementary').getByRole('button', { name: 'Open change' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Work detail' })
      .getByText('Delivered', { exact: true })
      .first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?view=streams&stream=${root.id}`);
  await expect(page.getByRole('heading', { name: root.title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(region.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(region.getByRole('button', { name: 'Map', exact: true })).toBeDisabled();
  await expect(region.locator('.work-map-node').filter({ hasText: parallel.title })).toBeVisible();
  await page.screenshot({ path: 'test-results/oversight-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('.outcome-card').filter({ hasText: root.title })).toContainText(
    '1 delivered',
  );
  await page.screenshot({ path: 'test-results/oversight-desktop.png', fullPage: true });
});
