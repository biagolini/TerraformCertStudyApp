import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NAV_ITEMS, NavTabId } from '../../core/models/nav-item.model';
import { OUTPUT_LANGUAGES } from '../../core/models/settings.model';
import { INTERFACE_LANGUAGES, InterfaceLanguage } from '../../core/models/i18n.model';
import { ModelsService } from '../../core/services/models.service';
import { QuestionsService } from '../../core/services/questions.service';
import { SettingsService } from '../../core/services/settings.service';
import { StorageService } from '../../core/services/storage.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="drawer">
      <header class="drawer-header">
        <h2>{{ i18n.t('settings.title') }}</h2>
        <button
          type="button"
          class="close-btn"
          (click)="closed.emit()"
          [attr.aria-label]="i18n.t('settings.closeSettings')"
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
            <h3>{{ i18n.t('settings.sync') }}</h3>
            <p class="helper">
              @if (syncStatus() === 'syncing') {
                {{ i18n.t('sync.syncing') }}
              } @else if (lastSyncedAt()) {
                {{ i18n.t('sync.lastSynced', { time: lastSyncedLabel() }) }}
              } @else {
                {{ i18n.t('sync.notSyncedYet') }}
              }
            </p>
          </header>
          @if (syncStatus() === 'error') {
            <p class="sync-error">{{ syncError() }}</p>
          }
          <button type="button" class="btn btn-ghost" (click)="onSyncNow()" [disabled]="syncStatus() === 'syncing'">
            {{ syncStatus() === 'syncing' ? i18n.t('sync.syncing') : i18n.t('settings.syncNow') }}
          </button>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.defaultModel') }}</h3>
            <p class="helper">{{ i18n.t('settings.defaultModelHelp') }}</p>
          </header>
          <select
            class="text-input"
            [ngModel]="defaultModel()"
            (ngModelChange)="onDefaultModelChange($event)"
            [attr.aria-label]="i18n.t('settings.defaultModel')"
          >
            @for (model of availableModels(); track model.id) {
              <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (' + i18n.t('settings.reasoning') + ')' : '' }} — {{ model.tier }}</option>
            }
            @if (!availableHas(defaultModel())) {
              <option [value]="defaultModel()">{{ defaultModel() }} ({{ i18n.t('settings.notInCurrentList') }})</option>
            }
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.examImportModel') }}</h3>
            <p class="helper">{{ i18n.t('settings.examImportModelHelp') }}</p>
          </header>
          <select
            class="text-input"
            [ngModel]="importExtractionModel()"
            (ngModelChange)="onImportExtractionModelChange($event)"
            [attr.aria-label]="i18n.t('settings.examImportModel')"
          >
            @for (model of availableModels(); track model.id) {
              <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (' + i18n.t('settings.reasoning') + ')' : '' }} — {{ model.tier }}</option>
            }
            @if (!availableHas(importExtractionModel())) {
              <option [value]="importExtractionModel()">{{ importExtractionModel() }} ({{ i18n.t('settings.notInCurrentList') }})</option>
            }
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.interfaceLanguage') }}</h3>
            <p class="helper">{{ i18n.t('settings.interfaceLanguageHelp') }}</p>
          </header>
          <select
            class="text-input"
            [ngModel]="interfaceLanguage()"
            (ngModelChange)="onInterfaceLanguageChange($event)"
            [attr.aria-label]="i18n.t('settings.interfaceLanguage')"
          >
            @for (lang of interfaceLanguages; track lang.code) {
              <option [value]="lang.code">{{ lang.label }}</option>
            }
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.outputLanguage') }}</h3>
            <p class="helper">{{ i18n.t('settings.outputLanguageHelp') }}</p>
          </header>
          <select
            class="text-input"
            [ngModel]="outputLanguage()"
            (ngModelChange)="onOutputLanguageChange($event)"
            [attr.aria-label]="i18n.t('settings.outputLanguage')"
          >
            @for (lang of outputLanguages; track lang.code) {
              <option [value]="lang.code">{{ lang.label }}</option>
            }
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.defaultReviewMode') }}</h3>
            <p class="helper">{{ i18n.t('settings.defaultReviewModeHelp') }}</p>
          </header>
          <select
            class="text-input"
            [ngModel]="defaultReviewMode()"
            (ngModelChange)="onDefaultReviewModeChange($event)"
            [attr.aria-label]="i18n.t('settings.defaultReviewMode')"
          >
            <option value="generate">{{ i18n.t('settings.generateWithAi') }}</option>
            <option value="manual">{{ i18n.t('settings.addReadyMadeReview') }}</option>
          </select>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.questionReview') }}</h3>
            <p class="helper">{{ i18n.t('settings.questionReviewHelp') }}</p>
          </header>
          <label class="switch-row">
            <button
              type="button"
              class="switch"
              [class.on]="showCorrectInReview()"
              (click)="onToggleShowCorrectInReview()"
              role="switch"
              [attr.aria-checked]="showCorrectInReview()"
              [attr.aria-label]="i18n.t('settings.highlightCorrectAriaLabel')"
            ><span class="thumb"></span></button>
            <span>{{ i18n.t('settings.highlightCorrectAlternative') }}</span>
          </label>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.quizTimer') }}</h3>
            <p class="helper">{{ i18n.t('settings.quizTimerHelp') }}</p>
          </header>
          <label class="switch-row">
            <button
              type="button"
              class="switch"
              [class.on]="defaultTrackTime()"
              (click)="onToggleDefaultTrackTime()"
              role="switch"
              [attr.aria-checked]="defaultTrackTime()"
              [attr.aria-label]="i18n.t('settings.trackTimeAriaLabel')"
            ><span class="thumb"></span></button>
            <span>{{ i18n.t('settings.trackTimeByDefault') }}</span>
          </label>
          <label class="switch-row">
            <button
              type="button"
              class="switch"
              [class.on]="defaultUseAccommodation()"
              (click)="onToggleDefaultUseAccommodation()"
              role="switch"
              [attr.aria-checked]="defaultUseAccommodation()"
              [attr.aria-label]="i18n.t('settings.useAccommodationAriaLabel')"
            ><span class="thumb"></span></button>
            <span>{{ i18n.t('settings.useAccommodationByDefault') }}</span>
          </label>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.bottomNav') }}</h3>
            <p class="helper">{{ i18n.t('settings.bottomNavHelp') }}</p>
          </header>
          @for (item of orderedNavItems(); track item.id; let i = $index, count = $count) {
            <div class="nav-order-row">
              <div class="reorder-buttons">
                <button
                  type="button"
                  class="reorder-btn"
                  [disabled]="i === 0"
                  (click)="onMoveNavTab(item.id, 'up')"
                  [attr.aria-label]="i18n.t('settings.moveUp', { name: i18n.t('nav.' + item.id) })"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="reorder-btn"
                  [disabled]="i === count - 1"
                  (click)="onMoveNavTab(item.id, 'down')"
                  [attr.aria-label]="i18n.t('settings.moveDown', { name: i18n.t('nav.' + item.id) })"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              <label class="switch-row">
                <button
                  type="button"
                  class="switch"
                  [class.on]="!hiddenNavTabs().includes(item.id)"
                  [disabled]="isLastVisibleNavTab(item.id)"
                  (click)="onToggleNavTab(item.id)"
                  role="switch"
                  [attr.aria-checked]="!hiddenNavTabs().includes(item.id)"
                  [attr.aria-label]="i18n.t('settings.showInBottomNav', { name: i18n.t('nav.' + item.id) })"
                ><span class="thumb"></span></button>
                <span>{{ i18n.t('nav.' + item.id) }}</span>
              </label>
            </div>
          }
        </section>

        <section class="block danger">
          <header class="section-header">
            <h3>{{ i18n.t('settings.dangerZone') }}</h3>
            <p class="helper">{{ i18n.t('settings.dangerZoneHelp') }}</p>
          </header>
          <button
            type="button"
            class="btn btn-danger"
            (click)="onClearRequested()"
            [disabled]="questionCount() === 0"
          >
            {{ i18n.t('settings.clearQuestionsInPack') }}
          </button>
          <p class="helper">{{ i18n.t('settings.questionCountInPack', { count: questionCount() }) }}</p>
          @if (clearResult(); as result) {
            <p class="helper" [class.clear-success]="result.failed === 0" [class.clear-warn]="result.failed > 0">
              @if (result.failed === 0) {
                {{ i18n.t('settings.deletedSuccessfully', { count: result.deleted }) }}
              } @else {
                {{ i18n.t('settings.deletedWithFailures', { deleted: result.deleted, failed: result.failed }) }}
              }
            </p>
          }
        </section>
      </div>

      @if (confirmingClear()) {
        <div class="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div class="confirm">
            <h3 id="confirm-title">{{ i18n.t('settings.clearQuestionsConfirmTitle') }}</h3>
            <p>{{ i18n.t('settings.clearQuestionsConfirmBody', { count: questionCount() }) }}</p>
            <div class="confirm-actions">
              <button type="button" class="btn btn-ghost" (click)="onCancelClear()" [disabled]="clearing()">{{ i18n.t('common.cancel') }}</button>
              <button type="button" class="btn btn-danger" (click)="onConfirmClear()" [disabled]="clearing()">
                {{ clearing() ? i18n.t('settings.deleting') : i18n.t('common.delete') }}
              </button>
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
      .helper.clear-success {
        color: var(--color-green);
      }
      .helper.clear-warn {
        color: var(--color-amber);
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
      .nav-order-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .reorder-buttons {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex-shrink: 0;
      }
      .reorder-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 16px;
        padding: 0;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
      }
      .reorder-btn:hover:not(:disabled) {
        border-color: var(--color-purple);
        color: var(--color-purple);
      }
      .reorder-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
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
  protected readonly i18n = inject(I18nService);

  protected readonly confirmingClear = signal(false);
  protected readonly clearing = signal(false);
  protected readonly clearResult = signal<{ deleted: number; failed: number } | null>(null);
  protected readonly outputLanguages = OUTPUT_LANGUAGES;
  protected readonly interfaceLanguages = INTERFACE_LANGUAGES;
  protected readonly navItems = NAV_ITEMS;
  protected readonly orderedNavItems = this.settings.orderedNavItems;

  readonly closed = output<void>();

  readonly questionCount = this.questionsService.count;
  readonly availableModels = this.modelsService.models;
  readonly defaultModel = this.settings.defaultModel;
  readonly importExtractionModel = this.settings.importExtractionModel;
  readonly interfaceLanguage = this.settings.interfaceLanguage;
  readonly outputLanguage = this.settings.outputLanguage;
  readonly defaultReviewMode = this.settings.defaultReviewMode;
  readonly showCorrectInReview = this.settings.showCorrectInReview;
  readonly defaultTrackTime = this.settings.defaultTrackTime;
  readonly defaultUseAccommodation = this.settings.defaultUseAccommodation;
  readonly hiddenNavTabs = this.settings.hiddenNavTabs;

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
    this.clearResult.set(null);
    this.confirmingClear.set(true);
  }

  onCancelClear(): void {
    this.confirmingClear.set(false);
  }

  async onConfirmClear(): Promise<void> {
    this.clearing.set(true);
    try {
      const result = await this.questionsService.clearActivePack();
      this.clearResult.set(result);
    } finally {
      this.clearing.set(false);
      this.confirmingClear.set(false);
    }
  }

  onDefaultModelChange(value: string): void {
    this.settings.setDefaultModel(value);
  }

  onImportExtractionModelChange(value: string): void {
    this.settings.setImportExtractionModel(value);
  }

  onInterfaceLanguageChange(value: InterfaceLanguage): void {
    this.settings.setInterfaceLanguage(value);
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

  onToggleDefaultTrackTime(): void {
    this.settings.setDefaultTrackTime(!this.defaultTrackTime());
  }

  onToggleDefaultUseAccommodation(): void {
    this.settings.setDefaultUseAccommodation(!this.defaultUseAccommodation());
  }

  onToggleNavTab(id: NavTabId): void {
    this.settings.toggleNavTab(id);
  }

  onMoveNavTab(id: NavTabId, direction: 'up' | 'down'): void {
    this.settings.moveNavTab(id, direction);
  }

  isLastVisibleNavTab(id: NavTabId): boolean {
    const hidden = this.hiddenNavTabs();
    return !hidden.includes(id) && hidden.length >= this.navItems.length - 1;
  }

  availableHas(id: string): boolean {
    return this.availableModels().some((m) => m.id === id);
  }
}
