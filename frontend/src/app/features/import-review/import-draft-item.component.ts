import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ImportDraftAlternative,
  ImportDraftImage,
  ImportDraftQuestion,
} from '../../core/models/import-draft.model';
import { ImageAssetService } from '../../core/services/image-asset.service';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { TruncatePipe } from '../../shared/pipes/truncate.pipe';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';

/** Encodes an ImportDraftImage's target+alternativeLetter as one <select>
 * value and back — 'stem' | 'generalComment' | 'unplaced' pass through as-is,
 * an alternative-scoped target becomes `alternativeText:A` / `alternativeComment:A`. */
function encodeImageTarget(img: Pick<ImportDraftImage, 'target' | 'alternativeLetter'>): string {
  if (img.target === 'alternativeText' || img.target === 'alternativeComment') {
    return `${img.target}:${img.alternativeLetter ?? ''}`;
  }
  return img.target;
}

function decodeImageTarget(value: string): Pick<ImportDraftImage, 'target' | 'alternativeLetter'> {
  const [target, letter] = value.split(':');
  if (target === 'alternativeText' || target === 'alternativeComment') {
    return { target, alternativeLetter: letter || null };
  }
  return { target: target as ImportDraftImage['target'], alternativeLetter: null };
}

function nextAlternativeLetter(existing: readonly { letter: string }[]): string {
  const used = new Set(existing.map((a) => a.letter.toUpperCase()));
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    if (!used.has(letter)) return letter;
  }
  return `X${existing.length}`; // 26 alternatives is already absurd — just don't collide
}

/** One row in the review screen's list — a sibling to
 * question-list/question-item.component.ts, not a reuse of it: the data
 * shape here is smaller (no starred/comment fields) and this row needs
 * FAILED-state rendering and a re-extract action that
 * question-item.component.ts has no reason to carry. Shows the FULL stem
 * and FULL alternative text (via the same MarkdownRendererComponent
 * review-viewer.component.ts uses, so `![alt](key)` images resolve
 * identically) rather than a truncated preview — the entire point of this
 * screen is verifying the extraction actually got it right, which isn't
 * possible from a 200-character snippet and an alternative count. The
 * correct-alternative highlight mirrors review-viewer's `.option-card`
 * pattern, minus the comment block (drafts have none yet). */
