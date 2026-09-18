import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { packDisplayLabel } from '../../core/models/pack.model';
import { QuizAttempt } from '../../core/models/quiz-attempt.model';
import { QuizMode, QuizScope } from '../../core/models/quiz.model';
import { PacksService } from '../../core/services/packs.service';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { QuizService } from '../../core/services/quiz.service';
import { SettingsService } from '../../core/services/settings.service';
import { slugify } from '../../core/utils/file-splitter.util';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-quiz-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="setup-card">
      <header class="card-header">
        <div>
          <h2>{{ i18n.t('quizSetup.title') }}</h2>
          <p class="subtitle">{{ i18n.t('quizSetup.subtitle') }}</p>
        </div>
        <button type="button" class="history-link" (click)="quiz.viewHistory()">{{ i18n.t('quizSetup.history') }}</button>
      </header>

      @if (inProgress().length > 0) {
        <div class="resume-list">
          @for (attempt of inProgress(); track attempt.id) {
            <div class="resume-row">
              <div class="resume-meta">
                <span class="resume-exam">{{ attempt.examName }}</span>
                <span class="resume-sub">
                  {{ attempt.mode === 'instant' ? i18n.t('quizSetup.instantFeedback') : i18n.t('quizSetup.examSimulation') }}
                  · {{ i18n.t('quizSetup.answeredOf', { answered: answeredCount(attempt), total: attempt.answers.length }) }}
                </span>
              </div>
              <div class="resume-actions">
                <button type="button" class="btn-ghost-sm" (click)="onDiscard(attempt)">{{ i18n.t('quizSetup.discard') }}</button>
                <button type="button" class="btn-resume" (click)="onResume(attempt)">{{ i18n.t('quizSetup.resume') }}</button>
              </div>
            </div>
          }
        </div>
      }

      @if (pendingConflict(); as conflict) {
        <div class="conflict-banner">
          <p>{{ i18n.t('quizSetup.conflictWarning', { answered: answeredCount(conflict), total: conflict.answers.length }) }}</p>
          <div class="conflict-actions">
            <button type="button" class="btn-ghost-sm" (click)="pendingConflict.set(null)">{{ i18n.t('common.cancel') }}</button>
            <button type="button" class="btn-resume" (click)="onDiscardAndStart(conflict)">{{ i18n.t('quizSetup.discardAndStartNew') }}</button>
          </div>
        </div>
      }

      <span class="field-label">{{ i18n.t('quizSetup.scope') }}</span>
      <div class="scope-group">
        <button
          type="button"
          class="scope-card"
          [class.selected]="scope() === 'pack'"
          (click)="onSelectScope('pack')"
        >
          <span class="scope-title">{{ i18n.t('quizSetup.thisPack') }}</span>
          <span class="scope-count">{{ activePackLabel() }} — {{ readyLabel('pack') }}</span>
        </button>
        <button
          type="button"
          class="scope-card"
          [class.selected]="scope() === 'exam'"
          (click)="onSelectScope('exam')"
        >
          <span class="scope-title">{{ i18n.t('quizSetup.allPacksForExam') }}</span>
          <span class="scope-count">{{ examLabel() }} — {{ readyLabel('exam') }}</span>
        </button>
        <button
          type="button"
          class="scope-card"
          [class.selected]="scope() === 'all'"
          (click)="onSelectScope('all')"
        >
          <span class="scope-title">{{ i18n.t('quizSetup.allPacks') }}</span>
          <span class="scope-count">{{ i18n.t('quizSetup.everyCertification') }} — {{ readyLabel('all') }}</span>
        </button>
      </div>

      <span class="field-label">{{ i18n.t('quizSetup.mode') }}</span>
      <div class="mode-toggle" role="tablist" [attr.aria-label]="i18n.t('quizSetup.quizMode')">
        <button
          type="button"
          class="mode-btn"
          [class.active]="mode() === 'instant'"
          (click)="mode.set('instant')"
          role="tab"
          [attr.aria-selected]="mode() === 'instant'"
        >{{ i18n.t('quizSetup.instantFeedback') }}</button>
        <button
          type="button"
          class="mode-btn"
          [class.active]="mode() === 'exam'"
          (click)="mode.set('exam')"
          role="tab"
          [attr.aria-selected]="mode() === 'exam'"
        >{{ i18n.t('quizSetup.examSimulation') }}</button>
      </div>

      @if (domainsList().length > 0) {
        <span class="field-label">{{ i18n.t('quizSetup.filterByDomain') }}</span>
        <div class="filters-row">
          @for (d of domainsList(); track d.name) {
            <button
              type="button"
              class="filter-chip"
              [class.selected]="selectedDomains().has(d.name)"
              (click)="onToggleDomain(d.name)"
            >{{ d.name }} ({{ d.count }})</button>
          }
        </div>
      }

      <div class="filters-row">
        <span class="switch-label">{{ i18n.t('quizSetup.questions') }}</span>
        <div class="stepper">
          <button type="button" (click)="onChangeCount(-5)" [disabled]="effectiveCount() <= 1">−</button>
          <span>{{ effectiveCount() }}</span>
          <button type="button" (click)="onChangeCount(5)" [disabled]="effectiveCount() >= filteredCount()">+</button>
        </div>
        <span class="hint-text">{{ i18n.t('quizSetup.ofAvailable', { count: filteredCount() }) }}</span>
      </div>

      <div class="filters-row">
        <button
          type="button"
          class="switch"
          [class.on]="shuffle()"
          (click)="shuffle.set(!shuffle())"
          role="switch"
          [attr.aria-checked]="shuffle()"
          [attr.aria-label]="i18n.t('quizSetup.shuffleOrder')"
        ><span class="thumb"></span></button>
        <span class="switch-label">{{ i18n.t('quizSetup.shuffleOrder') }}</span>
      </div>

      @if (quiz.timerAvailable()) {
        <div class="filters-row">
          <button
            type="button"
            class="switch"
            [class.on]="trackTime()"
            (click)="trackTime.set(!trackTime())"
            role="switch"
            [attr.aria-checked]="trackTime()"
            [attr.aria-label]="i18n.t('quizSetup.trackTime')"
          ><span class="thumb"></span></button>
          <span class="switch-label">{{ i18n.t('quizSetup.trackTimeWithLabel', { label: examDurationLabel() }) }}</span>
        </div>
        @if (accommodationMinutes() > 0) {
          <div class="filters-row">
            <button
              type="button"
              class="switch"
              [class.on]="useAccommodation()"
              [disabled]="!trackTime()"
              (click)="useAccommodation.set(!useAccommodation())"
              role="switch"
              [attr.aria-checked]="useAccommodation()"
              [attr.aria-label]="i18n.t('quizSetup.useAccommodation')"
            ><span class="thumb"></span></button>
            <span class="switch-label">{{ i18n.t('quizSetup.useAccommodationMin', { minutes: accommodationMinutes() }) }}</span>
          </div>
        }
      }

      @if (filteredCount() === 0) {
        <p class="empty-hint">{{ i18n.t('quizSetup.noQuestionsInScope') }}</p>
      }

      <button type="button" class="start-btn" [disabled]="filteredCount() === 0" (click)="onStart()">
        {{ i18n.t('quizSetup.startQuiz') }}
      </button>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .setup-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
        max-width: 640px;
        margin: 0 auto;
      }
      .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); }
      .card-header h2 { font-size: var(--font-size-xl); margin-bottom: var(--space-xs); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); }
      .history-link { flex-shrink: 0; padding: var(--space-xs) var(--space-md); border-radius: var(--radius-pill); border: 1px solid var(--bg-border); background: transparent; color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: 600; }
      .history-link:hover { border-color: var(--color-purple); color: var(--color-purple); }
      .field-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }

      .scope-group { display: flex; flex-direction: column; gap: var(--space-sm); }
      @media (min-width: 640px) {
        .scope-group { flex-direction: row; }
      }
      .scope-card {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1.5px solid var(--bg-border);
        background: var(--bg-input);
        text-align: left;
        cursor: pointer;
      }
      .scope-card:hover { border-color: var(--color-purple); }
      .scope-card.selected { border-color: var(--color-purple); background: var(--bg-elevated); }
      .scope-title { font-weight: 600; font-size: var(--font-size-base); color: var(--text-primary); }
      .scope-count { font-size: var(--font-size-xs); color: var(--text-muted); }

      .mode-toggle { display: inline-flex; gap: 2px; padding: 3px; background: var(--bg-elevated); border-radius: var(--radius-md); border: 1px solid var(--bg-border); align-self: flex-start; }
      .mode-btn { padding: 0 var(--space-md); min-height: 34px; border-radius: var(--radius-sm); background: transparent; border: none; color: var(--text-secondary); font-family: var(--font-family); font-size: var(--font-size-sm); font-weight: 600; cursor: pointer; }
      .mode-btn.active { background: var(--bg-surface); color: var(--color-purple); box-shadow: var(--shadow-sm); }

      .filters-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
      .filter-chip { padding: 4px var(--space-md); border-radius: var(--radius-pill); border: 1px solid var(--bg-border); background: var(--bg-input); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
      .filter-chip.selected { background: var(--color-purple); border-color: var(--color-purple); color: #fff; }

      .stepper { display: inline-flex; align-items: center; gap: var(--space-sm); border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); padding: 0 var(--space-xs); height: 36px; }
      .stepper button { width: 28px; height: 28px; border: none; background: transparent; color: var(--text-secondary); font-size: var(--font-size-lg); cursor: pointer; border-radius: var(--radius-sm); }
      .stepper button:hover:not(:disabled) { background: var(--bg-subtle); }
      .stepper button:disabled { opacity: 0.4; cursor: not-allowed; }
      .stepper span { min-width: 24px; text-align: center; font-weight: 600; font-size: var(--font-size-sm); }
      .hint-text { color: var(--text-faint); font-size: var(--font-size-xs); }
      .switch-label { font-size: var(--font-size-sm); color: var(--text-secondary); }

      .switch { width: 38px; height: 22px; border-radius: 999px; background: var(--bg-border); position: relative; border: none; cursor: pointer; flex-shrink: 0; padding: 0; }
      .switch.on { background: var(--color-purple); }
      .switch:disabled { opacity: 0.5; cursor: not-allowed; }
      .switch .thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left var(--transition-fast); }
      .switch.on .thumb { left: 18px; }

      .empty-hint { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; margin: 0; }

      .resume-list { display: flex; flex-direction: column; gap: var(--space-sm); }
      .resume-row {
        display: flex; align-items: center; justify-content: space-between; gap: var(--space-md);
        padding: var(--space-md); border-radius: var(--radius-md); border: 1.5px solid var(--color-purple);
        background: var(--bg-elevated);
      }
      .resume-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .resume-exam { font-weight: 600; font-size: var(--font-size-base); color: var(--text-primary); }
      .resume-sub { font-size: var(--font-size-xs); color: var(--text-muted); }
      .resume-actions { display: flex; gap: var(--space-sm); flex-shrink: 0; }
      .btn-resume {
        padding: 0 var(--space-md); min-height: var(--touch-min); border-radius: var(--radius-md); border: none;
        background: var(--color-purple); color: #fff; font-weight: 600; font-size: var(--font-size-sm); cursor: pointer;
      }
      .btn-resume:hover { filter: brightness(1.08); }
      .btn-ghost-sm {
        padding: 0 var(--space-md); min-height: var(--touch-min); border-radius: var(--radius-md);
        border: 1px solid var(--bg-border); background: transparent; color: var(--text-secondary);
        font-size: var(--font-size-sm); cursor: pointer;
      }
      .btn-ghost-sm:hover { background: var(--bg-subtle); }

      .conflict-banner {
        display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md);
        border-radius: var(--radius-md); border: 1.5px solid var(--color-red); background: var(--bg-elevated);
      }
      .conflict-banner p { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0; }
      .conflict-actions { display: flex; justify-content: flex-end; gap: var(--space-sm); }

      .start-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: var(--space-sm);
        width: 100%; min-height: 48px; padding: 0 var(--space-lg); border-radius: var(--radius-md);
        border: none; background: linear-gradient(135deg, var(--color-purple), var(--color-blue));
        color: #ffffff; font-weight: 600; font-size: var(--font-size-lg); cursor: pointer;
      }
      .start-btn:hover:not(:disabled) { filter: brightness(1.08); }
      .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    `,
  ],
})
export class QuizSetupComponent {
  protected readonly quiz = inject(QuizService);
  private readonly packs = inject(PacksService);
  private readonly settings = inject(SettingsService);
  private readonly attemptsService = inject(QuizAttemptsService);
  protected readonly i18n = inject(I18nService);

  protected readonly inProgress = this.attemptsService.inProgressAttempts;
  protected readonly pendingConflict = signal<QuizAttempt | null>(null);

  constructor() {
    void this.attemptsService.load();
  }

  protected readonly scope = signal<QuizScope>('pack');
  protected readonly mode = signal<QuizMode>('instant');
  protected readonly selectedDomains = signal<ReadonlySet<string>>(new Set());
  protected readonly countOverride = signal<number | null>(null);
  protected readonly shuffle = signal(true);
  protected readonly trackTime = signal(this.settings.defaultTrackTime());
  protected readonly useAccommodation = signal(this.settings.defaultUseAccommodation());

  protected readonly accommodationMinutes = computed(() => this.packs.activePack().accommodationMinutes ?? 0);
  protected readonly examDurationLabel = computed(() => {
    const pack = this.packs.activePack();
    return this.i18n.t('quizSetup.durationLabel', { minutes: pack.examDurationMinutes, count: pack.examTotalQuestions });
  });

  protected readonly activePackLabel = computed(() => packDisplayLabel(this.packs.activePack()));
  protected readonly examLabel = computed(() => {
    const examPacks = this.quiz.scopePools().examPacks;
    if (examPacks.length <= 1) return this.packs.activePack().name;
    const versions = examPacks.map((p) => p.version).filter(Boolean).join(' + ');
    return versions ? `${this.packs.activePack().name} (${versions})` : this.packs.activePack().name;
  });

  protected readonly domainsList = computed(() => this.quiz.domainsForScope(this.scope()));

  protected readonly filteredCount = computed(() => {
    const domains = this.selectedDomains();
    if (domains.size === 0) return this.quiz.scopePools().counts[this.scope()];
    return this.domainsList()
      .filter((d) => domains.has(d.name))
      .reduce((sum, d) => sum + d.count, 0);
  });

  protected readonly effectiveCount = computed(() => {
    const max = Math.max(this.filteredCount(), 1);
    const desired = this.countOverride() ?? Math.min(20, max);
    return Math.max(1, Math.min(desired, max));
  });

  readyLabel(scope: QuizScope): string {
    const count = this.quiz.scopePools().counts[scope];
    return this.i18n.t('quizSetup.questionCount', { count });
  }

  onSelectScope(scope: QuizScope): void {
    this.scope.set(scope);
    this.selectedDomains.set(new Set());
    this.countOverride.set(null);
  }

  onToggleDomain(name: string): void {
    const next = new Set(this.selectedDomains());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.selectedDomains.set(next);
    this.countOverride.set(null);
  }

  onChangeCount(delta: number): void {
    this.countOverride.set(this.effectiveCount() + delta);
  }

  answeredCount(attempt: QuizAttempt): number {
    return attempt.answers.filter((a) => a.checked).length;
  }

  onResume(attempt: QuizAttempt): void {
    this.quiz.resume(attempt);
  }

  async onDiscard(attempt: QuizAttempt): Promise<void> {
    await this.attemptsService.discard(attempt);
  }

  async onDiscardAndStart(attempt: QuizAttempt): Promise<void> {
    await this.attemptsService.discard(attempt);
    this.pendingConflict.set(null);
    this.beginQuiz();
  }

  onStart(): void {
    const examSlug = slugify(this.packs.activePack().name);
    const conflict = this.inProgress().find((a) => a.examSlug === examSlug);
    if (conflict) {
      this.pendingConflict.set(conflict);
      return;
    }
    this.beginQuiz();
  }

  private beginQuiz(): void {
    this.quiz.start({
      scope: this.scope(),
      mode: this.mode(),
      domains: [...this.selectedDomains()],
      count: this.effectiveCount(),
      shuffle: this.shuffle(),
      trackTime: this.quiz.timerAvailable() && this.trackTime(),
      useAccommodation: this.quiz.timerAvailable() && this.trackTime() && this.useAccommodation(),
    });
  }
}
