import { expect, type Page, type Response } from '@playwright/test';

export class RoundtablePage {
  constructor(private readonly page: Page) {}

  async signInAs(email: string): Promise<void> {
    await this.page.goto('/signin', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(this.page.getByRole('heading', { name: 'Welcome back to Roundtable' })).toBeVisible();
    await this.page.getByLabel('Dev email').fill(email);
    await this.page.getByRole('button', { name: 'Sign in in dev mode' }).click();
    await expect(this.page).toHaveURL('/');
    await expect(this.page.getByRole('button', { name: 'Start a Mission' })).toBeVisible();
  }

  async createMission(goal: string): Promise<Response> {
    await this.page.getByRole('button', { name: 'Start a Mission' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'New Mission' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Describe the outcome in plain language — Roundtable will create a Mission, plan it, and wait for approval.').fill(goal);

    const planned = this.page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/orchestrator/turn');
    await dialog.getByRole('button', { name: 'Start Mission' }).click();
    const response = await planned;
    expect(response.ok(), await response.text()).toBe(true);
    return response;
  }

  async approvePlan(): Promise<Response> {
    const approval = this.page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/orchestrator/approval');
    await this.page.getByRole('button', { name: 'Start building' }).click();
    const response = await approval;
    expect(response.ok(), await response.text()).toBe(true);
    return response;
  }

  async openMissionChat(): Promise<void> {
    await this.page.getByRole('button', { name: 'Chat', exact: true }).click();
  }

  async expectMissionInRail(goal: string): Promise<void> {
    const escapedGoal = goal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(this.page.getByRole('button', { name: new RegExp(escapedGoal) })).toBeVisible();
  }

  async expectApprovalGate(goal: string): Promise<void> {
    await expect(this.page.getByTestId('mission-goal').getByText(goal, { exact: true })).toBeVisible();
    const gate = this.page.getByTestId('mission-approval-gate');
    // A newly-created Mission replays its real planning meeting before the
    // review gate appears. Wait on the gate itself rather than a fixed delay.
    await expect(gate).toBeVisible({ timeout: 70_000 });
    await expect(gate.getByText('awaiting approval', { exact: true })).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Start building' })).toBeVisible();
    await expect(this.page.getByText('Delivery ready', { exact: true })).toHaveCount(0);
  }

  async expectDelivery(goal: string): Promise<void> {
    await expect(this.page.getByTestId('mission-goal').getByText(goal, { exact: true })).toBeVisible();
    const delivery = this.page.getByTestId('mission-delivery');
    await expect(delivery.getByText('Delivery ready', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(delivery.getByText(/adapter=local-dispatch/)).toBeVisible();
  }
}
