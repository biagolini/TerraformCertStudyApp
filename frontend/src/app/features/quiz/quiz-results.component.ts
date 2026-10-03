import { TutorDialogComponent } from '../tutor/tutor-dialog.component';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { Question } from '../../core/models/question.model';
import { QuizAnswer } from '../../core/models/quiz.model';
import { attemptScoreAtTimeLimit, formatClock, QuizService } from '../../core/services/quiz.service';
import { I18nService } from '../../core/i18n/i18n.service';

interface ReviewItem {
  question: Question;
  answer: QuizAnswer;
  index: number;
}

type ResultFilter = 'all' | 'correct' | 'incorrect' | 'blank';

function itemStatus(answer: QuizAnswer): Exclude<ResultFilter, 'all'> {
  if (answer.correct) return 'correct';
  return answer.selected.length === 0 ? 'blank' : 'incorrect';
}

@Component({
  selector: 'app-quiz-results',
  standalone: true,
  imports: [DomainBadgeComponent, MarkdownRendererComponent, TutorDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="results-card">
      <header class="card-header">
        <h2>{{ i18n.t('quizResults.title') }}</h2>
        <p class="subtitle">{{ summary() }}</p>
      </header>

      <div class="score-hero">
        <div class="score-ring" [style.--pct]="scorePercent()">
          <div class="score-ring-inner"><strong>{{ scoreLabel() }}%</strong><span>{{ i18n.t('quizResults.score') }}</span></div>
        </div>
        <div class="score-meta">
          <p>{{ i18n.t('quizResults.correctOutOf') }} <strong>{{ formatScore(score().correct) }}</strong> / <strong>{{ score().total }}</strong></p>
          @if (partialCredit()) { <p>{{ i18n.t('quizResults.partialCreditNote') }}</p> }
          @if (weakestDomain(); as w) {
            <p>{{ i18n.t('quizResults.weakestDomain') }} <strong>{{ w.domain }}</strong> ({{ formatScore(w.correct) }}/{{ w.total }})</p>
          }
          <p>{{ i18n.t('quizResults.totalTime') }} <strong>{{ formatClockValue(totalTime()) }}</strong></p>
        </div>
        <div class="verdict" [class.pass]="passed()" [class.fail]="!passed()">
          <strong>{{ passed() ? i18n.t('quizResults.pass') : i18n.t('quizResults.fail') }}</strong>
          <span>{{ i18n.t('quizResults.passMark', { pct: quiz.passingScorePercent() }) }}</span>
        </div>
      </div>

      <div class="counts">
        <button type="button" class="count-pill" [class.active]="filter() === 'all'" (click)="filter.set('all')">{{ i18n.t('quizResults.filterAll') }} <strong>{{ reviewItems().length }}</strong></button>
        <button type="button" class="count-pill good" [class.active]="filter() === 'correct'" (click)="filter.set('correct')">{{ i18n.t('quizResults.statusCorrect') }} <strong>{{ counts().correct }}</strong></button>
        <button type="button" class="count-pill bad" [class.active]="filter() === 'incorrect'" (click)="filter.set('incorrect')">{{ i18n.t('quizResults.statusIncorrect') }} <strong>{{ counts().incorrect }}</strong></button>
        <button type="button" class="count-pill blank" [class.active]="filter() === 'blank'" (click)="filter.set('blank')">{{ i18n.t('quizResults.statusUnanswered') }} <strong>{{ counts().blank }}</strong></button>
      </div>
      @if (counts().blank > 0) {
        <p class="blank-warning" role="note">{{ i18n.t('quizResults.blankWarning', { n: counts().blank }) }}</p>
      }

      @if (timeLimitScore(); as t) {
        <div class="time-limit-block">
          <button type="button" class="btn-ghost-sm" (click)="showTimeLimitScore.set(!showTimeLimitScore())">
            {{ showTimeLimitScore() ? i18n.t('quizResults.hideTimeLimitScore') : i18n.t('quizResults.seeTimeLimitScore') }}
          </button>
          @if (showTimeLimitScore()) {
            <p class="time-limit-value">{{ i18n.t('quizResults.timeLimitScoreExplain', { pct: t.scorePercent.toFixed(2) }) }}</p>
          }
        </div>
      }

      @if (domainBreakdown().length > 0) {
        <span class="field-label">{{ i18n.t('quizResults.byDomain') }}</span>
        <div class="domain-table-wrap">
          <table class="domain-table">
            <thead>
              <tr>
                <th scope="col">{{ i18n.t('quizResults.colDomain') }}</th>
                <th scope="col">{{ i18n.t('quizResults.colAttempted') }}</th>
                <th scope="col">{{ i18n.t('quizResults.colScore') }}</th>
                <th scope="col">{{ i18n.t('quizResults.colTime') }}</th>
                <th scope="col">{{ i18n.t('quizResults.colAvg') }}</th>
              </tr>
            </thead>
            <tbody>
              @for (d of domainBreakdown(); track d.domain) {
                <tr>
                  <th scope="row">
                    <span class="domain-name">{{ d.domain }}</span>
                    <div class="domain-track">
                      <div class="domain-fill" [class.warn]="d.total > 0 && (d.correct / d.total) * 100 < quiz.passingScorePercent()" [style.width.%]="d.total > 0 ? (d.correct / d.total) * 100 : 0"></div>
                    </div>
                  </th>
                  <td>{{ d.attempted }}/{{ d.total }}</td>
                  <td>{{ d.total > 0 ? ((d.correct / d.total) * 100).toFixed(0) : 0 }}%</td>
                  <td>{{ formatClockValue(d.timeSeconds) }}</td>
                  <td>{{ formatClockValue(d.total > 0 ? d.timeSeconds / d.total : 0) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <span class="field-label">{{ i18n.t('quizResults.allQuestions') }}</span>
      <div class="result-list">
        @for (row of filteredItems(); track row.question.id) {
          <div
            class="result-row"
            [class.correct]="row.answer.correct"
            [class.unanswered]="!row.answer.correct && row.answer.selected.length === 0"
            [class.incorrect]="!row.answer.correct && row.answer.selected.length > 0"
            [class.expanded]="expandedId() === row.question.id"
          >
            <button type="button" class="result-row-header" (click)="toggle(row.question.id)">
              <span
                class="status-icon"
                [attr.aria-label]="row.answer.correct ? i18n.t('quizResults.statusCorrect') : (row.answer.selected.length === 0 ? i18n.t('quizResults.statusUnanswered') : i18n.t('quizResults.statusIncorrect'))"
              >
                @if (row.answer.correct) {
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/></svg>
                } @else if (row.answer.selected.length === 0) {
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" d="M7 12h10"/></svg>
                } @else {
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
                }
              </span>
              <span class="result-row-title">{{ i18n.t('quizResults.questionNumber', { number: row.index + 1, title: row.question.title }) }}</span>
              <app-domain-badge [domain]="row.question.domain" />
              <svg class="chevron" viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
            </button>
            @if (expandedId() === row.question.id) {
              <div class="result-row-body">
                @for (opt of row.question.alternatives; track opt.letter) {
                  <div class="alt-row" [class.correct]="opt.isCorrect" [class.chosen]="row.answer.selected.includes(opt.letter)">
                    <span class="alt-letter">{{ opt.letter }}</span>
                    <div>
                      <div class="alt-text"><app-markdown-renderer [source]="opt.text" /></div>
                      @if (opt.comment) {
                        <div class="alt-comment">
                          <div class="alt-comment-label">
                            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
                            <span>{{ i18n.t('reviewViewer.comment') }}</span>
                          </div>
                          <app-markdown-renderer [source]="opt.comment" />
                        </div>
                      }
                    </div>
                  </div>
                }
                @if (row.question.generalComment) {
                  <div class="general-comment">
                    <span class="field-label">{{ i18n.t('quizResults.generalComment') }}</span>
                    <app-markdown-renderer [source]="row.question.generalComment" />
                  </div>
                }
                <div class="row-actions">
                  <span class="ui-faint">⏱ {{ formatClockValue(timeFor(row.question.id)) }}</span>
                  <button type="button" class="btn-ghost-sm" (click)="tutorFor.set(row.question)">✦ {{ i18n.t('tutor.ask') }}{{ tutorCount(row.question.id) ? ' (' + tutorCount(row.question.id) + ')' : '' }}</button>
                </div>
              </div>
            }
          </div>
        } @empty {
          <p class="ui-muted">{{ i18n.t('quizResults.filterEmpty') }}</p>
        }
      </div>
      @if (tutorFor(); as tq) {
        <app-tutor-dialog [question]="tq" [selected]="answerFor(tq.id)" (closed)="tutorFor.set(null)" />
      }

      <div class="results-actions">
        @if (quiz.cameFromHistory()) {
          <button type="button" class="btn btn-primary" (click)="quiz.viewHistory()">{{ i18n.t('quizResults.backToHistory') }}</button>
        } @else {
          <button type="button" class="btn btn-primary" (click)="quiz.reset()">{{ i18n.t('quizResults.newQuiz') }}</button>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .verdict { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); min-width: 120px; text-align: center; }
      .verdict strong { font-size: 18px; letter-spacing: 0.04em; text-transform: uppercase; }
      .verdict span { font-size: var(--font-size-xs); }
      .verdict.pass { background: rgba(0, 184, 148, 0.12); color: var(--color-green); }
      .verdict.fail { background: rgba(214, 48, 49, 0.1); color: var(--color-red); }
      .counts { display: flex; flex-wrap: wrap; gap: 6px; }
      .count-pill { display: inline-flex; gap: 6px; align-items: center; padding: 4px 12px; min-height: 32px; border-radius: var(--radius-pill); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
      .count-pill.active { border-color: var(--text-primary); color: var(--text-primary); box-shadow: 0 0 0 1px var(--text-primary); }
      .count-pill.good strong { color: var(--color-green); }
      .count-pill.bad strong { color: var(--color-red); }
      .count-pill.blank strong { color: var(--text-faint); }
      .blank-warning { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); background: rgba(225, 112, 85, 0.1); color: var(--color-amber); font-size: var(--font-size-sm); }
      .domain-table-wrap { overflow-x: auto; }
      .domain-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
      .domain-table th, .domain-table td { padding: 6px 8px; border-bottom: 1px solid var(--bg-border); text-align: left; vertical-align: middle; }
      .domain-table thead th { font-size: var(--font-size-xs); color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; }
      .domain-table td { font-family: var(--font-mono); white-space: nowrap; }
      .domain-table th[scope='row'] { font-weight: 500; min-width: 160px; }
      .general-comment { margin-top: var(--space-sm); padding: var(--space-sm); border-radius: var(--radius-md); background: var(--bg-elevated); }
      .row-actions { display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-sm); }
      .results-card { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); max-width: 680px; margin: 0 auto; }
      .card-header h2 { font-size: var(--font-size-xl); margin-bottom: var(--space-xs); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); }
      .field-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }

      .score-hero { display: flex; align-items: center; gap: var(--space-lg); }
      .score-ring { --pct: 0; width: 96px; height: 96px; border-radius: 50%; background: conic-gradient(var(--color-purple) calc(var(--pct) * 1%), var(--bg-border) 0); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .score-ring-inner { width: 76px; height: 76px; border-radius: 50%; background: var(--bg-surface); display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .score-ring-inner strong { font-size: var(--font-size-xl); color: var(--text-primary); line-height: 1; }
      .score-ring-inner span { font-size: var(--font-size-xs); color: var(--text-muted); }
      .score-meta p { margin: 0 0 4px; font-size: var(--font-size-sm); color: var(--text-muted); }
      .score-meta strong { color: var(--text-primary); }

      .domain-row { display: flex; align-items: center; gap: var(--space-sm); }
      .domain-name { width: 150px; font-size: var(--font-size-sm); color: var(--text-secondary); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .domain-track { flex: 1; height: 8px; border-radius: 999px; background: var(--bg-border); overflow: hidden; }
      .domain-fill { height: 100%; border-radius: 999px; background: var(--color-green); }
      .domain-fill.warn { background: var(--color-amber); }
      .domain-fraction { font-size: var(--font-size-xs); color: var(--text-muted); width: 36px; text-align: right; flex-shrink: 0; }
      .domain-time { font-size: var(--font-size-xs); color: var(--text-faint); width: 56px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }

      .result-list { display: flex; flex-direction: column; gap: var(--space-sm); }
      .result-row { border-radius: var(--radius-md); border: 1px solid var(--bg-border); overflow: hidden; }
      .result-row-header { display: flex; width: 100%; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); cursor: pointer; background: var(--bg-input); border: none; text-align: left; font-family: var(--font-family); }
      .status-icon { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .result-row.correct .status-icon { background: var(--color-green); }
      .result-row.incorrect .status-icon { background: var(--color-red); }
      /* Unanswered is a distinct neutral state, not a wrong answer: a grey dash
       * badge so a skipped question does not read as "you got this wrong". */
      .result-row.unanswered .status-icon { background: var(--text-faint); }
      .result-row-title { flex: 1; min-width: 0; font-size: var(--font-size-sm); font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chevron { color: var(--text-muted); transition: transform var(--transition-fast); flex-shrink: 0; }
      .result-row.expanded .chevron { transform: rotate(180deg); }
      .result-row-body { padding: var(--space-md); border-top: 1px solid var(--bg-border); display: flex; flex-direction: column; gap: var(--space-sm); }

      .alt-row { display: flex; gap: var(--space-sm); align-items: flex-start; padding: var(--space-sm); border-radius: var(--radius-md); border: 1px solid var(--bg-border); }
      .alt-row.correct { border-color: var(--color-green); background: rgba(0, 184, 148, 0.08); }
      .alt-row.chosen:not(.correct) { border-color: var(--color-red); background: rgba(214, 48, 49, 0.08); }
      .alt-letter { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--font-size-xs); background: var(--bg-elevated); color: var(--text-secondary); flex-shrink: 0; }
      .alt-row.correct .alt-letter { background: var(--color-green); color: #fff; }
      .alt-row.chosen:not(.correct) .alt-letter { background: var(--color-red); color: #fff; }
      .alt-text { font-size: var(--font-size-sm); font-weight: 500; color: var(--text-primary); }
      .alt-comment { margin: var(--space-sm) 0 0; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--bg-elevated); border-left: 2px solid var(--bg-border); font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.5; }
      .alt-comment-label { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; color: var(--text-faint); font-size: var(--font-size-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }

      .time-limit-block { padding: var(--space-md); border-radius: var(--radius-md); background: var(--bg-elevated); border: 1px solid var(--bg-border); }
      .btn-ghost-sm { padding: 0 var(--space-md); min-height: 36px; border-radius: var(--radius-md); border: 1px solid var(--bg-border); background: transparent; color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: 600; font-family: var(--font-family); cursor: pointer; }
      .btn-ghost-sm:hover { border-color: var(--color-purple); color: var(--color-purple); }
      .time-limit-value { margin: var(--space-sm) 0 0; font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5; }

      .results-actions { display: flex; justify-content: flex-end; margin-top: var(--space-sm); }
      .btn { min-height: var(--touch-min); padding: 0 var(--space-lg); border-radius: var(--radius-md); font-weight: 600; font-size: var(--font-size-base); border: none; font-family: var(--font-family); cursor: pointer; }
      .btn-primary { background: linear-gradient(135deg, var(--color-purple), var(--color-blue)); color: #ffffff; }
      .btn-primary:hover { filter: brightness(1.08); }
    `,
  ],
})
export class QuizResultsComponent {
  protected readonly quiz = inject(QuizService);
  protected readonly i18n = inject(I18nService);

  protected readonly score = this.quiz.score;
  protected readonly domainBreakdown = this.quiz.domainBreakdown;
  protected readonly expandedId = signal<string | null>(null);

  protected readonly scorePercent = computed(() => this.quiz.lastAttempt()?.scorePercent ?? 0);
  /** Two decimals as the norm, but a whole number (e.g. exactly 100 or 0) drops
   * the ".00" so "100%" fits inside the score ring without shrinking the font. */
  protected readonly scoreLabel = computed(() => {
    const pct = this.scorePercent();
    return Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
  });
  protected readonly partialCredit = computed(() => this.quiz.lastAttempt()?.partialCredit ?? false);
  protected readonly showTimeLimitScore = signal(false);
  protected readonly timeLimitScore = computed(() => {
    const attempt = this.quiz.lastAttempt();
    return attempt ? attemptScoreAtTimeLimit(attempt) : null;
  });

  formatScore(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  formatClockValue(seconds: number): string {
    return formatClock(seconds);
  }

  protected readonly weakestDomain = computed(() => {
    const breakdown = this.domainBreakdown().filter((d) => d.total > 0);
    if (breakdown.length < 2) return null;
    return breakdown.reduce((worst, d) => (d.correct / d.total < worst.correct / worst.total ? d : worst));
  });

  protected readonly reviewItems = computed<ReviewItem[]>(() => {
    const answers = this.quiz.answerByQuestionId();
    return this.quiz.questions().map((question, index) => ({
      question,
      index,
      answer: answers[question.id] ?? { selected: [], checked: true, correct: false, score: 0 },
    }));
  });

  protected readonly filter = signal<ResultFilter>('all');
  protected readonly tutorFor = signal<Question | null>(null);

  protected readonly filteredItems = computed(() => {
    const f = this.filter();
    return f === 'all' ? this.reviewItems() : this.reviewItems().filter((r) => itemStatus(r.answer) === f);
  });

  protected readonly counts = computed(() => {
    const c = { correct: 0, incorrect: 0, blank: 0 };
    for (const r of this.reviewItems()) c[itemStatus(r.answer)] += 1;
    return c;
  });

  protected readonly passed = computed(() => this.scorePercent() >= this.quiz.passingScorePercent());
  protected readonly totalTime = computed(() =>
    Object.values(this.quiz.timeSpentById()).reduce((sum, t) => sum + t, 0),
  );

  timeFor(id: string): number {
    return this.quiz.timeSpentById()[id] ?? 0;
  }

  answerFor(id: string): string[] {
    return this.quiz.answerByQuestionId()[id]?.selected ?? [];
  }

  tutorCount(id: string): number {
    return Math.floor((this.quiz.tutorById()[id]?.length ?? 0) / 2);
  }

  protected readonly summary = computed(() => {
    const settings = this.quiz.settings();
    const modeLabel = settings.mode === 'instant' ? this.i18n.t('quizSetup.instantFeedback') : this.i18n.t('quizSetup.examSimulation');
    return this.i18n.t('quizResults.summaryLine', { mode: modeLabel, count: this.quiz.questions().length });
  });

  toggle(questionId: string): void {
    this.expandedId.set(this.expandedId() === questionId ? null : questionId);
  }
}
