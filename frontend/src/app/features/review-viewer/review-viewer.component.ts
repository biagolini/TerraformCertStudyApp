import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DEFAULT_DOMAIN } from '../../core/models/settings.model';
import { Question, QuestionAlternative } from '../../core/models/question.model';
import { BedrockService } from '../../core/services/bedrock.service';
import { ModelsService } from '../../core/services/models.service';
import { PacksService } from '../../core/services/packs.service';
import { QuestionEnrichmentService } from '../../core/services/question-enrichment.service';
import { QuestionsService } from '../../core/services/questions.service';
import { SettingsService } from '../../core/services/settings.service';
import { StorageService } from '../../core/services/storage.service';
import { parseQuestionReview } from '../../core/utils/question-parse.util';
import { renderQuestionMarkdown } from '../../core/utils/question-markdown.util';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { MarkdownRendererComponent } from './markdown-renderer.component';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface AlternativeDraft extends QuestionAlternative {}

function toCommaList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

@Component({
  selector: 'app-review-viewer',
  standalone: true,
  imports: [FormsModule, MatProgressSpinnerModule, AiDisclaimerComponent, DomainBadgeComponent, MarkdownRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="viewer">
      @if (current(); as question) {
        <header class="viewer-header">
          @if (showBackButton()) {
            <button type="button" class="back-btn" (click)="back.emit()" aria-label="Back to question list">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>
              </svg>
              <span>Back</span>
            </button>
          }
          <div class="title-block">
            <h2>{{ question.title }}</h2>
            <app-domain-badge [domain]="question.domain" />
          </div>
          <div class="header-actions">
            <button
              type="button"
              class="icon-btn"
              (click)="onToggleEdit(question)"
              [class.active]="editing()"
              [attr.aria-label]="editing() ? 'Exit edit mode' : 'Edit question manually'"
              [attr.aria-pressed]="editing()"
              [disabled]="refining()"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"/>
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn delete-btn"
              (click)="onDelete(question)"
              aria-label="Delete this question"
              [disabled]="refining() || deleting()"
            >
              @if (deleting()) {
                <mat-spinner diameter="18"></mat-spinner>
              } @else {
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>
                </svg>
              }
            </button>
          </div>
        </header>

        <div class="viewer-body">
          @if (editing()) {
            <div class="edit-mode">
              <p class="edit-hint">Editing the structured question. Save to keep your changes; Cancel to discard.</p>

              <label class="edit-label">
                <span>Title</span>
                <input type="text" class="edit-input" [(ngModel)]="editTitleDraft" aria-label="Edit question title" />
              </label>

              <label class="edit-label">
                <span>Domain</span>
                <select class="edit-input" [(ngModel)]="editDomainDraft" aria-label="Edit question domain">
                  @for (d of domainOptions(); track d) {
                    <option [value]="d">{{ d }}</option>
                  }
                </select>
              </label>

              <label class="edit-label">
                <span>Question</span>
                <textarea class="edit-textarea" rows="4" [(ngModel)]="editStemDraft" aria-label="Edit question stem"></textarea>
              </label>

              <div class="alt-edit-list">
                <span class="field-label">Alternatives</span>
                @for (alt of editAlternatives; track $index; let i = $index) {
                  <div class="alt-edit-row">
                    <span class="alt-letter">{{ alt.letter }}</span>
                    <div class="alt-edit-fields">
                      <textarea class="edit-textarea" rows="2" [(ngModel)]="alt.text" placeholder="Alternative text"></textarea>
                      <label class="correct-toggle">
                        <input type="checkbox" [(ngModel)]="alt.isCorrect" />
                        <span>Correct</span>
                      </label>
                      <textarea class="edit-textarea" rows="2" [(ngModel)]="alt.comment" placeholder="Comment / rationale for this alternative"></textarea>
                    </div>
                    <button type="button" class="icon-btn-sm" (click)="onRemoveAlternative(i)" aria-label="Remove alternative" [disabled]="editAlternatives.length <= 2">
                      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 5l14 14M19 5L5 19"/></svg>
                    </button>
                  </div>
                }
                <button type="button" class="add-alt-btn" (click)="onAddAlternative()">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
                  <span>Add alternative</span>
                </button>
              </div>

              <label class="edit-label">
                <span>Topics (comma-separated)</span>
                <input type="text" class="edit-input" [(ngModel)]="editTopicsDraft" aria-label="Edit topics" />
              </label>
              <label class="edit-label">
                <span>Related services (comma-separated)</span>
                <input type="text" class="edit-input" [(ngModel)]="editRelatedServicesDraft" aria-label="Edit related services" />
              </label>

              @if (editError()) {
                <p class="edit-error" role="alert">{{ editError() }}</p>
              }

              <div class="edit-actions">
                <button type="button" class="btn btn-ghost" (click)="onCancelEdit()" [disabled]="saving()">Cancel</button>
                <button type="button" class="btn btn-primary" (click)="onSaveEdit(question)" [disabled]="saving()">
                  @if (saving()) { <mat-spinner diameter="18"></mat-spinner> } @else { Save }
                </button>
              </div>
            </div>
          } @else {
            <app-ai-disclaimer
              message="This question was generated by AI and may contain errors. Treat it as study support, not as an authoritative source."
            />

            <div class="stem"><app-markdown-renderer [source]="question.stem" /></div>

            @if (!showCorrectInReview()) {
              <button type="button" class="reveal-btn" (click)="onToggleReveal()">
                @if (revealed()) {
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.9 10.9 0 0112 5c7 0 11 7 11 7a13.2 13.2 0 01-3.1 3.6M6.2 6.2A13.3 13.3 0 001 12s4 7 11 7a10.6 10.6 0 004.7-1.1"/></svg>
                  <span>Hide correct answer &amp; comments</span>
                } @else {
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
                  <span>Reveal correct answer &amp; comments</span>
                }
              </button>
            }

            <div class="alternatives">
              @for (opt of question.alternatives; track opt.letter) {
                <div class="option-card" [class.correct]="revealAnswers() && opt.isCorrect">
                  <span class="option-letter">{{ opt.letter }}</span>
                  <div class="option-body">
                    <div class="option-text"><app-markdown-renderer [source]="opt.text" /></div>
                    @if (opt.comment && revealAnswers()) {
                      <div class="option-comment">
                        <div class="option-comment-label">
                          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
                          <span>Comment</span>
                        </div>
                        <app-markdown-renderer [source]="opt.comment" />
                      </div>
                    }
                  </div>
                  @if (revealAnswers() && opt.isCorrect) {
                    <span class="option-status">
                      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="var(--color-green)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/></svg>
                    </span>
                  }
                </div>
              }
            </div>

            @if (question.metadata.topics.length > 0 || question.metadata.relatedServices.length > 0) {
              <div class="metadata-block">
                @if (question.metadata.topics.length > 0) {
                  <div class="chip-row">
                    <span class="chip-label">Topics</span>
                    @for (t of question.metadata.topics; track t) { <span class="chip">{{ t }}</span> }
                  </div>
                }
                @if (question.metadata.relatedServices.length > 0) {
                  <div class="chip-row">
                    <span class="chip-label">Related services</span>
                    @for (s of question.metadata.relatedServices; track s) { <span class="chip">{{ s }}</span> }
                  </div>
                }
              </div>
            }

            <section class="refine-panel">
              <header class="refine-header">
                <h3>Refine with AI</h3>
                <p class="refine-hint">
                  Tell the model what to adjust. The full question will be regenerated with your feedback applied.
                </p>
              </header>
              <textarea
                class="refine-textarea"
                [(ngModel)]="refineDraft"
                rows="4"
                placeholder="e.g. In alternative B you explained X but the concept of Z is not clear. Expand that part."
                [disabled]="refining()"
                aria-label="Refinement feedback"
              ></textarea>
              <div class="options-row">
                <label class="model-row">
                  <span class="model-label">Model</span>
                  <select
                    class="model-select"
                    [ngModel]="selectedRefineModel()"
                    (ngModelChange)="onSelectRefineModel($event)"
                    [disabled]="refining()"
                    aria-label="Model for refinement"
                  >
                    @for (model of availableModels(); track model.id) {
                      <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (reasoning)' : '' }} — {{ model.tier }}</option>
                    }
                  </select>
                </label>
              </div>
              <div class="refine-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  (click)="onRefine(question)"
                  [disabled]="!refineDraft.trim() || refining()"
                >
                  @if (refining()) { <mat-spinner diameter="18"></mat-spinner><span>Refining…</span> } @else { Send to AI }
                </button>
              </div>
              @if (refineError()) {
                <p class="refine-error" role="alert">{{ refineError() }}</p>
              }
              <app-ai-disclaimer
                [tight]="true"
                message="Refined output is still AI-generated. Re-read the changes carefully before saving them as truth."
              />
            </section>

            <div class="new-question-row">
              <button type="button" class="new-question-btn" (click)="newQuestion.emit()">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/>
                </svg>
                <span>New question</span>
              </button>
            </div>
          }
        </div>
      } @else {
        <div class="viewer-empty">
          <p class="empty-title">No question selected.</p>
          <p class="empty-body">Generate a new review or pick one from the list to view it here.</p>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; height: 100%; }
      .viewer { display: flex; flex-direction: column; height: 100%; background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
      .viewer-header { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--bg-border); background: var(--bg-surface); }
      .back-btn { display: inline-flex; align-items: center; gap: var(--space-xs); min-height: var(--touch-min); padding: 0 var(--space-sm); border-radius: var(--radius-md); color: var(--text-secondary); font-size: var(--font-size-sm); }
      .back-btn:hover { background: var(--bg-subtle); color: var(--text-primary); }
      .title-block { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
      .title-block h2 { font-size: var(--font-size-lg); color: var(--text-primary); line-height: 1.3; overflow-wrap: anywhere; }
      .header-actions { display: inline-flex; align-items: center; gap: var(--space-xs); }
      .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: var(--touch-min); height: var(--touch-min); border-radius: var(--radius-md); color: var(--text-muted); transition: color var(--transition-fast), background var(--transition-fast); }
      .icon-btn:hover:not(:disabled) { background: var(--bg-subtle); color: var(--text-primary); }
      .icon-btn.active { background: var(--bg-elevated); color: var(--color-purple); }
      .icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .delete-btn:hover:not(:disabled) { color: var(--color-red); }
      .viewer-body { flex: 1; overflow-y: auto; padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-xl); }

      .stem { font-size: var(--font-size-base); line-height: 1.6; color: var(--text-primary); margin: 0; white-space: pre-line; }

      .alternatives { display: flex; flex-direction: column; gap: var(--space-sm); }
      .option-card { display: flex; gap: var(--space-sm); align-items: flex-start; padding: var(--space-md); border-radius: var(--radius-md); border: 1.5px solid var(--bg-border); background: var(--bg-input); }
      .option-card.correct { border-color: var(--color-green); background: rgba(0, 184, 148, 0.08); }
      .option-letter { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--font-size-sm); background: var(--bg-elevated); color: var(--text-secondary); flex-shrink: 0; }
      .option-card.correct .option-letter { background: var(--color-green); color: #fff; }
      .option-body { flex: 1; min-width: 0; }
      .option-text { display: block; font-size: var(--font-size-base); color: var(--text-primary); line-height: 1.5; }
      .option-comment { margin: var(--space-sm) 0 0; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--bg-elevated); border-left: 2px solid var(--bg-border); font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.5; }
      .option-comment-label { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; color: var(--text-faint); font-size: var(--font-size-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
      .option-status { flex-shrink: 0; margin-top: 3px; }

      .metadata-block { display: flex; flex-direction: column; gap: var(--space-sm); }
      .chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
      .chip-label { font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-right: var(--space-xs); }
      .chip { padding: 2px var(--space-sm); border-radius: var(--radius-pill); background: var(--bg-elevated); color: var(--text-secondary); font-size: var(--font-size-xs); }

      .edit-mode { display: flex; flex-direction: column; gap: var(--space-md); flex: 1; }
      .edit-hint { color: var(--text-muted); font-size: var(--font-size-sm); }
      .field-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }
      .edit-label { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-sm); color: var(--text-secondary); }
      .edit-input, .edit-textarea { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-primary); font-size: var(--font-size-base); font-family: var(--font-family); }
      .edit-input:focus-visible, .edit-textarea:focus-visible { outline: none; border-color: var(--color-purple); }
      .edit-textarea { resize: vertical; line-height: 1.5; }
      .edit-error { color: var(--color-red); font-size: var(--font-size-sm); }
      .edit-actions { display: flex; justify-content: flex-end; gap: var(--space-sm); }

      .alt-edit-list { display: flex; flex-direction: column; gap: var(--space-sm); }
      .alt-edit-row { display: flex; gap: var(--space-sm); align-items: flex-start; padding: var(--space-sm); border-radius: var(--radius-md); border: 1px solid var(--bg-border); }
      .alt-letter { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--font-size-xs); background: var(--bg-elevated); color: var(--text-secondary); flex-shrink: 0; margin-top: 4px; }
      .alt-edit-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
      .correct-toggle { display: inline-flex; align-items: center; gap: var(--space-xs); font-size: var(--font-size-sm); color: var(--text-secondary); align-self: flex-start; }
      .correct-toggle input { accent-color: var(--color-green); }
      .icon-btn-sm { width: 28px; height: 28px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); color: var(--text-muted); }
      .icon-btn-sm:hover:not(:disabled) { background: var(--bg-subtle); color: var(--color-red); }
      .icon-btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }
      .add-alt-btn { display: inline-flex; align-items: center; gap: var(--space-xs); align-self: flex-start; padding: var(--space-xs) var(--space-md); background: none; border: 1px dashed var(--bg-border); border-radius: var(--radius-pill); color: var(--text-muted); font-size: var(--font-size-sm); }
      .add-alt-btn:hover { border-color: var(--color-purple); color: var(--color-purple); }

      .refine-panel { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md); border-radius: var(--radius-md); background: var(--bg-elevated); border: 1px solid var(--bg-border); }
      .refine-header h3 { font-size: var(--font-size-base); color: var(--text-primary); margin-bottom: var(--space-xs); }
      .refine-hint { color: var(--text-muted); font-size: var(--font-size-sm); }
      .refine-textarea { width: 100%; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-primary); font-family: var(--font-family); font-size: var(--font-size-base); line-height: 1.5; resize: vertical; }
      .refine-textarea:focus-visible { outline: none; border-color: var(--color-purple); }
      .refine-textarea:disabled { opacity: 0.6; }
      .refine-actions { display: flex; justify-content: flex-end; }
      .options-row { display: flex; flex-direction: column; gap: var(--space-xs); }
      .model-row { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }
      .model-label { font-size: var(--font-size-sm); color: var(--text-muted); }
      .model-select { flex: 1; min-width: 0; max-width: 100%; min-height: 36px; padding: 0 var(--space-sm); border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-primary); font-size: var(--font-size-sm); }
      .model-select:focus-visible { outline: none; border-color: var(--color-purple); }
      .model-select:disabled { opacity: 0.55; cursor: not-allowed; }
      .refine-error { color: var(--color-red); font-size: var(--font-size-sm); }

      .btn { min-height: var(--touch-min); padding: 0 var(--space-md); border-radius: var(--radius-md); font-weight: 600; font-size: var(--font-size-base); display: inline-flex; align-items: center; gap: var(--space-sm); }
      .btn-primary { background: var(--color-purple); color: #ffffff; }
      .btn-primary:hover:not(:disabled) { background: var(--color-blue); }
      .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--bg-border); }
      .btn-ghost:hover:not(:disabled) { background: var(--bg-subtle); }
      .btn:disabled { opacity: 0.55; cursor: not-allowed; }

      .viewer-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-xs); padding: var(--space-xl); color: var(--text-muted); text-align: center; }
      .empty-title { font-size: var(--font-size-lg); color: var(--text-secondary); }
      .empty-body { font-size: var(--font-size-sm); }

      .new-question-row { display: flex; justify-content: center; padding: var(--space-md) 0 var(--space-lg); }
      .new-question-btn { display: inline-flex; align-items: center; gap: var(--space-xs); padding: var(--space-xs) var(--space-md); background: none; border: 1px solid var(--bg-border); border-radius: var(--radius-pill); color: var(--text-muted); font-size: var(--font-size-sm); }
      .new-question-btn:hover { border-color: var(--color-purple); color: var(--text-primary); }

      .reveal-btn { display: inline-flex; align-items: center; gap: var(--space-xs); align-self: flex-start; padding: var(--space-xs) var(--space-md); background: var(--bg-elevated); border: 1px solid var(--bg-border); border-radius: var(--radius-pill); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: 600; }
      .reveal-btn:hover { border-color: var(--color-purple); color: var(--color-purple); }
    `,
  ],
})
export class ReviewViewerComponent {
  private readonly questionsService = inject(QuestionsService);
  private readonly storage = inject(StorageService);
  private readonly bedrock = inject(BedrockService);
  private readonly settings = inject(SettingsService);
  private readonly modelsService = inject(ModelsService);
  private readonly packs = inject(PacksService);
  private readonly enrichment = inject(QuestionEnrichmentService);
  private readonly dialog = inject(MatDialog);

  readonly question = input<Question | null>(null);
  readonly showBackButton = input<boolean>(false);

  readonly current = computed(() => this.question());
  readonly back = output<void>();
  readonly deleted = output<string>();
  readonly newQuestion = output<void>();

  protected readonly editing = signal(false);
  protected readonly refining = signal(false);
  protected readonly deleting = signal(false);
  protected readonly saving = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly refineError = signal<string | null>(null);
  protected readonly refineModelOverride = signal<string | null>(null);
  protected editTitleDraft = '';
  protected editDomainDraft = '';
  protected editStemDraft = '';
  protected editAlternatives: AlternativeDraft[] = [];
  protected editTopicsDraft = '';
  protected editRelatedServicesDraft = '';
  protected refineDraft = '';
  private refineController: AbortController | null = null;

  readonly showCorrectInReview = this.settings.showCorrectInReview;
  protected readonly revealed = signal(false);
  readonly revealAnswers = computed(() => this.showCorrectInReview() || this.revealed());

  readonly domainOptions = computed(() => {
    const defined = this.packs.activeDomains().map((d) => d.name);
    return defined.length > 0 ? defined : [DEFAULT_DOMAIN];
  });

  readonly availableModels = this.modelsService.models;
  readonly selectedRefineModel = computed(
    () => this.refineModelOverride() ?? this.modelsService.resolveModel(this.settings.defaultModel()),
  );

  constructor() {
    effect(() => {
      const q = this.question();
      // Reset transient UI state whenever the displayed question changes.
      this.editing.set(false);
      this.refineDraft = '';
      this.refineError.set(null);
      this.editError.set(null);
      this.revealed.set(false);
    });
  }

  onToggleReveal(): void {
    this.revealed.set(!this.revealed());
  }

  onDelete(question: Question): void {
    const dialogRef = this.dialog.open(ConfirmDeleteDialogComponent, {
      data: { title: question.title },
      width: '400px',
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result !== 'confirm') return;
      this.deleting.set(true);
      const success = await this.storage.deleteQuestion(question.id);
      this.deleting.set(false);
      if (success) {
        this.questionsService.remove(question.id);
        this.deleted.emit(question.id);
      }
    });
  }

  onSelectRefineModel(value: string): void {
    this.refineModelOverride.set(value);
  }

  onToggleEdit(question: Question): void {
    if (this.editing()) {
      this.onSaveEdit(question);
    } else {
      this.editTitleDraft = question.title;
      this.editDomainDraft = question.domain;
      this.editStemDraft = question.stem;
      this.editAlternatives = question.alternatives.map((a) => ({ ...a }));
      this.editTopicsDraft = question.metadata.topics.join(', ');
      this.editRelatedServicesDraft = question.metadata.relatedServices.join(', ');
      this.editError.set(null);
      this.editing.set(true);
    }
  }

  onCancelEdit(): void {
    this.editing.set(false);
    this.editError.set(null);
  }

  onAddAlternative(): void {
    const letter = LETTERS[this.editAlternatives.length] ?? `#${this.editAlternatives.length + 1}`;
    this.editAlternatives = [...this.editAlternatives, { letter, text: '', isCorrect: false, comment: '' }];
  }

  onRemoveAlternative(index: number): void {
    if (this.editAlternatives.length <= 2) return;
    const next = this.editAlternatives.filter((_, i) => i !== index);
    this.editAlternatives = next.map((alt, i) => ({ ...alt, letter: LETTERS[i] ?? alt.letter }));
  }

  async onSaveEdit(question: Question): Promise<void> {
    const stem = this.editStemDraft.trim();
    const title = this.editTitleDraft.trim();
    const alternatives = this.editAlternatives
      .map((a) => ({ ...a, text: a.text.trim(), comment: a.comment.trim() }))
      .filter((a) => a.text.length > 0);

    if (!stem || !title) {
      this.editError.set('Title and question text cannot be empty.');
      return;
    }
    if (alternatives.length < 2) {
      this.editError.set('At least two alternatives are required.');
      return;
    }
    if (!alternatives.some((a) => a.isCorrect)) {
      this.editError.set('Mark at least one alternative as correct.');
      return;
    }

    this.saving.set(true);
    this.editError.set(null);
    try {
      const updated: Question = {
        ...question,
        title,
        domain: this.editDomainDraft || question.domain,
        stem,
        alternatives,
        metadata: {
          topics: toCommaList(this.editTopicsDraft),
          relatedServices: toCommaList(this.editRelatedServicesDraft),
        },
      };
      const success = await this.storage.updateQuestion(updated);
      if (success) {
        this.questionsService.updatePartial(question.id, updated);
        this.editing.set(false);
      } else {
        this.editError.set('Failed to save — please try again.');
      }
    } finally {
      this.saving.set(false);
    }
  }

  async onRefine(question: Question): Promise<void> {
    const feedback = this.refineDraft.trim();
    if (!feedback) return;

    const currentMarkdown = renderQuestionMarkdown(question);
    const controller = new AbortController();
    this.refineController = controller;
    this.refining.set(true);
    this.refineError.set(null);

    try {
      const activePack = this.packs.activePack();
      let accumulated = '';
      for await (const chunk of this.bedrock.streamRefineReview(
        currentMarkdown,
        feedback,
        { name: activePack.name, description: activePack.description, domains: activePack.domains },
        this.selectedRefineModel(),
        controller.signal,
        this.settings.outputLanguage(),
      )) {
        accumulated += chunk;
      }

      const parsed = parseQuestionReview(accumulated);
      if (!parsed) {
        this.refineError.set("Couldn't parse the refined output into structured question data. Nothing was changed.");
        return;
      }

      const relatedServices = await this.enrichment.extractRelatedServices(parsed.stem, parsed.alternatives);
      const updated: Question = {
        ...question,
        stem: parsed.stem,
        alternatives: parsed.alternatives,
        metadata: {
          topics: parsed.topics.length > 0 ? parsed.topics : question.metadata.topics,
          relatedServices,
        },
      };
      const success = await this.storage.updateQuestion(updated);
      if (success) {
        this.questionsService.updatePartial(question.id, updated);
        this.refineDraft = '';
        this.refineModelOverride.set(null);
      } else {
        this.refineError.set('Failed to save the refined question — please try again.');
      }
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      if (!aborted) {
        this.refineError.set(err instanceof Error ? err.message : 'Refine failed.');
      }
    } finally {
      this.refining.set(false);
      this.refineController = null;
    }
  }
}
