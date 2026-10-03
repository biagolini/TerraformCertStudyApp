import { PacksService } from '../../core/services/packs.service';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { QuizService } from '../../core/services/quiz.service';
import { QuizAttempt } from '../../core/models/quiz-attempt.model';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-quiz-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="history-card">
      <header class="card-header">
        <div>
          <h2>{{ i18n.t('quizHistory.title') }}</h2>
          <p class="subtitle">{{ i18n.t('quizHistory.subtitle') }}</p>
        </div>
        <button type="button" class="btn btn-ghost" (click)="quiz.reset()">{{ i18n.t('quizHistory.backToSetup') }}</button>
      </header>

      @if (attemptsService.loading()) {
        <p class="empty-hint">{{ i18n.t('common.loading') }}</p>
      } @else if (attempts().length === 0) {
        <p class="empty-hint">{{ i18n.t('quizHistory.noAttemptsYet') }}</p>
      } @else {
        <div class="attempt-list">
          @for (attempt of attempts(); track attempt.id) {
            <button type="button" class="attempt-header" (click)="openResults(attempt)">
              <div class="attempt-main">
                <span class="attempt-exam">{{ attempt.examName }}</span>
                <span class="attempt-meta">
                  {{ attempt.mode === 'instant' ? i18n.t('quizSetup.instantFeedback') : i18n.t('quizSetup.examSimulation') }}
                  · {{ i18n.t('quizHistory.questionCount', { count: attempt.answers.length }) }}
                  · {{ formatDate(attempt.finishedAt ?? attempt.startedAt) }}
                  @if (attempt.partialCredit) { · {{ i18n.t('quizHistory.partialCredit') }} }
                </span>
              </div>
              <span class="attempt-score">{{ formatScore(attempt.scorePercent) }}%</span>
              <svg class="chevron" viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
            </button>
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
      .attempt-header { display: flex; width: 100%; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-md); cursor: pointer; background: var(--bg-input); border: 1px solid var(--bg-border); border-radius: var(--radius-md); text-align: left; font-family: var(--font-family); }
      .attempt-header:hover { border-color: var(--color-purple); }
      .attempt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .attempt-exam { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); }
      .attempt-meta { font-size: var(--font-size-xs); color: var(--text-muted); }
      .attempt-score { font-size: var(--font-size-base); font-weight: 700; color: var(--color-purple); white-space: nowrap; }
      .chevron { color: var(--text-muted); flex-shrink: 0; }

      .btn { min-height: var(--touch-min); padding: 0 var(--space-md); border-radius: var(--radius-md); font-weight: 600; font-size: var(--font-size-base); border: none; font-family: var(--font-family); cursor: pointer; white-space: nowrap; }
      .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--bg-border); }
      .btn-ghost:hover { background: var(--bg-subtle); }
    `,
  ],
})
export class QuizHistoryComponent {
  protected readonly quiz = inject(QuizService);
  protected readonly attemptsService = inject(QuizAttemptsService);
  protected readonly i18n = inject(I18nService);

  private readonly packs = inject(PacksService);
  /** Finished attempts of the open certification only. */
  protected readonly attempts = computed(() => {
    const packId = this.packs.activePack().id;
    return this.attemptsService.finishedAttempts().filter((a) => a.packId === packId);
  });

  constructor() {
    void this.attemptsService.load();
  }

  openResults(attempt: QuizAttempt): void {
    this.quiz.viewAttempt(attempt);
  }

  formatDate(ms: number): string {
    return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Two decimals as the norm, but a whole number drops the ".00" — matches the
   * results screen's score ring. */
  formatScore(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
}
