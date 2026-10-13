import { IconComponent } from '../../shared/components/icon.component';
import { RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NAV_ITEMS, NavTabId } from '../../core/models/nav-item.model';
import { MAX_QUIZ_TOOLBAR_ROWS, QuizToolId } from '../../core/models/quiz-tool.model';
import { HEADER_ACTIONS, HeaderActionId } from '../../core/models/header-action.model';
import { OUTPUT_LANGUAGES, IMPORT_REVIEW_TIMEOUT_OPTIONS, IMPORT_REVIEW_CONCURRENCY_MAX } from '../../core/models/settings.model';
import { INTERFACE_LANGUAGES, InterfaceLanguage } from '../../core/models/i18n.model';
import { AuthService } from '../../core/services/auth.service';
import { ModelsService } from '../../core/services/models.service';
import { SettingsService } from '../../core/services/settings.service';
import { StorageService } from '../../core/services/storage.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="drawer">
      <header class="drawer-header">
        <h2>{{ i18n.t('settings.title') }}</h2>
        <button type="button" class="ui-btn ui-btn-sm" (click)="closed.emit()"><app-icon name="arrow-left" /> {{ i18n.t('common.back') }}</button>
      </header>

      <div class="drawer-body">
        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.account') }}</h3>
            <p class="helper">{{ i18n.t('settings.accountHelp') }}</p>
          </header>
          <p class="account-email">{{ currentUserEmail() ?? i18n.t('settings.accountUnknown') }}</p>
          <details class="password">
            <summary>{{ i18n.t('settings.changePassword') }}</summary>
            <form class="password-form" (ngSubmit)="onChangePassword()">
              <label class="ui-field"><span>{{ i18n.t('settings.currentPassword') }}</span>
                <input class="ui-input" type="password" name="old" autocomplete="current-password" [(ngModel)]="oldPassword" required />
              </label>
              <label class="ui-field"><span>{{ i18n.t('settings.newPassword') }}</span>
                <input class="ui-input" type="password" name="new" autocomplete="new-password" [(ngModel)]="newPassword" required minlength="8" />
              </label>
              <label class="ui-field"><span>{{ i18n.t('settings.confirmPassword') }}</span>
                <input class="ui-input" type="password" name="confirm" autocomplete="new-password" [(ngModel)]="confirmPassword" required />
              </label>
              <p class="helper">{{ i18n.t('settings.passwordRules') }}</p>
              @if (passwordMessage(); as m) {
                <p class="helper" [class.clear-success]="m.ok" [class.sync-error]="!m.ok" role="status">{{ m.text }}</p>
              }
              <button type="submit" class="ui-btn ui-btn-primary" [disabled]="changingPassword() || !oldPassword || !newPassword">{{ i18n.t('settings.updatePassword') }}</button>
            </form>
          </details>
          <div class="ui-actions">
            <a routerLink="/profile" class="ui-btn ui-btn-sm">{{ i18n.t('app.profile') }}</a>
            <a routerLink="/costs" class="ui-btn ui-btn-sm">{{ i18n.t('settings.costsAndBudget') }}</a>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="auth.logout()">{{ i18n.t('app.signOut') }}</button>
          </div>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.theme') }}</h3>
          </header>
          <div class="ui-chip-row" role="radiogroup" [attr.aria-label]="i18n.t('settings.theme')">
            <button type="button" role="radio" class="ui-chip" [class.active]="theme() === 'light'" [attr.aria-checked]="theme() === 'light'" (click)="setTheme('light')"><app-icon name="sun" /> {{ i18n.t('settings.themeLight') }}</button>
            <button type="button" role="radio" class="ui-chip" [class.active]="theme() === 'dark'" [attr.aria-checked]="theme() === 'dark'" (click)="setTheme('dark')"><app-icon name="moon" /> {{ i18n.t('settings.themeDark') }}</button>
          </div>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.dataBackup') }}</h3>
            <p class="helper">{{ i18n.t('settings.dataBackupHelp') }}</p>
          </header>
          <a class="ui-btn" routerLink="/backup"><app-icon name="download" /> {{ i18n.t('settings.openBackup') }}</a>
          <p class="helper">{{ i18n.t('settings.privacyNote') }}</p>
        </section>

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
          <button type="button" class="ui-btn" (click)="onSyncNow()" [disabled]="syncStatus() === 'syncing'">
            {{ syncStatus() === 'syncing' ? i18n.t('sync.syncing') : i18n.t('settings.syncNow') }}
          </button>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.defaultModel') }}</h3>
            <p class="helper">{{ i18n.t('settings.defaultModelHelp') }}</p>
          </header>
          <select
            class="ui-input"
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
            class="ui-input"
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
            <h3>{{ i18n.t('settings.importReview') }}</h3>
            <p class="helper">{{ i18n.t('settings.importReviewHelp') }}</p>
          </header>
          <label class="ui-field">
            <span>{{ i18n.t('settings.importReviewModel') }}</span>
            <select class="ui-input" [ngModel]="importReviewModel()" (ngModelChange)="settingsService.setImportReviewModel($event)" [attr.aria-label]="i18n.t('settings.importReviewModel')">
              @for (model of availableModels(); track model.id) {
                <option [value]="model.id">{{ model.displayName }}{{ model.reasoning ? ' (' + i18n.t('settings.reasoning') + ')' : '' }} — {{ model.tier }}</option>
              }
              @if (!availableHas(importReviewModel())) {
                <option [value]="importReviewModel()">{{ importReviewModel() }} ({{ i18n.t('settings.notInCurrentList') }})</option>
              }
            </select>
          </label>
          <div class="review-row">
            <label class="ui-field">
              <span>{{ i18n.t('settings.importReviewTimeout') }}</span>
              <select class="ui-input" [ngModel]="importReviewTimeoutSeconds()" (ngModelChange)="settingsService.setImportReviewTimeoutSeconds($event)" [attr.aria-label]="i18n.t('settings.importReviewTimeout')">
                @for (s of timeoutOptions; track s) {
                  <option [ngValue]="s">{{ formatWait(s) }}</option>
                }
              </select>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('settings.importReviewConcurrency') }}</span>
              <select class="ui-input" [ngModel]="importReviewConcurrency()" (ngModelChange)="settingsService.setImportReviewConcurrency($event)" [attr.aria-label]="i18n.t('settings.importReviewConcurrency')">
                @for (n of concurrencyOptions; track n) {
                  <option [ngValue]="n">{{ n }}</option>
                }
              </select>
            </label>
          </div>
          <p class="helper">{{ i18n.t('settings.importReviewCostHint') }}</p>
        </section>

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.interfaceLanguage') }}</h3>
            <p class="helper">{{ i18n.t('settings.interfaceLanguageHelp') }}</p>
          </header>
          <select
            class="ui-input"
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
            class="ui-input"
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
            <h3>{{ i18n.t('settings.translationTargetLanguage') }}</h3>
            <p class="helper">{{ i18n.t('settings.translationTargetLanguageHelp') }}</p>
          </header>
          <select
            class="ui-input"
            [ngModel]="translationTargetLanguage()"
            (ngModelChange)="onTranslationTargetLanguageChange($event)"
            [attr.aria-label]="i18n.t('settings.translationTargetLanguage')"
          >
            <option value="">{{ i18n.t('settings.translationTargetAutomatic') }}</option>
            @for (lang of translationLanguages; track lang.code) {
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
            class="ui-input"
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
              class="ui-switch"
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
              class="ui-switch"
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
              class="ui-switch"
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
            <h3>{{ i18n.t('settings.headerActions') }}</h3>
            <p class="helper">{{ i18n.t('settings.headerActionsHelp') }}</p>
          </header>
          @for (id of headerActions(); track id; let i = $index, count = $count) {
            <div class="nav-order-row">
              <div class="reorder-buttons">
                <button
                  type="button"
                  class="reorder-btn"
                  [disabled]="i === 0"
                  (click)="settingsService.moveHeaderAction(id, 'up')"
                  [attr.aria-label]="i18n.t('settings.moveUp', { name: headerActionLabel(id) })"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="reorder-btn"
                  [disabled]="i === count - 1"
                  (click)="settingsService.moveHeaderAction(id, 'down')"
                  [attr.aria-label]="i18n.t('settings.moveDown', { name: headerActionLabel(id) })"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              <span class="header-action-name">{{ headerActionLabel(id) }}</span>
              <button
                type="button"
                class="ui-btn ui-btn-sm ui-btn-ghost"
                (click)="settingsService.removeHeaderAction(id)"
                [attr.aria-label]="i18n.t('settings.headerActionRemove', { name: headerActionLabel(id) })"
              ><app-icon name="x" size="14" /> {{ i18n.t('settings.headerActionRemoveShort') }}</button>
            </div>
          }
          <div class="nav-order-row fixed-action">
            <span class="header-action-name">{{ i18n.t('headerActions.settings') }}</span>
            <span class="ui-faint">{{ i18n.t('settings.headerActionAlwaysShown') }}</span>
          </div>
          @if (availableHeaderActions().length > 0) {
            <span class="ui-label">{{ i18n.t('settings.headerActionsAvailable') }}</span>
            <div class="ui-chip-row">
              @for (action of availableHeaderActions(); track action.id) {
                <button type="button" class="ui-chip" (click)="settingsService.addHeaderAction(action.id)">
                  <app-icon name="plus" size="14" /> {{ i18n.t(action.labelKey) }}
                </button>
              }
            </div>
          }
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
                  class="ui-switch"
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

        <section class="block">
          <header class="section-header">
            <h3>{{ i18n.t('settings.quizToolbar') }}</h3>
            <p class="helper">{{ i18n.t('settings.quizToolbarHelp') }}</p>
          </header>
          @for (tool of orderedQuizTools(); track tool.id; let i = $index, count = $count) {
            <div class="nav-order-row">
              <div class="reorder-buttons">
                <button
                  type="button"
                  class="reorder-btn"
                  [disabled]="i === 0"
                  (click)="onMoveQuizTool(tool.id, 'up')"
                  [attr.aria-label]="i18n.t('settings.moveUp', { name: i18n.t(tool.labelKey) })"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="reorder-btn"
                  [disabled]="i === count - 1"
                  (click)="onMoveQuizTool(tool.id, 'down')"
                  [attr.aria-label]="i18n.t('settings.moveDown', { name: i18n.t(tool.labelKey) })"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              <label class="switch-row">
                <button
                  type="button"
                  class="ui-switch"
                  [class.on]="!hiddenQuizTools().includes(tool.id)"
                  (click)="onToggleQuizTool(tool.id)"
                  role="switch"
                  [attr.aria-checked]="!hiddenQuizTools().includes(tool.id)"
                  [attr.aria-label]="i18n.t('settings.showInQuizToolbar', { name: i18n.t(tool.labelKey) })"
                ><span class="thumb"></span></button>
                <span>{{ i18n.t(tool.labelKey) }}</span>
              </label>
            </div>
          }
          <div class="rows-row">
            <span class="rows-label">{{ i18n.t('settings.quizToolbarRows') }}</span>
            <div class="stepper">
              <button
                type="button"
                class="reorder-btn wide"
                [disabled]="quizToolbarRows() <= 1"
                (click)="onQuizToolbarRowsChange(quizToolbarRows() - 1)"
                [attr.aria-label]="i18n.t('settings.quizToolbarFewerRows')"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 12h14" /></svg>
              </button>
              <span class="rows-value">{{ quizToolbarRows() }}</span>
              <button
                type="button"
                class="reorder-btn wide"
                [disabled]="quizToolbarRows() >= maxQuizToolbarRows()"
                (click)="onQuizToolbarRowsChange(quizToolbarRows() + 1)"
                [attr.aria-label]="i18n.t('settings.quizToolbarMoreRows')"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
          </div>
          <p class="helper">{{ i18n.t('settings.quizToolbarRowsHelp') }}</p>
        </section>

      </div>

    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .drawer {
        display: flex;
        flex-direction: column;
        background: var(--bg-surface);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
      }
      .password summary {
        cursor: pointer;
        font-weight: 600;
        color: var(--color-blue);
      }
      .password-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        max-width: 360px;
        margin-top: var(--space-sm);
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
      .block > .ui-btn {
        align-self: flex-start;
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
      .review-row {
        display: grid;
        gap: var(--space-sm);
        grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
      }
      .account-email {
        font-size: var(--font-size-base);
        font-weight: 600;
        color: var(--text-primary);
      }
      .sync-error {
        font-size: var(--font-size-sm);
        color: var(--color-red);
        line-height: 1.45;
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
      .reorder-btn.wide {
        width: 28px;
        height: 24px;
      }
      .header-action-name {
        flex: 1;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .fixed-action {
        padding-left: calc(24px + var(--space-sm));
      }
      .rows-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        margin-top: var(--space-sm);
      }
      .rows-label {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .stepper {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .rows-value {
        min-width: 1.5em;
        text-align: center;
        font-size: var(--font-size-base);
        font-weight: 700;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class SettingsComponent {
  private readonly settings = inject(SettingsService);
  private readonly modelsService = inject(ModelsService);
  private readonly storage = inject(StorageService);
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);

  protected readonly currentUserEmail = this.auth.currentUserEmail;

  protected readonly theme = this.settings.theme;
  protected oldPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected readonly changingPassword = signal(false);
  protected readonly passwordMessage = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly outputLanguages = OUTPUT_LANGUAGES;
  // Excludes OUTPUT_LANGUAGES' own "Same as input (default)" entry — this
  // dropdown already has its own "Automatic" option (empty-string value,
  // rendered as its own <option> above) with different, translate-specific
  // semantics (interface language, falling back away from the question's
  // own detected language — see resolveTranslationTargetCode).
  protected readonly translationLanguages = OUTPUT_LANGUAGES.filter((l) => l.code !== '');
  protected readonly interfaceLanguages = INTERFACE_LANGUAGES;
  protected readonly navItems = NAV_ITEMS;
  protected readonly orderedNavItems = this.settings.orderedNavItems;
  protected readonly orderedQuizTools = this.settings.orderedQuizTools;
  /** Asking for more rows than there are visible buttons would leave an empty
   * row, so the stepper stops at the point where every row still gets one
   * button (the same rule splitQuizToolRows enforces at render time). */
  protected readonly maxQuizToolbarRows = computed(() => {
    const hidden = this.settings.hiddenQuizTools();
    const visible = this.orderedQuizTools().filter((tool) => !hidden.includes(tool.id)).length;
    return Math.max(1, Math.min(MAX_QUIZ_TOOLBAR_ROWS, visible));
  });

  readonly closed = output<void>();

  protected readonly headerActions = this.settings.headerActions;
  protected readonly availableHeaderActions = computed(() => {
    const visible = this.headerActions();
    return HEADER_ACTIONS.filter((a) => !visible.includes(a.id));
  });

  protected headerActionLabel(id: HeaderActionId): string {
    const def = HEADER_ACTIONS.find((a) => a.id === id);
    return def ? this.i18n.t(def.labelKey) : id;
  }

  readonly availableModels = this.modelsService.models;
  readonly defaultModel = this.settings.defaultModel;
  readonly importExtractionModel = this.settings.importExtractionModel;
  protected readonly settingsService = this.settings;
  readonly importReviewModel = this.settings.importReviewModel;
  readonly importReviewTimeoutSeconds = this.settings.importReviewTimeoutSeconds;
  readonly importReviewConcurrency = this.settings.importReviewConcurrency;
  protected readonly timeoutOptions = IMPORT_REVIEW_TIMEOUT_OPTIONS;
  protected readonly concurrencyOptions = Array.from({ length: IMPORT_REVIEW_CONCURRENCY_MAX }, (_, i) => i + 1);

  formatWait(seconds: number): string {
    return seconds % 60 === 0 ? this.i18n.t('settings.minutesN', { n: seconds / 60 }) : `${seconds}s`;
  }
  readonly interfaceLanguage = this.settings.interfaceLanguage;
  readonly outputLanguage = this.settings.outputLanguage;
  readonly translationTargetLanguage = this.settings.translationTargetLanguage;
  readonly defaultReviewMode = this.settings.defaultReviewMode;
  readonly showCorrectInReview = this.settings.showCorrectInReview;
  readonly defaultTrackTime = this.settings.defaultTrackTime;
  readonly defaultUseAccommodation = this.settings.defaultUseAccommodation;
  readonly hiddenNavTabs = this.settings.hiddenNavTabs;
  readonly hiddenQuizTools = this.settings.hiddenQuizTools;
  readonly quizToolbarRows = this.settings.quizToolbarRows;

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

  setTheme(theme: 'light' | 'dark'): void {
    this.settings.setTheme(theme);
  }

  async onChangePassword(): Promise<void> {
    this.passwordMessage.set(null);
    if (this.newPassword !== this.confirmPassword) {
      this.passwordMessage.set({ ok: false, text: this.i18n.t('settings.passwordMismatch') });
      return;
    }
    this.changingPassword.set(true);
    try {
      await this.auth.changePassword(this.oldPassword, this.newPassword);
      this.oldPassword = this.newPassword = this.confirmPassword = '';
      this.passwordMessage.set({ ok: true, text: this.i18n.t('settings.passwordChanged') });
    } catch (err) {
      this.passwordMessage.set({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      this.changingPassword.set(false);
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

  onTranslationTargetLanguageChange(value: string): void {
    this.settings.setTranslationTargetLanguage(value);
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

  onToggleQuizTool(id: QuizToolId): void {
    this.settings.toggleQuizTool(id);
    // Hiding buttons can push the current row count past what is now
    // representable — clamp it instead of leaving a phantom empty row.
    const max = this.maxQuizToolbarRows();
    if (this.quizToolbarRows() > max) this.settings.setQuizToolbarRows(max);
  }

  onMoveQuizTool(id: QuizToolId, direction: 'up' | 'down'): void {
    this.settings.moveQuizTool(id, direction);
  }

  onQuizToolbarRowsChange(rows: number): void {
    this.settings.setQuizToolbarRows(Math.min(rows, this.maxQuizToolbarRows()));
  }

  isLastVisibleNavTab(id: NavTabId): boolean {
    const hidden = this.hiddenNavTabs();
    return !hidden.includes(id) && hidden.length >= this.navItems.length - 1;
  }

  availableHas(id: string): boolean {
    return this.availableModels().some((m) => m.id === id);
  }
}
