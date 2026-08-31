import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { formatClock, QuizService } from '../../core/services/quiz.service';
import { QuizAnnotatedTextComponent } from './quiz-annotated-text.component';

@Component({
  selector: 'app-quiz-history',
  standalone: true,
  imports: [QuizAnnotatedTextComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="history-card">
      <header class="card-header">
        <div>
          <h2>Quiz history</h2>
          <p class="subtitle">Every finished practice quiz, most recent first.</p>
        </div>
        <button type="button" class="btn btn-ghost" (click)="quiz.reset()">Back to setup</button>
      </header>

      @if (attemptsService.loading()) {
        <p class="empty-hint">Loading…</p>
      } @else if (attempts().length === 0) {
        <p class="empty-hint">No quiz attempts yet. Finish a practice quiz to see it here.</p>
      } @else {
        <div class="attempt-list">
          @for (attempt of attempts(); track attempt.id) {
            <div class="attempt-row" [class.expanded]="expandedId() === attempt.id">
              <button type="button" class="attempt-header" (click)="toggle(attempt.id)">
                <div class="attempt-main">
                  <span class="attempt-exam">{{ attempt.examName }}</span>
                  <span class="attempt-meta">
                    {{ attempt.mode === 'instant' ? 'Instant feedback' : 'Exam simulation' }}
                    · {{ attempt.answers.length }} question{{ attempt.answers.length === 1 ? '' : 's' }}
                    · {{ formatDate(attempt.finishedAt) }}
                    @if (attempt.partialCredit) { · partial credit }
                  </span>
                </div>
                <span class="attempt-score">{{ attempt.scorePercent.toFixed(2) }}%</span>
                <svg class="chevron" viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
              </button>
              @if (expandedId() === attempt.id) {
                <div class="attempt-body">
                  @for (a of attempt.answers; track a.questionId) {
                    <div
                      class="answer-row"
                      [class.correct]="a.score === 1"
                      [class.partial]="a.score > 0 && a.score < 1"
                      [class.wrong]="a.score === 0"
                      [class.expanded]="expandedQuestionId() === a.questionId"
                    >
                      <button type="button" class="answer-header" (click)="toggleQuestion(a.questionId)">
                        <span class="answer-title">{{ a.title }}</span>
                        <span class="answer-meta">
                          {{ a.domain }}
                          @if (a.timeSpentSeconds > 0) { · {{ formatClockValue(a.timeSpentSeconds) }} }
                          · Score {{ formatScore(a.score) }}
                        </span>
                        <svg class="chevron" viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
                      </button>
                      @if (expandedQuestionId() === a.questionId) {
                        <div class="answer-body">
                          <app-annotated-text
                            blockId="stem"
                            [text]="a.stemSnapshot"
                            [highlights]="a.highlights['stem'] ?? []"
                            [strikethroughs]="a.strikethroughs['stem'] ?? []"
                          />
                          @for (alt of a.alternativesSnapshot; track alt.letter) {
                            <div
                              class="hist-alt"
                              [class.correct]="a.correctLetters.includes(alt.letter)"
                              [class.chosen]="a.selected.includes(alt.letter) && !a.correctLetters.includes(alt.letter)"
                            >
                              <span class="hist-alt-letter">{{ alt.letter }}</span>
                              <app-annotated-text
                                [blockId]="alt.letter"
                                [text]="alt.text"
                                [highlights]="a.highlights[alt.letter] ?? []"
                                [strikethroughs]="a.strikethroughs[alt.letter] ?? []"
                              />
                            </div>
                          }
                          @if (a.note) {
                            <div class="hist-note"><strong>Note:</strong> {{ a.note }}</div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .history-card { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); max-width: 680px; margin: 0 auto; }
      .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); }
      .card-header h2 { font-size: var(--font-size-xl); margin-bottom: var(--space-xs); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); }
      .empty-hint { color: var(--text-muted); font-size: var(--font-size-sm); margin: 0; }

      .attempt-list { display: flex; flex-direction: column; gap: var(--space-sm); }
      .attempt-row { border-radius: var(--radius-md); border: 1px solid var(--bg-border); overflow: hidden; }
      .attempt-header { display: flex; width: 100%; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-md); cursor: pointer; background: var(--bg-input); border: none; text-align: left; font-family: var(--font-family); }
      .attempt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .attempt-exam { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); }
      .attempt-meta { font-size: var(--font-size-xs); color: var(--text-muted); }
      .attempt-score { font-size: var(--font-size-base); font-weight: 700; color: var(--color-purple); white-space: nowrap; }
      .chevron { color: var(--text-muted); transition: transform var(--transition-fast); flex-shrink: 0; }
      .attempt-row.expanded .chevron { transform: rotate(180deg); }
      .attempt-body { padding: var(--space-md); border-top: 1px solid var(--bg-border); display: flex; flex-direction: column; gap: var(--space-sm); }

      .answer-row { border-radius: var(--radius-md); border: 1px solid var(--bg-border); overflow: hidden; }
      .answer-row.correct { border-color: var(--color-green); }
      .answer-row.partial { border-color: var(--color-amber); }
      .answer-row.wrong { border-color: var(--color-red); }
      .answer-header { display: flex; width: 100%; align-items: center; gap: var(--space-sm); padding: var(--space-sm); cursor: pointer; background: var(--bg-input); border: none; text-align: left; font-family: var(--font-family); }
      .answer-row.correct .answer-header { background: rgba(0, 184, 148, 0.08); }
      .answer-row.partial .answer-header { background: rgba(225, 112, 85, 0.08); }
      .answer-row.wrong .answer-header { background: rgba(214, 48, 49, 0.08); }
      .answer-title { flex: 1; min-width: 0; font-size: var(--font-size-sm); font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .answer-meta { font-size: var(--font-size-xs); color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
      .answer-row.expanded .chevron { transform: rotate(180deg); }
      .answer-body { padding: var(--space-md); border-top: 1px solid var(--bg-border); display: flex; flex-direction: column; gap: var(--space-sm); font-size: var(--font-size-sm); line-height: 1.55; color: var(--text-primary); }

      .hist-alt { display: flex; gap: var(--space-sm); align-items: flex-start; padding: var(--space-sm); border-radius: var(--radius-md); border: 1px solid var(--bg-border); }
      .hist-alt.correct { border-color: var(--color-green); background: rgba(0, 184, 148, 0.08); }
      .hist-alt.chosen { border-color: var(--color-red); background: rgba(214, 48, 49, 0.08); }
      .hist-alt-letter { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--font-size-xs); background: var(--bg-elevated); color: var(--text-secondary); flex-shrink: 0; }
      .hist-alt.correct .hist-alt-letter { background: var(--color-green); color: #fff; }
      .hist-alt.chosen .hist-alt-letter { background: var(--color-red); color: #fff; }

      .hist-note { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); background: var(--bg-elevated); border-left: 2px solid var(--color-purple); font-size: var(--font-size-sm); color: var(--text-secondary); }

      :host ::ng-deep mark { background: #fde68a; color: inherit; border-radius: 2px; }
      :host ::ng-deep s { text-decoration-color: var(--color-red); }

      .btn { min-height: var(--touch-min); padding: 0 var(--space-md); border-radius: var(--radius-md); font-weight: 600; font-size: var(--font-size-base); border: none; font-family: var(--font-family); cursor: pointer; white-space: nowrap; }
      .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--bg-border); }
      .btn-ghost:hover { background: var(--bg-subtle); }
    `,
  ],
})
export class QuizHistoryComponent {
  protected readonly quiz = inject(QuizService);
  protected readonly attemptsService = inject(QuizAttemptsService);

  protected readonly attempts = this.attemptsService.attempts;
  protected readonly expandedId = signal<string | null>(null);
  protected readonly expandedQuestionId = signal<string | null>(null);

  constructor() {
    void this.attemptsService.load();
  }

  toggle(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
    this.expandedQuestionId.set(null);
  }

  toggleQuestion(id: string): void {
    this.expandedQuestionId.set(this.expandedQuestionId() === id ? null : id);
  }

  formatDate(ms: number): string {
    return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  formatScore(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  formatClockValue(seconds: number): string {
    return formatClock(seconds);
  }
}
