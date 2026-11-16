import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

test('an offline midnight rollover does not label yesterday’s changes as today’s', async ({
  page,
}) => {
  const start = Date.parse('2026-11-17T05:59:59Z');
  await page.clock.install({ time: start });
  let calls = 0;
  await page.route('**/api/daily-progress**', async (route) => {
    if (++calls > 1) return route.fulfill({ status: 503, json: { message: 'Offline' } });
    return route.fulfill({
      json: {
        count: 8,
        target: 7,
        revision: 1,
        metric: 'changes_done',
        day: '2026-11-16',
        timeZone: 'America/Chicago',
        nextDayAt: start + 1000,
        checkedAt: start,
        items: [],
      },
    });
  });
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Daily change progress' });
  await expect(card.getByText('+1 over goal')).toBeVisible();
  await page.clock.fastForward(1100);
  await expect(card.getByText('—', { exact: true })).toBeVisible();
  await expect(card.getByText('+1 over goal')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Goal 7', exact: true })).toBeVisible();
});

test('real delivered changes update a persistent daily target and uncapped over-goal progress', async ({
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
  const complete = async (title: string) => {
    const w = await post('/work', {
      title,
      objective: 'Daily progress fixture',
      idempotencyKey: randomUUID(),
    });
    await post(`/work/${w.id}/tracking`, {
      revision: w.tracking.revision,
      progress: 'delivered',
      progressNote: 'Fixture delivered.',
    });
    return w;
  };
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Daily change progress' });
  await expect(card.getByRole('button', { name: 'Edit daily goal' })).toBeEnabled();
  const initial = await page.evaluate(async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (await fetch('/api/daily-progress?timeZone=' + encodeURIComponent(zone))).json();
  });
  const goal = initial.count + 5;
  const setTarget = async (value: number) => {
    await card.getByRole('button', { name: 'Edit daily goal' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Daily goal', { exact: true })).toBeFocused();
    await dialog.getByLabel('Daily goal', { exact: true }).fill(String(value));
    await dialog.getByRole('button', { name: 'Save goal' }).click();
    await expect(dialog).not.toBeVisible();
  };
  await setTarget(goal);
  for (let i = 0; i < 3; i++) await complete('Completed change ' + i);
  await expect(card.getByText('2 to go')).toBeVisible();
  await card.screenshot({ path: 'test-results/daily-progress-under.png' });
  for (let i = 3; i < 8; i++) await complete('Completed change ' + i);
  const total = initial.count + 8;
  await expect(card.getByText('+3 over goal')).toBeVisible();
  await expect(card.getByText(Math.round((total / goal) * 100) + '% of your goal')).toBeVisible();
  await card.screenshot({ path: 'test-results/daily-progress-over.png' });
  await setTarget(4);
  await expect(card.getByText(`+${total - 4} over goal`)).toBeVisible();
  for (let i = 8; i < 18; i++) await complete('Completed change ' + i);
  const final = initial.count + 18;
  await expect(card.getByText(`+${final - 4} over goal`)).toBeVisible();
  await expect(card.getByText(Math.round((final / 4) * 100) + '% of your goal')).toBeVisible();
  await page.reload();
  await expect(card.getByText(`+${final - 4} over goal`)).toBeVisible();
  await card.getByRole('button', { name: 'Edit daily goal' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(`Changes done today · ${final}`, { exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'Completed change 17' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close daily goal' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/daily-progress-mobile.png', fullPage: true });
});

test('a target edited in another tab preserves the draft and reports a conflict', async ({
  page,
}) => {
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Daily change progress' });
  await card.getByRole('button', { name: 'Edit daily goal' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Daily goal', { exact: true }).fill('7');
  await page.evaluate(async () => {
    const current = await (await fetch('/api/daily-progress')).json();
    await fetch('/api/daily-progress/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 9, revision: current.revision }),
    });
  });
  await dialog.getByRole('button', { name: 'Save goal' }).click();
  await expect(dialog.getByRole('alert')).toContainText('goal changed');
  await expect(dialog.getByLabel('Daily goal', { exact: true })).toHaveValue('7');
  await dialog.getByRole('button', { name: 'Save goal' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card.getByRole('button', { name: 'Goal 7', exact: true })).toBeVisible();
});

test('empty, reached and far over-goal states stay clear on narrow screens', async ({ page }) => {
  let count = 0;
  await page.route('**/api/daily-progress**', (route) =>
    route.fulfill({
      json: {
        count,
        target: 5,
        revision: 1,
        metric: 'changes_done',
        day: '2026-11-16',
        timeZone: 'America/Chicago',
        nextDayAt: Date.now() + 86400000,
        checkedAt: Date.now(),
        items: [],
      },
    }),
  );
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Daily change progress' });
  await expect(card.getByText('5 to go', { exact: true })).toBeVisible();
  await expect(card.locator('.goal-ring-value')).toHaveCount(0);
  await card.screenshot({ path: 'test-results/daily-progress-zero.png' });
  count = 5;
  await page.reload();
  await expect(card.getByText('Goal reached', { exact: true })).toBeVisible();
  await expect(card.locator('.goal-ring-value')).toHaveAttribute('stroke-dasharray', '100 100');
  await expect(card.locator('.goal-ring-bonus')).toHaveCount(0);
  await card.screenshot({ path: 'test-results/daily-progress-reached.png' });
  count = 10;
  await page.reload();
  await expect(card.locator('.goal-ring-bonus')).toHaveAttribute('stroke-dasharray', '100 100');
  count = 11;
  await page.reload();
  await expect(card.getByText('+6 over goal', { exact: true })).toBeVisible();
  await expect(card.locator('.goal-ring-bonus')).toHaveAttribute('stroke-dasharray', '100 100');
  count = 12345;
  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload();
  await expect(card.getByText('+12340 over goal', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const number = await card.locator('.daily-progress-ring strong').boundingBox();
  const ring = await card.locator('.daily-progress-ring').boundingBox();
  expect(number!.width).toBeLessThan(ring!.width - 20);
  await card.getByRole('button', { name: 'Edit daily goal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your daily goal' });
  await expect(dialog.getByLabel('Daily goal', { exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Save goal' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/daily-progress-small-dialog.png' });
});
