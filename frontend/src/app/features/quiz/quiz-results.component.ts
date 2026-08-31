import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { Question } from '../../core/models/question.model';
import { QuizAnswer } from '../../core/models/quiz.model';
import { attemptScoreAtTimeLimit, formatClock, QuizService } from '../../core/services/quiz.service';

interface ReviewItem {
  question: Question;
  answer: QuizAnswer;
}

@Component({
  selector: 'app-quiz-results',
  standalone: true,
  imports: [DomainBadgeComponent, MarkdownRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="results-card">
      <header class="card-header">
        <h2>Quiz results</h2>
        <p class="subtitle">{{ summary() }}</p>
      </header>

      <div class="score-hero">
        <div class="score-ring" [style.--pct]="scorePercent()">
          <div class="score-ring-inner"><strong>{{ scorePercent().toFixed(2) }}%</strong><span>score</span></div>
        </div>
        <div class="score-meta">
          <p><strong>{{ formatScore(score().correct) }}</strong> correct out of <strong>{{ score().total }}</strong></p>
          @if (partialCredit()) { <p>This exam allows partial credit on multi-select questions.</p> }
          @if (weakestDomain(); as w) {
            <p>Weakest domain: <strong>{{ w.domain }}</strong> ({{ formatScore(w.correct) }}/{{ w.total }})</p>
          }
        </div>
      </div>

      @if (timeLimitScore(); as t) {
        <div class="time-limit-block">
          <button type="button" class="btn-ghost-sm" (click)="showTimeLimitScore.set(!showTimeLimitScore())">
            {{ showTimeLimitScore() ? 'Hide' : 'See' }} score if I'd stopped at the time limit
          </button>
          @if (showTimeLimitScore()) {
            <p class="time-limit-value">
              You would have scored <strong>{{ t.scorePercent.toFixed(2) }}%</strong> if you had stopped
              answering the moment time ran out (answers changed after that don't count).
            </p>
          }
        </div>
      }

      @if (domainBreakdown().length > 1) {
        <span class="field-label">By domain</span>
        @for (d of domainBreakdown(); track d.domain) {
          <div class="domain-row">
            <span class="domain-name">{{ d.domain }}</span>
            <div class="domain-track">
              <div class="domain-fill" [class.warn]="d.total > 0 && d.correct / d.total < 0.7" [style.width.%]="d.total > 0 ? (d.correct / d.total) * 100 : 0"></div>
            </div>
            <span class="domain-fraction">{{ formatScore(d.correct) }}/{{ d.total }}</span>
            @if (d.timeSeconds > 0) {
              <span class="domain-time">avg {{ formatClockValue(d.timeSeconds / d.total) }}</span>
            }
          </div>
        }
      }

      <span class="field-label">All questions</span>
      <div class="result-list">
        @for (row of reviewItems(); track row.question.id; let i = $index) {
          <div class="result-row" [class.correct]="row.answer.correct" [class.incorrect]="!row.answer.correct" [class.expanded]="expandedId() === row.question.id">
            <button type="button" class="result-row-header" (click)="toggle(row.question.id)">
              <span class="status-icon">
                @if (row.answer.correct) {
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/></svg>
                } @else {
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
                }
              </span>
              <span class="result-row-title">Q{{ i + 1 }} — {{ row.question.title }}</span>
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
                            <span>Comment</span>
                          </div>
                          <app-markdown-renderer [source]="opt.comment" />
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <div class="results-actions">
        <button type="button" class="btn btn-primary" (click)="quiz.reset()">New quiz</button>
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
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

  protected readonly score = this.quiz.score;
  protected readonly domainBreakdown = this.quiz.domainBreakdown;
  protected readonly expandedId = signal<string | null>(null);

  protected readonly scorePercent = computed(() => this.quiz.lastAttempt()?.scorePercent ?? 0);
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
    return this.quiz.questions().map((question) => ({
      question,
      answer: answers[question.id] ?? { selected: [], checked: true, correct: false, score: 0 },
    }));
  });

  protected readonly summary = computed(() => {
    const settings = this.quiz.settings();
    const modeLabel = settings.mode === 'instant' ? 'Instant feedback' : 'Exam simulation';
    return `${modeLabel} · ${this.quiz.questions().length} questions`;
  });

  toggle(questionId: string): void {
    this.expandedId.set(this.expandedId() === questionId ? null : questionId);
  }
}
