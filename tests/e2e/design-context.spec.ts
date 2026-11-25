import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
test('shows scoped invariants, assumption changes and qualified verification on desktop and mobile', async ({
  page,
}) => {
  const config = JSON.parse(readFileSync('.data/e2e/agent.json', 'utf8'));
  const post = async (path: string, body: unknown) => {
    const r = await fetch(config.url + '/api' + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r.ok, await r.clone().text()).toBeTruthy();
    return r.json();
  };
  const s = await post('/streams', {
    title: 'Keep design evidence connected',
    outcome: 'Review changed assumptions',
    idempotencyKey: randomUUID(),
  });
  const w = await post('/work', {
    title: 'Preserve private uploads',
    objective: 'Keep evidence scoped',
    streamId: s.id,
    acceptanceCriteria: ['Images remain private.'],
    idempotencyKey: randomUUID(),
  });
  const source = await post('/design-records', {
    target: { kind: 'stream', id: s.id },
    record: {
      kind: 'assumption',
      statement: 'The provider blocks anonymous image reads.',
      status: 'supported',
      evidence: 'Documentation says private.',
      invalidatedBy: 'Anonymous requests return image bytes.',
    },
    reason: 'Record provider behavior.',
    idempotencyKey: randomUUID(),
  });
  await post('/assumption-reviews', {
    changeId: w.id,
    assumptionId: source.id,
    assumptionRevision: 1,
    revision: 0,
    note: 'Use a private upload bucket.',
    idempotencyKey: randomUUID(),
  });
  await post('/design-records', {
    target: { kind: 'stream', id: s.id },
    record: {
      kind: 'invariant',
      statement: 'Pending images stay private.',
      applicability: 'Image pipeline',
      inherit: true,
      status: 'active',
    },
    reason: 'Keep privacy in scope.',
    idempotencyKey: randomUUID(),
  });
  await post('/design-records', {
    target: { kind: 'change', id: w.id },
    record: {
      kind: 'verification',
      criterionIndex: 0,
      criterion: 'Images remain private.',
      result: 'pass',
      method: 'manual',
      evidence: 'Signed-out GET returned 403.',
      conditions: 'Staging bucket only.',
      limitations: 'Production was not tested.',
      codeRevision: 'fixture-abc123',
      checkedAt: Date.now() - 10000,
    },
    reason: 'Record a bounded check.',
    idempotencyKey: randomUUID(),
  });
  await page.goto(`/?view=streams&stream=${s.id}`);
  await page.locator(`[data-map-node="${w.id}"]`).click();
  const inspector = page.getByRole('complementary', { name: 'Selected work' });
  const context = inspector.getByRole('region', { name: 'Design context' });
  await expect(
    context.getByText('Invariant: Pending images stay private.', { exact: true }),
  ).toBeVisible();
  await context.getByText('Criterion 1: pass', { exact: true }).click();
  await expect(context.getByText('Production was not tested.', { exact: true })).toBeVisible();
  await post('/design-records', {
    id: source.id,
    revision: 1,
    target: source.target,
    record: {
      ...source.record,
      status: 'invalidated',
      evidence: 'Anonymous staging probe returned bytes.',
    },
    reason: 'Recheck dependent work.',
    idempotencyKey: randomUUID(),
  });
  await expect(
    context.getByText('Assumption changed — review this work', { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await context
    .getByText('Assumption: The provider blocks anonymous image reads.', { exact: true })
    .click();
  await expect(
    context.getByText('Anonymous staging probe returned bytes.', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/design-context-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    context.getByText('Assumption changed — review this work', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/design-context-mobile.png', fullPage: true });
});
