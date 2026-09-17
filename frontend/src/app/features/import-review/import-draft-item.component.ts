import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImportDraftQuestion } from '../../core/models/import-draft.model';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { TruncatePipe } from '../../shared/pipes/truncate.pipe';

/** One row in the review screen's list — a sibling to
 * question-list/question-item.component.ts, not a reuse of it: the data
 * shape here is smaller and has no starred/comment fields, and this row
 * needs FAILED-state rendering and a re-extract action that
 * question-item.component.ts has no reason to carry. Copies that
 * component's proven visual patterns (checkbox markup, icon-button with
 * stopPropagation, domain-badge, truncate pipe) rather than reinventing
 * them. */
@Component({
  selector: 'app-import-draft-item',
  standalone: true,
  imports: [DomainBadgeComponent, TruncatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" [class.failed]="isFailed()">
      <label class="check" [attr.aria-label]="checkboxLabel()">
        <input
          type="checkbox"
          [checked]="selected()"
          [disabled]="isFailed()"
          (change)="selectionToggled.emit()"
        />
        <span class="check-box" aria-hidden="true"></span>
      </label>

      <div class="content">
        <div class="title-row">
          @if (isFailed()) {
            <span class="title failed-title">Extraction failed — question {{ draft().index + 1 }}</span>
          } @else {
            <span class="title">{{ draft().title | truncate: 120 }}</span>
          }
          <button
            type="button"
            class="reextract-btn"
            [class.active]="hintOpen()"
            [disabled]="busy()"
            (click)="$event.stopPropagation(); toggleHint()"
            [attr.aria-label]="'Re-extract question ' + (draft().index + 1)"
            [attr.aria-pressed]="hintOpen()"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 12a9 9 0 1 1 3 6.7M3 12v5h5"
              />
            </svg>
          </button>
        </div>

        @if (isFailed()) {
          <p class="error-line">{{ draft().error }}</p>
          @if (draft().preview) {
            <p class="preview-line">{{ draft().preview }}</p>
          }
        } @else {
          <p class="stem-preview">{{ draft().stem | truncate: 200 }}</p>
          <div class="domain-row">
            @if (draft().domain) {
              <app-domain-badge [domain]="draft().domain!" />
            }
            <span class="alt-count">{{ draft().alternatives.length }} alternatives</span>
            @if (draft().reExtractCount > 0) {
              <span class="reextract-count">re-extracted {{ draft().reExtractCount }}×</span>
            }
          </div>
        }

        @if (hintOpen()) {
          <div class="hint-form" (click)="$event.stopPropagation()">
            <input
              type="text"
              class="hint-input"
              placeholder="What's wrong? (optional) e.g. 'the correct answer is C, not B'"
              [(ngModel)]="hintText"
              [disabled]="busy()"
            />
            <button type="button" class="hint-submit" [disabled]="busy()" (click)="submitReExtract()">
              {{ busy() ? 'Re-extracting…' : 'Re-extract' }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .row {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: start;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-surface);
        border-radius: var(--radius-md);
        border: 1px solid transparent;
      }
      .row.failed {
        border-color: var(--color-red);
        background: var(--bg-elevated);
      }
      .content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        padding: var(--space-xs) 0;
      }
      .check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        cursor: pointer;
        position: relative;
      }
      .check input {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        cursor: pointer;
      }
      .check input:disabled {
        cursor: not-allowed;
      }
      .check-box {
        width: 20px;
        height: 20px;
        border-radius: var(--radius-sm);
        border: 1.5px solid var(--bg-border);
        background: var(--bg-input);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background var(--transition-fast), border-color var(--transition-fast);
      }
      .check input:checked + .check-box {
        background: var(--color-purple);
        border-color: var(--color-purple);
      }
      .check input:checked + .check-box::after {
        content: '';
        width: 10px;
        height: 6px;
        border-left: 2px solid #ffffff;
        border-bottom: 2px solid #ffffff;
        transform: rotate(-45deg) translate(0, -2px);
      }
      .check input:disabled + .check-box {
        opacity: 0.5;
      }
      .title-row {
        display: flex;
        align-items: flex-start;
        gap: var(--space-xs);
      }
      .title {
        flex: 1;
        min-width: 0;
        font-size: var(--font-size-base);
        font-weight: 500;
        line-height: 1.35;
        word-break: break-word;
      }
      .failed-title {
        color: var(--color-red);
      }
      .reextract-btn {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        background: none;
        color: var(--text-faint);
      }
      .reextract-btn:hover {
        color: var(--color-blue);
      }
      .reextract-btn.active {
        color: var(--color-blue);
      }
      .stem-preview {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.4;
        word-break: break-word;
      }
      .error-line {
        font-size: var(--font-size-sm);
        color: var(--color-red);
      }
      .preview-line {
        font-size: var(--font-size-xs);
        color: var(--text-faint);
        font-style: italic;
      }
      .domain-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-wrap: wrap;
      }
      .alt-count,
      .reextract-count {
        font-size: var(--font-size-xs);
        color: var(--text-faint);
      }
      .hint-form {
        display: flex;
        gap: var(--space-xs);
        margin-top: var(--space-xs);
      }
      .hint-input {
        flex: 1;
        min-width: 0;
        height: 32px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
      }
      .hint-submit {
        flex-shrink: 0;
        height: 32px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        background: var(--color-purple);
        color: #ffffff;
        font-size: var(--font-size-sm);
        white-space: nowrap;
      }
      .hint-submit:disabled,
      .hint-input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
})
export class ImportDraftItemComponent {
  readonly draft = input.required<ImportDraftQuestion>();
  readonly selected = input.required<boolean>();
  readonly busy = input<boolean>(false);

  readonly selectionToggled = output<void>();
  readonly reExtractRequested = output<string | undefined>();

  protected readonly hintOpen = signal(false);
  protected hintText = '';

  readonly isFailed = computed(() => this.draft().extractStatus === 'FAILED');

  readonly checkboxLabel = computed(() =>
    this.selected() ? `Deselect question ${this.draft().index + 1}` : `Select question ${this.draft().index + 1}`,
  );

  toggleHint(): void {
    this.hintOpen.update((open) => !open);
  }

  submitReExtract(): void {
    const hint = this.hintText.trim();
    this.reExtractRequested.emit(hint || undefined);
    this.hintOpen.set(false);
    this.hintText = '';
  }
}
