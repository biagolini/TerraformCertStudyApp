import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { correctLetters } from '../../core/models/question.model';
import { AiDisclaimerComponent } from '../../shared/components/ai-disclaimer.component';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { resolveSelectionBlock } from '../../core/utils/text-range.util';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { QuizAnnotatedTextComponent } from './quiz-annotated-text.component';
import { formatClock, QuizService } from '../../core/services/quiz.service';

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
          <span class="progress-text">Question {{ progress().index + 1 }} of {{ progress().total }}</span>
          @if (clock(); as c) {
            <span class="clock-pill" [class.overtime]="c.overtime">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              {{ clockLabel(c) }}
            </span>
          }
          @if (isInstant()) {
            <span class="score-pill">Score {{ score().correct }}/{{ score().answered }}</span>
          }
        </header>

        <div class="annotate-toolbar">
          <button type="button" class="tool-btn" (click)="onHighlightClick()">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 11l6-6 4 4-6 6m-4-4l-3 7 7-3m-4-4l4 4"/></svg>
            <span>Highlight</span>
          </button>
          <button type="button" class="tool-btn" (click)="onStrikethroughClick()">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 12h16M8 12c0-2 1.5-4 4-4s4 1 4 2M8 12c0 2 1.5 5 4 5 2.5 0 3.5-1.3 4-2.5"/></svg>
            <span>Strikethrough</span>
          </button>
          <button type="button" class="tool-btn" [class.active]="noteOpen()" (click)="noteOpen.set(!noteOpen())">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v11H8l-4 4V5z"/></svg>
            <span>Note</span>
          </button>
        </div>
        @if (noteOpen()) {
          <textarea
            class="note-textarea"
            [ngModel]="annotations().note"
            (ngModelChange)="quiz.setNote($event)"
            placeholder="Write a note for reviewing this question later..."
            rows="3"
          ></textarea>
        }

        @if (showTimeUpDialog()) {
          <div class="time-up-banner">
            <p><strong>Time's up.</strong> Do you want to end the exam now, or keep going?</p>
            <div class="time-up-actions">
              <button type="button" class="btn btn-ghost" (click)="onContinuePastTime()">Continue</button>
              <button type="button" class="btn btn-primary" (click)="quiz.finish()">End exam now</button>
            </div>
          </div>
        }

        <div class="runner-body">
          <div class="question-main">
            <div class="q-domain"><app-domain-badge [domain]="q.domain" /></div>
            <div class="q-stem">
              <app-annotated-text
                blockId="stem"
                [text]="q.stem"
                [highlights]="annotations().highlights['stem'] ?? []"
                [strikethroughs]="annotations().strikethroughs['stem'] ?? []"
              />
            </div>
            @if (isMultiSelect()) {
              <p class="multi-hint">Select {{ requiredCount() }} answers.</p>
            }

            @for (opt of q.alternatives; track opt.letter) {
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
                    <app-annotated-text
                      [blockId]="opt.letter"
                      [text]="opt.text"
                      [highlights]="annotations().highlights[opt.letter] ?? []"
                      [strikethroughs]="annotations().strikethroughs[opt.letter] ?? []"
                    />
                  </div>
                  @if (showFeedback() && opt.comment) {
                    <div class="option-comment">
                      <div class="option-comment-label">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
                        <span>Comment</span>
                      </div>
                      <app-markdown-renderer [source]="opt.comment" />
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

            @if (showFeedback()) {
              <app-ai-disclaimer
                [tight]="true"
                message="This content was generated by AI and may contain errors. Treat it as study support, not as an authoritative source."
              />
            }

            <div class="runner-actions">
              <button type="button" class="btn btn-ghost" [disabled]="progress().index === 0" (click)="quiz.previous()">Previous</button>
              <button type="button" class="btn btn-ghost flag-btn" [class.active]="quiz.isCurrentFlagged()" (click)="quiz.toggleReviewFlag()">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 3v18M6 4h11l-3 4 3 4H6"/></svg>
                <span>{{ quiz.isCurrentFlagged() ? 'Unmark' : 'Mark for review' }}</span>
              </button>
              <span class="spacer"></span>
              @if (isInstant()) {
                @if (!answer().checked) {
                  <button
                    type="button"
                    class="btn btn-ghost"
                    [disabled]="answer().selected.length === 0"
                    (click)="quiz.checkAnswer()"
                  >Check answer</button>
                  @if (!isLast()) {
                    <button type="button" class="btn btn-ghost" (click)="quiz.next()">Next</button>
                  }
                } @else {
                  <button type="button" class="btn btn-primary" (click)="onNextInstant()">
                    {{ isLast() ? 'See results' : 'Next question' }}
                  </button>
                }
              } @else if (!isLast()) {
                <button type="button" class="btn btn-ghost" (click)="quiz.next()">Next</button>
              }
              <button type="button" class="btn btn-danger-outline" (click)="quiz.finish()">End exam</button>
            </div>
          </div>

          <aside class="palette">
            <h4>Item Navigator</h4>
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
              <div class="legend-row"><span class="legend-swatch current"></span> Current item</div>
              <div class="legend-row"><span class="legend-swatch" style="background:var(--color-purple)"></span> Answered</div>
              <div class="legend-row"><span class="legend-swatch outline"></span> Unanswered</div>
              <div class="legend-row"><span class="legend-swatch outline"><span class="flag-dot" aria-hidden="true"></span></span> Marked for review</div>
            </div>
            <p class="palette-summary">{{ answeredCount() }} of {{ progress().total }} answered</p>
            @if (quiz.flaggedCount() > 0) {
              <p class="palette-summary">{{ quiz.flaggedCount() }} marked for review</p>
            }
          </aside>
        </div>
      </section>
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

      .annotate-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
      .tool-btn { display: inline-flex; align-items: center; gap: var(--space-xs); padding: 0 var(--space-md); min-height: 34px; border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: 600; font-family: var(--font-family); cursor: pointer; }
      .tool-btn:hover { border-color: var(--color-purple); color: var(--color-purple); }
      .tool-btn.active { background: var(--bg-elevated); border-color: var(--color-purple); color: var(--color-purple); }
      .note-textarea { width: 100%; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-primary); font-family: var(--font-family); font-size: var(--font-size-sm); line-height: 1.5; resize: vertical; box-sizing: border-box; }
      .note-textarea:focus-visible { outline: none; border-color: var(--color-purple); }
      :host ::ng-deep mark { background: #fde68a; color: inherit; border-radius: 2px; }
      :host ::ng-deep s { text-decoration-color: var(--color-red); }

      .time-up-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-md); border-radius: var(--radius-md); background: rgba(214, 48, 49, 0.1); border: 1px solid var(--color-red); }
      .time-up-banner p { margin: 0; font-size: var(--font-size-sm); color: var(--text-primary); }
      .time-up-actions { display: flex; gap: var(--space-sm); flex-shrink: 0; }

      .runner-body { display: flex; gap: var(--space-lg); align-items: flex-start; }
      .question-main { flex: 1; min-width: 0; }

      .q-domain { margin-bottom: var(--space-sm); }
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

  protected readonly question = this.quiz.currentQuestion;
  protected readonly answer = this.quiz.currentAnswer;
  protected readonly progress = this.quiz.progress;
  protected readonly score = this.quiz.score;
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

  private readonly timeUpDismissed = signal(false);
  protected readonly showTimeUpDialog = computed(
    () => !this.isInstant() && this.quiz.timeLimitReachedAt() !== null && !this.timeUpDismissed(),
  );

  clockLabel(c: { remainingSeconds: number; overtime: boolean }): string {
    return formatClock(Math.abs(c.remainingSeconds));
  }

  onContinuePastTime(): void {
    this.timeUpDismissed.set(true);
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

  onHighlightClick(): void {
    const resolved = resolveSelectionBlock();
    if (!resolved) return;
    this.quiz.toggleAnnotation('highlight', resolved.blockId, resolved.range);
    document.getSelection()?.removeAllRanges();
  }

  onStrikethroughClick(): void {
    const resolved = resolveSelectionBlock();
    if (!resolved) return;
    this.quiz.toggleAnnotation('strike', resolved.blockId, resolved.range);
    document.getSelection()?.removeAllRanges();
  }

  onNextInstant(): void {
    if (this.isLast()) {
      this.quiz.finish();
    } else {
      this.quiz.next();
    }
  }
}
