import { IconComponent } from '../../shared/components/icon.component';
import { TutorDialogComponent } from '../tutor/tutor-dialog.component';
import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { correctLetters, Question } from '../../core/models/question.model';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { resolveSelectionBlock } from '../../core/utils/text-range.util';
import { formatQuestionForCopy } from '../../core/utils/question-copy.util';
import { resolveTranslationTargetLabel } from '../../core/utils/translate-prompt.util';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { QuizAnnotatedTextComponent } from './quiz-annotated-text.component';
import { formatClock, QuizService } from '../../core/services/quiz.service';
import { splitQuizToolRows } from '../../core/models/quiz-tool.model';
import { ViewportService } from '../../core/services/viewport.service';
import { BedrockService, TranslatedReviewContent } from '../../core/services/bedrock.service';
import { QuestionsService } from '../../core/services/questions.service';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-quiz-runner',
  standalone: true,
  imports: [IconComponent, AiDisclaimerComponent, DomainBadgeComponent, MarkdownRendererComponent, QuizAnnotatedTextComponent, FormsModule, TutorDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (question(); as q) {
      <section class="runner" [class.with-tutor]="tutorOpen()">
        <header class="runner-header">
          <div class="ui-progress bar"><span [style.width.%]="progressPct()"></span></div>
          <span class="progress-text">{{ i18n.t('importReview.questionOf', { current: progress().index + 1, total: progress().total }) }}</span>
          @if (clock(); as c) {
            @if (isInstant()) {
              <!-- Per-question countdown; once it passes zero it counts the overtime up. -->
              <button
                type="button"
                class="clock-pill clock-btn"
                [class.overtime]="c.overtime"
                [disabled]="answer().checked"
                (click)="resetTimeConfirm.set(true)"
                [title]="questionClockTitle(c)"
                [attr.aria-label]="questionClockTitle(c)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                {{ clockLabel(c) }}
              </button>
            } @else {
              <span class="clock-pill" [class.overtime]="c.overtime">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                {{ clockLabel(c) }}
              </span>
            }
            <button
              type="button"
              class="pause-btn"
              (click)="quiz.paused() ? quiz.unpause() : quiz.pause()"
              [attr.aria-label]="quiz.paused() ? i18n.t('quizRunner.resume') : i18n.t('quizRunner.pause')"
            >
              @if (quiz.paused()) {
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
              } @else {
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>
              }
            </button>
          }
          @if (isInstant()) {
            <span class="score-pill">{{ i18n.t('quizRunner.score', { percent: formatPercent(), correct: score().correct, answered: score().answered }) }}</span>
          }
        </header>
        @if (clockUnavailable()) {
          <p class="clock-unavailable">
            <app-icon name="clock" size="14" />
            {{ i18n.t('quizRunner.clockUnavailable') }}
          </p>
        }

        <div #toolbarSentinel></div>
        @if (toolRows().length > 0) {
        <div class="annotate-toolbar" [class.stuck]="toolbarStuck()">
          @for (row of toolRows(); track $index) {
            <div class="toolbar-row">
              @for (tool of row; track tool.id) {
                @switch (tool.id) {
                  @case ('highlight') {
                    <button
                      type="button"
                      class="tool-btn"
                      (mousedown)="onToolPointerDown('Highlight', $event)"
                      (touchstart)="onToolPointerDown('Highlight', $event)"
                      (touchend)="onHighlightTouchEnd($event)"
                      (click)="onHighlightClick()"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 11l6-6 4 4-6 6m-4-4l-3 7 7-3m-4-4l4 4"/></svg>
                      <span>{{ i18n.t('quizRunner.highlight') }}</span>
                    </button>
                  }
                  @case ('strikethrough') {
                    <button
                      type="button"
                      class="tool-btn"
                      (mousedown)="onToolPointerDown('Strikethrough', $event)"
                      (touchstart)="onToolPointerDown('Strikethrough', $event)"
                      (touchend)="onStrikethroughTouchEnd($event)"
                      (click)="onStrikethroughClick()"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 12h16M8 12c0-2 1.5-4 4-4s4 1 4 2M8 12c0 2 1.5 5 4 5 2.5 0 3.5-1.3 4-2.5"/></svg>
                      <span>{{ i18n.t('quizRunner.strikethrough') }}</span>
                    </button>
                  }
                  @case ('clearMarks') {
                    <button
                      type="button"
                      class="tool-btn"
                      [disabled]="!quiz.hasCurrentMarks()"
                      (click)="onClearMarksClick()"
                      [attr.aria-label]="i18n.t('quizRunner.clearMarksAriaLabel')"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 20H9l-6-6a2 2 0 010-2.8L12.6 2.6a2 2 0 012.8 0l5.7 5.7a2 2 0 010 2.8L14 18"/></svg>
                      <span>{{ i18n.t('quizRunner.clearMarks') }}</span>
                    </button>
                  }
                  @case ('note') {
                    <button type="button" class="tool-btn" [class.active]="noteOpen()" (click)="onNoteToggleClick()">
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v11H8l-4 4V5z"/></svg>
                      <span>{{ i18n.t('quizRunner.note') }}</span>
                    </button>
                  }
                  @case ('translate') {
                    <button
                      type="button"
                      class="tool-btn"
                      [class.active]="showTranslated()"
                      [disabled]="translating()"
                      (click)="onToggleTranslate(q)"
                      [attr.aria-pressed]="showTranslated()"
                      [title]="showTranslated() ? i18n.t('reviewViewer.showOriginal') : i18n.t('reviewViewer.translateTooltip', { language: translateTargetLabel() })"
                    >
                      @if (translating()) {
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" class="spin"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="40" stroke-linecap="round"/></svg>
                      } @else {
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 8h9M9.5 5v3M13 8a12 12 0 01-6.5 8M8 12a10.7 10.7 0 006 5M13 20l4-9 4 9M14.7 17h4.6"/></svg>
                      }
                      <span>{{ showTranslated() ? i18n.t('reviewViewer.showOriginal') : i18n.t('reviewViewer.translate') }}</span>
                    </button>
                  }
                  @case ('checkAnswer') {
                    <button
                      type="button"
                      class="tool-btn"
                      [disabled]="answer().checked || answer().selected.length === 0"
                      (click)="quiz.checkAnswer()"
                      [attr.aria-label]="i18n.t('quizRunner.checkAnswer')"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/></svg>
                      <span>{{ i18n.t('quizRunner.checkAnswer') }}</span>
                    </button>
                  }
                  @case ('nextQuestion') {
                    <button
                      type="button"
                      class="tool-btn"
                      [disabled]="isLast()"
                      (click)="quiz.next()"
                      [attr.aria-label]="i18n.t('quizRunner.nextQuestion')"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 12h13m0 0l-5-5m5 5l-5 5"/></svg>
                      <span>{{ i18n.t('importReview.next') }}</span>
                    </button>
                  }
                  @case ('pauseExam') {
                    <button
                      type="button"
                      class="tool-btn"
                      (click)="quiz.leave()"
                      [title]="i18n.t('quizRunner.pauseExamHint')"
                      [attr.aria-label]="i18n.t('quizRunner.pauseExamHint')"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 6v12M15 6v12"/></svg>
                      <span>{{ i18n.t('quizRunner.pauseExam') }}</span>
                    </button>
                  }
                }
              }
            </div>
          }
        </div>
        }
        @if (translateError()) {
          <p class="translate-error" role="alert">{{ translateError() }}</p>
        }
        @if (noteOpen()) {
          <textarea
            class="ui-input"
            [ngModel]="annotations().note"
            (ngModelChange)="quiz.setNote($event)"
            [placeholder]="i18n.t('quizRunner.notePlaceholder')"
            rows="3"
          ></textarea>
        }

        @if (showTimeUpDialog()) {
          <div class="time-up-banner">
            <p><strong>{{ i18n.t('quizRunner.timesUp') }}</strong> {{ i18n.t('quizRunner.timesUpQuestion') }}</p>
            <div class="time-up-actions">
              <button type="button" class="ui-btn" (click)="onContinuePastTime()">{{ i18n.t('quizRunner.continue') }}</button>
              <button type="button" class="ui-btn ui-btn-primary" (click)="quiz.finish()">{{ i18n.t('quizRunner.endExamNow') }}</button>
            </div>
          </div>
        }

        @if (quiz.paused()) {
          <div class="paused-banner">
            <p><strong>{{ i18n.t('quizRunner.paused') }}</strong> {{ i18n.t('quizRunner.pausedMessage') }}</p>
            <div class="time-up-actions">
              <button type="button" class="ui-btn" (click)="quiz.leave()">{{ i18n.t('quizRunner.saveAndExit') }}</button>
              <button type="button" class="ui-btn ui-btn-primary" (click)="quiz.unpause()">{{ i18n.t('quizRunner.resume') }}</button>
            </div>
          </div>
        } @else {
        <div class="runner-body">
          <div
            class="question-main"
            [class.swipe-anim]="swipeAnimating()"
            [style.transform]="swipeOffset() ? 'translateX(' + swipeOffset() + 'px)' : null"
            (touchstart)="onSwipeStart($event)"
            (touchmove)="onSwipeMove($event)"
            (touchend)="onSwipeEnd($event)"
            (touchcancel)="onSwipeCancel()"
          >
            <div class="q-domain">
              @if (showFeedback()) {
                <span
                  class="verdict-dot"
                  [class.ok]="answer().correct"
                  [class.bad]="!answer().correct"
                  [attr.aria-label]="answer().correct ? i18n.t('quizRunner.verdictCorrect') : i18n.t('quizRunner.verdictIncorrect')"
                  [title]="answer().correct ? i18n.t('quizRunner.verdictCorrect') : i18n.t('quizRunner.verdictIncorrect')"
                ></span>
              }
              @if (showFeedback()) {
                <span
                  class="time-spent"
                  [class.ok]="perQuestionBudget() > 0 && !spentOverBudget(q.id)"
                  [class.bad]="perQuestionBudget() > 0 && spentOverBudget(q.id)"
                  [title]="spentTitle(q.id)"
                  [attr.aria-label]="spentTitle(q.id)"
                >
                  <app-icon name="clock" size="14" />
                  {{ formatSpent(q.id) }}
                </span>
              }
              @if (answer().checked) {
                <app-domain-badge [domain]="q.domain" />
              }
              <button
                type="button"
                class="star-btn"
                [class.active]="isQuestionStarred()"
                (click)="onToggleStar(q.id)"
                [attr.aria-label]="isQuestionStarred() ? i18n.t('questionItem.unstar') : i18n.t('questionItem.star')"
                [attr.aria-pressed]="isQuestionStarred()"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path [attr.fill]="isQuestionStarred() ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z"/>
                </svg>
              </button>
            </div>
            <div class="q-stem">
              @if (showTranslated()) {
                <app-markdown-renderer [source]="displayStem(q)" />
              } @else {
                <app-annotated-text
                  blockId="stem"
                  [text]="q.stem"
                  [highlights]="annotations().highlights['stem'] ?? []"
                  [strikethroughs]="annotations().strikethroughs['stem'] ?? []"
                />
              }
            </div>
            @if (isMultiSelect()) {
              <p class="multi-hint">{{ i18n.t('quizRunner.selectAnswers', { count: requiredCount() }) }}</p>
            }

            @for (opt of q.alternatives; track opt.letter; let i = $index) {
              <div
                class="option-card"
                [class.selected]="isSelected(opt.letter)"
                [class.correct]="showFeedback() && opt.isCorrect"
                [class.incorrect]="showFeedback() && isSelected(opt.letter) && !opt.isCorrect"
                [class.disabled]="answer().checked"
                (click)="onSelect(opt.letter)"
              >
                <span class="option-letter">{{ opt.letter }}</span>
                <div class="option-body">
                  @if (showFeedback() && isSelected(opt.letter)) {
                    <div class="your-answer" [class.ok]="opt.isCorrect" [class.bad]="!opt.isCorrect" role="status">
                      @if (opt.isCorrect) {
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/></svg>
                      } @else {
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18"/></svg>
                      }
                      <span>{{ answerVerdictLabel(opt.isCorrect) }}</span>
                    </div>
                  }
                  <div class="option-text">
                    @if (showTranslated()) {
                      <app-markdown-renderer [source]="displayAltText(opt, i)" />
                    } @else {
                      <app-annotated-text
                        [blockId]="opt.letter"
                        [text]="opt.text"
                        [highlights]="annotations().highlights[opt.letter] ?? []"
                        [strikethroughs]="annotations().strikethroughs[opt.letter] ?? []"
                      />
                    }
                  </div>
                  @if (showFeedback() && opt.comment) {
                    <div class="option-comment">
                      <div class="option-comment-label">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
                        <span>{{ i18n.t('reviewViewer.comment') }}</span>
                      </div>
                      <app-markdown-renderer [source]="displayAltComment(opt, i)" />
                    </div>
                  }
                </div>
                @if (showFeedback() && opt.isCorrect) {
                  <span class="option-status">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="var(--color-green)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/></svg>
                  </span>
                } @else if (showFeedback() && isSelected(opt.letter)) {
                  <span class="option-status">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="var(--color-red)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18"/></svg>
                  </span>
                }
              </div>
            }

            @if (showFeedback() && q.generalComment) {
              <div class="general-comment">
                <div class="option-comment-label">
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
                  <span>{{ i18n.t('reviewViewer.generalComment') }}</span>
                </div>
                <app-markdown-renderer [source]="displayGeneralComment(q) ?? ''" />
              </div>
            }

            <div class="copy-row">
              <button
                type="button"
                class="ui-btn ui-btn-ghost ui-btn-icon copy"
                [class.done]="copyState() === 'copied'"
                (click)="onCopyQuestion(q)"
                [title]="copyTitle()"
                [attr.aria-label]="copyTitle()"
              >
                <app-icon [name]="copyState() === 'copied' ? 'check' : 'copy'" size="16" />
              </button>
              <span class="ui-sr-only" aria-live="polite">{{ copyState() === 'copied' ? i18n.t('quizRunner.copied') : copyState() === 'failed' ? i18n.t('quizRunner.copyFailed') : '' }}</span>
            </div>

            @if (showFeedback()) {
              <app-ai-disclaimer
                [tight]="true"
                [message]="i18n.t('reviewViewer.aiDisclaimerReview')"
              />
            }

            <div class="runner-actions">
              <button type="button" class="ui-btn" [disabled]="progress().index === 0" (click)="quiz.previous()">{{ i18n.t('importReview.previous') }}</button>
              <button type="button" class="ui-btn flag-btn" [class.active]="quiz.isCurrentFlagged()" (click)="quiz.toggleReviewFlag()">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 3v18M6 4h11l-3 4 3 4H6"/></svg>
                <span>{{ quiz.isCurrentFlagged() ? i18n.t('quizRunner.unmark') : i18n.t('quizRunner.markForReview') }}</span>
              </button>
              <span class="spacer"></span>
              @if (isInstant()) {
                @if (!answer().checked) {
                  <button
                    type="button"
                    class="ui-btn"
                    [disabled]="answer().selected.length === 0"
                    (click)="quiz.checkAnswer()"
                  >{{ i18n.t('quizRunner.checkAnswer') }}</button>
                  @if (!isLast()) {
                    <button type="button" class="ui-btn" (click)="quiz.next()">{{ i18n.t('importReview.next') }}</button>
                  }
                } @else {
                  <button type="button" class="ui-btn ui-btn-primary" (click)="onNextInstant()">
                    {{ isLast() ? i18n.t('quizRunner.seeResults') : i18n.t('quizRunner.nextQuestion') }}
                  </button>
                }
              } @else if (!isLast()) {
                <button type="button" class="ui-btn" (click)="quiz.next()">{{ i18n.t('importReview.next') }}</button>
              }
              <button type="button" class="ui-btn" (click)="quiz.leave()" [title]="i18n.t('quizRunner.saveAndExitHint')">{{ i18n.t('quizRunner.saveAndExit') }}</button>
              <button type="button" class="ui-btn ui-btn-danger" (click)="requestFinish()">{{ i18n.t('quizRunner.endExam') }}</button>
            </div>
            @if (isInstant()) {
              <button
                type="button"
                class="ui-btn ui-btn-sm tutor-btn"
                [disabled]="!answer().checked"
                [title]="answer().checked ? i18n.t('tutor.askHint') : i18n.t('tutor.answerFirst')"
                [attr.aria-pressed]="tutorOpen()"
                (click)="tutorOpen.set(!tutorOpen())"
              ><app-icon name="sparkles" /> {{ i18n.t('tutor.ask') }}</button>
            }
          </div>

          <aside class="palette">
            <h4>{{ i18n.t('importReview.itemNavigator') }}</h4>
            <div class="palette-filters" role="group" [attr.aria-label]="i18n.t('quizRunner.navigatorFilter')">
              @for (f of navFilters; track f) {
                <button type="button" class="ui-chip palette-filter" [class.active]="navFilter() === f" (click)="navFilter.set(f)" [attr.aria-pressed]="navFilter() === f">
                  {{ i18n.t('quizRunner.filter_' + f) }}
                </button>
              }
            </div>
            <div class="palette-grid">
              @for (cell of navCells(); track cell.index) {
                <button
                  type="button"
                  class="palette-dot"
                  [class.answered]="cell.answered"
                  [class.current]="cell.index === progress().index"
                  [class.correct]="cell.status === 'correct'"
                  [class.incorrect]="cell.status === 'incorrect'"
                  [class.overtime]="cell.overtime"
                  [attr.aria-label]="i18n.t('quizRunner.goToQuestion', { n: cell.index + 1 })"
                  (click)="quiz.goTo(cell.index)"
                >
                  {{ cell.index + 1 }}
                  @if (cell.flagged) { <span class="flag-dot" aria-hidden="true"></span> }
                </button>
              } @empty {
                <p class="palette-summary">{{ i18n.t('quizRunner.filterEmpty') }}</p>
              }
            </div>
            @if (quiz.nextUnansweredIndex() >= 0) {
              <button type="button" class="ui-btn palette-jump" (click)="quiz.goTo(quiz.nextUnansweredIndex())">
                {{ i18n.t('quizRunner.nextUnanswered') }} <app-icon name="arrow-right" />
              </button>
            }
            <div class="palette-legend">
              <div class="legend-row"><span class="legend-swatch current"></span> {{ i18n.t('importReview.currentItem') }}</div>
              <div class="legend-row"><span class="legend-swatch" style="background:var(--color-purple)"></span> {{ i18n.t('quizRunner.answered') }}</div>
              <div class="legend-row"><span class="legend-swatch outline"></span> {{ i18n.t('quizRunner.unanswered') }}</div>
              <div class="legend-row"><span class="legend-swatch outline"><span class="flag-dot" aria-hidden="true"></span></span> {{ i18n.t('quizRunner.markedForReview') }}</div>
              @if (settings().mode === 'instant') {
                <div class="legend-row"><span class="legend-swatch" style="background:var(--color-green)"></span> {{ i18n.t('quizResults.statusCorrect') }}</div>
                <div class="legend-row"><span class="legend-swatch" style="background:var(--color-red)"></span> {{ i18n.t('quizResults.statusIncorrect') }}</div>
              }
              @if (perQuestionBudget() > 0) {
                <div class="legend-row"><span class="legend-swatch outline overtime-swatch"></span> {{ i18n.t('quizRunner.overtime') }}</div>
              }
            </div>
            <p class="palette-summary">{{ i18n.t('quizRunner.answeredOfTotal', { answered: answeredCount(), total: progress().total }) }}</p>
            @if (quiz.flaggedCount() > 0) {
              <p class="palette-summary">{{ i18n.t('quizRunner.flaggedCount', { count: quiz.flaggedCount() }) }}</p>
            }
          </aside>
        </div>
        }
      </section>

      @if (debugEnabled()) {
        <div class="debug-panel">
          <div class="debug-header">
            <span>Debug log ({{ debugLog().length }})</span>
            <button type="button" (click)="debugLog.set([])">Clear</button>
          </div>
          @for (line of debugLog(); track $index) {
            <div class="debug-line">{{ line }}</div>
          }
        </div>
      }
    }
    @if (finishConfirm()) {
      <div class="finish-dialog" role="dialog" aria-modal="true" aria-labelledby="finish-title" (click)="finishConfirm.set(false)">
        <div class="finish-card" (click)="$event.stopPropagation()">
          <h3 id="finish-title">{{ i18n.t('quizRunner.finishTitle') }}</h3>
          <div class="finish-stats">
            <div><strong>{{ answeredCount() }}</strong><span>{{ i18n.t('quizRunner.answered') }}</span></div>
            <div class="blank"><strong>{{ progress().total - answeredCount() }}</strong><span>{{ i18n.t('quizRunner.blank') }}</span></div>
            <div><strong>{{ quiz.flaggedCount() }}</strong><span>{{ i18n.t('quizRunner.flagged') }}</span></div>
          </div>
          @if (progress().total - answeredCount() > 0) {
            <p class="hint">{{ i18n.t('quizRunner.finishBlankWarning', { n: progress().total - answeredCount() }) }}</p>
          }
          <div class="finish-actions">
            @if (quiz.nextUnansweredIndex() >= 0) {
              <button type="button" class="ui-btn" (click)="goToUnansweredFromDialog()">{{ i18n.t('quizRunner.goToUnanswered') }}</button>
            }
            <button type="button" class="ui-btn" (click)="finishConfirm.set(false)">{{ i18n.t('quizRunner.keepGoing') }}</button>
            <button type="button" class="ui-btn ui-btn-primary" (click)="confirmFinish()">{{ i18n.t('quizRunner.finishNow') }}</button>
          </div>
        </div>
      </div>
    }
    @if (resetTimeConfirm()) {
      <div class="finish-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-time-title" (click)="resetTimeConfirm.set(false)">
        <div class="finish-card" (click)="$event.stopPropagation()">
          <h3 id="reset-time-title">{{ i18n.t('quizRunner.resetTimeTitle') }}</h3>
          <p class="hint">{{ i18n.t('quizRunner.resetTimeMessage', { time: formatSpent(question()?.id ?? '') }) }}</p>
          <div class="finish-actions">
            <button type="button" class="ui-btn" (click)="resetTimeConfirm.set(false)">{{ i18n.t('common.cancel') }}</button>
            <button type="button" class="ui-btn ui-btn-primary" (click)="confirmResetTime()">{{ i18n.t('quizRunner.resetTimeConfirm') }}</button>
          </div>
        </div>
      </div>
    }
    @if (tutorOpen() && question(); as q) {
      <app-tutor-dialog [question]="q" [selected]="answer().selected" [locked]="!answer().checked" (closed)="tutorOpen.set(false)" />
    }
  `,
  styles: [
    `
      :host { display: block; }
      .runner { display: flex; flex-direction: column; gap: var(--space-lg); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-lg); max-width: 960px; margin: 0 auto; }
      .runner-header { display: flex; align-items: center; gap: var(--space-md); }
      .bar { flex: 1; }
      .progress-text { font-size: var(--font-size-xs); color: var(--text-muted); white-space: nowrap; }
      .score-pill { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); background: var(--bg-elevated); padding: 4px var(--space-md); border-radius: var(--radius-pill); white-space: nowrap; }
      .clock-pill { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-secondary); background: var(--bg-elevated); padding: 4px var(--space-md); border-radius: var(--radius-pill); white-space: nowrap; }
      .clock-pill.overtime { color: #fff; background: var(--color-red); }
      .copy-row { display: flex; justify-content: flex-end; margin-top: var(--space-xs); }
      .clock-unavailable { display: flex; align-items: center; gap: 6px; margin: calc(-1 * var(--space-sm)) 0 0; font-size: var(--font-size-xs); color: var(--text-muted); }
      .clock-btn { border: 1px solid transparent; font-family: var(--font-family); cursor: pointer; }
      .clock-btn:hover:not(:disabled) { border-color: var(--color-purple); }
      .clock-btn:disabled { cursor: default; }
      .time-spent { display: inline-flex; align-items: center; gap: 4px; padding: 2px var(--space-sm); border-radius: var(--radius-pill); font-size: var(--font-size-xs); font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-secondary); background: var(--bg-elevated); }
      .time-spent.ok { color: var(--color-green); background: rgba(0, 184, 148, 0.14); }
      .time-spent.bad { color: var(--color-red); background: rgba(214, 48, 49, 0.14); }
      .pause-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border-radius: 50%; border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-secondary); cursor: pointer; flex-shrink: 0; }
      .pause-btn:hover { border-color: var(--color-purple); color: var(--color-purple); }

      .paused-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-lg); border-radius: var(--radius-md); background: var(--bg-elevated); border: 1px solid var(--bg-border); }
      .paused-banner p { margin: 0; font-size: var(--font-size-sm); color: var(--text-primary); }

      /* Icon-on-top / small-label-below, evenly distributed — same shape as
       * the app's own bottom tabbar (app.component.scss's .tabbar/.tab),
       * just requested here too: keeps 5 buttons (Highlight/Strikethrough/
       * Clear marks/Note/Translate) on one row instead of wrapping to two
       * on a narrow phone screen, and frees up more vertical room for the
       * question itself. */
      .annotate-toolbar { display: flex; flex-direction: column; gap: var(--space-xs); }
      .toolbar-row { display: flex; gap: var(--space-xs); }
      /* top matches --header-height, not 0 — the page's own .app-header is
       * ALSO position:sticky/top:0/z-index:10 (app.component.scss), so
       * sticking to 0 here landed the toolbar underneath/behind the header
       * at the same offset instead of just below it. */
      .annotate-toolbar.stuck { position: sticky; top: var(--header-height); z-index: 9; background: var(--bg-surface); box-shadow: var(--shadow-sm); padding: var(--space-sm) 0; }
      .tool-btn {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-height: var(--touch-min);
        padding: var(--space-xs) 2px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-secondary);
        font-size: var(--font-size-xs);
        font-weight: 600;
        font-family: var(--font-family);
        cursor: pointer;
        text-align: center;
      }
      .tool-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
      .tool-btn:hover { border-color: var(--color-purple); color: var(--color-purple); }
      .tool-btn.active { background: var(--bg-elevated); border-color: var(--color-purple); color: var(--color-purple); }
      .tool-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .tool-btn:disabled:hover { border-color: var(--bg-border); color: var(--text-secondary); }
      .tool-btn .spin { animation: quiz-translate-spin 900ms linear infinite; }
      @keyframes quiz-translate-spin { to { transform: rotate(360deg); } }
      .translate-error { color: var(--color-red); font-size: var(--font-size-sm); margin: 0; }

      /* Temporary on-device diagnostic panel — enable with ?debug=1, remove once the
       * mobile Safari highlight/strikethrough investigation is closed out. */
      .debug-panel {
        position: fixed; left: var(--space-sm); right: var(--space-sm); bottom: var(--space-sm);
        max-height: 40vh; overflow-y: auto; background: rgba(0, 0, 0, 0.92); color: #7CFC7C;
        font-family: 'SF Mono', Menlo, monospace; font-size: 11px; line-height: 1.5;
        border-radius: var(--radius-md); padding: var(--space-sm); z-index: 999;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.15);
      }
      .debug-header { display: flex; justify-content: space-between; align-items: center; color: #fff; font-weight: 700; margin-bottom: 4px; }
      .debug-header button { background: #333; color: #fff; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; }
      .debug-line { white-space: pre-wrap; word-break: break-word; border-bottom: 1px solid rgba(255,255,255,0.08); padding: 2px 0; }
      /* Fixed light-yellow background regardless of theme, so the text color must
       * be fixed too — inheriting the theme's text color left dark-theme's light
       * text unreadable against this background. */
      :host ::ng-deep mark { background: #fde68a; color: #1a1a1a; border-radius: 2px; }
      :host ::ng-deep s { text-decoration-color: var(--color-red); }

      .time-up-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-md); border-radius: var(--radius-md); background: rgba(214, 48, 49, 0.1); border: 1px solid var(--color-red); }
      .time-up-banner p { margin: 0; font-size: var(--font-size-sm); color: var(--text-primary); }
      .time-up-actions { display: flex; gap: var(--space-sm); flex-shrink: 0; }

      .runner-body { display: flex; gap: var(--space-lg); align-items: flex-start; overflow-x: clip; }
      /* touch-action keeps vertical scrolling and pinch-zoom native while the
       * horizontal axis is left to the swipe handler (see onSwipeStart). */
      .question-main { flex: 1; min-width: 0; touch-action: pan-y pinch-zoom; will-change: transform; }
      .question-main.swipe-anim { transition: transform 180ms ease-out; }

      .q-domain { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm); }
      /* Second, at-a-glance right/wrong marker, always in the same spot in front
       * of the domain badge — a compact echo of the per-alternative feedback
       * already shown inside the question. */
      .verdict-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
      .verdict-dot.ok { background: var(--color-green); }
      .verdict-dot.bad { background: var(--color-red); }
      .star-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; background: none; color: var(--text-faint); flex-shrink: 0; }
      .star-btn:hover { color: var(--color-amber); }
      .star-btn.active { color: var(--color-amber); }
      .q-stem { font-size: var(--font-size-base); line-height: 1.55; color: var(--text-primary); margin: 0 0 var(--space-lg); }
      .multi-hint { font-size: var(--font-size-xs); color: var(--text-muted); margin: 0 0 var(--space-sm); }

      .option-card {
        display: flex; width: 100%; gap: var(--space-sm); align-items: flex-start; text-align: left;
        padding: var(--space-md); border-radius: var(--radius-md); border: 1.5px solid var(--bg-border);
        background: var(--bg-input); cursor: pointer; margin-bottom: var(--space-sm); font-family: var(--font-family);
      }
      .option-card:hover:not(.disabled) { border-color: var(--color-purple); }
      .option-card.disabled { cursor: default; }
      .option-card.selected { border-color: var(--color-purple); background: var(--bg-elevated); }
      .option-card.correct { border-color: var(--color-green); background: rgba(0, 184, 148, 0.08); }
      .option-card.incorrect { border-color: var(--color-red); background: rgba(214, 48, 49, 0.08); }
      .option-letter { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--font-size-sm); background: var(--bg-elevated); color: var(--text-secondary); flex-shrink: 0; }
      .option-card.selected .option-letter { background: var(--color-purple); color: #fff; }
      .option-card.correct .option-letter { background: var(--color-green); color: #fff; }
      .option-card.incorrect .option-letter { background: var(--color-red); color: #fff; }
      .option-body { flex: 1; min-width: 0; }
      /* Verdict banner on the alternative the user picked, so "did I get it
       * right?" is answerable without comparing the green/red borders — and,
       * in multi-select, per choice rather than for the question as a whole. */
      .your-answer { display: inline-flex; align-items: center; gap: 4px; margin: 0 0 var(--space-xs); padding: 2px var(--space-sm); border-radius: var(--radius-pill); font-size: var(--font-size-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
      .your-answer.ok { color: var(--color-green); background: rgba(0, 184, 148, 0.14); }
      .your-answer.bad { color: var(--color-red); background: rgba(214, 48, 49, 0.14); }
      .option-text { display: block; font-size: var(--font-size-base); color: var(--text-primary); line-height: 1.5; }
      .option-comment { margin: var(--space-sm) 0 0; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--bg-elevated); border-left: 2px solid var(--bg-border); font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.5; }
      .option-comment-label { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; color: var(--text-faint); font-size: var(--font-size-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
      .option-status { flex-shrink: 0; margin-top: 3px; }
      .general-comment { margin: var(--space-md) 0 0; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--bg-elevated); border-left: 2px solid var(--color-purple); font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.5; }

      .runner-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-lg); }
      .spacer { flex: 1; }
      .flag-btn { display: inline-flex; align-items: center; gap: 6px; }
      .flag-btn.active { border-color: var(--color-amber); color: var(--color-amber); background: rgba(225, 112, 85, 0.08); }

      /* 200px = 5 dots x 28px + 4 gaps x 6px + 2 x 16px padding + 2 x 1px border
       * (198px), rounded up. The old 176px left 142px of content for five 1fr
       * columns, i.e. ~23.6px each, narrower than the fixed 28px dot, so every dot
       * overflowed its cell and the last one spilled past the panel on desktop. */
      .palette { width: 200px; flex-shrink: 0; background: var(--bg-elevated); border-radius: var(--radius-md); padding: var(--space-md); border: 1px solid var(--bg-border); }
      .palette h4 { margin: 0 0 var(--space-sm); font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
      /* Fixed-width tracks spread with space-between: first and last dot sit flush
       * with the padding on both sides, so the full-width mobile panel no longer
       * leaves all the slack on the right (1fr tracks with a left-aligned 28px dot
       * inside each did exactly that). */
      .palette-grid { display: grid; grid-template-columns: repeat(5, 28px); justify-content: space-between; row-gap: 6px; column-gap: 6px; }
      .palette-dot { position: relative; width: 28px; height: 28px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-xs); font-weight: 600; background: var(--bg-input); border: 1.5px solid var(--bg-border); color: var(--text-muted); cursor: pointer; font-family: var(--font-family); }
      .palette-dot.answered { background: var(--color-purple); border-color: var(--color-purple); color: #fff; }
      .palette-dot.current { box-shadow: 0 0 0 2px var(--color-blue) inset; }
      .palette-dot .flag-dot { position: absolute; top: -3px; right: -3px; }
      .palette-filters { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--space-sm); }
      .palette-dot.correct { background: var(--color-green) !important; border-color: var(--color-green) !important; color: #fff !important; }
      .palette-dot.incorrect { background: var(--color-red) !important; border-color: var(--color-red) !important; color: #fff !important; }
      .palette-dot.overtime { box-shadow: inset 0 -3px 0 var(--color-amber); }
      .overtime-swatch { box-shadow: inset 0 -3px 0 var(--color-amber); }
      .palette-jump { width: 100%; margin-top: var(--space-sm); }
      .tutor-btn { margin-top: var(--space-sm); align-self: flex-start; }
      /* Room for the docked tutor panel (440px) on screens wide enough to show both. */
      @media (min-width: 1200px) {
        .runner.with-tutor { margin-right: 460px; }
      }
      .finish-dialog { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: var(--space-md); background: var(--overlay-bg); }
      .finish-card { width: min(420px, 100%); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); }
      .finish-card h3 { font-size: var(--font-size-lg); }
      .finish-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); text-align: center; }
      .finish-stats strong { display: block; font-size: 22px; }
      .finish-stats span { font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
      .finish-stats .blank strong { color: var(--color-amber); }
      .finish-card .hint { font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.5; }
      .finish-actions { display: flex; justify-content: flex-end; gap: var(--space-sm); flex-wrap: wrap; }
      .palette-legend { margin-top: var(--space-md); display: flex; flex-direction: column; gap: 6px; font-size: var(--font-size-xs); color: var(--text-muted); }
      .legend-row { display: flex; align-items: center; gap: 6px; }
      .legend-swatch { position: relative; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
      .legend-swatch.outline { background: var(--bg-input); border: 1.5px solid var(--bg-border); }
      .legend-swatch.current { background: transparent; border: 2px solid var(--color-blue); }
      .legend-swatch .flag-dot { position: absolute; top: -4px; right: -4px; }
      .flag-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--color-amber); border: 1px solid var(--bg-elevated); }
      .palette-summary { margin: var(--space-sm) 0 0; font-size: var(--font-size-xs); color: var(--text-muted); }

      @media (max-width: 640px) {
        .runner { padding: var(--space-md); gap: var(--space-md); }
        .runner-body { flex-direction: column; }
        .palette { width: 100%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .question-main.swipe-anim { transition: none; }
      }
      .copy { width: 32px; min-height: 32px; color: var(--text-faint); }
      .copy.done { color: var(--color-green); }
    `,
  ],
})
export class QuizRunnerComponent {
  protected readonly quiz = inject(QuizService);
  private readonly questionsService = inject(QuestionsService);
  private readonly bedrock = inject(BedrockService);
  private readonly appSettings = inject(SettingsService);
  private readonly viewport = inject(ViewportService);
  protected readonly i18n = inject(I18nService);

  protected readonly question = this.quiz.currentQuestion;
  protected readonly isQuestionStarred = computed(() => {
    const q = this.question();
    return q ? (this.questionsService.getById(q.id)?.starred ?? false) : false;
  });
  protected readonly answer = this.quiz.currentAnswer;
  protected readonly progress = this.quiz.progress;
  protected readonly score = this.quiz.score;
  private static readonly PERCENT_LOCALES: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES', it: 'it-IT' };
  protected readonly scorePercent = computed(() => {
    const s = this.score();
    return s.answered === 0 ? 0 : (s.correct / s.answered) * 100;
  });
  protected readonly answeredFlags = this.quiz.answeredFlags;
  protected readonly answeredCount = computed(() => this.answeredFlags().filter(Boolean).length);
  protected readonly reviewFlags = this.quiz.reviewFlags;
  protected readonly isMultiSelect = this.quiz.isMultiSelect;
  protected readonly requiredCount = computed(() => correctLetters(this.question() ?? { alternatives: [] }).length);

  protected readonly isInstant = computed(() => this.quiz.settings().mode === 'instant');
  protected readonly settings = this.quiz.settings;
  protected readonly instantChecked = computed(() => this.isInstant() && this.answer().checked);
  protected readonly finishConfirm = signal(false);
  protected readonly tutorOpen = signal(false);
  protected readonly navFilters = ['all', 'answered', 'unanswered', 'flagged'] as const;
  protected readonly navFilter = signal<'all' | 'answered' | 'unanswered' | 'flagged'>('all');
  protected readonly perQuestionBudget = computed(() => {
    this.quiz.settings();
    return this.quiz.clockEnabled() ? this.quiz.perQuestionSeconds() : 0;
  });
  /** Instant mode with no clock means the certification lacks a duration or an
   * official question count; say so instead of silently showing nothing. */
  protected readonly clockUnavailable = computed(() => this.isInstant() && this.clock() === null);

  /** Navigator cells: answered/flagged state, instant-mode grading, and overtime against the per-question budget. */
  protected readonly navCells = computed(() => {
    const answers = this.quiz.answerByQuestionId();
    const flags = this.reviewFlags();
    const filter = this.navFilter();
    const budget = this.perQuestionBudget();
    const instant = this.isInstant();
    return this.quiz
      .questions()
      .map((q, index) => {
        const a = answers[q.id];
        const answered = (a?.selected.length ?? 0) > 0;
        const status: 'correct' | 'incorrect' | null = instant && a?.checked ? (a.correct ? 'correct' : 'incorrect') : null;
        return { index, answered, flagged: flags[index] ?? false, status, overtime: budget > 0 && this.quiz.liveTimeSpent(q.id) > budget };
      })
      .filter((c) =>
        filter === 'all' ? true : filter === 'answered' ? c.answered : filter === 'unanswered' ? !c.answered : c.flagged,
      );
  });

  /** Ending early always confirms, showing exactly what would be submitted blank. */
  requestFinish(): void {
    this.finishConfirm.set(true);
  }

  confirmFinish(): void {
    this.finishConfirm.set(false);
    this.quiz.finish();
  }

  goToUnansweredFromDialog(): void {
    this.finishConfirm.set(false);
    this.quiz.goTo(this.quiz.nextUnansweredIndex());
  }
  protected readonly isLast = computed(() => this.progress().index === this.progress().total - 1);
  protected readonly showFeedback = computed(() => this.isInstant() && this.answer().checked);
  protected readonly progressPct = computed(() => {
    const { index, total } = this.progress();
    return total === 0 ? 0 : (index / total) * 100;
  });
  protected readonly clock = this.quiz.clock;
  protected readonly annotations = this.quiz.currentAnnotations;
  protected readonly noteOpen = signal(false);

  // Translates the whole question (stem, alternatives' text, each comment,
  // general comment) in one call. While showTranslated() is on, the stem
  // and each alternative's text switch from <app-annotated-text> (which
  // renders highlight/strikethrough marks by character offset into the
  // ORIGINAL text) to plain <app-markdown-renderer> — a translation has
  // different text/length, so those offsets would misalign if rendered
  // through the same component. Marks aren't lost: they're keyed to the
  // original text and reappear correctly the moment showTranslated() flips
  // back off. The comment/generalComment fields always used plain
  // <app-markdown-renderer> already, so they don't need this branching.
  protected readonly translatedContent = signal<TranslatedReviewContent | null>(null);
  protected readonly showTranslated = signal(false);
  protected readonly translating = signal(false);
  protected readonly translateError = signal<string | null>(null);

  private readonly toolbarSentinelRef = viewChild<{ nativeElement: HTMLElement }>('toolbarSentinel');
  protected readonly toolbarStuck = signal(false);

  /** User-configured tool set (see SettingsComponent's "Quiz toolbar" block),
   * minus the ones that don't apply in the current context. */
  protected readonly visibleTools = computed(() => {
    const hidden = new Set(this.appSettings.hiddenQuizTools());
    const instant = this.isInstant();
    return this.appSettings
      .orderedQuizTools()
      .filter((tool) => !hidden.has(tool.id))
      .filter((tool) => (tool.instantOnly ? instant : true));
  });

  /** The row split is a phone-only layout aid (the user asked for it to fit the
   * pinned toolbar on a narrow screen). On desktop there is room for every
   * button on one row, and splitting there just makes the page look like the
   * mobile layout, so the setting is ignored above the mobile breakpoint. */
  protected readonly toolRows = computed(() =>
    splitQuizToolRows(this.visibleTools(), this.viewport.isMobile() ? this.appSettings.quizToolbarRows() : 1),
  );

  /** Temporary on-device diagnostic panel for the mobile Safari highlight/
   * strikethrough investigation — the on-screen panel needs ?debug=1 in the URL,
   * but every log line always prints to console too, unconditionally, so a
   * console session alone (no query param) is enough to confirm a fresh deploy
   * is running and see click/selection activity. Remove this whole block once
   * that investigation is resolved. */
  private static readonly BUILD_MARKER = 'quiz-runner-debug-2026-09-17-c-touchend-fix';
  protected readonly debugEnabled = signal(
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1',
  );
  protected readonly debugLog = signal<string[]>([]);

  private log(msg: string): void {
    const line = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
    console.log(`[QuizRunner] ${line}`);
    if (this.debugEnabled()) {
      this.debugLog.update((prev) => [line, ...prev].slice(0, 40));
    }
  }

  onToolPointerDown(label: string, event: Event): void {
    this.log(`${event.type} on "${label}" button`);
    event.preventDefault();
  }

  onNoteToggleClick(): void {
    this.log('clicked "Note" button');
    this.noteOpen.set(!this.noteOpen());
  }

  constructor() {
    const destroyRef = inject(DestroyRef);
    console.log(`[QuizRunner] loaded — build marker: ${QuizRunnerComponent.BUILD_MARKER}`);

    effect(() => {
      this.question();
      // Translated content is per-question and must never leak across navigation.
      this.translatedContent.set(null);
      this.showTranslated.set(false);
      this.translateError.set(null);
      this.copyState.set('idle');
    });
    if (this.debugEnabled()) {
      const onSelectionChange = () => {
        const sel = document.getSelection();
        this.log(`selectionchange -> "${sel?.toString() ?? ''}" collapsed=${sel?.isCollapsed}`);
      };
      document.addEventListener('selectionchange', onSelectionChange);
      destroyRef.onDestroy(() => document.removeEventListener('selectionchange', onSelectionChange));
    }

    const onKeydown = (event: KeyboardEvent) => this.onKeydown(event);
    document.addEventListener('keydown', onKeydown);
    destroyRef.onDestroy(() => document.removeEventListener('keydown', onKeydown));

    afterNextRender(() => {
      const sentinel = this.toolbarSentinelRef()?.nativeElement;
      if (!sentinel) return;
      const observer = new IntersectionObserver(([entry]) => this.toolbarStuck.set(!entry.isIntersecting), {
        threshold: 0,
      });
      observer.observe(sentinel);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private readonly timeUpDismissed = signal(false);
  protected readonly showTimeUpDialog = computed(
    () => !this.isInstant() && this.quiz.timeLimitReachedAt() !== null && !this.timeUpDismissed(),
  );

  clockLabel(c: { remainingSeconds: number; overtime: boolean }): string {
    // The "+" tells counting-up overtime apart from a countdown at a glance.
    return (c.overtime ? '+' : '') + formatClock(Math.abs(c.remainingSeconds));
  }

  protected readonly resetTimeConfirm = signal(false);

  questionClockTitle(c: { overtime: boolean }): string {
    const budget = formatClock(this.perQuestionBudget());
    if (this.answer().checked) return this.i18n.t('quizRunner.questionClockFrozen', { budget });
    return c.overtime
      ? this.i18n.t('quizRunner.questionClockOvertime', { budget })
      : this.i18n.t('quizRunner.questionClockLeft', { budget });
  }

  confirmResetTime(): void {
    this.resetTimeConfirm.set(false);
    this.quiz.resetCurrentQuestionTime();
  }

  formatSpent(questionId: string): string {
    return formatClock(this.quiz.liveTimeSpent(questionId));
  }

  spentOverBudget(questionId: string): boolean {
    const budget = this.perQuestionBudget();
    // Compared on whole seconds, the precision the student actually sees.
    return budget > 0 && Math.round(this.quiz.liveTimeSpent(questionId)) > Math.round(budget);
  }

  spentTitle(questionId: string): string {
    const time = this.formatSpent(questionId);
    const budget = this.perQuestionBudget();
    if (budget <= 0) return this.i18n.t('quizRunner.timeSpent', { time });
    return this.i18n.t(this.spentOverBudget(questionId) ? 'quizRunner.timeSpentOver' : 'quizRunner.timeSpentWithin', {
      time,
      budget: formatClock(budget),
    });
  }

  formatPercent(): string {
    const locale = QuizRunnerComponent.PERCENT_LOCALES[this.i18n.lang()] ?? 'en-US';
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(this.scorePercent());
  }

  /** Same automatic-target resolution as ReviewViewerComponent — see
   * resolveTranslationTargetLabel. */
  protected readonly translateTargetLabel = computed(() =>
    resolveTranslationTargetLabel(this.question()?.language, this.appSettings.interfaceLanguage(), this.appSettings.translationTargetLanguage()),
  );

  /** Same toggle-and-cache behavior as ReviewViewerComponent.onToggleTranslate
   * — first click translates and caches, later clicks just flip the display,
   * no re-fetch. */
  async onToggleTranslate(question: Question): Promise<void> {
    if (this.showTranslated()) {
      this.showTranslated.set(false);
      return;
    }
    if (this.translatedContent()) {
      this.showTranslated.set(true);
      return;
    }
    const targetLanguageLabel = this.translateTargetLabel();
    this.translating.set(true);
    this.translateError.set(null);
    try {
      const result = await this.bedrock.translateReview(
        {
          stem: question.stem,
          alternatives: question.alternatives.map((a) => ({ letter: a.letter, text: a.text, comment: a.comment })),
          generalComment: question.generalComment ?? null,
        },
        targetLanguageLabel,
        new AbortController().signal,
      );
      this.translatedContent.set(result);
      this.showTranslated.set(true);
    } catch {
      this.translateError.set(this.i18n.t('reviewViewer.translateFailed'));
    } finally {
      this.translating.set(false);
    }
  }

  displayStem(question: Question): string {
    return this.showTranslated() ? this.translatedContent()?.stem ?? question.stem : question.stem;
  }

  displayAltText(opt: { letter: string; text: string }, index: number): string {
    return this.showTranslated() ? this.translatedContent()?.alternatives[index]?.text ?? opt.text : opt.text;
  }

  displayAltComment(opt: { letter: string; comment: string }, index: number): string {
    return this.showTranslated() ? this.translatedContent()?.alternatives[index]?.comment ?? opt.comment : opt.comment;
  }

  displayGeneralComment(question: Question): string | null {
    if (!this.showTranslated()) return question.generalComment ?? null;
    return this.translatedContent()?.generalComment ?? question.generalComment ?? null;
  }

  onContinuePastTime(): void {
    this.timeUpDismissed.set(true);
  }

  onToggleStar(questionId: string): void {
    this.questionsService.toggleStarred(questionId);
  }

  isSelected(letter: string): boolean {
    return this.answer().selected.includes(letter);
  }

  /** Multi-select gets "choice" wording: with several picks, a per-alternative
   * verdict is not the verdict for the question. */
  answerVerdictLabel(isCorrect: boolean): string {
    if (this.isMultiSelect()) {
      return isCorrect ? this.i18n.t('quizRunner.yourChoiceCorrect') : this.i18n.t('quizRunner.yourChoiceIncorrect');
    }
    return isCorrect ? this.i18n.t('quizRunner.yourAnswerCorrect') : this.i18n.t('quizRunner.yourAnswerIncorrect');
  }

  onSelect(letter: string): void {
    // A text-selection drag ends with a click too — don't treat that as choosing
    // this alternative, or highlighting/striking option text would also select it.
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().length > 0) return;
    this.quiz.toggleOption(letter);
  }

  /** WebKit suppresses the synthesized `click` event entirely after
   * `touchstart.preventDefault()` (needed to stop iOS from clearing the text
   * selection on tap) — confirmed live on a real iPhone via Web Inspector:
   * `touchstart` logged on every tap, `click` never followed. So the actual
   * action must run from `touchend` on touch devices; `click` stays as the
   * mouse/desktop path. This timestamp guards against double-firing on the
   * rare hybrid device where click still follows touchend. */
  private lastTouchHandledAt = 0;

  onHighlightTouchEnd(event: Event): void {
    event.preventDefault();
    this.lastTouchHandledAt = Date.now();
    this.log('touchend on "Highlight" — handling directly (click is suppressed by WebKit here)');
    this.performHighlight();
  }

  onHighlightClick(): void {
    if (Date.now() - this.lastTouchHandledAt < 500) {
      this.log('click on "Highlight" ignored — already handled via touchend');
      return;
    }
    this.performHighlight();
  }

  private performHighlight(): void {
    const sel = document.getSelection();
    this.log(`Highlight action — selection="${sel?.toString() ?? ''}" collapsed=${sel?.isCollapsed}`);
    const resolved = resolveSelectionBlock();
    this.log(
      resolved
        ? `resolveSelectionBlock -> block="${resolved.blockId}" range=${resolved.range.start}-${resolved.range.end}`
        : 'resolveSelectionBlock -> null (no mark applied)',
    );
    if (!resolved) return;
    this.quiz.toggleAnnotation('highlight', resolved.blockId, resolved.range);
    document.getSelection()?.removeAllRanges();
    this.log(`after removeAllRanges — collapsed=${document.getSelection()?.isCollapsed}`);
  }

  onStrikethroughTouchEnd(event: Event): void {
    event.preventDefault();
    this.lastTouchHandledAt = Date.now();
    this.log('touchend on "Strikethrough" — handling directly (click is suppressed by WebKit here)');
    this.performStrikethrough();
  }

  onStrikethroughClick(): void {
    if (Date.now() - this.lastTouchHandledAt < 500) {
      this.log('click on "Strikethrough" ignored — already handled via touchend');
      return;
    }
    this.performStrikethrough();
  }

  private performStrikethrough(): void {
    const sel = document.getSelection();
    this.log(`Strikethrough action — selection="${sel?.toString() ?? ''}" collapsed=${sel?.isCollapsed}`);
    const resolved = resolveSelectionBlock();
    this.log(
      resolved
        ? `resolveSelectionBlock -> block="${resolved.blockId}" range=${resolved.range.start}-${resolved.range.end}`
        : 'resolveSelectionBlock -> null (no mark applied)',
    );
    if (!resolved) return;
    this.quiz.toggleAnnotation('strike', resolved.blockId, resolved.range);
    document.getSelection()?.removeAllRanges();
    this.log(`after removeAllRanges — collapsed=${document.getSelection()?.isCollapsed}`);
  }

  onClearMarksClick(): void {
    this.log('clicked "Clear marks" button');
    this.quiz.clearAnnotations();
  }

  // ---------------------------------------------------------------------------
  // Swipe between questions (carousel style) and arrow-key navigation.
  //
  // The gesture has to coexist with text selection, which highlight and
  // strikethrough depend on: a long-press selection never moves before the
  // axis is decided, and a drag that starts while text is selected (moving a
  // selection handle) is ignored. Only a clearly horizontal drag counts.
  // ---------------------------------------------------------------------------
  protected readonly swipeOffset = signal(0);
  protected readonly swipeAnimating = signal(false);
  private swipe: { x: number; y: number; t: number; axis: 'x' | 'y' | null; width: number } | null = null;
  private static readonly SWIPE_LOCK_PX = 10;
  private static readonly SWIPE_ANIM_MS = 180;

  private canGo(direction: 'next' | 'previous'): boolean {
    const { index, total } = this.progress();
    return direction === 'next' ? index < total - 1 : index > 0;
  }

  private static hasTextSelection(): boolean {
    const sel = document.getSelection();
    return !!sel && !sel.isCollapsed && sel.toString().length > 0;
  }

  onSwipeStart(event: TouchEvent): void {
    this.swipe = null;
    if (event.touches.length !== 1 || this.swipeAnimating()) return;
    const target = event.target as HTMLElement | null;
    // Inputs keep their own gestures; wide code blocks and tables scroll sideways.
    if (target?.closest('textarea, input, select, pre, table')) return;
    const touch = event.touches[0];
    const width = (event.currentTarget as HTMLElement).getBoundingClientRect().width || window.innerWidth;
    this.swipe = { x: touch.clientX, y: touch.clientY, t: Date.now(), axis: null, width };
  }

  onSwipeMove(event: TouchEvent): void {
    const s = this.swipe;
    if (!s || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - s.x;
    const dy = touch.clientY - s.y;
    if (s.axis === null) {
      if (Math.abs(dx) < QuizRunnerComponent.SWIPE_LOCK_PX && Math.abs(dy) < QuizRunnerComponent.SWIPE_LOCK_PX) return;
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
      if (s.axis === 'x' && QuizRunnerComponent.hasTextSelection()) {
        this.swipe = null;
        return;
      }
    }
    if (s.axis !== 'x') return;
    // Rubber-band at the first/last question so the drag still feels alive.
    const blocked = !this.canGo(dx < 0 ? 'next' : 'previous');
    this.swipeOffset.set(blocked ? dx * 0.25 : dx);
  }

  onSwipeEnd(event: TouchEvent): void {
    const s = this.swipe;
    this.swipe = null;
    if (!s || s.axis !== 'x') return;
    const dx = (event.changedTouches[0]?.clientX ?? s.x) - s.x;
    const direction: 'next' | 'previous' = dx < 0 ? 'next' : 'previous';
    const flick = Date.now() - s.t < 300 && Math.abs(dx) > 40;
    if (this.canGo(direction) && (Math.abs(dx) > s.width * 0.25 || flick)) {
      this.slideTo(direction, s.width);
    } else {
      this.snapBack();
    }
  }

  onSwipeCancel(): void {
    if (this.swipe?.axis === 'x') this.snapBack();
    this.swipe = null;
  }

  private snapBack(): void {
    if (this.swipeOffset() === 0) return;
    this.swipeAnimating.set(true);
    this.swipeOffset.set(0);
    setTimeout(() => this.swipeAnimating.set(false), QuizRunnerComponent.SWIPE_ANIM_MS);
  }

  /** Slides the current question out, swaps it, and slides the new one in
   * from the opposite edge, like a photo carousel. */
  private slideTo(direction: 'next' | 'previous', width: number): void {
    const out = direction === 'next' ? -width : width;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const go = () => (direction === 'next' ? this.quiz.next() : this.quiz.previous());
    if (reduceMotion) {
      go();
      this.swipeOffset.set(0);
      return;
    }
    this.swipeAnimating.set(true);
    this.swipeOffset.set(out);
    setTimeout(() => {
      go();
      // Jump to the opposite edge without a transition, then animate to rest.
      this.swipeAnimating.set(false);
      this.swipeOffset.set(-out);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          this.swipeAnimating.set(true);
          this.swipeOffset.set(0);
          setTimeout(() => this.swipeAnimating.set(false), QuizRunnerComponent.SWIPE_ANIM_MS);
        }),
      );
    }, QuizRunnerComponent.SWIPE_ANIM_MS);
  }

  /** Left/right arrows move between questions on a keyboard, unless the user
   * is typing (note field) or a dialog is open. */
  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (this.finishConfirm() || this.resetTimeConfirm() || this.quiz.paused()) return;
    const direction = event.key === 'ArrowRight' ? 'next' : 'previous';
    if (!this.canGo(direction)) return;
    event.preventDefault();
    if (direction === 'next') this.quiz.next();
    else this.quiz.previous();
  }

  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  protected copyTitle(): string {
    if (this.copyState() === 'copied') return this.i18n.t('quizRunner.copied');
    if (this.copyState() === 'failed') return this.i18n.t('quizRunner.copyFailed');
    return this.showFeedback() ? this.i18n.t('quizRunner.copyQuestionRevealed') : this.i18n.t('quizRunner.copyQuestion');
  }

  /** Copies what is on screen: the translated text while the translation is
   * shown, and the answer and comments only once they are revealed, so a
   * copy taken mid-question never carries the answer with it. */
  async onCopyQuestion(question: Question): Promise<void> {
    const reveal = this.showFeedback();
    const text = formatQuestionForCopy(
      {
        stem: this.displayStem(question),
        alternatives: question.alternatives.map((alt, i) => ({
          letter: alt.letter,
          text: this.displayAltText(alt, i),
          isCorrect: alt.isCorrect,
          comment: reveal ? this.displayAltComment(alt, i) : '',
        })),
        generalComment: reveal ? this.displayGeneralComment(question) : null,
      },
      {
        reveal,
        selected: this.answer().selected,
        labels: {
          questionHeading: this.i18n.t('quizRunner.copyQuestionHeading'),
          optionsHeading: this.i18n.t('quizRunner.copyOptionsHeading'),
          answerHeading: this.i18n.t('quizRunner.copyAnswerHeading'),
          commentsHeading: this.i18n.t('quizRunner.copyComments'),
          studentChoseOne: this.i18n.t('quizRunner.copyStudentChoseOne'),
          studentChoseMany: this.i18n.t('quizRunner.copyStudentChoseMany'),
          correctOne: this.i18n.t('quizRunner.copyCorrectOne'),
          correctMany: this.i18n.t('quizRunner.copyCorrectMany'),
          generalComment: this.i18n.t('reviewViewer.generalComment'),
        },
      },
    );
    try {
      await navigator.clipboard.writeText(text);
      this.copyState.set('copied');
    } catch {
      // Clipboard API unavailable (insecure context or denied permission).
      this.copyState.set('failed');
    }
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
    this.copyResetTimer = setTimeout(() => this.copyState.set('idle'), 2000);
  }

  onNextInstant(): void {
    if (this.isLast()) {
      if (this.answeredCount() < this.progress().total) this.requestFinish();
      else this.quiz.finish();
    } else {
      this.quiz.next();
    }
  }
}
