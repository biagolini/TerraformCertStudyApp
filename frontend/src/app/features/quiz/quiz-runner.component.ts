import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { correctLetters, Question } from '../../core/models/question.model';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { resolveSelectionBlock } from '../../core/utils/text-range.util';
import { resolveTranslationTargetLabel } from '../../core/utils/translate-prompt.util';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { QuizAnnotatedTextComponent } from './quiz-annotated-text.component';
import { formatClock, QuizService } from '../../core/services/quiz.service';
import { BedrockService, TranslatedReviewContent } from '../../core/services/bedrock.service';
import { QuestionsService } from '../../core/services/questions.service';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-quiz-runner',
  standalone: true,
  imports: [AiDisclaimerComponent, DomainBadgeComponent, MarkdownRendererComponent, QuizAnnotatedTextComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (question(); as q) {
      <section class="runner">
        <header class="runner-header">
          <div class="progress-track"><div class="progress-fill" [style.width.%]="progressPct()"></div></div>
          <span class="progress-text">{{ i18n.t('importReview.questionOf', { current: progress().index + 1, total: progress().total }) }}</span>
          @if (clock(); as c) {
            <span class="clock-pill" [class.overtime]="c.overtime">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              {{ clockLabel(c) }}
            </span>
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

        <div #toolbarSentinel></div>
        <div class="annotate-toolbar" [class.stuck]="toolbarStuck()">
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
          <button type="button" class="tool-btn" [class.active]="noteOpen()" (click)="onNoteToggleClick()">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v11H8l-4 4V5z"/></svg>
            <span>{{ i18n.t('quizRunner.note') }}</span>
          </button>
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
        </div>
        @if (translateError()) {
          <p class="translate-error" role="alert">{{ translateError() }}</p>
        }
        @if (noteOpen()) {
          <textarea
            class="note-textarea"
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
              <button type="button" class="btn btn-ghost" (click)="onContinuePastTime()">{{ i18n.t('quizRunner.continue') }}</button>
              <button type="button" class="btn btn-primary" (click)="quiz.finish()">{{ i18n.t('quizRunner.endExamNow') }}</button>
            </div>
          </div>
        }

        @if (quiz.paused()) {
          <div class="paused-banner">
            <p><strong>{{ i18n.t('quizRunner.paused') }}</strong> {{ i18n.t('quizRunner.pausedMessage') }}</p>
            <button type="button" class="btn btn-primary" (click)="quiz.unpause()">{{ i18n.t('quizRunner.resume') }}</button>
          </div>
        } @else {
        <div class="runner-body">
          <div class="question-main">
            <div class="q-domain">
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

            @if (showFeedback()) {
              <app-ai-disclaimer
                [tight]="true"
                [message]="i18n.t('reviewViewer.aiDisclaimerReview')"
              />
            }

            <div class="runner-actions">
              <button type="button" class="btn btn-ghost" [disabled]="progress().index === 0" (click)="quiz.previous()">{{ i18n.t('importReview.previous') }}</button>
              <button type="button" class="btn btn-ghost flag-btn" [class.active]="quiz.isCurrentFlagged()" (click)="quiz.toggleReviewFlag()">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 3v18M6 4h11l-3 4 3 4H6"/></svg>
                <span>{{ quiz.isCurrentFlagged() ? i18n.t('quizRunner.unmark') : i18n.t('quizRunner.markForReview') }}</span>
              </button>
              <span class="spacer"></span>
              @if (isInstant()) {
                @if (!answer().checked) {
                  <button
                    type="button"
                    class="btn btn-ghost"
                    [disabled]="answer().selected.length === 0"
                    (click)="quiz.checkAnswer()"
                  >{{ i18n.t('quizRunner.checkAnswer') }}</button>
                  @if (!isLast()) {
                    <button type="button" class="btn btn-ghost" (click)="quiz.next()">{{ i18n.t('importReview.next') }}</button>
                  }
                } @else {
                  <button type="button" class="btn btn-primary" (click)="onNextInstant()">
                    {{ isLast() ? i18n.t('quizRunner.seeResults') : i18n.t('quizRunner.nextQuestion') }}
                  </button>
                }
              } @else if (!isLast()) {
                <button type="button" class="btn btn-ghost" (click)="quiz.next()">{{ i18n.t('importReview.next') }}</button>
              }
              <button type="button" class="btn btn-danger-outline" (click)="quiz.finish()">{{ i18n.t('quizRunner.endExam') }}</button>
            </div>
          </div>

          <aside class="palette">
            <h4>{{ i18n.t('importReview.itemNavigator') }}</h4>
            <div class="palette-grid">
              @for (flag of answeredFlags(); track $index) {
                <button
                  type="button"
                  class="palette-dot"
                  [class.answered]="flag"
                  [class.current]="$index === progress().index"
                  (click)="quiz.goTo($index)"
                >
                  {{ $index + 1 }}
                  @if (reviewFlags()[$index]) { <span class="flag-dot" aria-hidden="true"></span> }
                </button>
              }
            </div>
            <div class="palette-legend">
              <div class="legend-row"><span class="legend-swatch current"></span> {{ i18n.t('importReview.currentItem') }}</div>
              <div class="legend-row"><span class="legend-swatch" style="background:var(--color-purple)"></span> {{ i18n.t('quizRunner.answered') }}</div>
              <div class="legend-row"><span class="legend-swatch outline"></span> {{ i18n.t('quizRunner.unanswered') }}</div>
              <div class="legend-row"><span class="legend-swatch outline"><span class="flag-dot" aria-hidden="true"></span></span> {{ i18n.t('quizRunner.markedForReview') }}</div>
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
  `,
  styles: [
    `
      :host { display: block; }
      .runner { display: flex; flex-direction: column; gap: var(--space-lg); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-lg); max-width: 960px; margin: 0 auto; }
      .runner-header { display: flex; align-items: center; gap: var(--space-md); }
      .progress-track { flex: 1; height: 6px; border-radius: 999px; background: var(--bg-border); overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(135deg, var(--color-purple), var(--color-blue)); border-radius: 999px; }
      .progress-text { font-size: var(--font-size-xs); color: var(--text-muted); white-space: nowrap; }
      .score-pill { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); background: var(--bg-elevated); padding: 4px var(--space-md); border-radius: var(--radius-pill); white-space: nowrap; }
      .clock-pill { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-secondary); background: var(--bg-elevated); padding: 4px var(--space-md); border-radius: var(--radius-pill); white-space: nowrap; }
      .clock-pill.overtime { color: #fff; background: var(--color-red); }
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
      .annotate-toolbar { display: flex; gap: var(--space-xs); }
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
      .note-textarea { width: 100%; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-primary); font-family: var(--font-family); font-size: var(--font-size-sm); line-height: 1.5; resize: vertical; box-sizing: border-box; }
      .note-textarea:focus-visible { outline: none; border-color: var(--color-purple); }
      /* Fixed light-yellow background regardless of theme, so the text color must
       * be fixed too — inheriting the theme's text color left dark-theme's light
       * text unreadable against this background. */
      :host ::ng-deep mark { background: #fde68a; color: #1a1a1a; border-radius: 2px; }
      :host ::ng-deep s { text-decoration-color: var(--color-red); }

      .time-up-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-md); border-radius: var(--radius-md); background: rgba(214, 48, 49, 0.1); border: 1px solid var(--color-red); }
      .time-up-banner p { margin: 0; font-size: var(--font-size-sm); color: var(--text-primary); }
      .time-up-actions { display: flex; gap: var(--space-sm); flex-shrink: 0; }

      .runner-body { display: flex; gap: var(--space-lg); align-items: flex-start; }
      .question-main { flex: 1; min-width: 0; }

      .q-domain { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm); }
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
      .option-text { display: block; font-size: var(--font-size-base); color: var(--text-primary); line-height: 1.5; }
      .option-comment { margin: var(--space-sm) 0 0; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--bg-elevated); border-left: 2px solid var(--bg-border); font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.5; }
      .option-comment-label { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; color: var(--text-faint); font-size: var(--font-size-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
      .option-status { flex-shrink: 0; margin-top: 3px; }
      .general-comment { margin: var(--space-md) 0 0; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--bg-elevated); border-left: 2px solid var(--color-purple); font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.5; }

      .runner-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-lg); }
      .spacer { flex: 1; }
      .btn { min-height: var(--touch-min); padding: 0 var(--space-lg); border-radius: var(--radius-md); font-weight: 600; font-size: var(--font-size-base); border: none; font-family: var(--font-family); cursor: pointer; }
      .btn-primary { background: linear-gradient(135deg, var(--color-purple), var(--color-blue)); color: #ffffff; }
      .btn-primary:hover { filter: brightness(1.08); }
      .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--bg-border); }
      .btn-ghost:hover:not(:disabled) { background: var(--bg-subtle); }
      .btn-danger-outline { background: transparent; color: var(--color-red); border: 1px solid var(--color-red); }
      .btn-danger-outline:hover { background: rgba(214, 48, 49, 0.08); }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .flag-btn { display: inline-flex; align-items: center; gap: 6px; }
      .flag-btn.active { border-color: var(--color-amber); color: var(--color-amber); background: rgba(225, 112, 85, 0.08); }

      .palette { width: 176px; flex-shrink: 0; background: var(--bg-elevated); border-radius: var(--radius-md); padding: var(--space-md); border: 1px solid var(--bg-border); }
      .palette h4 { margin: 0 0 var(--space-sm); font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
      .palette-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
      .palette-dot { position: relative; width: 28px; height: 28px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-xs); font-weight: 600; background: var(--bg-input); border: 1.5px solid var(--bg-border); color: var(--text-muted); cursor: pointer; font-family: var(--font-family); }
      .palette-dot.answered { background: var(--color-purple); border-color: var(--color-purple); color: #fff; }
      .palette-dot.current { box-shadow: 0 0 0 2px var(--color-blue) inset; }
      .palette-dot .flag-dot { position: absolute; top: -3px; right: -3px; }
      .palette-legend { margin-top: var(--space-md); display: flex; flex-direction: column; gap: 6px; font-size: var(--font-size-xs); color: var(--text-muted); }
      .legend-row { display: flex; align-items: center; gap: 6px; }
      .legend-swatch { position: relative; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
      .legend-swatch.outline { background: var(--bg-input); border: 1.5px solid var(--bg-border); }
      .legend-swatch.current { background: transparent; border: 2px solid var(--color-blue); }
      .legend-swatch .flag-dot { position: absolute; top: -4px; right: -4px; }
      .flag-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--color-amber); border: 1px solid var(--bg-elevated); }
      .palette-summary { margin: var(--space-sm) 0 0; font-size: var(--font-size-xs); color: var(--text-muted); }

      @media (max-width: 640px) {
        .runner-body { flex-direction: column; }
        .palette { width: 100%; }
      }
    `,
  ],
})
export class QuizRunnerComponent {
  protected readonly quiz = inject(QuizService);
  private readonly questionsService = inject(QuestionsService);
  private readonly bedrock = inject(BedrockService);
  private readonly appSettings = inject(SettingsService);
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
    });
    if (this.debugEnabled()) {
      const onSelectionChange = () => {
        const sel = document.getSelection();
        this.log(`selectionchange -> "${sel?.toString() ?? ''}" collapsed=${sel?.isCollapsed}`);
      };
      document.addEventListener('selectionchange', onSelectionChange);
      destroyRef.onDestroy(() => document.removeEventListener('selectionchange', onSelectionChange));
    }

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
    return formatClock(Math.abs(c.remainingSeconds));
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

  onNextInstant(): void {
    if (this.isLast()) {
      this.quiz.finish();
    } else {
      this.quiz.next();
    }
  }
}
