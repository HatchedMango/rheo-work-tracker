import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
test('finds session handoffs on changes and streams with pagination and safe return actions', async ({
  page,
  context,
}) => {
  const config = JSON.parse(readFileSync('.data/e2e/agent.json', 'utf8'));
  async function post(path: string, body: unknown) {
    const r = await fetch(config.url + '/api' + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r.ok, await r.clone().text()).toBeTruthy();
    return r.json();
  }
  const s = await post('/streams', {
    title: 'Find session history',
    outcome: 'Return to the right chat',
    idempotencyKey: randomUUID(),
  });
  const a = await post('/work', {
    title: 'First session change',
    objective: 'First work',
    streamId: s.id,
    idempotencyKey: randomUUID(),
  });
  const b = await post('/work', {
    title: 'Second session change',
    objective: 'Second work',
    streamId: s.id,
    idempotencyKey: randomUUID(),
  });
  await post('/dependencies', {
    target: { kind: 'change', id: b.id },
    revision: b.tracking.revision,
    dependencies: [
      {
        source: { kind: 'change', id: a.id },
        stage: 'start',
        condition: 'output_available',
        reason: 'Use the first result in the second change',
      },
    ],
  });
  let time = Date.now() - 2000;
  const sessionId = randomUUID();
  async function event(
    changeId: string,
    kind: string,
    checkpoint?: unknown,
    id = sessionId,
    client = 'codex',
  ) {
    return post('/sync/events', {
      streamId: s.id,
      changeId,
      client,
      sessionId: id,
      project: '/a/very-long-project-path/'.repeat(8),
      turnId: 'one',
      eventId: randomUUID(),
      event: kind,
      occurredAt: ++time,
      ...(checkpoint ? { checkpoint } : {}),
    });
  }
  await event(a.id, 'start');
  await event(a.id, 'checkpoint', { summary: 'First handoff is preserved' });
  await event(b.id, 'start');
  await event(b.id, 'checkpoint', { summary: 'Second handoff is separate' });
  for (let i = 0; i < 10; i++) await event(b.id, 'start', undefined, randomUUID(), 'claude-code');
  await page.goto(`/?view=active&work=${a.id}`);
  const detail = page.getByRole('region', { name: 'Work detail' });
  const chat = detail.getByRole('link', { name: `Open Codex chat ${sessionId.slice(-6)}` });
  await expect(chat).toHaveAttribute('href', `codex://threads/${sessionId}`);
  await expect(detail.getByText('First handoff is preserved')).toHaveCount(0);
  await expect(detail.getByText('Session details', { exact: true })).toHaveCount(0);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/?view=streams&stream=${s.id}`);
  const aCard = page.locator(`[data-map-card="${a.id}"]`),
    bCard = page.locator(`[data-map-card="${b.id}"]`);
  await expect(
    aCard.getByRole('link', { name: `Open Codex chat ${sessionId.slice(-6)}` }),
  ).toHaveAttribute('href', `codex://threads/${sessionId}`);
  await expect(bCard.getByRole('button', { name: /Copy Claude session ID/ })).toHaveCount(3);
  // Chat actions are siblings of the work selector, so copying doesn't change selection.
  await aCard.locator('.work-map-node').click();
  await bCard
    .getByRole('button', { name: /Copy Claude session ID/ })
    .first()
    .click();
  await expect(aCard.locator('.work-map-node')).toHaveAttribute('aria-pressed', 'true');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^[a-f0-9-]{36}$/);
  await expect(bCard.getByRole('status')).toHaveText('Copied');
  expect(await page.locator('button button, button a').count()).toBe(0);
  await bCard.getByRole('button', { name: 'Show all 11 related chats' }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected work' });
  await expect(inspector.getByRole('heading', { name: 'Second session change' })).toBeVisible();
  await inspector.getByRole('button', { name: 'Older chats' }).click();
  await inspector.getByRole('button', { name: 'Older chats' }).click();
  await expect(
    inspector.getByRole('link', { name: `Open Codex chat ${sessionId.slice(-6)}` }),
  ).toBeVisible();
  await expect(inspector.getByText('Second handoff is separate')).toHaveCount(0);
  // The same work owns its links in the active map and narrow fallback.
  await expect(page.getByRole('group', { name: 'Work presentation' })).toHaveCount(0);
  await expect(page.locator('.work-map-edge')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/integrated-chats-map.png', fullPage: true });
  await expect(aCard.getByRole('link')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/integrated-chats-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(aCard.getByRole('link')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/integrated-chats-mobile.png', fullPage: true });
});

test('reading context does not imply saved progress or add a work chat link', async ({ page }) => {
  const config = JSON.parse(readFileSync('.data/e2e/agent.json', 'utf8'));
  const post = async (path: string, body: unknown) => {
    const r = await fetch(config.url + '/api' + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r.ok).toBeTruthy();
    return r.json();
  };
  const stream = await post('/streams', {
    title: 'Read context quietly',
    outcome: 'Review context',
    idempotencyKey: randomUUID(),
  });
  const change = await post('/work', {
    title: 'Unstarted work',
    objective: 'A future output',
    streamId: stream.id,
    idempotencyKey: randomUUID(),
  });
  await post('/sync/events', {
    streamId: stream.id,
    changeId: change.id,
    client: 'claude-code',
    sessionId: randomUUID(),
    project: '/fixture',
    turnId: 'one',
    eventId: randomUUID(),
    event: 'start',
    occurredAt: Date.now(),
    defaultIntent: 'reading',
  });
  await page.goto(`/?view=streams&stream=${stream.id}`);
  await page.getByText('Details & history', { exact: true }).click();
  await expect(page.locator('.sync-summary > summary')).toHaveText('Context received');
  await page.locator('.sync-summary > summary').click();
  await expect(page.locator('.sync-summary')).toContainText('Reading context');
  await expect(page.locator('.sync-summary')).not.toContainText('1970');
  await expect(
    page
      .locator(`[data-map-card="${change.id}"]`)
      .getByRole('button', { name: /Copy Claude session ID/ }),
  ).toHaveCount(0);
});
