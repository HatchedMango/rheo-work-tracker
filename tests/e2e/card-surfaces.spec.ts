import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
test('whole work cards keep their tone with selection, chat footers, hover and narrow layouts', async ({
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
    title: 'Check complete card surfaces',
    outcome: 'Consistent work cards',
    idempotencyKey: randomUUID(),
  });
  const human = await post('/human-actions', {
    streamId: s.id,
    title: 'Get access before connecting the service',
    doneWhen: 'Access is ready',
    idempotencyKey: randomUUID(),
  });
  const question = await post(`/streams/${s.id}/context`, {
    kind: 'question',
    body: 'Which account should the connection use?',
    needsHuman: true,
    idempotencyKey: randomUUID(),
  });
  const create = (title: string) =>
    post('/work', {
      title,
      objective: 'Keep related chats beside this work',
      streamId: s.id,
      idempotencyKey: randomUUID(),
    });
  const planned = await create('Planned work with several related chats and a wrapped title');
  const quiet = await create('Delivered work with a related chat');
  await post(`/work/${quiet.id}/tracking`, {
    revision: quiet.tracking.revision,
    progress: 'delivered',
    progressNote: 'Fixture delivered',
  });
  for (const w of [planned, quiet])
    for (let i = 0; i < 3; i++)
      await post('/sync/events', {
        streamId: s.id,
        changeId: w.id,
        client: 'codex',
        sessionId: randomUUID(),
        project: '/fixture',
        turnId: 'one',
        event: 'start',
        eventId: randomUUID(),
        occurredAt: Date.now(),
      });
  await page.goto(`/?view=streams&stream=${s.id}`);
  const card = (id: string) => page.locator(`[data-map-card="${id}"]`);
  await expect(card(human.id)).toBeVisible();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  async function check() {
    for (const [id, color] of [
      [human.id, 'rgb(248, 243, 252)'],
      [question.id, 'rgb(248, 243, 252)'],
      [planned.id, 'rgb(255, 255, 255)'],
      [quiet.id, 'rgb(247, 248, 250)'],
    ]) {
      await expect(card(id)).toHaveCSS('background-color', color);
      // No inner rounded color patch can stop short of the card's footer or stretched bottom.
      await expect(card(id).locator('.work-map-node')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      const bounds = await card(id).boundingBox();
      const links = card(id).locator('.chat-links');
      const footer = (await links.count()) ? await links.boundingBox() : null;
      if (footer && bounds)
        expect(footer.y + footer.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  }
  await check();
  for (const id of [human.id, question.id, planned.id, quiet.id]) {
    await card(id).locator('.work-map-node').click();
    await expect(card(id)).toHaveCSS('border-top-color', 'rgb(66, 99, 199)');
    await card(id).hover();
    await check();
  }
  // Keyboard focus stays visible on its own selector and on each independent chat link.
  const firstChat = card(planned.id).getByRole('link').first();
  await card(planned.id).locator('.work-map-node').focus();
  await page.keyboard.press('Tab');
  await expect(card(planned.id).getByRole('button', { name: 'Resume work' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstChat).toBeFocused();
  await expect(firstChat).toHaveCSS('outline-style', 'solid');
  await expect(firstChat).toHaveCSS('outline-width', '2px');
  await card(human.id).locator('.work-map-node').click();
  await page.screenshot({ path: 'test-results/card-surfaces-map.png', fullPage: true });
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await check();
  await page.screenshot({ path: 'test-results/card-surfaces-list.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/card-surfaces-mobile.png', fullPage: true });
});
