import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ExportService } from '../../core/services/export.service';
import { PacksService } from '../../core/services/packs.service';
import { QuestionsService } from '../../core/services/questions.service';
import { Question } from '../../core/models/question.model';
import { slugify } from '../../core/utils/file-splitter.util';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';

@Component({
  selector: 'app-export',
  standalone: true,
  imports: [FormsModule, AiDisclaimerComponent, DomainBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="export">
      <header class="card-header">
        <h2>Export</h2>
        <p class="subtitle">Download selected questions as Markdown files ready for NotebookLM.</p>
        <app-ai-disclaimer
          message="Exported files contain AI-generated reviews. Verify content before sharing or using them as study material for others."
        />
      </header>

      <div class="card">
        <h3>Selection</h3>
        <p class="selection-line">
          <strong>{{ selectedCount() }}</strong> question{{ selectedCount() === 1 ? '' : 's' }} selected
          @if (totalCount() > 0) {
            <span class="of"> of {{ totalCount() }}</span>
          }
        </p>
        @if (breakdown().length > 0) {
          <ul class="pills">
            @for (entry of breakdown(); track entry.domain) {
              <li class="pill">
                <app-domain-badge [domain]="entry.domain" />
                <span class="pill-total">{{ entry.total }}</span>
              </li>
            }
          </ul>
        }
      </div>

      <div class="card">
        <h3>Batch settings</h3>
        <label class="split-toggle">
          <input
            type="checkbox"
            [(ngModel)]="splitEnabled"
          />
          <span>Split into multiple files</span>
        </label>
        @if (splitEnabled) {
          <label class="field">
            <span class="label">Max questions per file</span>
            <input
              type="number"
              min="1"
              max="500"
              [(ngModel)]="maxPerFile"
              class="number-input"
              aria-label="Max questions per file"
            />
          </label>
          <p class="helper">{{ helperLine() }}</p>
        }
      </div>

      <div class="card actions-card">
        <button
          type="button"
          class="action-btn"
          (click)="downloadSelected()"
          [disabled]="selectedCount() === 0"
        >
          <span class="action-label">Download selected</span>
          <span class="action-sub">{{ splitEnabled ? 'Split into balanced batches of ~' + maxPerFile : 'Single file with all selected questions' }}</span>
        </button>

        <button
          type="button"
          class="action-btn"
          (click)="downloadAll()"
          [disabled]="totalCount() === 0"
        >
          <span class="action-label">Download all</span>
          <span class="action-sub">{{ splitEnabled ? 'Split into balanced batches of ~' + maxPerFile : 'Every reviewed question in a single file' }}</span>
        </button>
      </div>

      @if (selectedBreakdown().length > 0) {
        <div class="card">
          <h3>By domain (selected)</h3>
          <ul class="domain-grid">
            @for (entry of selectedBreakdown(); track entry.domain) {
              <li>
                <button
                  type="button"
                  class="domain-download"
                  (click)="downloadDomain(entry.domain)"
                >
                  <span class="domain-name">{{ entry.domain }}</span>
                  <span class="domain-total">{{ entry.total }} selected</span>
                </button>
              </li>
            }
          </ul>
        </div>
      }

      @if (allDomains().length > 0) {
        <div class="card">
          <h3>By domain (all questions)</h3>
          <p class="helper">Select one or more domains to download all questions from those domains, regardless of selection above.</p>
          <ul class="domain-check-grid">
            @for (entry of allDomains(); track entry.domain) {
              <li class="domain-check-item">
                <label class="domain-check-label">
                  <input
                    type="checkbox"
                    [checked]="isDomainChecked(entry.domain)"
                    (change)="toggleDomainCheck(entry.domain)"
                  />
                  <span class="domain-check-name">{{ entry.domain }}</span>
                  <span class="domain-check-total">{{ entry.total }}</span>
                </label>
              </li>
            }
          </ul>
          <div class="domain-check-actions">
            <button
              type="button"
              class="action-btn"
              (click)="downloadCheckedDomains()"
              [disabled]="checkedDomains().size === 0"
            >
              <span class="action-label">Download checked domains</span>
              <span class="action-sub">{{ checkedDomainsHelper() }}</span>
            </button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .export {
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
      .selection-line {
        color: var(--text-secondary);
        font-size: var(--font-size-base);
      }
      .selection-line strong {
        font-size: var(--font-size-xl);
        color: var(--text-primary);
      }
      .of {
        color: var(--text-faint);
      }
      .pills {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-xs);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
      }
      .pill-total {
        background: var(--bg-elevated);
        color: var(--text-secondary);
        padding: 0 var(--space-sm);
        height: 22px;
        line-height: 22px;
        border-radius: var(--radius-pill);
        font-size: var(--font-size-sm);
        font-weight: 600;
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
      .number-input {
        height: var(--touch-min);
        width: 120px;
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-base);
      }
      .split-toggle {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        cursor: pointer;
        font-size: var(--font-size-base);
        color: var(--text-primary);
      }
      .split-toggle input {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
      .helper {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .actions-card {
        gap: var(--space-md);
      }
      .action-btn {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
        color: var(--text-primary);
        text-align: left;
        transition: border-color var(--transition-fast), background var(--transition-fast);
      }
      .action-btn:hover:not(:disabled) {
        border-color: var(--color-purple);
        background: var(--bg-subtle);
      }
      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .action-label {
        font-weight: 600;
        font-size: var(--font-size-base);
      }
      .action-sub {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .domain-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--space-sm);
      }
      .domain-download {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
        color: var(--text-primary);
        text-align: left;
        min-height: var(--touch-min);
      }
      .domain-download:hover {
        border-color: var(--color-purple);
        background: var(--bg-subtle);
      }
      .domain-name {
        font-weight: 600;
        font-size: var(--font-size-base);
      }
      .domain-total {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .domain-check-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--space-xs);
      }
      .domain-check-label {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-elevated);
        cursor: pointer;
        transition: border-color var(--transition-fast);
      }
      .domain-check-label:hover {
        border-color: var(--color-purple);
      }
      .domain-check-name {
        flex: 1;
        font-size: var(--font-size-sm);
        font-weight: 500;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .domain-check-total {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        font-weight: 600;
      }
      .domain-check-actions {
        margin-top: var(--space-xs);
      }
    `,
  ],
})
export class ExportComponent {
  private readonly exportService = inject(ExportService);
  private readonly questionsService = inject(QuestionsService);
  private readonly packs = inject(PacksService);

  protected splitEnabled = false;
  protected maxPerFile = 10;

  readonly selectedCount = this.questionsService.selectedCount;
  readonly totalCount = this.questionsService.count;
  readonly breakdown = this.questionsService.domainBreakdown;

  readonly selectedBreakdown = computed(() => this.breakdown());

  /** All domains from ALL questions in the active pack (not just selected). */
  readonly allDomains = computed(() => {
    const counts = new Map<string, number>();
    for (const q of this.questionsService.questions()) {
      counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
    }
    return [...counts.entries()].map(([domain, total]) => ({ domain, total }));
  });

  readonly checkedDomains = signal<ReadonlySet<string>>(new Set());

  isDomainChecked(domain: string): boolean {
    return this.checkedDomains().has(domain);
  }

  toggleDomainCheck(domain: string): void {
    const next = new Set(this.checkedDomains());
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    this.checkedDomains.set(next);
  }

  checkedDomainsHelper(): string {
    const domains = this.checkedDomains();
    if (domains.size === 0) return 'Check at least one domain';
    const questions = this.questionsService.questions().filter((q) => domains.has(q.domain));
    return `${questions.length} question${questions.length === 1 ? '' : 's'} across ${domains.size} domain${domains.size === 1 ? '' : 's'}`;
  }

  downloadCheckedDomains(): void {
    const domains = this.checkedDomains();
    if (domains.size === 0) return;
    const questions = this.questionsService.questions().filter((q) => domains.has(q.domain));
    if (questions.length === 0) return;
    if (this.splitEnabled && this.maxPerFile > 0) {
      this.emitBatches(questions, this.maxPerFile);
    } else {
      const pack = this.packs.activePack();
      const content = this.exportService.buildMarkdownContent(questions, 1, 1, pack);
      const suffix = domains.size === 1 ? slugify([...domains][0]) : `${domains.size}-domains`;
      const filename = this.exportService.buildFilename(pack.name, suffix, pack.version);
      this.exportService.downloadFile(content, filename);
    }
  }

  helperLine(): string {
    const total = this.selectedCount();
    const max = this.maxPerFile;
    if (total === 0 || max <= 0) return 'Select questions to enable export.';
    const files = Math.max(1, Math.ceil(total / max));
    const avg = Math.round(total / files);
    return `${total} questions → ${files} file${files === 1 ? '' : 's'} of ~${avg} each`;
  }

  downloadSelected(): void {
    const questions = this.questionsService.selectedQuestions();
    if (questions.length === 0) return;
    if (this.splitEnabled && this.maxPerFile > 0) {
      this.emitBatches(questions, this.maxPerFile);
    } else {
      const pack = this.packs.activePack();
      const content = this.exportService.buildMarkdownContent(questions, 1, 1, pack);
      const filename = this.exportService.buildFilename(pack.name, 'selected', pack.version);
      this.exportService.downloadFile(content, filename);
    }
  }

  downloadAll(): void {
    const questions = this.questionsService.questions();
    if (questions.length === 0) return;
    if (this.splitEnabled && this.maxPerFile > 0) {
      this.emitBatches(questions, this.maxPerFile);
    } else {
      const pack = this.packs.activePack();
      const content = this.exportService.buildMarkdownContent(questions, 1, 1, pack);
      const filename = this.exportService.buildFilename(pack.name, 'all', pack.version);
      this.exportService.downloadFile(content, filename);
    }
  }

  downloadDomain(domain: string): void {
    const questions = this.questionsService.selectedQuestions().filter((q) => q.domain === domain);
    if (questions.length === 0) return;
    if (this.splitEnabled && this.maxPerFile > 0) {
      this.emitBatches(questions, this.maxPerFile);
    } else {
      const pack = this.packs.activePack();
      const content = this.exportService.buildMarkdownContent(questions, 1, 1, pack);
      const packDomain = pack.domains.find((d) => d.name === domain) ?? { name: domain, description: '' };
      const filename = this.exportService.buildDomainFilename(packDomain, pack.version);
      this.exportService.downloadFile(content, filename);
    }
  }

  private emitBatches(questions: Question[], maxPerFile: number): void {
    const batches = this.exportService.buildBatches(questions, Math.max(1, maxPerFile));
    const pack = this.packs.activePack();
    const total = batches.length;

    if (total <= 1) {
      // Single file — download directly, no ZIP needed.
      const content = this.exportService.buildMarkdownContent(batches[0], 1, 1, pack);
      const filename = this.exportService.buildFilename(pack.name, 'selected', pack.version);
      this.exportService.downloadFile(content, filename);
      return;
    }

    // Multiple files — bundle into a ZIP.
    const files = batches.map((batch, index) => {
      const part = index + 1;
      const content = this.exportService.buildMarkdownContent(batch, part, total, pack);
      const suffix = `part-${part}-of-${total}`;
      const filename = this.exportService.buildFilename(pack.name, suffix, pack.version);
      return { content, filename };
    });
    const zipName = this.exportService.buildFilename(pack.name, `${total}-parts`, pack.version).replace(/\.md$/, '.zip');
    void this.exportService.downloadZip(files, zipName);
  }
}
