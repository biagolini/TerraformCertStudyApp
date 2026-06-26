import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Question } from '../../core/models/question.model';
import { BedrockService } from '../../core/services/bedrock.service';
import { ModelsService } from '../../core/services/models.service';
import { PacksService } from '../../core/services/packs.service';
import { QuestionsService } from '../../core/services/questions.service';
import { SettingsService } from '../../core/services/settings.service';
import { StorageService } from '../../core/services/storage.service';
import { stripInferredMetadata } from '../../core/utils/domain-inference.util';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { MarkdownRendererComponent } from './markdown-renderer.component';

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
            <button
              type="button"
              class="back-btn"
              (click)="back.emit()"
              aria-label="Back to question list"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 6l-6 6 6 6"
                />
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
              [attr.aria-label]="editing() ? 'Exit edit mode' : 'Edit review manually'"
              [attr.aria-pressed]="editing()"
              [disabled]="refining()"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
                />
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
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
                  />
                </svg>
              }
            </button>
          </div>
        </header>

        <div class="viewer-body">
          @if (editing()) {
            <div class="edit-mode">
              <p class="edit-hint">
                Editing title and review (Markdown). Save to keep your changes; Cancel to discard.
              </p>
              <label class="edit-label">
                <span>Title</span>
                <input
                  type="text"
                  class="edit-title-input"
                  [(ngModel)]="editTitleDraft"
                  aria-label="Edit question title"
                />
              </label>
              <textarea
                class="edit-textarea"
                [(ngModel)]="editDraft"
                aria-label="Edit review markdown"
              ></textarea>
              <div class="edit-actions">
                <button type="button" class="btn btn-ghost" (click)="onCancelEdit()" [disabled]="saving()">Cancel</button>
                <button
                  type="button"
                  class="btn btn-primary"
                  (click)="onSaveEdit(question)"
                  [disabled]="!editDraft.trim() || saving()"
                >
                  @if (saving()) {
                    <mat-spinner diameter="18"></mat-spinner>
                  } @else {
                    Save
                  }
                </button>
              </div>
            </div>
          } @else {
            <app-ai-disclaimer
              message="This review was generated by AI and may contain errors. Treat it as study support, not as an authoritative source."
            />
            <app-markdown-renderer [source]="question.review" />

            <section class="refine-panel">
              <header class="refine-header">
                <h3>Refine with AI</h3>
                <p class="refine-hint">
                  Tell the model what to adjust. The full review will be regenerated with your feedback applied.
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
                @if (refining()) {
                  <button type="button" class="btn btn-stop" (click)="onStopRefine()">
                    <span class="stop-icon" aria-hidden="true"></span>
                    <span>Stop</span>
                  </button>
                } @else {
                  <button
                    type="button"
                    class="btn btn-primary"
                    (click)="onRefine(question)"
                    [disabled]="!refineDraft.trim()"
                  >
                    Send to AI
                  </button>
                }
              </div>
              @if (refineError()) {
                <p class="refine-error" role="alert">{{ refineError() }}</p>
              }
              <app-ai-disclaimer
                [tight]="true"
                message="Refined output is still AI-generated. Re-read the changes carefully before saving them as truth."
              />
            </section>
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
      :host {
        display: block;
        height: 100%;
      }
      .viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }
      .viewer-header {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-md) var(--space-lg);
        border-bottom: 1px solid var(--bg-border);
        background: var(--bg-surface);
      }
      .back-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        min-height: var(--touch-min);
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .back-btn:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .title-block {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .title-block h2 {
        font-size: var(--font-size-lg);
        color: var(--text-primary);
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      .header-actions {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
      }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-muted);
        transition: color var(--transition-fast), background var(--transition-fast);
      }
      .icon-btn:hover:not(:disabled) {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .icon-btn.active {
        background: var(--bg-elevated);
        color: var(--color-purple);
      }
      .icon-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .delete-btn:hover:not(:disabled) {
        color: var(--color-red);
      }
      .viewer-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-xl);
      }
      .edit-mode {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        flex: 1;
      }
      .edit-hint {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .edit-label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .edit-title-input {
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-base);
      }
      .edit-title-input:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .edit-textarea {
        flex: 1;
        min-height: 320px;
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: var(--font-size-base);
        line-height: 1.5;
        resize: vertical;
      }
      .edit-textarea:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .edit-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-sm);
      }
      .refine-panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
      }
      .refine-header h3 {
        font-size: var(--font-size-base);
        color: var(--text-primary);
        margin-bottom: var(--space-xs);
      }
      .refine-hint {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
      }
      .refine-textarea {
        width: 100%;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-family: var(--font-family);
        font-size: var(--font-size-base);
        line-height: 1.5;
        resize: vertical;
      }
      .refine-textarea:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .refine-textarea:disabled {
        opacity: 0.6;
      }
      .refine-actions {
        display: flex;
        justify-content: flex-end;
      }
      .options-row {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .model-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .model-label {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .model-select {
        flex: 1;
        min-height: 36px;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
      }
      .model-select:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .model-select:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .search-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        cursor: pointer;
      }
      .search-toggle input[type='checkbox'] {
        accent-color: var(--color-purple);
      }
      .refine-warn {
        color: var(--color-amber);
        font-size: var(--font-size-sm);
      }
      .refine-error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
      }
      .btn {
        min-height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        font-weight: 600;
        font-size: var(--font-size-base);
        display: inline-flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .btn-primary {
        background: var(--color-purple);
        color: #ffffff;
      }
      .btn-primary:hover:not(:disabled) {
        background: var(--color-blue);
      }
      .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--bg-border);
      }
      .btn-ghost:hover:not(:disabled) {
        background: var(--bg-subtle);
      }
      .btn-stop {
        background: var(--color-red);
        color: #ffffff;
      }
      .btn-stop:hover {
        filter: brightness(1.1);
      }
      .stop-icon {
        width: 12px;
        height: 12px;
        background: #ffffff;
        border-radius: 2px;
      }
      .btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.4);
        border-top-color: #ffffff;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .viewer-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-xs);
        padding: var(--space-xl);
        color: var(--text-muted);
        text-align: center;
      }
      .empty-title {
        font-size: var(--font-size-lg);
        color: var(--text-secondary);
      }
      .empty-body {
        font-size: var(--font-size-sm);
      }
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
  private readonly dialog = inject(MatDialog);

  readonly question = input<Question | null>(null);
  readonly showBackButton = input<boolean>(false);

  readonly current = computed(() => this.question());
  readonly back = output<void>();
  readonly deleted = output<string>();

  protected readonly editing = signal(false);
  protected readonly refining = signal(false);
  protected readonly deleting = signal(false);
  protected readonly saving = signal(false);
  protected readonly refineError = signal<string | null>(null);
  protected readonly refineModelOverride = signal<string | null>(null);
  protected editDraft = '';
  protected editTitleDraft = '';
  protected refineDraft = '';
  private refineController: AbortController | null = null;

  readonly availableModels = this.modelsService.models;
  readonly selectedRefineModel = computed(
    () => this.refineModelOverride() ?? this.modelsService.resolveModel(this.settings.defaultModel()),
  );

  constructor() {
    effect(() => {
      const q = this.question();
      // Reset transient UI state whenever the displayed question changes.
      this.editing.set(false);
      this.editDraft = q?.review ?? '';
      this.editTitleDraft = q?.title ?? '';
      this.refineDraft = '';
      this.refineError.set(null);
    });
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
      // Clicking the pencil again while editing = save
      this.onSaveEdit(question);
    } else {
      this.editDraft = question.review;
      this.editTitleDraft = question.title;
      this.refineError.set(null);
      this.editing.set(true);
    }
  }

  onCancelEdit(): void {
    this.editing.set(false);
    const q = this.question();
    this.editDraft = q?.review ?? '';
    this.editTitleDraft = q?.title ?? '';
  }

  async onSaveEdit(question: Question): Promise<void> {
    const value = this.editDraft.trim();
    const title = this.editTitleDraft.trim() || question.title;
    if (!value) return;
    this.saving.set(true);
    const updated = { ...question, review: value, title };
    const success = await this.storage.updateQuestion(updated);
    this.saving.set(false);
    if (success) {
      this.questionsService.updatePartial(question.id, { review: value, title });
      this.editing.set(false);
    }
  }

  async onRefine(question: Question): Promise<void> {
    const feedback = this.refineDraft.trim();
    if (!feedback) return;

    const baseReview = question.review;
    const controller = new AbortController();
    this.refineController = controller;
    this.refining.set(true);
    this.refineError.set(null);

    let started = false;
    let accumulated = '';
    try {
      const activePack = this.packs.activePack();

      for await (const chunk of this.bedrock.streamRefineReview(
        baseReview,
        feedback,
        { name: activePack.name, description: activePack.description, domains: activePack.domains },
        this.selectedRefineModel(),
        controller.signal,
        this.settings.outputLanguage(),
      )) {
        accumulated += chunk;
        if (!started) {
          // First chunk: take over the viewer with the new content.
          this.questionsService.setReview(question.id, chunk);
          started = true;
        } else {
          this.questionsService.appendToReview(question.id, chunk);
        }
      }

      this.questionsService.setReview(question.id, stripInferredMetadata(accumulated));
      this.refineDraft = '';
      this.refineModelOverride.set(null);
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      if (started) {
        if (aborted) {
          this.questionsService.setReview(question.id, stripInferredMetadata(accumulated));
        } else {
          this.questionsService.setReview(question.id, baseReview);
          this.refineError.set(err instanceof Error ? err.message : 'Refine failed.');
        }
      } else if (!aborted) {
        this.refineError.set(err instanceof Error ? err.message : 'Refine failed.');
      }
    } finally {
      this.refining.set(false);
      this.refineController = null;
    }
  }

  onStopRefine(): void {
    this.refineController?.abort();
  }
}