@Component({
  selector: 'app-import-draft-item',
  standalone: true,
  imports: [DomainBadgeComponent, TruncatePipe, FormsModule, MarkdownRendererComponent],
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
          @if (isFailed() && !editing()) {
            <span class="title failed-title">Extraction failed — question {{ draft().index + 1 }}</span>
          } @else if (!editing()) {
            <span class="title">{{ draft().title | truncate: 120 }}</span>
          } @else {
            <input type="text" class="title-input" [(ngModel)]="editTitle" placeholder="Title" />
          }
          @if (!editing()) {
            <button
              type="button"
              class="reextract-btn"
              (click)="$event.stopPropagation(); startEdit()"
              [attr.aria-label]="'Edit question ' + (draft().index + 1)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M13.5 6.5l4 4" />
              </svg>
            </button>
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
          }
        </div>

        @if (editing()) {
          <div class="edit-form" (click)="$event.stopPropagation()">
            <label class="edit-label">
              <span>Domain</span>
              <input type="text" class="edit-domain-input" [(ngModel)]="editDomain" placeholder="Domain" />
            </label>
            <label class="edit-label">
              <span>Question stem</span>
              <textarea class="edit-textarea" rows="5" [(ngModel)]="editStem"></textarea>
            </label>
            @for (alt of editAlternatives(); track alt.letter) {
              <div class="edit-alt-block">
                <div class="edit-alt-row">
                  <label class="edit-correct-check">
                    <input type="checkbox" [checked]="alt.isCorrect" (change)="toggleEditCorrect(alt.letter)" />
                    <span>{{ alt.letter }}</span>
                  </label>
                  <textarea
                    class="edit-textarea"
                    rows="2"
                    [ngModel]="alt.text"
                    (ngModelChange)="setEditAltText(alt.letter, $event)"
                  ></textarea>
                  <button
                    type="button"
                    class="remove-alt-btn"
                    [disabled]="editAlternatives().length <= 2"
                    [attr.aria-label]="'Remove alternative ' + alt.letter"
                    (click)="removeAlternative(alt.letter)"
                  >×</button>
                </div>
                <textarea
                  class="edit-textarea edit-comment-textarea"
                  rows="2"
                  placeholder="Source explanation for this option (optional)"
                  [ngModel]="alt.sourceComment ?? ''"
                  (ngModelChange)="setEditAltComment(alt.letter, $event)"
                ></textarea>
              </div>
            }
            <button type="button" class="add-alt-btn" (click)="addAlternative()">+ Add alternative</button>

            <label class="edit-label">
              <span>Overall source explanation (optional)</span>
              <textarea class="edit-textarea" rows="3" [(ngModel)]="editSourceGeneralComment"></textarea>
            </label>

            <div class="edit-images">
              <span class="edit-label-text">Images</span>
              @for (img of editImages(); track img.key) {
                <div class="edit-image-row">
                  <div class="edit-image-thumb"><app-markdown-renderer [source]="'![image](' + img.key + ')'" /></div>
                  <select
                    class="edit-domain-input"
                    [ngModel]="encodeTarget(img)"
                    (ngModelChange)="setImageTarget(img.key, $event)"
                  >
                    <option value="stem">Question stem</option>
                    @for (alt of editAlternatives(); track alt.letter) {
                      <option [value]="'alternativeText:' + alt.letter">Alternative {{ alt.letter }} text</option>
                      <option [value]="'alternativeComment:' + alt.letter">Alternative {{ alt.letter }} explanation</option>
                    }
                    <option value="generalComment">Overall explanation</option>
                    <option value="unplaced">Not placed</option>
                  </select>
                  <button
                    type="button"
                    class="remove-alt-btn"
                    [attr.aria-label]="'Remove image'"
                    (click)="removeImage(img.key)"
                  >×</button>
                </div>
              }
              <label class="add-image-btn">
                {{ uploadingImage() ? 'Uploading…' : '+ Add image' }}
                <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" hidden [disabled]="uploadingImage()" (change)="onAddImage($event)" />
              </label>
              @if (imageUploadError()) {
                <p class="error-line">{{ imageUploadError() }}</p>
              }
            </div>

            <div class="edit-actions">
              <button type="button" class="hint-submit" [disabled]="busy()" (click)="saveEdit()">
                {{ busy() ? 'Saving…' : 'Save' }}
              </button>
              <button type="button" class="btn-cancel" [disabled]="busy()" (click)="cancelEdit()">Cancel</button>
            </div>
          </div>
        } @else if (isFailed()) {
          <p class="error-line">{{ draft().error }}</p>
          @if (draft().preview) {
            <p class="preview-line">{{ draft().preview }}</p>
          }
        } @else {
          <div class="stem">
            <app-markdown-renderer [source]="draft().stem ?? ''" />
            @for (img of imagesFor('stem'); track img.key) {
              <app-markdown-renderer [source]="'![diagram](' + img.key + ')'" />
            }
          </div>

          <div class="alternatives">
            @for (alt of draft().alternatives; track alt.letter) {
              <div class="option-card" [class.correct]="alt.isCorrect">
                <span class="option-letter">{{ alt.letter }}</span>
                <div class="option-body">
                  <div class="option-text">
                    <app-markdown-renderer [source]="alt.text" />
                    @for (img of imagesFor('alternativeText', alt.letter); track img.key) {
                      <app-markdown-renderer [source]="'![diagram](' + img.key + ')'" />
                    }
                  </div>
                  @if (alt.sourceComment || imagesFor('alternativeComment', alt.letter).length > 0) {
                    <div class="source-comment">
                      <p class="source-label">Source explanation (unverified):</p>
                      @if (alt.sourceComment) {
                        <app-markdown-renderer [source]="alt.sourceComment" />
                      }
                      @for (img of imagesFor('alternativeComment', alt.letter); track img.key) {
                        <app-markdown-renderer [source]="'![diagram](' + img.key + ')'" />
                      }
                    </div>
                  }
                </div>
                @if (alt.isCorrect) {
                  <span class="option-status" aria-label="Correct">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                      <path fill="none" stroke="var(--color-green)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7" />
                    </svg>
                  </span>
                }
              </div>
            }
          </div>

          @if (draft().sourceGeneralComment || imagesFor('generalComment').length > 0) {
            <div class="source-comment">
              <p class="source-label">Overall source explanation (unverified):</p>
              @if (draft().sourceGeneralComment) {
                <app-markdown-renderer [source]="draft().sourceGeneralComment!" />
              }
              @for (img of imagesFor('generalComment'); track img.key) {
                <app-markdown-renderer [source]="'![diagram](' + img.key + ')'" />
              }
            </div>
          }

          @if (imagesFor('unplaced').length > 0) {
            <div class="reference-images">
              <p class="reference-label">Other image(s) from this question (not placed — edit to assign one):</p>
              <div class="reference-grid">
                @for (img of imagesFor('unplaced'); track img.key) {
                  <app-markdown-renderer [source]="'![reference image](' + img.key + ')'" />
                }
              </div>
            </div>
          }

          <div class="domain-row">
            @if (draft().domain) {
              <app-domain-badge [domain]="draft().domain!" />
            }
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
        padding: var(--space-md);
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
        gap: var(--space-sm);
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
        font-weight: 600;
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
      .stem {
        font-size: var(--font-size-base);
        color: var(--text-primary);
        line-height: 1.5;
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
      .alternatives {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .option-card {
        display: flex;
        gap: var(--space-sm);
        align-items: flex-start;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1.5px solid var(--bg-border);
        background: var(--bg-input);
      }
      .option-card.correct {
        border-color: var(--color-green);
        background: rgba(0, 184, 148, 0.08);
      }
      .option-letter {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: var(--font-size-sm);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        flex-shrink: 0;
      }
      .option-card.correct .option-letter {
        background: var(--color-green);
        color: #ffffff;
      }
      .option-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .option-text {
        font-size: var(--font-size-sm);
      }
      .option-status {
        flex-shrink: 0;
        display: inline-flex;
      }
      .source-comment {
        padding: var(--space-sm);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px dashed var(--bg-border);
        font-size: var(--font-size-sm);
      }
      .source-label {
        margin: 0 0 4px;
        font-size: var(--font-size-xs);
        color: var(--text-faint);
        font-style: italic;
      }
      .reference-images {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .reference-label {
        font-size: var(--font-size-xs);
        color: var(--text-faint);
        font-style: italic;
        margin: 0;
      }
      .reference-grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-sm);
      }
      .domain-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-wrap: wrap;
      }
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
      .title-input {
        flex: 1;
        min-width: 0;
        height: 32px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-base);
        font-weight: 600;
      }
      .edit-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .edit-label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }
      .edit-domain-input {
        height: 32px;
        max-width: 260px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
      }
      .edit-textarea {
        width: 100%;
        padding: var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        font-family: var(--font-family);
        resize: vertical;
      }
      .edit-alt-row {
        display: flex;
        gap: var(--space-sm);
        align-items: flex-start;
      }
      .edit-correct-check {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        font-size: var(--font-size-xs);
        color: var(--text-muted);
        padding-top: var(--space-xs);
      }
      .edit-correct-check input {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
      .edit-alt-row .edit-textarea {
        flex: 1;
      }
      .edit-alt-block {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        padding-bottom: var(--space-xs);
        border-bottom: 1px dashed var(--bg-border);
      }
      .edit-comment-textarea {
        margin-left: calc(18px + var(--space-sm));
        font-size: var(--font-size-xs);
      }
      .remove-alt-btn {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        font-size: var(--font-size-base);
        line-height: 1;
      }
      .remove-alt-btn:hover:not(:disabled) {
        border-color: var(--color-red);
        color: var(--color-red);
      }
      .remove-alt-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .add-alt-btn {
        align-self: flex-start;
        height: 32px;
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .add-alt-btn:hover {
        border-color: var(--color-purple);
        color: var(--text-primary);
      }
      .edit-label-text {
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }
      .edit-images {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .edit-image-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .edit-image-thumb {
        width: 64px;
        flex-shrink: 0;
        overflow: hidden;
        border-radius: var(--radius-sm);
      }
      .edit-image-row select {
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
      .add-image-btn {
        align-self: flex-start;
        height: 32px;
        padding: 0 var(--space-md);
        display: inline-flex;
        align-items: center;
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
      }
      .add-image-btn:hover {
        border-color: var(--color-purple);
        color: var(--text-primary);
      }
      .edit-actions {
        display: flex;
        gap: var(--space-sm);
        margin-top: var(--space-xs);
      }
      .btn-cancel {
        flex-shrink: 0;
        height: 32px;
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .btn-cancel:hover {
        border-color: var(--color-purple);
        color: var(--text-primary);
      }
    `,
  ],
})
export class ImportDraftItemComponent {
  private readonly imageAssets = inject(ImageAssetService);

  readonly draft = input.required<ImportDraftQuestion>();
  readonly selected = input.required<boolean>();
  readonly busy = input<boolean>(false);

  readonly selectionToggled = output<void>();
  readonly reExtractRequested = output<string | undefined>();
  readonly editSaved = output<
    Pick<ImportDraftQuestion, 'title' | 'domain' | 'stem' | 'alternatives' | 'sourceGeneralComment' | 'images'>
  >();

  protected readonly hintOpen = signal(false);
  protected hintText = '';

  protected readonly editing = signal(false);
  protected editTitle = '';
  protected editDomain = '';
  protected editStem = '';
  protected editSourceGeneralComment = '';
  protected readonly editAlternatives = signal<ImportDraftAlternative[]>([]);
  protected readonly editImages = signal<ImportDraftImage[]>([]);
  protected readonly uploadingImage = signal(false);
  protected readonly imageUploadError = signal<string | null>(null);

  readonly isFailed = computed(() => this.draft().extractStatus === 'FAILED');

  /** Images matching one view-mode slot — see ImportDraftImageTarget. */
  imagesFor(target: ImportDraftImage['target'], alternativeLetter?: string): ImportDraftImage[] {
    return (this.draft().images ?? []).filter(
      (img) => img.target === target && (alternativeLetter === undefined || img.alternativeLetter === alternativeLetter),
    );
  }

  protected readonly encodeTarget = encodeImageTarget;

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

  startEdit(): void {
    const d = this.draft();
    this.editTitle = d.title ?? '';
    this.editDomain = d.domain ?? '';
    this.editStem = d.stem ?? '';
    this.editSourceGeneralComment = d.sourceGeneralComment ?? '';
    this.editAlternatives.set(
      d.alternatives.length > 0
        ? d.alternatives.map((a) => ({ ...a }))
        : [
            { letter: 'A', text: '', isCorrect: false },
            { letter: 'B', text: '', isCorrect: false },
          ],
    );
    this.editImages.set((d.images ?? []).map((img) => ({ ...img })));
    this.imageUploadError.set(null);
    this.hintOpen.set(false);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  toggleEditCorrect(letter: string): void {
    this.editAlternatives.update((alts) => alts.map((a) => (a.letter === letter ? { ...a, isCorrect: !a.isCorrect } : a)));
  }

  setEditAltText(letter: string, text: string): void {
    this.editAlternatives.update((alts) => alts.map((a) => (a.letter === letter ? { ...a, text } : a)));
  }

  setEditAltComment(letter: string, sourceComment: string): void {
    this.editAlternatives.update((alts) =>
      alts.map((a) => (a.letter === letter ? { ...a, sourceComment: sourceComment || null } : a)),
    );
  }

  addAlternative(): void {
    const letter = nextAlternativeLetter(this.editAlternatives());
    this.editAlternatives.update((alts) => [...alts, { letter, text: '', isCorrect: false }]);
  }

  removeAlternative(letter: string): void {
    if (this.editAlternatives().length <= 2) return;
    this.editAlternatives.update((alts) => alts.filter((a) => a.letter !== letter));
    // An image anchored to the alternative that just disappeared would
    // otherwise point at a letter that no longer exists.
    this.editImages.update((imgs) =>
      imgs.map((img) => (img.alternativeLetter === letter ? { ...img, target: 'unplaced', alternativeLetter: null } : img)),
    );
  }

  setImageTarget(key: string, encoded: string): void {
    const { target, alternativeLetter } = decodeImageTarget(encoded);
    this.editImages.update((imgs) => imgs.map((img) => (img.key === key ? { ...img, target, alternativeLetter } : img)));
  }

  removeImage(key: string): void {
    this.editImages.update((imgs) => imgs.filter((img) => img.key !== key));
  }

  async onAddImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadingImage.set(true);
    this.imageUploadError.set(null);
    try {
      const result = await this.imageAssets.uploadManual(file);
      if ('error' in result) {
        this.imageUploadError.set(result.error);
        return;
      }
      this.editImages.update((imgs) => [
        ...imgs,
        { key: result.relativeKey, target: 'unplaced', alternativeLetter: null },
      ]);
    } finally {
      this.uploadingImage.set(false);
      input.value = '';
    }
  }

  saveEdit(): void {
    this.editSaved.emit({
      title: this.editTitle.trim() || null,
      domain: this.editDomain.trim() || null,
      stem: this.editStem.trim() || null,
      alternatives: this.editAlternatives(),
      sourceGeneralComment: this.editSourceGeneralComment.trim() || null,
      images: this.editImages(),
    });
    // Optimistic close — the parent's save is async and this component has
    // no callback path to know when it resolves; a failure surfaces via the
    // page's shared error banner (same pattern re-extract already uses),
    // and the user can just click edit again to retry.
    this.editing.set(false);
  }
}
