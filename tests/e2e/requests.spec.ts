import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
test('human requests show action, useful instructions and why before expandable background', async ({
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
    title: 'Make human input clear',
    outcome: 'One obvious next step',
    idempotencyKey: randomUUID(),
  });
  const command = "example auth login --browser '<script>window.bad=true</script>'";
  const action = await post('/human-actions', {
    streamId: s.id,
    title: 'Sign in to the service',
    description: 'Technical background belongs in details.',
    doneWhen: 'The intended account is authenticated and confirmed in chat.',
    conversationUrl: 'codex://threads/' + randomUUID(),
    guidance: {
      steps: [
        'Open Terminal.',
        'Copy and run the sign-in command, then finish in your browser.',
        'Tell the agent when you are signed in.',
      ],
      copy: { label: 'sign-in command', text: command },
      why: 'This lets the agent publish the trial.',
    },
    idempotencyKey: randomUUID(),
  });
  const q = await post(`/streams/${s.id}/context`, {
    kind: 'question',
    body: 'Which account should we use?',
    needsHuman: true,
    guidance: {
      recommendation: 'Use the team account.',
      why: 'It keeps access available to the team.',
    },
    idempotencyKey: randomUUID(),
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/?view=streams&stream=${s.id}`);
  await page.locator(`[data-map-node="${action.id}"]`).click();
  const inspector = page.getByRole('complementary', { name: 'Selected work' });
  await expect(inspector.getByText('Open Terminal.', { exact: true })).toBeVisible();
  await expect(inspector.getByText('This lets the agent publish the trial.')).toBeVisible();
  await expect(inspector.getByText('Technical background belongs in details.')).toBeHidden();
  await expect(
    inspector.getByText('The intended account is authenticated and confirmed in chat.'),
  ).toBeHidden();
  await inspector.getByRole('button', { name: 'Copy sign-in command', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  expect(await page.evaluate(() => Object.hasOwn(window, 'bad'))).toBe(false);
  await inspector.getByText('Details', { exact: true }).click();
  await expect(inspector.getByText('Technical background belongs in details.')).toBeVisible();
  await inspector.getByText('Details', { exact: true }).click();
  await page.screenshot({ path: 'test-results/focused-request-map.png', fullPage: true });
  // Same selected request refreshes when its content revision changes, without duplicating or completing it.
  await post(`/human-actions/${action.id}/update`, {
    revision: 1,
    guidance: { steps: ['Use the updated sign-in instructions.'], why: 'This unlocks publishing.' },
    idempotencyKey: randomUUID(),
  });
  await expect(inspector.getByText('Use the updated sign-in instructions.')).toBeVisible({
    timeout: 12000,
  });
  await expect(inspector.getByRole('button', { name: 'Copy sign-in command' })).toHaveCount(0);
  await page.locator(`[data-map-node="${q.id}"]`).click();
  await expect(inspector.getByText('Use the team account.')).toBeVisible();
  await expect(inspector.getByText('It keeps access available to the team.')).toBeVisible();
  await page.goto('/?view=needs');
  const card = page
    .locator('.request-card')
    .filter({ has: page.getByRole('heading', { name: 'Sign in to the service', exact: true }) });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Use the updated sign-in instructions.')).toBeVisible();
  await expect(card.getByText('Technical background belongs in details.')).toBeHidden();
  await expect(card.getByRole('link', { name: 'Open chat' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/focused-request-mobile.png', fullPage: true });
});
