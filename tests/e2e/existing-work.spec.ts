import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('existing work handoffs resume and observe fresh progress for each selected project', async ({
  page,
}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rheo-projects-')));
  const projects = [join(root, "Client's web app"), join(root, 'API')];
  projects.forEach((p) => mkdirSync(p));
  const agent = new Client({ name: 'existing-work-browser-fixture', version: '1.0' });
  try {
    await page.goto('/?view=connections');
    await page.getByRole('button', { name: 'Connect an agent', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Client', exact: true }).selectOption('claude-code');
    await dialog.getByRole('textbox', { name: 'Connection name' }).fill('Existing project agent');
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/connections') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    const setup = await (await response).json();
    await agent.connect(new StdioClientTransport({ ...setup.launch, stderr: 'pipe' }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await agent.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const beforeAdoption = (await call('list_work', { view: 'all', limit: 100 })).items
      .map((w: { id: string }) => w.id)
      .sort();
    await dialog.getByRole('button', { name: 'Continue to verification' }).click();
    await dialog.getByRole('button', { name: 'Finish connection', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Set up existing work' });
    await expect(dialog.getByLabel('Project folders')).toBeFocused();
    await dialog.getByLabel('Project folders').fill('relative/path');
    await dialog.getByRole('button', { name: 'Prepare project prompts' }).click();
    await expect(dialog.getByRole('alert')).toContainText('full path');
    await expect(dialog.getByLabel('Project folders')).toHaveValue('relative/path');
    await dialog.getByLabel('Project folders').fill(projects.join('\n'));
    await dialog.getByRole('button', { name: 'Prepare project prompts' }).click();
    const cards = dialog.locator('.existing-projects > li');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("Client's web app");
    await expect(dialog.getByText('Context not received yet', { exact: true })).toHaveCount(2);
    await expect(dialog.getByText('Checkpoint not received yet', { exact: true })).toHaveCount(2);
    await expect(
      dialog.getByRole('button', { name: 'Copy project prompt', exact: true }),
    ).toHaveCount(2);
    await cards.first().getByText('View project prompt', { exact: true }).click();
    await expect(cards.first().locator('pre')).toContainText(
      'Reuse matching streams and unfinished changes',
    );
    await cards.first().getByText('View project prompt', { exact: true }).click();
    expect(
      (await call('list_work', { view: 'all', limit: 100 })).items
        .map((w: { id: string }) => w.id)
        .sort(),
    ).toEqual(beforeAdoption);
    await page.screenshot({ path: 'test-results/existing-work-handoffs.png', fullPage: true });
    const stream = await call('submit_stream', {
      title: 'Ship the client project',
      outcome: 'Finish current work',
      idempotencyKey: randomUUID(),
    });
    const identity = {
      client: 'claude-code',
      sessionId: randomUUID(),
      project: projects[0],
      streamId: stream.id,
      turnId: 'adoption',
    };
    await call('sync_work', {
      ...identity,
      event: 'start',
      eventId: randomUUID(),
      occurredAt: Date.now(),
    });
    await expect(cards.first().getByText('Context received', { exact: true })).toBeVisible();
    await expect(cards.nth(1).getByText('Context not received yet', { exact: true })).toBeVisible();
    await call('sync_work', {
      ...identity,
      event: 'checkpoint',
      eventId: randomUUID(),
      occurredAt: Date.now(),
      checkpoint: { summary: 'Current work and next step recorded.' },
    });
    await expect(cards.first().getByText('Checkpoint saved', { exact: true })).toBeVisible();
    await call('sync_work', {
      ...identity,
      turnId: 'follow-up',
      event: 'prompt',
      eventId: randomUUID(),
      occurredAt: Date.now(),
    });
    await expect(
      cards.first().getByText('Waiting for the chat’s latest checkpoint', { exact: true }),
    ).toBeVisible();
    await call('sync_work', {
      ...identity,
      turnId: 'follow-up',
      event: 'checkpoint',
      eventId: randomUUID(),
      occurredAt: Date.now(),
      checkpoint: { summary: 'Latest handoff recorded.' },
    });
    await expect(cards.first().getByText('Checkpoint saved', { exact: true })).toBeVisible();
    await page.reload();
    const row = page.locator('.connection-list li').filter({ hasText: 'Existing project agent' });
    await row.getByRole('button', { name: 'Set up existing work', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Set up existing work' });
    await expect(dialog.getByText('Checkpoint saved', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/existing-work-mobile.png', fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(
      row.getByRole('button', { name: 'Set up existing work', exact: true }),
    ).toBeFocused();
  } finally {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  }
});
