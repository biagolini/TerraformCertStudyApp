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
      </div>

      <div class="card actions-card">
        <button
          type="button"
          class="action-btn"
          (click)="downloadSelected()"
          [disabled]="selectedCount() === 0"
        >
          <span class="action-label">Download selected</span>
          <span class="action-sub">Respects max-per-file, balanced batches</span>
        </button>

        <button
          type="button"
          class="action-btn"
          (click)="downloadAll()"
          [disabled]="totalCount() === 0"
        >
          <span class="action-label">Download all</span>
          <span class="action-sub">Every reviewed question in a single file</span>
        </button>
      </div>

      @if (selectedBreakdown().length > 0) {
        <div class="card">
          <h3>By domain</h3>
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
    `,
  ],
})
export class ExportComponent {
  private readonly exportService = inject(ExportService);
  private readonly questionsService = inject(QuestionsService);
  private readonly packs = inject(PacksService);

  protected maxPerFile = 10;

  readonly selectedCount = this.questionsService.selectedCount;
  readonly totalCount = this.questionsService.count;
  readonly breakdown = this.questionsService.domainBreakdown;

  readonly selectedBreakdown = computed(() => this.breakdown());

  readonly helperLine = computed(() => {
    const total = this.selectedCount();
    const max = this.maxPerFile;
    if (total === 0 || max <= 0) return 'Select questions to enable export.';
    const files = Math.max(1, Math.ceil(total / max));
    const avg = Math.round(total / files);
    return `${total} questions → ${files} file${files === 1 ? '' : 's'} of ~${avg} each`;
  });

  downloadSelected(): void {
    const questions = this.questionsService.selectedQuestions();
    if (questions.length === 0) return;
    this.emitBatches(questions, this.maxPerFile);
  }

  downloadAll(): void {
    const questions = this.questionsService.questions();
    if (questions.length === 0) return;
    const pack = this.packs.activePack();
    const content = this.exportService.buildMarkdownContent(questions, 1, 1, pack);
    const filename = this.exportService.buildFilename(pack.name, 'all', pack.version);
    this.exportService.downloadFile(content, filename);
  }

  downloadDomain(domain: string): void {
    const questions = this.questionsService.selectedQuestions().filter((q) => q.domain === domain);
    if (questions.length === 0) return;
    const pack = this.packs.activePack();
    const content = this.exportService.buildMarkdownContent(questions, 1, 1, pack);
    const packDomain = pack.domains.find((d) => d.name === domain) ?? { name: domain, description: '' };
    const filename = this.exportService.buildDomainFilename(packDomain, pack.version);
    this.exportService.downloadFile(content, filename);
  }

  private emitBatches(questions: Question[], maxPerFile: number): void {
    const batches = this.exportService.buildBatches(questions, Math.max(1, maxPerFile));
    const pack = this.packs.activePack();
    const total = batches.length;
    batches.forEach((batch, index) => {
      const part = index + 1;
      const content = this.exportService.buildMarkdownContent(batch, part, total, pack);
      const suffix = total > 1 ? `part-${part}-of-${total}` : 'selected';
      const filename = this.exportService.buildFilename(pack.name, suffix, pack.version);
      this.exportService.downloadFile(content, filename);
    });
  }
}
