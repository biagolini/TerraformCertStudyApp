import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export interface UsageEvent {
  action: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  packId?: string;
  /** Snapshotted at call time, not resolved live — still shows a real
   * label after the pack itself is later deleted. Absent on rows logged
   * before this was added. */
  packName?: string;
  packVersion?: string;
  jobId?: string;
  label?: string;
  createdAt: number;
}

export interface UsageSummary {
  /** Raw, unaggregated — the Costs page caches this once per load and does
   * ALL time-range filtering and grouping (by action/model/pack/pack+model)
   * itself, client-side, from this array. See costs-page.component.ts. */
  items: UsageEvent[];
  totals: {
    totalCostUsd: number | null;
    totalTokens: number;
    count: number;
  };
}

export interface BudgetStatus {
  enabled: boolean;
  monthlyLimitUsd: number | null;
  currentSpendUsd: number;
  month: string;
}

/**
 * Reads the Costs page's data — GET /data/usage (see lambda/data/app.py).
 * Every AI-call producer (converse/review/import_extract/import_explain
 * Lambdas, plus this file's own data Lambda) writes the raw token-usage
 * rows this endpoint reads and prices. Also owns the monthly AI budget
 * config (GET/PUT /data/budget) that same set of Lambdas enforces before
 * making any Bedrock/AgentCore call — see their `_check_budget`/
 * `_add_budget_spend` helpers.
 */
@Injectable({ providedIn: 'root' })
export class UsageService {
  private readonly auth = inject(AuthService);

  /** Fetches the full (TTL-bounded, ~365 day) raw usage list once — no
   * since/until params, the Costs page filters/groups the cached result
   * itself rather than re-fetching per filter change. */
  async fetchUsage(): Promise<UsageSummary> {
    const token = await this.auth.getValidToken();
    const response = await fetch(`${environment.apiUrl}/data/usage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Failed to load usage history (status ${response.status})`);
    return (await response.json()) as UsageSummary;
  }

  async fetchBudget(): Promise<BudgetStatus> {
    const token = await this.auth.getValidToken();
    const response = await fetch(`${environment.apiUrl}/data/budget`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Failed to load budget (status ${response.status})`);
    return (await response.json()) as BudgetStatus;
  }

  async updateBudget(enabled: boolean, monthlyLimitUsd: number | null): Promise<BudgetStatus> {
    const token = await this.auth.getValidToken();
    const response = await fetch(`${environment.apiUrl}/data/budget`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled, monthlyLimitUsd }),
    });
    if (!response.ok) throw new Error(`Failed to save budget (status ${response.status})`);
    return (await response.json()) as BudgetStatus;
  }
}
