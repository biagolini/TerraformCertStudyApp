import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BudgetStatus, UsageEvent, UsageService, UsageSummary } from '../../core/services/usage.service';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { I18nService } from '../../core/i18n/i18n.service';

type RangePreset = 'all' | 'month' | '7d' | '30d' | 'custom';
type GroupBy = 'action' | 'model' | 'packName' | 'packVersion' | 'packModel';

interface JobGroup {
  jobId: string;
  packName?: string;
  packVersion?: string;
  items: UsageEvent[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number | null;
}

interface HistoryRow {
  kind: 'event' | 'jobGroup';
  event?: UsageEvent;
  group?: JobGroup;
}

interface BreakdownRow {
  key: string;
  label: string;
  tokens: number;
  costUsd: number;
  count: number;
}

const KNOWN_ACTIONS = [
  'reviewGenerate', 'reviewRefine', 'chat', 'chatSummary', 'transcriptScript',
  'titleGeneration', 'relatedServices', 'translate', 'importExtract', 'importExplain',
];

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 365;
const DEFAULT_BUDGET_LIMIT_USD = 10;

@Component({
  selector: 'app-costs-page',
  standalone: true,
  imports: [FormsModule, AiDisclaimerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="costs">
      <header class="card-header">
        <h2>{{ i18n.t('costsPage.title') }}</h2>
        <p class="subtitle">{{ i18n.t('costsPage.subtitle') }}</p>
        <app-ai-disclaimer [message]="i18n.t('costsPage.aiDisclaimer')" />
      </header>

      <div class="card range-card">
        <label class="field">
          <span class="label">{{ i18n.t('costsPage.range') }}</span>
          <select
            class="select-input"
            [ngModel]="rangePreset()"
            (ngModelChange)="rangePreset.set($event)"
          >
            <option value="all">{{ i18n.t('costsPage.rangeAll') }}</option>
            <option value="month">{{ i18n.t('costsPage.rangeMonth') }}</option>
            <option value="7d">{{ i18n.t('costsPage.range7d') }}</option>
            <option value="30d">{{ i18n.t('costsPage.range30d') }}</option>
            <option value="custom">{{ i18n.t('costsPage.rangeCustom') }}</option>
          </select>
        </label>
        @if (rangePreset() === 'custom') {
          <div class="custom-range">
            <label class="field">
              <span class="label">{{ i18n.t('costsPage.rangeFrom') }}</span>
              <input
                type="date"
                class="date-input"
                [min]="oneYearAgoIso"
                [ngModel]="customStart()"
                (ngModelChange)="customStart.set($event)"
              />
            </label>
            <label class="field">
              <span class="label">{{ i18n.t('costsPage.rangeTo') }}</span>
              <input
                type="date"
                class="date-input"
                [min]="oneYearAgoIso"
                [ngModel]="customEnd()"
                (ngModelChange)="customEnd.set($event)"
              />
            </label>
          </div>
        }
      </div>

      <div class="card budget-card">
        <h3>{{ i18n.t('costsPage.budgetTitle') }}</h3>
        <p class="helper">{{ i18n.t('costsPage.budgetDescription') }}</p>
        <label class="toggle-row">
          <input
            type="checkbox"
            [ngModel]="budgetEnabled()"
            (ngModelChange)="budgetEnabled.set($event)"
          />
          <span>{{ i18n.t('costsPage.budgetEnable') }}</span>
        </label>
        @if (budgetEnabled()) {
          <label class="field">
            <span class="label">{{ i18n.t('costsPage.budgetLimit') }}</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              class="date-input"
              [(ngModel)]="budgetLimitInput"
            />
          </label>
        }
        <div class="budget-actions">
          <button type="button" class="save-btn" (click)="saveBudget()" [disabled]="budgetSaving()">
            {{ i18n.t('costsPage.budgetSave') }}
          </button>
          @if (budgetSaved()) {
            <span class="helper">{{ i18n.t('costsPage.budgetSaved') }}</span>
          }
        </div>
        @if (budgetStatus(); as b) {
          @if (b.enabled) {
            <p class="helper">
              {{ i18n.t('costsPage.budgetSpent', { spent: formatUsd(b.currentSpendUsd), limit: formatUsd(b.monthlyLimitUsd) }) }}
            </p>
          }
        }
      </div>

      @if (loading()) {
        <div class="card"><p class="helper">{{ i18n.t('costsPage.loading') }}</p></div>
      } @else if (error()) {
        <div class="card"><p class="helper error">{{ i18n.t('costsPage.loadFailed') }}</p></div>
      } @else {
        <div class="summary-grid">
          <div class="card summary-card">
            <span class="summary-label">{{ i18n.t('costsPage.totalCost') }}</span>
            <span class="summary-value">{{ formatCost(rangeTotals().costUsd) }}</span>
          </div>
          <div class="card summary-card">
            <span class="summary-label">{{ i18n.t('costsPage.totalTokens') }}</span>
            <span class="summary-value">{{ formatTokens(rangeTotals().tokens) }}</span>
          </div>
          <div class="card summary-card">
            <span class="summary-label">{{ i18n.t('costsPage.totalCalls') }}</span>
            <span class="summary-value">{{ rangeFilteredItems().length }}</span>
          </div>
        </div>

        <div class="card">
          <label class="field">
            <span class="label">{{ i18n.t('costsPage.groupBy') }}</span>
            <select
              class="select-input"
              [ngModel]="groupBy()"
              (ngModelChange)="groupBy.set($event)"
            >
              <option value="action">{{ i18n.t('costsPage.byAction') }}</option>
              <option value="model">{{ i18n.t('costsPage.byModel') }}</option>
              <option value="packName">{{ i18n.t('costsPage.byPack') }}</option>
              <option value="packVersion">{{ i18n.t('costsPage.byPackVersion') }}</option>
              <option value="packModel">{{ i18n.t('costsPage.byPackModel') }}</option>
            </select>
          </label>
          @if (groupedBreakdown().length === 0) {
            <p class="helper">{{ i18n.t('costsPage.empty') }}</p>
          } @else {
            <ul class="breakdown-list">
              @for (row of groupedBreakdown(); track row.key) {
                <li class="breakdown-row">
                  <span class="breakdown-name">{{ row.label }}</span>
                  <span class="breakdown-sub">{{ i18n.t('costsPage.callCount', { count: row.count }) }} · {{ formatTokens(row.tokens) }}</span>
                  <span class="breakdown-cost">{{ formatCost(row.costUsd) }}</span>
                </li>
              }
            </ul>
          }
        </div>

        <div class="card">
          <h3>{{ i18n.t('costsPage.history') }}</h3>
          @if (historyRows().length === 0) {
            <p class="helper">{{ i18n.t('costsPage.empty') }}</p>
          } @else {
            <ul class="history-list">
              @for (row of historyRows(); track row.event ? row.event.createdAt + row.event.action : row.group!.jobId) {
                @if (row.kind === 'event') {
                  <li class="history-row">
                    <div class="history-main">
                      <span class="history-action">{{ actionLabel(row.event!.action) }}</span>
                      <span class="history-model">{{ row.event!.modelId }}</span>
                    </div>
                    <div class="history-sub">
                      <span>{{ formatDate(row.event!.createdAt) }}</span>
                      <span>{{ i18n.t('costsPage.tokensIn', { count: row.event!.inputTokens }) }}</span>
                      <span>{{ i18n.t('costsPage.tokensOut', { count: row.event!.outputTokens }) }}</span>
                      @if (formatPackLabel(row.event!.packName, row.event!.packVersion); as name) {
                        <span class="history-pack">{{ name }}</span>
                      }
                      @if (row.event!.label) {
                        <span class="history-label">{{ row.event!.label }}</span>
                      }
                    </div>
                    <span class="history-cost">{{ formatCost(row.event!.costUsd) }}</span>
                  </li>
                } @else {
                  <li class="history-row job-row">
                    <div class="history-main">
                      <span class="history-action">{{ i18n.t('costsPage.jobGroup') }} — {{ row.group!.jobId }}</span>
                    </div>
                    <div class="history-sub">
                      <span>{{ i18n.t('costsPage.callCount', { count: row.group!.items.length }) }}</span>
                      <span>{{ i18n.t('costsPage.tokensIn', { count: row.group!.inputTokens }) }}</span>
                      <span>{{ i18n.t('costsPage.tokensOut', { count: row.group!.outputTokens }) }}</span>
                      @if (formatPackLabel(row.group!.packName, row.group!.packVersion); as name) {
                        <span class="history-pack">{{ name }}</span>
                      }
                    </div>
                    <span class="history-cost">{{ formatCost(row.group!.totalCostUsd) }}</span>
                  </li>
                }
              }
            </ul>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
      }
      @media (min-width: 768px) {
        :host {
          max-width: 960px;
          margin: 0 auto;
          width: 100%;
        }
      }
      .costs {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .card-header h2 {
        font-size: var(--font-size-xl);
        margin-bottom: var(--space-xs);
      }
      .subtitle {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .card {
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        padding: var(--space-lg);
        box-shadow: var(--shadow-sm);
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .card h3 {
        font-size: var(--font-size-lg);
        color: var(--text-primary);
      }
      .helper {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .helper.error {
        color: var(--color-red);
      }
      .range-card {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--space-md);
      }
      .custom-range {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-md);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .label {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .select-input,
      .date-input {
        height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-base);
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: var(--space-sm);
      }
      .summary-card {
        align-items: flex-start;
        gap: 2px;
      }
      .summary-label {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .summary-value {
        font-size: var(--font-size-xl);
        font-weight: 700;
        color: var(--text-primary);
      }
      .breakdown-list,
      .history-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .breakdown-row,
      .history-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
      }
      .breakdown-name {
        font-weight: 600;
        font-size: var(--font-size-base);
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
      }
      .breakdown-sub {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        white-space: nowrap;
      }
      .breakdown-cost {
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
      }
      .history-row {
        flex-wrap: wrap;
      }
      .history-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .history-action {
        font-weight: 600;
        font-size: var(--font-size-base);
        color: var(--text-primary);
      }
      .history-model {
        font-size: var(--font-size-xs);
        color: var(--text-faint);
      }
      .history-sub {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-sm);
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .history-pack {
        color: var(--color-purple);
        font-weight: 600;
      }
      .history-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 240px;
      }
      .history-cost {
        font-weight: 600;
        color: var(--text-primary);
        margin-left: auto;
      }
      .job-row {
        border-color: var(--color-purple);
      }
      .budget-card {
        gap: var(--space-sm);
      }
      .toggle-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        cursor: pointer;
        font-size: var(--font-size-base);
        color: var(--text-primary);
      }
      .toggle-row input {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
      .budget-actions {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .save-btn {
        height: var(--touch-min);
        padding: 0 var(--space-lg);
        border-radius: var(--radius-md);
        background: var(--color-purple);
        color: #fff;
        font-weight: 600;
        font-size: var(--font-size-base);
      }
      .save-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
})
export class CostsPageComponent {
  private readonly usageService = inject(UsageService);
  protected readonly i18n = inject(I18nService);

  /** Fetched once per page load; every filter/grouping below operates on
   * this cached array — no re-fetch on a filter or grouping change. */
  protected readonly rawItems = signal<UsageEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly rangePreset = signal<RangePreset>('all');
  /** yyyy-mm-dd strings — signals (not plain properties) so the
   * range-filter computed below reacts to them. */
  protected readonly customStart = signal('');
  protected readonly customEnd = signal('');
  /** Matches the backend's 365-day TTL — a custom date before this can
   * never have data, so the input simply doesn't offer it. */
  protected readonly oneYearAgoIso = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);

  protected readonly groupBy = signal<GroupBy>('action');

  protected readonly budgetStatus = signal<BudgetStatus | null>(null);
  protected readonly budgetEnabled = signal(false);
  protected readonly budgetSaving = signal(false);
  protected readonly budgetSaved = signal(false);
  /** Plain property (not a signal) bound via [(ngModel)] on a number input. */
  protected budgetLimitInput = DEFAULT_BUDGET_LIMIT_USD;

  protected readonly rangeFilteredItems = computed<UsageEvent[]>(() => {
    const { since, until } = this.resolveRange();
    if (since === undefined && until === undefined) return this.rawItems();
    return this.rawItems().filter(
      (item) => (since === undefined || item.createdAt >= since) && (until === undefined || item.createdAt <= until),
    );
  });

  protected readonly rangeTotals = computed(() => {
    let tokens = 0;
    let costUsd = 0;
    let anyPriced = false;
    for (const item of this.rangeFilteredItems()) {
      tokens += item.totalTokens;
      if (item.costUsd !== null) {
        costUsd += item.costUsd;
        anyPriced = true;
      }
    }
    return { tokens, costUsd: anyPriced ? costUsd : null };
  });

  protected readonly groupedBreakdown = computed<BreakdownRow[]>(() => {
    const mode = this.groupBy();
    const map = new Map<string, BreakdownRow>();
    for (const item of this.rangeFilteredItems()) {
      const keyLabel = this.groupKeyAndLabel(item, mode);
      if (!keyLabel) continue;
      const row = map.get(keyLabel.key) ?? { key: keyLabel.key, label: keyLabel.label, tokens: 0, costUsd: 0, count: 0 };
      row.tokens += item.totalTokens;
      row.count += 1;
      if (item.costUsd !== null) row.costUsd += item.costUsd;
      map.set(keyLabel.key, row);
    }
    return [...map.values()].sort((a, b) => b.tokens - a.tokens);
  });

  /** Groups importExtract/importExplain rows sharing a jobId into one
   * collapsed history line (a whole .zip's cost read as one number) —
   * everything else (chat, translate, review, ...) stays a plain row. */
  protected readonly historyRows = computed<HistoryRow[]>(() => {
    const rows: HistoryRow[] = [];
    const jobGroups = new Map<string, JobGroup>();

    for (const item of this.rangeFilteredItems()) {
      if (item.jobId && (item.action === 'importExtract' || item.action === 'importExplain')) {
        let group = jobGroups.get(item.jobId);
        if (!group) {
          group = {
            jobId: item.jobId,
            packName: item.packName,
            packVersion: item.packVersion,
            items: [],
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            totalCostUsd: null,
          };
          jobGroups.set(item.jobId, group);
          rows.push({ kind: 'jobGroup', group });
        }
        group.items.push(item);
        group.inputTokens += item.inputTokens;
        group.outputTokens += item.outputTokens;
        group.totalTokens += item.totalTokens;
        if (item.costUsd !== null) group.totalCostUsd = (group.totalCostUsd ?? 0) + item.costUsd;
      } else {
        rows.push({ kind: 'event', event: item });
      }
    }
    return rows;
  });

  constructor() {
    void this.load();
    void this.loadBudget();
  }

  private async loadBudget(): Promise<void> {
    try {
      const status = await this.usageService.fetchBudget();
      this.budgetStatus.set(status);
      this.budgetEnabled.set(status.enabled);
      this.budgetLimitInput = status.monthlyLimitUsd ?? DEFAULT_BUDGET_LIMIT_USD;
    } catch {
      // Best-effort — the rest of the Costs page still works without it.
    }
  }

  protected async saveBudget(): Promise<void> {
    this.budgetSaving.set(true);
    this.budgetSaved.set(false);
    try {
      const status = await this.usageService.updateBudget(this.budgetEnabled(), this.budgetLimitInput);
      this.budgetStatus.set(status);
      this.budgetSaved.set(true);
    } catch {
      // Leave the form as-is — the user can retry.
    } finally {
      this.budgetSaving.set(false);
    }
  }

  protected formatUsd(value: number | null): string {
    return value === null ? '—' : `$${value.toFixed(2)}`;
  }

  /** "Name — Version" (version omitted when absent) — both fields are
   * snapshotted per-row at write time (see usage.service.ts), so this
   * never needs a live lookup against the current pack list. */
  protected formatPackLabel(name: string | undefined, version: string | undefined): string | null {
    if (!name) return null;
    return version ? `${name} — ${version}` : name;
  }

  private groupKeyAndLabel(item: UsageEvent, mode: GroupBy): { key: string; label: string } | null {
    switch (mode) {
      case 'action':
        return { key: item.action, label: this.actionLabel(item.action) };
      case 'model':
        return { key: item.modelId, label: item.modelId };
      case 'packName': {
        const name = item.packName ?? item.packId;
        return name ? { key: name, label: name } : null;
      }
      case 'packVersion': {
        const packKey = item.packId ?? item.packName;
        if (!packKey) return null;
        return { key: packKey, label: this.formatPackLabel(item.packName ?? item.packId, item.packVersion) ?? packKey };
      }
      case 'packModel': {
        const packKey = item.packId ?? item.packName;
        if (!packKey) return null;
        const packLabel = this.formatPackLabel(item.packName ?? item.packId, item.packVersion) ?? packKey;
        return { key: `${packKey}::${item.modelId}`, label: `${packLabel} — ${item.modelId}` };
      }
    }
  }

  protected actionLabel(action: string): string {
    const key = KNOWN_ACTIONS.includes(action) ? action : 'unknown';
    return this.i18n.t('costsPage.action.' + key);
  }

  protected formatCost(costUsd: number | null): string {
    if (costUsd === null) return this.i18n.t('costsPage.unpriced');
    return `$${costUsd < 0.01 && costUsd > 0 ? costUsd.toFixed(6) : costUsd.toFixed(2)}`;
  }

  protected formatTokens(tokens: number): string {
    return `${tokens.toLocaleString()} tok`;
  }

  protected formatDate(ms: number): string {
    return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** [since, until] in epoch ms for the current preset, or [undefined,
   * undefined] for "all time". `until` for a day-based preset is left
   * unset (now) rather than computed, so a call made mid-session still
   * shows up. */
  private resolveRange(): { since?: number; until?: number } {
    const preset = this.rangePreset();
    const now = Date.now();
    switch (preset) {
      case 'month': {
        const start = new Date();
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return { since: start.getTime() };
      }
      case '7d':
        return { since: now - 7 * DAY_MS };
      case '30d':
        return { since: now - 30 * DAY_MS };
      case 'custom': {
        const start = this.customStart();
        const end = this.customEnd();
        const since = start ? new Date(`${start}T00:00:00`).getTime() : undefined;
        const until = end ? new Date(`${end}T23:59:59.999`).getTime() : undefined;
        return { since, until };
      }
      default:
        return {};
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const summary: UsageSummary = await this.usageService.fetchUsage();
      this.rawItems.set(summary.items);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
