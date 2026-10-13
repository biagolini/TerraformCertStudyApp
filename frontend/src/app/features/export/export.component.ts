import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ExportService } from '../../core/services/export.service';
import { scoreAnswer } from '../../core/services/quiz.service';
import { PacksService } from '../../core/services/packs.service';
import { QuestionsService } from '../../core/services/questions.service';
import { BanksService } from '../../core/services/banks.service';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { SettingsService } from '../../core/services/settings.service';
import { StorageService } from '../../core/services/storage.service';
import { ExportBankFilter, ExportPreset, ExportSource } from '../../core/models/export-preset.model';
import { Question, correctLetters, isStarred } from '../../core/models/question.model';
import { QuizAttempt, QuizAttemptAnswer } from '../../core/models/quiz-attempt.model';
import {
  AttemptQuestionEntry,
  AttemptQuestionFilter,
  AttemptRange,
  ExportFileGroup,
  collectAttemptQuestions,
  exportFileName,
  isWrongScore,
  matchesAttemptFilter,
  planExportFiles,
  sanitizeFilePrefix,
} from '../../core/utils/export-plan.util';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { BankPickerComponent, everyBankSelected } from '../../shared/components/bank-picker.component';
import { IconComponent } from '../../shared/components/icon.component';
import { I18nService } from '../../core/i18n/i18n.service';

type BankQuestionFilter = ExportBankFilter;

/** Wait this long after the last change before saving the configuration. */
const PRESET_SAVE_DEBOUNCE_MS = 800;

/** How many planned files the summary lists before collapsing the rest into "+N more". */
const FILE_PREVIEW_LIMIT = 6;

/**
 * Export as a three-step form — 1. where the questions come from (question
 * banks OR finished mock exams, never both), 2. optional filters (status,
 * exam domains, hand-picked list), 3. how to cut the output into files — with
 * a live summary and the single download button beside it. Everything is
 * derived from signals, so the summary always shows exactly what downloads.
 */
