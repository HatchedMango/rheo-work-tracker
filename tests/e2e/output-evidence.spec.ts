import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

test('read-only MR checks remain distinct from reported work and work on a narrow screen', async ({
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
    title: 'Follow linked MR evidence',
    outcome: 'Keep observations clear',
    idempotencyKey: randomUUID(),
  });
  const w = await post('/work', {
    title: 'Implement the useful change',
    objective: 'Observe without delivering',
    streamId: s.id,
    idempotencyKey: randomUUID(),
  });
  await post(`/work/${w.id}/outputs`, {
    kind: 'mr',
    label: 'Implementation MR',
    url: 'https://gitlab.example.com/team/project/-/merge_requests/12',
    state: 'available',
    codeRevision: 'a'.repeat(40),
    idempotencyKey: randomUUID(),
  });
  const other = await post('/work', {
    title: 'Keep another change separate',
    objective: 'Retain selection-specific evidence',
    streamId: s.id,
    idempotencyKey: randomUUID(),
  });
  await post(`/work/${other.id}/outputs`, {
    kind: 'other',
    label: 'Other change evidence',
    url: 'https://example.com/other',
    state: 'available',
    idempotencyKey: randomUUID(),
  });
  await page.goto('/?view=connections');
  const card = page.locator('.gitlab-connection');
  await card.getByRole('button', { name: 'Set up GitLab', exact: true }).click();
  await card
    .getByRole('textbox', { name: 'GitLab URL', exact: true })
    .fill('https://gitlab.example.com');
  await card.getByLabel('Read-only access token', { exact: true }).fill('synthetic-browser-token');
  await card.getByRole('button', { name: 'Save GitLab access', exact: true }).click();
  await expect(card.getByText('Access saved for', { exact: false })).toBeVisible();
  await expect(card.getByLabel('Read-only access token', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/gitlab-connection.png', fullPage: true });
  try {
    await page.goto(`/?view=streams&stream=${s.id}`);
    await page.locator(`[data-map-node="${w.id}"]`).click();
    const inspector = page.getByRole('complementary', { name: 'Selected work' });
    await expect(inspector.getByText('available · reported by', { exact: false })).toBeVisible();
    await inspector.getByRole('button', { name: 'Check GitLab', exact: true }).click();
    await expect(inspector.getByText('GitLab: merged', { exact: false })).toBeVisible();
    await expect(inspector.getByText('pipeline success', { exact: false })).toBeVisible();
    await expect(page.locator(`[data-map-node="${w.id}"]`)).toContainText('Planned');
    const actual = await page.request.get(`/api/work/${w.id}`);
    expect((await actual.json()).tracking.progress).not.toBe('delivered');
    await page.screenshot({ path: 'test-results/output-evidence-map.png', fullPage: true });
    let resume!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => (resume = resolve));
    const intercepted = new Promise<void>((resolve) => (started = resolve));
    const observePath = `**/api/work/${w.id}/outputs/*/observe`;
    await page.route(observePath, async (route) => {
      started();
      await waiting;
      await route.continue();
    });
    await inspector.getByRole('button', { name: 'Check GitLab', exact: true }).click();
    await intercepted;
    await page.locator(`[data-map-node="${other.id}"]`).click();
    await expect(inspector.getByRole('link', { name: 'Other change evidence' })).toBeVisible();
    const completed = page.waitForResponse((r) => r.url().endsWith('/observe'));
    resume();
    await completed;
    await expect(inspector.getByRole('link', { name: 'Implementation MR' })).toHaveCount(0);
    await expect(inspector.getByRole('link', { name: 'Other change evidence' })).toBeVisible();
    await page.unroute(observePath);
    await page.locator(`[data-map-node="${w.id}"]`).click();
    await expect(inspector.getByText('GitLab: merged', { exact: false })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(
      inspector.getByRole('link', { name: 'Implementation MR', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: 'test-results/output-evidence-mobile.png', fullPage: true });
  } finally {
    await page.goto('/?view=connections');
    await page
      .locator('.gitlab-connection')
      .getByRole('button', { name: 'Remove GitLab access', exact: true })
      .click();
    await expect(
      page
        .locator('.gitlab-connection')
        .getByRole('button', { name: 'Set up GitLab', exact: true }),
    ).toBeVisible();
  }
});
