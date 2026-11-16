import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
test('automatically starts new work fresh and resumes the exact change with an up-to-date brief', async ({
  page,
  context,
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
    title: 'Start a focused task',
    outcome: 'Keep task context focused',
    idempotencyKey: randomUUID(),
  });
  const a = await post('/work', {
    streamId: s.id,
    title: 'Implement the selected work',
    objective: 'Only work on this change',
    idempotencyKey: randomUUID(),
  });
  const b = await post('/work', {
    streamId: s.id,
    title: 'A separate task',
    objective: 'A fresh context for a different change',
    idempotencyKey: randomUUID(),
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/?view=streams&stream=${s.id}`);
  const aCard = page.locator(`[data-map-card="${a.id}"]`);
  await aCard.getByRole('button', { name: 'Start work', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Start work', exact: true });
  await expect(
    dialog.getByText('A fresh chat will receive a focused brief for this change.'),
  ).toBeVisible();
  await dialog.getByLabel('Project folder').fill(resolve('.'));
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  const draft = dialog.getByRole('link', { name: 'Open Codex draft' });
  await expect(draft).toBeVisible();
  const uri = new URL((await draft.getAttribute('href'))!);
  expect(uri.protocol).toBe('codex:');
  expect(uri.hostname).toBe('new');
  expect(uri.searchParams.get('path')).toBe(resolve('.'));
  expect(uri.searchParams.get('prompt')).toContain(a.id);
  expect(uri.searchParams.get('prompt')).not.toContain(b.id);
  await dialog.getByLabel('Open with').selectOption('claude-code');
  await dialog.getByRole('button', { name: 'Copy start command' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('&& claude ');
  await page.keyboard.press('Escape');
  const unchanged = await page.evaluate(async (id) => {
    const w = await (await fetch(`/api/work/${id}`)).json();
    const sessions = await (await fetch(`/api/sessions?changeId=${id}`)).json();
    return { progress: w.tracking.progress, total: sessions.total };
  }, a.id);
  expect(unchanged).toEqual({ progress: 'unreported', total: 0 });
  const sessionId = randomUUID();
  await post('/sync/events', {
    client: 'codex',
    project: resolve('.'),
    sessionId,
    streamId: s.id,
    changeId: a.id,
    turnId: 'one',
    event: 'start',
    eventId: randomUUID(),
    occurredAt: Date.now(),
  });
  await post(`/work/${a.id}/tracking`, {
    revision: 1,
    progress: 'working',
    progressNote: 'Use the revised interface',
  });
  await page.reload();
  await aCard.getByRole('button', { name: 'Resume work', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Resume work', exact: true });
  await dialog.getByRole('button', { name: 'Copy current brief', exact: true }).click();
  const brief = await page.evaluate(() => navigator.clipboard.readText());
  expect(brief).toContain('Use the revised interface');
  expect(brief).toContain(a.id);
  await expect(dialog.getByRole('link', { name: 'Open existing chat' })).toHaveAttribute(
    'href',
    `codex://threads/${sessionId}`,
  );
  await expect(dialog.getByRole('link', { name: 'Open Codex draft' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/resume-work-desktop.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page
    .locator(`[data-map-card="${b.id}"]`)
    .getByRole('button', { name: 'Start work', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Start work', exact: true });
  await expect(dialog.getByRole('link', { name: 'Open Codex draft' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByText('Current brief', { exact: true }).click();
  await expect(dialog.getByLabel('Current work brief')).toContainText(b.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/start-work-mobile.png', fullPage: true });
});