@Component({
  selector: 'app-export',
  standalone: true,
  imports: [FormsModule, AiDisclaimerComponent, DomainBadgeComponent, BankPickerComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h2>{{ i18n.t('exportPage.title') }}</h2>
          <p>{{ i18n.t('exportPage.subtitle') }}</p>
        </div>
      </header>
      <app-ai-disclaimer [message]="i18n.t('exportPage.aiDisclaimer')" />

      <div class="layout">
        <div class="steps">
          <!-- 1 · Source -->
          <section class="ui-card step">
            <h3 class="step-title"><span class="step-num">1</span> {{ i18n.t('exportPage.sourceTitle') }}</h3>
            <div class="source-options" role="radiogroup" [attr.aria-label]="i18n.t('exportPage.sourceTitle')">
              <button type="button" class="source-option" role="radio" [class.active]="source() === 'banks'" [attr.aria-checked]="source() === 'banks'" (click)="setSource('banks')">
                <span class="source-icon"><app-icon name="layers" size="20" /></span>
                <span class="source-text">
                  <strong>{{ i18n.t('exportPage.sourceBanks') }}</strong>
                  <span>{{ i18n.t('exportPage.sourceBanksHint') }}</span>
                </span>
              </button>
              <button type="button" class="source-option" role="radio" [class.active]="source() === 'attempts'" [attr.aria-checked]="source() === 'attempts'" (click)="setSource('attempts')">
                <span class="source-icon"><app-icon name="list-checks" size="20" /></span>
                <span class="source-text">
                  <strong>{{ i18n.t('exportPage.sourceAttempts') }}</strong>
                  <span>{{ i18n.t('exportPage.sourceAttemptsHint', { count: attempts().length }) }}</span>
                </span>
              </button>
            </div>

            @if (source() === 'banks') {
              <div class="sub-head">
                <span class="ui-label">{{ i18n.t('quizSetup.banks') }}</span>
                @if (banks.banks().length > 0) {
                  <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="toggleAllBanks()">
                    {{ allBanksSelected() ? i18n.t('quizSetup.clearBanks') : i18n.t('quizSetup.selectAllBanks') }}
                  </button>
                }
              </div>
              <p class="ui-faint">{{ i18n.t('quizSetup.banksHint') }}</p>
              <app-bank-picker [selected]="selectedBanks()" (selectedChange)="onBanksChange($event)" />
            } @else {
              <div class="sub-head">
                <span class="ui-label">{{ i18n.t('exportPage.attemptsLabel') }}</span>
                @if (attempts().length > 0) {
                  <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="toggleAllAttempts()">
                    {{ allAttemptsSelected() ? i18n.t('exportPage.clearAttempts') : i18n.t('exportPage.selectAllAttempts') }}
                  </button>
                }
              </div>
              @if (attemptsService.loading() && attempts().length === 0) {
                <p class="ui-faint">{{ i18n.t('common.loading') }}</p>
              } @else if (attempts().length === 0) {
                <div class="ui-empty">
                  <h3>{{ i18n.t('exportPage.noAttemptsTitle') }}</h3>
                  <p>{{ i18n.t('exportPage.noAttemptsHint') }}</p>
                </div>
              } @else {
                <ul class="attempt-list">
                  @for (a of attemptRows(); track a.attempt.id) {
                    <li>
                      <button type="button" class="attempt-row" [class.selected]="selectedAttempts().has(a.attempt.id)" [attr.aria-pressed]="selectedAttempts().has(a.attempt.id)" (click)="toggleAttempt(a.attempt.id)">
                        <span class="check" aria-hidden="true">@if (selectedAttempts().has(a.attempt.id)) { <app-icon name="check" size="12" /> }</span>
                        <span class="attempt-main">
                          <span class="attempt-title">{{ a.attempt.mode === 'instant' ? i18n.t('quizSetup.instantFeedback') : i18n.t('quizSetup.examSimulation') }} · {{ i18n.t('quizHistory.questionCount', { count: a.attempt.answers.length }) }}</span>
                          <span class="ui-faint">
                            {{ formatDate(a.attempt.finishedAt ?? a.attempt.startedAt) }}
                            @if (a.inProgress) {
                              <span class="ui-chip ui-chip-accent in-progress">{{ i18n.t('exportPage.inProgressBadge', { answered: a.answered, total: a.attempt.answers.length }) }}</span>
                            }
                          </span>
                        </span>
                        <span class="attempt-stats">
                          <span class="stat bad" [title]="i18n.t('exportPage.wrongCount', { count: a.wrong })"><app-icon name="x" size="12" /> {{ a.wrong }}</span>
                          <span class="stat flag" [title]="i18n.t('exportPage.flaggedCount', { count: a.flagged })"><app-icon name="flag" size="12" /> {{ a.flagged }}</span>
                          @if (!a.inProgress) {
                            <span class="score">{{ formatScore(a.attempt.scorePercent) }}%</span>
                          }
                        </span>
                      </button>
                    </li>
                  }
                </ul>
              }
            }
          </section>

          <!-- 2 · Filters -->
          <section class="ui-card step">
            <div class="step-head">
              <h3 class="step-title"><span class="step-num">2</span> {{ i18n.t('exportPage.filterTitle') }}</h3>
              <button type="button" class="ui-switch" [class.on]="filterOn()" role="switch" [attr.aria-checked]="filterOn()" [attr.aria-label]="i18n.t('exportPage.filterToggle')" (click)="setFilterOn(!filterOn())"><span class="thumb"></span></button>
            </div>
            @if (!filterOn()) {
              <p class="ui-faint">{{ i18n.t('exportPage.filterOffHint') }}</p>
            } @else {
              <label class="ui-field">
                <span>{{ i18n.t('exportPage.statusFilter') }}</span>
                @if (source() === 'attempts') {
                  <select class="ui-input" [ngModel]="attemptFilter()" (ngModelChange)="setAttemptFilter($event)">
                    <option value="all">{{ i18n.t('exportPage.statusAll') }}</option>
                    <option value="wrong">{{ i18n.t('exportPage.statusWrong') }}</option>
                    <option value="flagged">{{ i18n.t('exportPage.statusFlagged') }}</option>
                    <option value="wrongOrFlagged">{{ i18n.t('exportPage.statusWrongOrFlagged') }}</option>
                  </select>
                } @else {
                  <select class="ui-input" [ngModel]="bankFilter()" (ngModelChange)="setBankFilter($event)">
                    <option value="all">{{ i18n.t('exportPage.statusAll') }}</option>
                    <option value="starred">{{ i18n.t('exportPage.statusStarred') }}</option>
                  </select>
                }
              </label>
              @if (source() === 'attempts' && attemptFilter() !== 'all') {
                <p class="ui-faint">{{ i18n.t('exportPage.wrongDefinition') }}</p>
              }
              @if (source() === 'attempts') {
                <label class="option-row check-row">
                  <input type="checkbox" [ngModel]="excludeUnanswered()" (ngModelChange)="setExcludeUnanswered($event)" />
                  <span class="option-label">{{ i18n.t('exportPage.excludeUnanswered') }}</span>
                </label>
                @if (selectedAttemptRows().length > 0) {
                  <div class="sub-head"><span class="ui-label">{{ i18n.t('exportPage.rangeTitle') }}</span></div>
                  <p class="ui-faint">{{ i18n.t('exportPage.rangeHint') }}</p>
                  <ul class="range-list">
                    @for (r of selectedAttemptRows(); track r.attempt.id) {
                      <li class="range-row">
                        <span class="range-name">
                          {{ r.attempt.mode === 'instant' ? i18n.t('quizSetup.instantFeedback') : i18n.t('quizSetup.examSimulation') }}
                          <span class="ui-faint">· {{ formatDate(r.attempt.finishedAt ?? r.attempt.startedAt) }}</span>
                        </span>
                        <span class="range-fields">
                          <label>{{ i18n.t('exportPage.rangeFrom') }}
                            <input class="ui-input range-input" type="number" min="1" [max]="r.attempt.answers.length" placeholder="1" [ngModel]="rangeOf(r.attempt.id).from" (ngModelChange)="setRange(r.attempt.id, 'from', $event)" />
                          </label>
                          <label>{{ i18n.t('exportPage.rangeTo') }}
                            <input class="ui-input range-input" type="number" min="1" [max]="r.attempt.answers.length" [placeholder]="r.attempt.answers.length" [ngModel]="rangeOf(r.attempt.id).to" (ngModelChange)="setRange(r.attempt.id, 'to', $event)" />
                          </label>
                          <span class="ui-faint">{{ i18n.t('exportPage.rangeOf', { count: r.attempt.answers.length }) }}</span>
                        </span>
                        @if (rangeInvalid(r.attempt.id)) {
                          <span class="range-warn">{{ i18n.t('exportPage.rangeInvalid') }}</span>
                        }
                      </li>
                    }
                  </ul>
                }
              }

              @if (domainChips().length > 0) {
                <div class="sub-head">
                  <span class="ui-label">{{ i18n.t('exportPage.domainsLabel') }}</span>
                  @if (effectiveDomains().size > 0) {
                    <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="setDomains(noIds)">{{ i18n.t('exportPage.allDomains') }}</button>
                  }
                </div>
                <div class="ui-chip-row">
                  @for (d of domainChips(); track d.name) {
                    <button type="button" class="ui-chip" [attr.aria-pressed]="selectedDomains().has(d.name)" (click)="toggleDomain(d.name)">{{ d.name }} · {{ d.count }}</button>
                  }
                </div>
              }

              <div class="manual-row">
                <button type="button" class="ui-btn ui-btn-sm" (click)="openPicker()" [disabled]="pool().length === 0">
                  <app-icon name="list-checks" size="16" /> {{ i18n.t('exportPage.pickManually') }}
                </button>
                @if (manual(); as m) {
                  <span class="ui-chip ui-chip-accent">{{ i18n.t('exportPage.manualActive', { count: m.size }) }}</span>
                  <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="manual.set(null)">{{ i18n.t('exportPage.resetManual') }}</button>
                }
              </div>
            }
          </section>

          <!-- 3 · Files -->
          <section class="ui-card step">
            <h3 class="step-title"><span class="step-num">3</span> {{ i18n.t('exportPage.filesTitle') }}</h3>
            <label class="ui-field">
              <span>{{ i18n.t('exportPage.fileNameLabel') }}</span>
              <input class="ui-input mono" type="text" maxlength="80" spellcheck="false" autocomplete="off" [placeholder]="i18n.t('exportPage.fileNamePlaceholder')" [ngModel]="filePrefix()" (ngModelChange)="filePrefix.set($event)" />
            </label>
            <p class="ui-faint">{{ i18n.t('exportPage.fileNameHint', { example: exampleName() }) }}</p>
            <div class="option-row">
              <button type="button" class="ui-switch" [class.on]="splitBySize()" role="switch" [attr.aria-checked]="splitBySize()" [attr.aria-label]="i18n.t('exportPage.splitBySize')" (click)="splitBySize.set(!splitBySize())"><span class="thumb"></span></button>
              <span class="option-label">{{ i18n.t('exportPage.splitBySize') }}</span>
              @if (splitBySize()) {
                <input type="number" class="ui-input size-input" min="1" max="500" [ngModel]="maxPerFile()" (ngModelChange)="setMaxPerFile($event)" [attr.aria-label]="i18n.t('exportPage.maxQuestionsPerFile')" />
                <span class="ui-faint">{{ i18n.t('exportPage.questionsPerFile') }}</span>
              }
            </div>
            <div class="option-row">
              <button type="button" class="ui-switch" [class.on]="splitByDomain()" role="switch" [attr.aria-checked]="splitByDomain()" [attr.aria-label]="i18n.t('exportPage.splitByDomain')" (click)="splitByDomain.set(!splitByDomain())"><span class="thumb"></span></button>
              <span class="option-label">{{ i18n.t('exportPage.splitByDomain') }}</span>
            </div>
            @if (splitBySize() && splitByDomain()) {
              <p class="ui-faint">{{ i18n.t('exportPage.splitCombinedHint', { max: maxPerFile() }) }}</p>
            }
            @if (source() === 'attempts') {
              <label class="option-row check-row">
                <input type="checkbox" [ngModel]="includeAnswers()" (ngModelChange)="includeAnswers.set($event)" />
                <span class="option-label">{{ i18n.t('exportPage.includeMyAnswer') }}</span>
              </label>
            }
          </section>
        </div>

        <!-- Summary -->
        <aside class="ui-card summary">
          <span class="ui-label">{{ i18n.t('exportPage.summaryTitle') }}</span>
          <div class="summary-count">
            <strong>{{ finalQuestions().length }}</strong>
            <span>{{ i18n.t('exportPage.questionsWord') }}</span>
          </div>
          @if (missingCount() > 0) {
            <p class="summary-warn">{{ i18n.t('exportPage.missingQuestions', { count: missingCount() }) }}</p>
          }
          @if (emptyReason(); as reason) {
            <p class="ui-faint">{{ reason }}</p>
          }

          @if (summaryDomains().length > 0) {
            <ul class="domain-bars">
              @for (d of summaryDomains(); track d.name) {
                <li>
                  <span class="domain-bar-name" [title]="d.name">{{ d.name }}</span>
                  <span class="domain-bar-count">{{ d.count }}</span>
                  <span class="ui-progress"><span [style.width.%]="d.share"></span></span>
                </li>
              }
            </ul>
          }

          @if (files().length > 0) {
            <div class="file-plan">
              <span class="ui-label">{{ i18n.t('exportPage.filesCount', { count: files().length }) }}</span>
              @if (files().length > 1) {
                <span class="zip-name"><app-icon name="download" size="14" /> {{ zipName() }}</span>
              }
              <ul>
                @for (f of previewFiles(); track $index) {
                  <li [title]="fileLabel(f)"><app-icon name="file-text" size="14" /> <span class="file-name">{{ fileName(f) }}</span> <span class="file-count">{{ f.questions.length }}</span></li>
                }
              </ul>
              @if (files().length > previewFiles().length) {
                <p class="ui-faint">{{ i18n.t('exportPage.moreFiles', { count: files().length - previewFiles().length }) }}</p>
              }
            </div>
          }

          <button type="button" class="ui-btn ui-btn-primary download" [disabled]="files().length === 0" (click)="download()">
            <app-icon name="download" size="16" /> {{ files().length > 1 ? i18n.t('exportPage.downloadZip') : i18n.t('exportPage.downloadMarkdown') }}
          </button>
        </aside>
      </div>
    </div>

    @if (pickerOpen()) {
      <div class="ui-modal-backdrop" (click)="closePicker()">
        <div class="ui-modal" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t('exportPage.pickerTitle')" (click)="$event.stopPropagation()">
          <div class="ui-modal-head">
            <div>
              <h2>{{ i18n.t('exportPage.pickerTitle') }}</h2>
              <p>{{ i18n.t('exportPage.pickerHint', { count: pickerDraft().size, total: pool().length }) }}</p>
            </div>
            <button type="button" class="ui-btn ui-btn-icon ui-btn-ghost" [attr.aria-label]="i18n.t('common.close')" (click)="closePicker()"><app-icon name="x" /></button>
          </div>
          <div class="ui-modal-body">
            <div class="ui-actions">
              <button type="button" class="ui-btn ui-btn-sm" (click)="pickerDraft.set(idSet(pool()))">{{ i18n.t('exportPage.pickAll') }}</button>
              <button type="button" class="ui-btn ui-btn-sm" (click)="pickerDraft.set(noIds)">{{ i18n.t('exportPage.pickNone') }}</button>
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" (click)="pickerDraft.set(idSet(autoQuestions()))">{{ i18n.t('exportPage.pickFromFilters') }}</button>
            </div>
            <ul class="pick-list">
              @for (q of pool(); track q.id; let i = $index) {
                <li>
                  <label class="pick-row" [class.selected]="pickerDraft().has(q.id)">
                    <input type="checkbox" [checked]="pickerDraft().has(q.id)" (change)="togglePick(q.id)" />
                    @if (source() === 'attempts') {
                      <span class="status-dot" [class.bad]="entryFor(q.id)?.wrong" [attr.aria-label]="entryFor(q.id)?.wrong ? i18n.t('quizResults.statusIncorrect') : i18n.t('quizResults.statusCorrect')">
                        <app-icon [name]="entryFor(q.id)?.wrong ? 'x' : 'check'" size="12" />
                      </span>
                    }
                    <span class="pick-title">{{ q.title }}</span>
                    @if (source() === 'attempts' ? entryFor(q.id)?.flagged : isStarred(q)) {
                      <span class="pick-mark" [title]="source() === 'attempts' ? i18n.t('quizRunner.markedForReview') : i18n.t('exportPage.statusStarred')">
                        <app-icon [name]="source() === 'attempts' ? 'flag' : 'star'" size="14" />
                      </span>
                    }
                    <app-domain-badge [domain]="q.domain" />
                  </label>
                </li>
              }
            </ul>
          </div>
          <div class="ui-modal-foot">
            <button type="button" class="ui-btn ui-btn-ghost" (click)="closePicker()">{{ i18n.t('common.cancel') }}</button>
            <button type="button" class="ui-btn ui-btn-primary" (click)="applyPicker()">{{ i18n.t('exportPage.applySelection', { count: pickerDraft().size }) }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      /* Full-width item of the workspace's two-column .ws-body grid. */
      :host { display: block; grid-column: 1 / -1; min-width: 0; }
      .layout { display: grid; gap: var(--space-lg); align-items: start; }
      @media (min-width: 960px) {
        .layout { grid-template-columns: minmax(0, 1fr) 320px; }
        .summary { position: sticky; top: calc(var(--header-height) + var(--space-md)); }
      }
      .steps { display: flex; flex-direction: column; gap: var(--space-md); min-width: 0; }
      .step { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg); }
      .step-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); }
      .step-title { display: flex; align-items: center; gap: var(--space-sm); font-size: var(--font-size-lg); font-weight: 700; }
      .step-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--pack-color-soft, rgba(108, 92, 231, 0.16)); color: var(--pack-color, var(--color-purple)); font-size: var(--font-size-sm); font-weight: 800; }
      .sub-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }

      .source-options { display: grid; gap: var(--space-sm); grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
      .source-option { display: flex; align-items: flex-start; gap: var(--space-md); padding: var(--space-md); border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary); text-align: left; cursor: pointer; transition: border-color var(--transition-fast), box-shadow var(--transition-fast); }
      .source-option:hover { border-color: var(--color-purple); }
      .source-option.active { border-color: var(--color-purple); box-shadow: 0 0 0 1px var(--color-purple); background: rgba(108, 92, 231, 0.06); }
      .source-icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-secondary); flex-shrink: 0; }
      .source-option.active .source-icon { background: var(--color-purple); color: #fff; }
      .source-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .source-text strong { font-size: var(--font-size-base); }
      .source-text span { font-size: var(--font-size-sm); color: var(--text-muted); }

      .attempt-list { display: flex; flex-direction: column; gap: 6px; }
      .attempt-row { display: flex; width: 100%; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-md); min-height: 52px; border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary); text-align: left; cursor: pointer; }
      .attempt-row:hover { border-color: var(--color-purple); }
      .attempt-row.selected { border-color: var(--color-purple); background: rgba(108, 92, 231, 0.08); }
      .check { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--bg-border); color: #fff; flex-shrink: 0; }
      .attempt-row.selected .check { background: var(--color-purple); border-color: var(--color-purple); }
      .attempt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .attempt-title { font-size: var(--font-size-sm); font-weight: 600; }
      .attempt-stats { display: inline-flex; align-items: center; gap: var(--space-sm); flex-shrink: 0; }
      .stat { display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-mono); font-size: var(--font-size-xs); font-weight: 700; }
      .stat.bad { color: var(--color-red); }
      .stat.flag { color: var(--color-amber); }
      .score { min-width: 52px; text-align: right; font-weight: 700; color: var(--color-purple); }

      .in-progress { margin-left: 6px; font-size: var(--font-size-xs); padding: 0 8px; }
      .range-list { display: flex; flex-direction: column; gap: 6px; }
      .range-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); }
      .range-name { font-size: var(--font-size-sm); font-weight: 600; }
      .range-fields { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
      .range-fields label { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); color: var(--text-secondary); }
      .range-input { width: 76px; min-height: 34px; }
      .range-warn { flex-basis: 100%; font-size: var(--font-size-sm); color: var(--color-amber); }
      .manual-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
      .option-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); min-height: 36px; }
      .option-label { font-size: var(--font-size-base); color: var(--text-primary); }
      .check-row { cursor: pointer; }
      .check-row input { width: 18px; height: 18px; accent-color: var(--color-purple); cursor: pointer; }
      .size-input { width: 88px; min-height: 36px; }

      .summary { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg); }
      .summary-count { display: flex; align-items: baseline; gap: var(--space-sm); }
      .summary-count strong { font-size: 36px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
      .summary-count span { color: var(--text-muted); }
      .summary-warn { font-size: var(--font-size-sm); color: var(--color-amber); }
      .domain-bars { display: flex; flex-direction: column; gap: var(--space-sm); }
      .domain-bars li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px var(--space-sm); }
      .domain-bar-name { font-size: var(--font-size-sm); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .domain-bar-count { font-family: var(--font-mono); font-size: var(--font-size-sm); font-weight: 700; }
      .domain-bars .ui-progress { grid-column: 1 / -1; }
      .file-plan { display: flex; flex-direction: column; gap: var(--space-xs); padding-top: var(--space-md); border-top: 1px solid var(--bg-border); }
      .file-plan ul { display: flex; flex-direction: column; gap: 4px; }
      .file-plan li { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 0; }
      .zip-name { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--font-size-sm); font-weight: 700; color: var(--text-primary); word-break: break-all; }
      .mono { font-family: var(--font-mono); }
      .file-name { font-family: var(--font-mono); font-size: var(--font-size-xs); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .file-count { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--text-muted); }
      .download { width: 100%; min-height: 44px; }

      .pick-list { display: flex; flex-direction: column; gap: 6px; }
      .pick-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); cursor: pointer; }
      .pick-row.selected { border-color: var(--color-purple); }
      .pick-row input { width: 16px; height: 16px; accent-color: var(--color-purple); flex-shrink: 0; }
      .status-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: var(--color-green); color: #fff; flex-shrink: 0; }
      .status-dot.bad { background: var(--color-red); }
      .pick-title { flex: 1; min-width: 0; font-size: var(--font-size-sm); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pick-mark { display: inline-flex; color: var(--color-amber); flex-shrink: 0; }
      @media (max-width: 640px) {
        .pick-row app-domain-badge { display: none; }
      }
    `,
  ],
})
export class ExportComponent {
  private readonly exportService = inject(ExportService);
  private readonly questionsService = inject(QuestionsService);
  private readonly packs = inject(PacksService);
  protected readonly banks = inject(BanksService);
  protected readonly attemptsService = inject(QuizAttemptsService);
  protected readonly i18n = inject(I18nService);
  protected readonly isStarred = isStarred;
  protected readonly noIds: ReadonlySet<string> = new Set();

  private readonly settings = inject(SettingsService);
  private readonly storage = inject(StorageService);
  /** Pack whose saved configuration is applied; saving waits for it so the
   * defaults never overwrite a stored preset before it was restored. */
  private readonly restoredFor = signal<string | null>(null);

  constructor() {
    void this.attemptsService.load();

    // Restore the certification's last export configuration once settings have loaded.
    effect(() => {
      const packId = this.packs.activePack().id;
      if (!this.storage.ready() || this.restoredFor() === packId) return;
      untracked(() => {
        const preset = this.settings.exportPreset(packId);
        if (preset) this.applyPreset(preset);
        this.restoredFor.set(packId);
      });
    });

    // Save every change (debounced) as the new "last configuration".
    let timer: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      const packId = this.restoredFor();
      const preset = this.currentPreset();
      if (!packId || packId !== this.packs.activePack().id) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.settings.saveExportPreset(packId, preset), PRESET_SAVE_DEBOUNCE_MS);
    });
    inject(DestroyRef).onDestroy(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private readonly currentPreset = computed<ExportPreset>(() => ({
    source: this.source(),
    bankIds: [...this.selectedBanks()],
    attemptIds: [...this.selectedAttempts()],
    filterOn: this.filterOn(),
    attemptFilter: this.attemptFilter(),
    bankFilter: this.bankFilter(),
    domains: [...this.selectedDomains()],
    splitBySize: this.splitBySize(),
    maxPerFile: this.maxPerFile(),
    splitByDomain: this.splitByDomain(),
    includeAnswers: this.includeAnswers(),
    excludeUnanswered: this.excludeUnanswered(),
    attemptRanges: { ...this.attemptRanges() },
    filePrefix: this.filePrefix(),
  }));

  private applyPreset(p: ExportPreset): void {
    this.source.set(p.source === 'attempts' ? 'attempts' : 'banks');
    this.selectedBanks.set(new Set(p.bankIds ?? []));
    this.selectedAttempts.set(new Set(p.attemptIds ?? []));
    this.filterOn.set(!!p.filterOn);
    this.attemptFilter.set(p.attemptFilter ?? 'wrong');
    this.bankFilter.set(p.bankFilter ?? 'all');
    this.selectedDomains.set(new Set(p.domains ?? []));
    this.splitBySize.set(!!p.splitBySize);
    this.maxPerFile.set(p.maxPerFile > 0 ? p.maxPerFile : 25);
    this.splitByDomain.set(!!p.splitByDomain);
    this.includeAnswers.set(!!p.includeAnswers);
    this.excludeUnanswered.set(!!p.excludeUnanswered);
    this.attemptRanges.set({ ...(p.attemptRanges ?? {}) });
    this.filePrefix.set(p.filePrefix ?? '');
    this.manual.set(null);
  }

  // ---- 1 · Source ----
  protected readonly source = signal<ExportSource>('banks');
  /** Empty = every bank, same rule as Quiz setup. */
  protected readonly selectedBanks = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedAttempts = signal<ReadonlySet<string>>(new Set());

  /** Mock exams of this certification, finished or still in progress, newest first. */
  protected readonly attempts = computed(() => {
    const packId = this.packs.activePack().id;
    return this.attemptsService.attempts().filter((a) => a.packId === packId);
  });
  protected readonly attemptRows = computed(() =>
    this.attempts().map((attempt) => ({
      attempt,
      inProgress: attempt.status === 'IN_PROGRESS',
      answered: attempt.answers.filter((a) => a.selected.length > 0).length,
      // In progress: count only answered questions, or every blank still ahead would read as wrong.
      wrong: attempt.answers.filter((a) => (attempt.status !== 'IN_PROGRESS' || a.selected.length > 0) && isWrongScore(gradeAnswer(a, attempt))).length,
      flagged: attempt.answers.filter((a) => a.markedForReview).length,
    })),
  );
  /** Selected mock exams in list order, for the per-exam range fields. */
  protected readonly selectedAttemptRows = computed(() => this.attemptRows().filter((r) => this.selectedAttempts().has(r.attempt.id)));
  protected readonly allBanksSelected = computed(() => everyBankSelected(this.banks.banks(), this.selectedBanks()));
  protected readonly allAttemptsSelected = computed(
    () => this.attempts().length > 0 && this.attempts().every((a) => this.selectedAttempts().has(a.id)),
  );

  // ---- 2 · Filters ----
  protected readonly filterOn = signal(false);
  protected readonly attemptFilter = signal<AttemptQuestionFilter>('wrong');
  protected readonly bankFilter = signal<BankQuestionFilter>('all');
  protected readonly selectedDomains = signal<ReadonlySet<string>>(new Set());
  /** Mock exams source: leave out questions with nothing selected. */
  protected readonly excludeUnanswered = signal(false);
  /** Mock exams source: question range per attempt, in that attempt's own numbering. */
  protected readonly attemptRanges = signal<Readonly<Record<string, { from: number | null; to: number | null }>>>({});
  /** Hand-picked question ids; null = follow the filters. Cleared whenever an upstream choice changes. */
  protected readonly manual = signal<ReadonlySet<string> | null>(null);

  // ---- 3 · Files ----
  protected readonly splitBySize = signal(false);
  protected readonly maxPerFile = signal(25);
  protected readonly splitByDomain = signal(false);
  protected readonly includeAnswers = signal(false);
  /** As typed; sanitized when used. Empty = the app's standard file names. */
  protected readonly filePrefix = signal('');

  // ---- Derived question sets ----
  private readonly attemptEntries = computed(() => {
    const chosen = this.attempts().filter((a) => this.selectedAttempts().has(a.id));
    const filtering = this.filterOn();
    return collectAttemptQuestions(chosen, {
      ranges: filtering ? (this.attemptRanges() as Record<string, AttemptRange>) : undefined,
      skipUnanswered: filtering && this.excludeUnanswered(),
      scoreOf: gradeAnswer,
    });
  });
  private readonly entryById = computed(() => new Map(this.attemptEntries().map((e) => [e.questionId, e])));

  /** Questions answered in the chosen mock exams that no longer exist in any bank — skipped. */
  protected readonly missingCount = computed(() => {
    if (this.source() !== 'attempts') return 0;
    return this.attemptEntries().filter((e) => !this.questionsService.getById(e.questionId)).length;
  });

  /** Everything the chosen source offers, before any filter. */
  protected readonly pool = computed<Question[]>(() => {
    if (this.source() === 'banks') {
      const ids = new Set(this.banks.banks().map((b) => b.id).filter((id) => this.selectedBanks().has(id)));
      const all = this.questionsService.questions();
      return ids.size === 0 ? all : all.filter((q) => ids.has(q.bankId));
    }
    return this.attemptEntries()
      .map((e) => this.questionsService.getById(e.questionId))
      .filter((q): q is Question => !!q);
  });

  /** Pool narrowed by the status select (wrong / flagged / starred). */
  private readonly statusFiltered = computed(() => {
    const pool = this.pool();
    if (!this.filterOn()) return pool;
    if (this.source() === 'banks') return this.bankFilter() === 'starred' ? pool.filter(isStarred) : pool;
    const filter = this.attemptFilter();
    const entries = this.entryById();
    return pool.filter((q) => {
      const entry = entries.get(q.id);
      return !!entry && matchesAttemptFilter(entry, filter);
    });
  });

  protected readonly domainOptions = computed(() => this.orderedDomainCounts(this.statusFiltered()));

  /** Domain chips: what the pool offers, plus any chosen domain that has no
   * match right now (shown with 0) so an active filter is never invisible. */
  protected readonly domainChips = computed(() => {
    const options = this.domainOptions();
    const shown = new Set(options.map((d) => d.name));
    const extra = [...this.effectiveDomains()].filter((d) => !shown.has(d)).map((name) => ({ name, count: 0 }));
    return [...options, ...extra];
  });

  /** Chosen domains that still exist in the exam or the pool — a restored
   * preset may name a domain that was renamed since. */
  protected readonly effectiveDomains = computed(() => {
    const known = new Set([...this.packs.activePack().domains.map((d) => d.name), ...this.pool().map((q) => q.domain)]);
    return new Set([...this.selectedDomains()].filter((d) => known.has(d)));
  });

  /** What the filters alone select. */
  protected readonly autoQuestions = computed(() => {
    const list = this.statusFiltered();
    const domains = this.effectiveDomains();
    if (!this.filterOn() || domains.size === 0) return list;
    return list.filter((q) => domains.has(q.domain));
  });

  protected readonly finalQuestions = computed(() => {
    const manual = this.filterOn() ? this.manual() : null;
    return manual ? this.pool().filter((q) => manual.has(q.id)) : this.autoQuestions();
  });

  protected readonly summaryDomains = computed(() => {
    const total = this.finalQuestions().length;
    return this.orderedDomainCounts(this.finalQuestions()).map((d) => ({
      ...d,
      share: total > 0 ? (d.count / total) * 100 : 0,
    }));
  });

  protected readonly files = computed(() =>
    planExportFiles(
      this.finalQuestions(),
      { maxPerFile: this.splitBySize() ? this.maxPerFile() : null, byDomain: this.splitByDomain() },
      this.packs.activePack().domains.map((d) => d.name),
    ),
  );
  protected readonly previewFiles = computed(() => this.files().slice(0, FILE_PREVIEW_LIMIT));

  protected readonly emptyReason = computed(() => {
    if (this.finalQuestions().length > 0) return null;
    if (this.source() === 'attempts' && this.selectedAttempts().size === 0) return this.i18n.t('exportPage.pickAttemptFirst');
    return this.i18n.t('exportPage.nothingMatches');
  });

  // ---- Source actions ----
  setSource(source: ExportSource): void {
    if (this.source() === source) return;
    this.source.set(source);
    this.manual.set(null);
  }

  onBanksChange(next: ReadonlySet<string>): void {
    this.selectedBanks.set(next);
    this.resetDownstream();
  }

  toggleAllBanks(): void {
    this.onBanksChange(this.allBanksSelected() ? new Set() : new Set(this.banks.banks().map((b) => b.id)));
  }

  toggleAttempt(id: string): void {
    const next = new Set(this.selectedAttempts());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedAttempts.set(next);
    this.resetDownstream();
  }

  toggleAllAttempts(): void {
    this.selectedAttempts.set(this.allAttemptsSelected() ? new Set() : new Set(this.attempts().map((a) => a.id)));
    this.resetDownstream();
  }

  // ---- Filter actions ----
  setFilterOn(on: boolean): void {
    this.filterOn.set(on);
    this.manual.set(null);
  }

  setAttemptFilter(value: AttemptQuestionFilter): void {
    this.attemptFilter.set(value);
    this.resetDownstream();
  }

  setExcludeUnanswered(value: boolean): void {
    this.excludeUnanswered.set(value);
    this.resetDownstream();
  }

  rangeOf(attemptId: string): { from: number | null; to: number | null } {
    return this.attemptRanges()[attemptId] ?? { from: null, to: null };
  }

  /** Empty field = no limit on that side; values are whole numbers from 1. */
  setRange(attemptId: string, bound: 'from' | 'to', value: number | string | null): void {
    const n = value === null || value === '' ? null : Math.round(Number(value));
    const clean = n !== null && Number.isFinite(n) && n >= 1 ? n : null;
    this.attemptRanges.update((all) => ({ ...all, [attemptId]: { ...this.rangeOf(attemptId), [bound]: clean } }));
    this.resetDownstream();
  }

  rangeInvalid(attemptId: string): boolean {
    const r = this.rangeOf(attemptId);
    return r.from !== null && r.to !== null && r.from > r.to;
  }

  setBankFilter(value: BankQuestionFilter): void {
    this.bankFilter.set(value);
    this.resetDownstream();
  }

  toggleDomain(name: string): void {
    const next = new Set(this.selectedDomains());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.setDomains(next);
  }

  setDomains(next: ReadonlySet<string>): void {
    this.selectedDomains.set(next);
    this.manual.set(null);
  }

  setMaxPerFile(value: number): void {
    if (!Number.isFinite(value)) return;
    this.maxPerFile.set(Math.max(1, Math.min(500, Math.round(value))));
  }

  /** Hand-picked questions belong to one exact set of choices — start them over.
   * Domains are kept, so switching to the next mock exam keeps the same filter. */
  private resetDownstream(): void {
    this.manual.set(null);
  }

  // ---- Manual picker ----
  protected readonly pickerOpen = signal(false);
  protected readonly pickerDraft = signal<ReadonlySet<string>>(new Set());

  openPicker(): void {
    this.pickerDraft.set(this.idSet(this.finalQuestions()));
    this.pickerOpen.set(true);
  }

  closePicker(): void {
    this.pickerOpen.set(false);
  }

  togglePick(id: string): void {
    const next = new Set(this.pickerDraft());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.pickerDraft.set(next);
  }

  applyPicker(): void {
    this.manual.set(this.pickerDraft());
    this.pickerOpen.set(false);
  }

  idSet(questions: readonly Question[]): ReadonlySet<string> {
    return new Set(questions.map((q) => q.id));
  }

  entryFor(id: string): AttemptQuestionEntry | undefined {
    return this.entryById().get(id);
  }

  // ---- Download ----
  /** The user's own prefix, sanitized; empty = standard names. */
  protected readonly prefix = computed(() => sanitizeFilePrefix(this.filePrefix()));

  /** Shows how a custom name expands for the current split, using a neutral example name. */
  protected readonly exampleName = computed(() =>
    exportFileName(this.prefix() || 'my-export', { part: 1, totalParts: this.splitBySize() ? 2 : 1 }, this.splitByDomain() ? 3 : null),
  );

  protected readonly zipName = computed(() => {
    if (this.prefix()) return `${this.prefix()}.zip`;
    const pack = this.packs.activePack();
    const split = this.splitByDomain() ? 'by-domain' : `${this.files().length}-parts`;
    return this.exportService.buildFilename(pack.name, `${this.standardSuffix()}-${split}`, pack.version).replace(/\.md$/, '.zip');
  });

  download(): void {
    const files = this.files();
    if (files.length === 0) return;
    const pack = this.packs.activePack();
    const appendix = this.source() === 'attempts' && this.includeAnswers() ? this.answerAppendix() : undefined;

    if (files.length === 1) {
      const [f] = files;
      const content = this.exportService.buildMarkdownContent(f.questions, 1, 1, pack, appendix);
      this.exportService.downloadFile(content, this.fileName(f));
      return;
    }

    const out = files.map((f) => ({
      content: this.exportService.buildMarkdownContent(f.questions, f.part, f.totalParts, pack, appendix),
      filename: this.fileName(f),
    }));
    void this.exportService.downloadZip(out, this.zipName());
  }

  /** Custom prefix → short `<prefix>[-dN][-p-of-t].md`; none → the app's standard names
   * (`<certification>[-<version>]-<what>[-part-p-of-t].md`, or `domain-N-<domain>[-<version>]…` per domain). */
  fileName(f: ExportFileGroup): string {
    const prefix = this.prefix();
    if (prefix) return exportFileName(prefix, f, f.domain ? this.domainNumber(f.domain) : null);
    const pack = this.packs.activePack();
    const part = f.totalParts > 1 ? `-part-${f.part}-of-${f.totalParts}` : '';
    if (f.domain) {
      const domain = pack.domains.find((d) => d.name === f.domain) ?? { name: f.domain, description: '' };
      return this.exportService.buildDomainFilename(domain, pack.version, part);
    }
    return this.exportService.buildFilename(pack.name, `${this.standardSuffix()}${part}`, pack.version);
  }

  /** What was exported, as in the standard names: "all", "starred", "mock-exams", "wrong", "flagged", "wrong-flagged". */
  private standardSuffix(): string {
    if (this.source() === 'banks') return this.filterOn() && this.bankFilter() === 'starred' ? 'starred' : 'all';
    const filter = this.filterOn() ? this.attemptFilter() : 'all';
    return { all: 'mock-exams', wrong: 'wrong', flagged: 'flagged', wrongOrFlagged: 'wrong-flagged' }[filter];
  }

  /** Readable label for the file's tooltip: domain and part. */
  fileLabel(f: ExportFileGroup): string {
    const domain = f.domain ?? this.i18n.t('exportPage.allDomainsFile');
    return f.totalParts > 1 ? `${domain} · ${f.part}/${f.totalParts}` : domain;
  }

  formatDate(ms: number): string {
    return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  formatScore(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  /** The domain's official number: its `order`, else its position in the exam's list, else after the known ones. */
  private domainNumber(domain: string): number {
    const domains = this.packs.activePack().domains;
    const index = domains.findIndex((d) => d.name === domain);
    if (index >= 0) return domains[index].order ?? index + 1;
    const extra = this.orderedDomainCounts(this.finalQuestions()).map((d) => d.name).filter((n) => !domains.some((d) => d.name === n));
    return domains.length + extra.indexOf(domain) + 1;
  }

  /** "#### My answers" block per question: one line per attempt it appeared in. */
  private answerAppendix(): Map<string, string> {
    const map = new Map<string, string>();
    for (const q of this.finalQuestions()) {
      const entry = this.entryById().get(q.id);
      if (!entry) continue;
      const correct = correctLetters(q).join(', ') || '—';
      const lines = entry.answers.map((a) => {
        const date = new Date(a.at).toISOString().slice(0, 10);
        const mine = a.selected.length > 0 ? a.selected.join(', ') : '(no answer)';
        const verdict = a.score >= 1 ? 'correct' : a.score > 0 ? `partial, ${Math.round(a.score * 100)}%` : 'incorrect';
        return `- ${date}: ${mine} — ${verdict}`;
      });
      map.set(q.id, ['#### My answers:', `Correct: ${correct}`, '', ...lines].join('\n'));
    }
    return map;
  }

  /** Domain counts in the exam's official domain order, unknown domains last. */
  private orderedDomainCounts(questions: readonly Question[]): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const q of questions) counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
    const order = this.packs.activePack().domains.map((d) => d.name).filter((n) => counts.has(n));
    for (const n of counts.keys()) if (!order.includes(n)) order.push(n);
    return order.map((name) => ({ name, count: counts.get(name)! }));
  }
}

/** An answer's score; an exam-mode attempt still in progress has not been
 * graded yet, so grade it now from its saved answer key, with the same
 * partial-credit rule the attempt runs under. */
function gradeAnswer(answer: QuizAttemptAnswer, attempt: QuizAttempt): number {
  if (attempt.status !== 'IN_PROGRESS' || answer.checked) return answer.score;
  return scoreAnswer(answer.correctLetters, answer.selected, attempt.partialCredit);
}
