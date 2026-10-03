import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { QuizService, formatClock } from '../../core/services/quiz.service';
import { PacksService } from '../../core/services/packs.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { DEFAULT_PASSING_SCORE_PERCENT } from '../../core/models/pack.model';
import { QuizAttempt, attemptPassed } from '../../core/models/quiz-attempt.model';
import { attemptBlankCount, attemptDurationSeconds, domainMastery, scoreChartPoints } from '../../core/utils/performance.util';
import { examPath } from '../../core/utils/routes.util';

const CHART_W = 640;
const CHART_H = 220;
const CHART_PAD = 28;

/** /exam/:packId/performance — attempt history, score evolution and domain mastery for one certification. */
@Component({
  selector: 'app-performance-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h2>{{ i18n.t('performance.title') }}</h2>
          <p>{{ i18n.t('performance.subtitle') }}</p>
        </div>
        <button type="button" class="ui-btn ui-btn-primary" (click)="goToQuiz()">{{ i18n.t('performance.newMock') }}</button>
      </header>

      @if (attemptsService.loading() && all().length === 0) {
        <p class="ui-muted">{{ i18n.t('common.loading') }}</p>
      } @else if (all().length === 0) {
        <section class="ui-empty">
          <h3>{{ i18n.t('performance.emptyTitle') }}</h3>
          <p>{{ i18n.t('performance.emptyBody') }}</p>
          <button type="button" class="ui-btn ui-btn-primary" (click)="goToQuiz()">{{ i18n.t('performance.newMock') }}</button>
        </section>
      } @else {
        <div class="kpis">
          <div class="ui-card kpi"><span>{{ i18n.t('performance.attempts') }}</span><strong>{{ kpis().count }}</strong></div>
          <div class="ui-card kpi"><span>{{ i18n.t('performance.average') }}</span><strong>{{ kpis().avg }}%</strong></div>
          <div class="ui-card kpi"><span>{{ i18n.t('performance.best') }}</span><strong>{{ kpis().best }}%</strong></div>
          <div class="ui-card kpi"><span>{{ i18n.t('performance.last') }}</span><strong>{{ kpis().last }}%</strong></div>
          <div class="ui-card kpi"><span>{{ i18n.t('performance.passRate') }}</span><strong>{{ kpis().passRate }}%</strong></div>
        </div>

        <section class="ui-card">
          <div class="section-head">
            <strong>{{ i18n.t('performance.evolution') }}</strong>
            <span class="ui-faint">{{ i18n.t('quizResults.passMark', { pct: passMark() }) }}</span>
          </div>
          <svg class="chart" [attr.viewBox]="'0 0 ' + chartW + ' ' + chartH" role="img" [attr.aria-label]="i18n.t('performance.chartLabel')">
            @for (g of gridLines; track g) {
              <line [attr.x1]="pad" [attr.x2]="chartW - pad" [attr.y1]="yFor(g)" [attr.y2]="yFor(g)" class="grid" />
              <text [attr.x]="4" [attr.y]="yFor(g) + 4" class="axis">{{ g }}</text>
            }
            <line [attr.x1]="pad" [attr.x2]="chartW - pad" [attr.y1]="yFor(passMark())" [attr.y2]="yFor(passMark())" class="pass-line" />
            @if (points().length > 1) {
              <polyline [attr.points]="polyline()" class="line" />
            }
            @for (p of points(); track p.attempt.id) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="5" [class.pass]="isPassed(p.attempt)" [class.fail]="!isPassed(p.attempt)" class="dot">
                <title>{{ formatDate(p.attempt) }} · {{ p.attempt.scorePercent }}%</title>
              </circle>
            }
          </svg>
        </section>

        <section class="ui-card">
          <div class="section-head">
            <strong>{{ i18n.t('performance.mastery') }}</strong>
            <span class="ui-faint">{{ i18n.t('performance.masteryHint') }}</span>
          </div>
          @if (weak().length > 0) {
            <div class="weak" role="note">
              <strong>{{ i18n.t('performance.focusTitle') }}</strong>
              <span>{{ i18n.t('performance.focusBody', { domains: weakNames() }) }}</span>
            </div>
          }
          <div class="mastery">
            @for (d of mastery(); track d.domain) {
              <div class="m-row">
                <span class="m-name">{{ d.domain }}</span>
                <div class="ui-progress m-bar" [style.--bar-color]="d.percent >= passMark() ? 'var(--color-green)' : 'var(--color-amber)'">
                  <span [style.width.%]="d.percent"></span>
                </div>
                <span class="m-num">{{ d.percent }}%</span>
                <span class="m-meta ui-faint">{{ d.answered }}/{{ d.total }} · {{ clock(d.avgSeconds) }}</span>
                <button type="button" class="ui-btn ui-btn-sm" (click)="practice(d.domain)">{{ i18n.t('performance.practice') }}</button>
              </div>
            }
          </div>
        </section>

        <section class="ui-card">
          <div class="section-head">
            <strong>{{ i18n.t('performance.history') }}</strong>
            <div class="filters">
              <select class="ui-input" [ngModel]="status()" (ngModelChange)="status.set($event)" [attr.aria-label]="i18n.t('performance.statusFilter')">
                <option value="all">{{ i18n.t('performance.allResults') }}</option>
                <option value="pass">{{ i18n.t('quizResults.pass') }}</option>
                <option value="fail">{{ i18n.t('quizResults.fail') }}</option>
              </select>
              <select class="ui-input" [ngModel]="period()" (ngModelChange)="period.set($event)" [attr.aria-label]="i18n.t('performance.periodFilter')">
                <option value="all">{{ i18n.t('performance.allTime') }}</option>
                <option value="7">{{ i18n.t('performance.lastDays', { n: 7 }) }}</option>
                <option value="30">{{ i18n.t('performance.lastDays', { n: 30 }) }}</option>
                <option value="90">{{ i18n.t('performance.lastDays', { n: 90 }) }}</option>
              </select>
            </div>
          </div>
          <div class="table-wrap">
            <table class="history">
              <thead>
                <tr>
                  <th scope="col">{{ i18n.t('performance.date') }}</th>
                  <th scope="col">{{ i18n.t('performance.mode') }}</th>
                  <th scope="col">{{ i18n.t('quizResults.colScore') }}</th>
                  <th scope="col">{{ i18n.t('performance.verdict') }}</th>
                  <th scope="col">{{ i18n.t('performance.answeredBlank') }}</th>
                  <th scope="col">{{ i18n.t('quizResults.colTime') }}</th>
                  <th scope="col"><span class="ui-sr-only">{{ i18n.t('performance.open') }}</span></th>
                </tr>
              </thead>
              <tbody>
                @for (a of filtered(); track a.id) {
                  <tr>
                    <td>{{ formatDate(a) }}</td>
                    <td>{{ a.mode === 'instant' ? i18n.t('quizSetup.instantFeedback') : i18n.t('quizSetup.examSimulation') }}</td>
                    <td class="mono">{{ a.scorePercent }}%</td>
                    <td><span class="ui-chip" [class.ui-chip-good]="isPassed(a)" [class.ui-chip-bad]="!isPassed(a)">{{ isPassed(a) ? i18n.t('quizResults.pass') : i18n.t('quizResults.fail') }}</span></td>
                    <td class="mono">{{ a.answers.length - blank(a) }} / {{ blank(a) }}</td>
                    <td class="mono">{{ clock(duration(a)) }}</td>
                    <td><button type="button" class="ui-btn ui-btn-sm" (click)="open(a)">{{ i18n.t('performance.open') }}</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="ui-muted">{{ i18n.t('performance.noMatch') }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .kpis {
        display: grid;
        gap: var(--space-md);
        grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
      }
      .kpi span {
        display: block;
        font-size: var(--font-size-xs);
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-faint);
      }
      .kpi strong {
        font-size: 26px;
        font-weight: 800;
      }
      .section-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        margin-bottom: var(--space-md);
      }
      .chart {
        width: 100%;
        height: auto;
        max-height: 260px;
      }
      .grid {
        stroke: var(--bg-border);
        stroke-width: 1;
      }
      .axis {
        fill: var(--text-faint);
        font-size: 10px;
        font-family: var(--font-mono);
      }
      .pass-line {
        stroke: var(--color-green);
        stroke-dasharray: 6 4;
        stroke-width: 1.5;
      }
      .line {
        fill: none;
        stroke: var(--pack-color, var(--color-purple));
        stroke-width: 2.5;
        stroke-linejoin: round;
      }
      .dot {
        stroke: var(--bg-surface);
        stroke-width: 2;
      }
      .dot.pass {
        fill: var(--color-green);
      }
      .dot.fail {
        fill: var(--color-red);
      }
      .weak {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-sm) var(--space-md);
        margin-bottom: var(--space-md);
        border-radius: var(--radius-md);
        background: rgba(225, 112, 85, 0.1);
        color: var(--color-amber);
        font-size: var(--font-size-sm);
      }
      .mastery {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .m-row {
        display: grid;
        grid-template-columns: minmax(120px, 1.4fr) minmax(80px, 2fr) 56px auto auto;
        align-items: center;
        gap: var(--space-sm);
      }
      @media (max-width: 640px) {
        .m-row {
          grid-template-columns: 1fr 56px;
        }
        .m-bar,
        .m-meta {
          grid-column: 1 / -1;
        }
      }
      .m-name {
        font-weight: 600;
        font-size: var(--font-size-sm);
      }
      .m-num,
      .mono {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
      }
      .filters {
        display: flex;
        gap: var(--space-sm);
      }
      .filters select {
        width: auto;
        min-height: 32px;
        padding: 4px 8px;
      }
      .table-wrap {
        overflow-x: auto;
      }
      .history {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--font-size-sm);
      }
      .history th,
      .history td {
        padding: 8px;
        text-align: left;
        border-bottom: 1px solid var(--bg-border);
        white-space: nowrap;
      }
      .history thead th {
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-faint);
      }
    `,
  ],
})
export class PerformancePageComponent {
  protected readonly attemptsService = inject(QuizAttemptsService);
  private readonly quiz = inject(QuizService);
  private readonly packs = inject(PacksService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();

  protected readonly chartW = CHART_W;
  protected readonly chartH = CHART_H;
  protected readonly pad = CHART_PAD;
  protected readonly gridLines = [0, 25, 50, 75, 100];

  readonly status = signal<'all' | 'pass' | 'fail'>('all');
  readonly period = signal<'all' | '7' | '30' | '90'>('all');

  readonly passMark = computed(() => this.packs.getById(this.packId())?.passingScorePercent ?? DEFAULT_PASSING_SCORE_PERCENT);

  readonly all = computed(() => this.attemptsService.finishedAttempts().filter((a) => a.packId === this.packId()));

  readonly kpis = computed(() => {
    const list = this.all();
    const scores = list.map((a) => a.scorePercent);
    const newest = [...list].sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0];
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      count: list.length,
      avg: scores.length ? round(scores.reduce((s, x) => s + x, 0) / scores.length) : 0,
      best: scores.length ? round(Math.max(...scores)) : 0,
      last: newest ? round(newest.scorePercent) : 0,
      passRate: list.length ? Math.round((list.filter((a) => this.isPassed(a)).length / list.length) * 100) : 0,
    };
  });

  readonly points = computed(() => scoreChartPoints(this.all(), CHART_W, CHART_H, CHART_PAD));
  readonly polyline = computed(() => this.points().map((p) => `${p.x},${p.y}`).join(' '));

  readonly mastery = computed(() => domainMastery(this.all()));
  readonly weak = computed(() => this.mastery().filter((d) => d.total >= 3 && d.percent < this.passMark()).slice(0, 3));
  readonly weakNames = computed(() => this.weak().map((d) => d.domain).join(', '));

  readonly filtered = computed(() => {
    const status = this.status();
    const period = this.period();
    const since = period === 'all' ? 0 : Date.now() - Number(period) * 86_400_000;
    return [...this.all()]
      .filter((a) => (a.finishedAt ?? a.startedAt) >= since)
      .filter((a) => status === 'all' || (status === 'pass') === this.isPassed(a))
      .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
  });

  constructor() {
    void this.attemptsService.load();
  }

  yFor(percent: number): number {
    return CHART_PAD + (CHART_H - CHART_PAD * 2) * (1 - percent / 100);
  }

  isPassed(a: QuizAttempt): boolean {
    return attemptPassed(a, this.passMark());
  }

  blank(a: QuizAttempt): number {
    return attemptBlankCount(a);
  }

  duration(a: QuizAttempt): number {
    return attemptDurationSeconds(a);
  }

  clock(seconds: number): string {
    return formatClock(seconds);
  }

  formatDate(a: QuizAttempt): string {
    return new Date(a.finishedAt ?? a.startedAt).toLocaleString(this.i18n.lang(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  goToQuiz(): void {
    if (this.quiz.phase() !== 'running') this.quiz.reset();
    void this.router.navigate(examPath(this.packId(), 'quiz'));
  }

  practice(domain: string): void {
    this.quiz.release();
    void this.router.navigate(examPath(this.packId(), 'quiz'), { queryParams: { domain } });
  }

  /** Reopens the attempt in the mock-exam results view. */
  open(a: QuizAttempt): void {
    if (this.quiz.phase() === 'running') this.quiz.leave();
    this.quiz.viewAttempt(a);
    void this.router.navigate(examPath(this.packId(), 'quiz'));
  }
}
