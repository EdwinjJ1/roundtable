import { test } from '@playwright/test';
import { RoundtablePage } from './pages/roundtable.page';

test.describe('reviewable Mission workflow', () => {
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
