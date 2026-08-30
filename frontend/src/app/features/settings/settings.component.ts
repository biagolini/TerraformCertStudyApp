import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OUTPUT_LANGUAGES } from '../../core/models/settings.model';
import { ModelsService } from '../../core/services/models.service';
import { QuestionsService } from '../../core/services/questions.service';
import { SettingsService } from '../../core/services/settings.service';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="drawer">
      <header class="drawer-header">
        <h2>Settings</h2>
        <button
          type="button"
          class="close-btn"
          (click)="closed.emit()"
          aria-label="Close settings"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              d="M5 5l14 14M19 5L5 19"
            />
          </svg>
        </button>
      </header>

      <div class="drawer-body">
        <section class="block">
          <header class="section-header">
            <h3>Sync</h3>
            <p class="helper">
              @if (syncStatus() === 'syncing') {
                Syncing…
              } @else if (lastSyncedAt()) {
                Last synced {{ lastSyncedLabel() }}
              } @else {
                Not synced yet.
              }
            </p>
          </header>
          @if (syncStatus() === 'error') {
            <p class="sync-error">{{ syncError() }}</p>
          }
          <button type="button" class="btn btn-ghost" (click)="onSyncNow()" [disabled]="syncStatus() === 'syncing'">
            @if (syncStatus() === 'syncing') { Syncing… } @else { Sync now }
          </button>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>Default model</h3>
            <p class="helper">
              Foundation model used for Generate Review and Refine. You can override per call. Lighter tiers (fast) respond quicker and cost less. Models marked "(reasoning)" think before answering for higher accuracy.
            </p>
          </header>
          <select
            class="text-input"
            [ngModel]="defaultModel()"
            (ngModelChange)="onDefaultModelChange($event)"
            aria-label="Default model"
          >
            @for (model of availableModels(); track model.id) {
              <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (reasoning)' : '' }} — {{ model.tier }}</option>
            }
            @if (!availableHas(defaultModel())) {
              <option [value]="defaultModel()">{{ defaultModel() }} (not in current list)</option>
            }
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>Output language</h3>
            <p class="helper">
              Language used in explanations and translations. Default keeps the same language as the input question or transcript.
            </p>
          </header>
          <select
            class="text-input"
            [ngModel]="outputLanguage()"
            (ngModelChange)="onOutputLanguageChange($event)"
            aria-label="Output language"
          >
            @for (lang of outputLanguages; track lang.code) {
              <option [value]="lang.code">{{ lang.label }}</option>
            }
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>Default review mode</h3>
            <p class="helper">
              Choose whether the New Question screen starts in "Generate with AI" mode or "Add ready-made review" mode. You can switch modes at any time on the screen itself.
            </p>
          </header>
          <select
            class="text-input"
            [ngModel]="defaultReviewMode()"
            (ngModelChange)="onDefaultReviewModeChange($event)"
            aria-label="Default review mode"
          >
            <option value="generate">Generate with AI</option>
            <option value="manual">Add ready-made review</option>
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>Question review</h3>
            <p class="helper">
              Highlight the correct alternative in green when reviewing a question. Turn this off to
              review without seeing the answer marked.
            </p>
          </header>
          <label class="switch-row">
            <button
              type="button"
              class="switch"
              [class.on]="showCorrectInReview()"
              (click)="onToggleShowCorrectInReview()"
              role="switch"
              [attr.aria-checked]="showCorrectInReview()"
              aria-label="Highlight correct alternative in review"
            ><span class="thumb"></span></button>
            <span>Highlight correct alternative</span>
          </label>
        </section>

        <section class="block danger">
          <header class="section-header">
            <h3>Danger Zone</h3>
            <p class="helper">
              Clears the questions belonging to the active pack only. Other packs are not affected.
            </p>
          </header>
          <button
            type="button"
            class="btn btn-danger"
            (click)="onClearRequested()"
            [disabled]="questionCount() === 0"
          >
            Clear questions in this pack
          </button>
          <p class="helper">{{ questionCount() }} question{{ questionCount() === 1 ? '' : 's' }} in this pack.</p>
        </section>
      </div>

      @if (confirmingClear()) {
        <div class="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div class="confirm">
            <h3 id="confirm-title">Clear questions in this pack?</h3>
            <p>
              This will permanently delete the {{ questionCount() }} question{{ questionCount() === 1 ? '' : 's' }} in the active pack. Your settings and other packs will not be affected.
            </p>
            <div class="confirm-actions">
              <button type="button" class="btn btn-ghost" (click)="onCancelClear()">Cancel</button>
              <button type="button" class="btn btn-danger" (click)="onConfirmClear()">Delete</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .drawer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-surface);
        color: var(--text-primary);
      }
      .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-md) var(--space-lg);
        border-bottom: 1px solid var(--bg-border);
        position: sticky;
        top: 0;
        background: var(--bg-surface);
        z-index: 1;
      }
      .drawer-header h2 {
        font-size: var(--font-size-xl);
      }
      .close-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-muted);
      }
      .close-btn:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-xl);
        padding-bottom: calc(var(--space-xl) * 2);
      }
      .block {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .section-header h3 {
        font-size: var(--font-size-lg);
        color: var(--text-primary);
        margin-bottom: var(--space-xs);
      }
      .helper {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        line-height: 1.45;
      }
      .sync-error {
        font-size: var(--font-size-sm);
        color: var(--color-red);
        line-height: 1.45;
      }
      .text-input {
        height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-base);
        width: 100%;
        transition: border-color var(--transition-fast);
      }
      .text-input:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .btn {
        min-height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        font-weight: 600;
        font-size: var(--font-size-base);
        white-space: nowrap;
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--bg-border);
      }
      .btn-ghost:hover:not(:disabled) {
        background: var(--bg-subtle);
      }
      .btn-danger {
        background: transparent;
        color: var(--color-red);
        border: 1px solid var(--color-red);
      }
      .btn-danger:hover:not(:disabled) {
        background: var(--color-red);
        color: #ffffff;
      }
      .danger {
        border-top: 1px solid var(--bg-border);
        padding-top: var(--space-lg);
      }
      .switch-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .switch {
        width: 38px;
        height: 22px;
        border-radius: 999px;
        background: var(--bg-border);
        position: relative;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        padding: 0;
      }
      .switch.on {
        background: var(--color-purple);
      }
      .switch .thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        transition: left var(--transition-fast);
      }
      .switch.on .thumb {
        left: 18px;
      }
      .confirm-overlay {
        position: absolute;
        inset: 0;
        background: var(--overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-lg);
      }
      .confirm {
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        padding: var(--space-lg);
        box-shadow: var(--shadow-lg);
        max-width: 360px;
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .confirm h3 {
        font-size: var(--font-size-lg);
      }
      .confirm p {
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-sm);
      }
    `,
  ],
})
export class SettingsComponent {
  private readonly settings = inject(SettingsService);
  private readonly questionsService = inject(QuestionsService);
  private readonly modelsService = inject(ModelsService);
  private readonly storage = inject(StorageService);

  protected readonly confirmingClear = signal(false);
  protected readonly outputLanguages = OUTPUT_LANGUAGES;

  readonly closed = output<void>();

  readonly questionCount = this.questionsService.count;
  readonly availableModels = this.modelsService.models;
  readonly defaultModel = this.settings.defaultModel;
  readonly outputLanguage = this.settings.outputLanguage;
  readonly defaultReviewMode = this.settings.defaultReviewMode;
  readonly showCorrectInReview = this.settings.showCorrectInReview;

  readonly syncStatus = this.storage.syncStatus;
  readonly syncError = this.storage.lastError;
  readonly lastSyncedAt = this.storage.lastSyncedAt;
  readonly lastSyncedLabel = computed(() => {
    const at = this.lastSyncedAt();
    if (!at) return '';
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  onSyncNow(): void {
    void this.storage.refresh();
  }

  onClearRequested(): void {
    this.confirmingClear.set(true);
  }

  onCancelClear(): void {
    this.confirmingClear.set(false);
  }

  onConfirmClear(): void {
    this.questionsService.clearActivePack();
    this.confirmingClear.set(false);
  }

  onDefaultModelChange(value: string): void {
    this.settings.setDefaultModel(value);
  }

  onOutputLanguageChange(value: string): void {
    this.settings.setOutputLanguage(value);
  }

  onDefaultReviewModeChange(value: string): void {
    if (value === 'generate' || value === 'manual') {
      this.settings.setDefaultReviewMode(value);
    }
  }

  onToggleShowCorrectInReview(): void {
    this.settings.setShowCorrectInReview(!this.showCorrectInReview());
  }

  availableHas(id: string): boolean {
    return this.availableModels().some((m) => m.id === id);
  }
}
