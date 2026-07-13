import { expect, test } from '@playwright/test';
import { RoundtablePage } from './pages/roundtable.page';

test.describe('reviewable Mission workflow', () => {
  test('makes workflow creation and step ownership obvious to a first-time user', async ({ page }) => {
    const roundtable = new RoundtablePage(page);

    await roundtable.signInAs('workflow-builder@roundtable.local');
    await page.getByRole('button', { name: 'Workflow', exact: true }).click();

    await expect(page.getByRole('button', { name: 'New workflow', exact: true })).toBeVisible();
    await expect(page.getByRole('note', { name: 'How workflows work' })).toContainText('Each card is one step');
    await expect(page.getByRole('note', { name: 'How workflows work' })).toContainText('Who is responsible?');

    await page.getByRole('button', { name: 'New workflow', exact: true }).click();
    await expect(page.getByTitle('Rename this workflow')).toHaveValue('Untitled workflow');

    await page.getByRole('button', { name: 'Configure', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Set up Build' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('What happens in this step?', { exact: true })).toBeVisible();
    await expect(dialog.getByText('What should this step produce?', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Who is responsible?', { exact: true })).toBeVisible();
    await expect(dialog.getByText('When can the workflow continue?', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('No one is assigned');

    await dialog.getByLabel('Instructions').fill('Create an accessible implementation from the approved brief.');
    await dialog.getByLabel('Expected result').fill('A working implementation ready for review.');
    await dialog.getByRole('button', { name: 'Add a role or person' }).click();
    await dialog.getByRole('button', { name: 'You', exact: true }).click();
    await dialog.getByRole('button', { name: 'Close step setup' }).click();

    await expect(page.getByText('A working implementation ready for review.', { exact: true })).toBeVisible();
    await expect(page.getByText('No role assigned yet', { exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Workflow', exact: true }).click();
    await page.getByRole('button', { name: 'Switch workflow', exact: true }).click();
    await page.getByRole('button', { name: /Untitled workflow/ }).click();
    await expect(page.getByText('A working implementation ready for review.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Set up New step' })).toBeVisible();
  });

  test('a signed-in user reviews a plan before local agents deliver the Mission', async ({ page }) => {
    const roundtable = new RoundtablePage(page);
    const goal = 'Build a static HTML status badge with accessible text, green and red states, and a short usage example.';

    await roundtable.signInAs('golden-path@roundtable.local');
    await roundtable.createMission(goal);
    await roundtable.expectApprovalGate(goal);
    await roundtable.approvePlan();
    await roundtable.expectDelivery(goal);
  });

  test('refresh restores a planned Mission without bypassing its approval gate', async ({ page }) => {
    const roundtable = new RoundtablePage(page);
    const goal = 'Create a static HTML release checklist with four named steps, keyboard focus styles, and completion criteria.';

    await roundtable.signInAs('approval-recovery@roundtable.local');
    await roundtable.createMission(goal);
    await page.reload();
    await roundtable.expectMissionInRail(goal);
    await roundtable.openMissionChat();

    await roundtable.expectApprovalGate(goal);
  });
});
