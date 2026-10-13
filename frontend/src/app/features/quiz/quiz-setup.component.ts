import { IconComponent } from '../../shared/components/icon.component';
import { ActivatedRoute } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAX_IN_PROGRESS_ATTEMPTS, QuizAttempt } from '../../core/models/quiz-attempt.model';
import { QuizMode, QuizScope } from '../../core/models/quiz.model';
import { PacksService } from '../../core/services/packs.service';
import { BanksService } from '../../core/services/banks.service';
import { BankPickerComponent, everyBankSelected } from '../../shared/components/bank-picker.component';
import { ProfileService } from '../../core/services/profile.service';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { formatClock, QuizService } from '../../core/services/quiz.service';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-quiz-setup',
  standalone: true,
  imports: [FormsModule, IconComponent, BankPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-card setup-card">
      <header class="card-header">
        <div>
          <h2>{{ i18n.t('quizSetup.title') }}</h2>
          <p class="subtitle">{{ i18n.t('quizSetup.subtitle') }}</p>
        </div>
        <button type="button" class="ui-btn ui-btn-sm" (click)="quiz.viewHistory()">{{ i18n.t('quizSetup.history') }}</button>
      </header>

      @if (inProgress().length > 0) {
        <div class="resume-list">
          <span class="ui-label">{{ i18n.t('quizSetup.inProgressCount', { count: inProgress().length, max: maxInProgress }) }}</span>
          @for (attempt of inProgress(); track attempt.id) {
            <div class="resume-row">
              <div class="resume-meta">
                <span class="resume-exam">{{ attempt.examName }}</span>
                <span class="resume-sub">
                  {{ attempt.mode === 'instant' ? i18n.t('quizSetup.instantFeedback') : i18n.t('quizSetup.examSimulation') }}
                  · {{ i18n.t('quizSetup.answeredOf', { answered: answeredCount(attempt), total: attempt.answers.length }) }}
                </span>
                <span class="resume-sub">
                  {{ i18n.t('quizSetup.startedAt', { date: formatStartedAt(attempt.startedAt) }) }}
                  · {{ i18n.t('quizSetup.stoppedAtQuestion', { index: attempt.currentIndex + 1 }) }}
                </span>
              </div>
              <div class="resume-actions">
                <button type="button" class="ui-btn ui-btn-sm" (click)="onDiscard(attempt)">{{ i18n.t('quizSetup.discard') }}</button>
                <button type="button" class="ui-btn ui-btn-primary" (click)="onResume(attempt)">{{ i18n.t('quizSetup.resume') }}</button>
              </div>
            </div>
          }
        </div>
      }

      @if (atInProgressLimit()) {
        <div class="conflict-banner" role="status">
          <p>{{ i18n.t('quizSetup.inProgressLimitReached', { max: maxInProgress }) }}</p>
        </div>
      }

      <div class="banks-head">
        <span class="ui-label">{{ i18n.t('quizSetup.banks') }}</span>
        @if (banks.banks().length > 0) {
          <button type="button" class="ui-btn ui-btn-sm" (click)="selectAllBanks()">
            {{ allBanksSelected() ? i18n.t('quizSetup.clearBanks') : i18n.t('quizSetup.selectAllBanks') }}
          </button>
        }
      </div>
      <p class="hint-text">{{ i18n.t('quizSetup.banksHint') }}</p>
      <app-bank-picker [selected]="selectedBanks()" (selectedChange)="onBanksChange($event)" />

      <span class="ui-label">{{ i18n.t('quizSetup.mode') }}</span>
      <div class="ui-segmented" role="tablist" [attr.aria-label]="i18n.t('quizSetup.quizMode')">
        <button
          type="button"
          class=""
          [class.active]="mode() === 'instant'"
          (click)="mode.set('instant')"
          role="tab"
          [attr.aria-selected]="mode() === 'instant'"
        >{{ i18n.t('quizSetup.instantFeedback') }}</button>
        <button
          type="button"
          class=""
          [class.active]="mode() === 'exam'"
          (click)="mode.set('exam')"
          role="tab"
          [attr.aria-selected]="mode() === 'exam'"
        >{{ i18n.t('quizSetup.examSimulation') }}</button>
      </div>

      @if (domainsList().length > 0) {
        <span class="ui-label">{{ i18n.t('quizSetup.filterByDomain') }}</span>
        <div class="filters-row">
          @for (d of domainsList(); track d.name) {
            <button
              type="button"
              class="ui-chip"
              [class.active]="selectedDomains().has(d.name)"
              (click)="onToggleDomain(d.name)"
            >{{ d.name }} ({{ d.count }})</button>
          }
        </div>
      }

      <div class="filters-row">
        <span class="switch-label">{{ i18n.t('quizSetup.questions') }}</span>
        <div class="stepper">
          <button type="button" (click)="onChangeCount(-5)" [disabled]="effectiveCount() <= 1" [attr.aria-label]="i18n.t('quizSetup.fewer')"><app-icon name="minus" /></button>
          <input
            type="number"
            inputmode="numeric"
            class="stepper-input"
            [ngModel]="effectiveCount()"
            (ngModelChange)="onCountInput($event)"
            [min]="1"
            [max]="filteredCount()"
            [attr.aria-label]="i18n.t('quizSetup.questions')"
          />
          <button type="button" (click)="onChangeCount(5)" [disabled]="effectiveCount() >= filteredCount()" [attr.aria-label]="i18n.t('quizSetup.more')"><app-icon name="plus" /></button>
        </div>
        <span class="hint-text">{{ i18n.t('quizSetup.ofAvailable', { count: filteredCount() }) }}</span>
      </div>

      <div class="filters-row">
        <button
          type="button"
          class="ui-switch"
          [class.on]="shuffle()"
          (click)="shuffle.set(!shuffle())"
          role="switch"
          [attr.aria-checked]="shuffle()"
          [attr.aria-label]="i18n.t('quizSetup.shuffleOrder')"
        ><span class="thumb"></span></button>
        <span class="switch-label">{{ i18n.t('quizSetup.shuffleOrder') }}</span>
      </div>

      <div class="filters-row">
        <button
          type="button"
          class="ui-switch"
          [class.on]="shuffleAlternatives()"
          (click)="shuffleAlternatives.set(!shuffleAlternatives())"
          role="switch"
          [attr.aria-checked]="shuffleAlternatives()"
          [attr.aria-label]="i18n.t('quizSetup.shuffleAlternatives')"
        ><span class="thumb"></span></button>
        <span class="switch-label">{{ i18n.t('quizSetup.shuffleAlternatives') }}</span>
      </div>

      @if (quiz.timerAvailable()) {
        @if (mode() === 'instant') {
          <!-- Instant feedback always paces each question against the real exam;
               only exam simulation has an optional whole-exam clock. -->
          <div class="filters-row">
            <app-icon name="clock" />
            <span class="switch-label">{{ i18n.t('quizSetup.perQuestionClock', { time: perQuestionLabel(), label: examDurationLabel() }) }}</span>
          </div>
        } @else {
        <div class="filters-row">
          <button
            type="button"
            class="ui-switch"
            [class.on]="trackTime()"
            (click)="trackTime.set(!trackTime())"
            role="switch"
            [attr.aria-checked]="trackTime()"
            [attr.aria-label]="i18n.t('quizSetup.trackTime')"
          ><span class="thumb"></span></button>
          <span class="switch-label">{{ i18n.t('quizSetup.trackTimeWithLabel', { label: examDurationLabel() }) }}</span>
        </div>
        }
        @if (accommodationMinutes() > 0) {
          <div class="filters-row">
            <button
              type="button"
              class="ui-switch"
              [class.on]="useAccommodation()"
              [disabled]="!timeTracked()"
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

      <button type="button" class="ui-btn ui-btn-primary start" [disabled]="filteredCount() === 0 || atInProgressLimit()" (click)="onStart()">
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
        max-width: 640px;
        margin: 0 auto;
      }
      .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); }
      .card-header h2 { font-size: var(--font-size-xl); margin-bottom: var(--space-xs); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); }

      .banks-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }

      .filters-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }

      .stepper { display: inline-flex; align-items: center; gap: var(--space-sm); border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); padding: 0 var(--space-xs); height: 36px; }
      .stepper button { width: 28px; height: 28px; border: none; background: transparent; color: var(--text-secondary); font-size: var(--font-size-lg); cursor: pointer; border-radius: var(--radius-sm); }
      .stepper button:hover:not(:disabled) { background: var(--bg-subtle); }
      .stepper button:disabled { opacity: 0.4; cursor: not-allowed; }
      .stepper span { min-width: 24px; text-align: center; font-weight: 600; font-size: var(--font-size-sm); }
      .stepper-input {
        width: 48px; min-width: 0; text-align: center; font-weight: 600; font-size: var(--font-size-sm);
        border: none; background: transparent; color: var(--text-primary); font-family: var(--font-family);
        -moz-appearance: textfield;
      }
      .stepper-input::-webkit-outer-spin-button, .stepper-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .stepper-input:focus { outline: none; }
      .hint-text { color: var(--text-faint); font-size: var(--font-size-xs); }
      .switch-label { font-size: var(--font-size-sm); color: var(--text-secondary); }

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

      .conflict-banner {
        display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md);
        border-radius: var(--radius-md); border: 1.5px solid var(--color-red); background: var(--bg-elevated);
      }
      .conflict-banner p { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0; }
      .start { width: 100%; min-height: 48px; font-size: var(--font-size-lg); }
    `,
  ],
})
export class QuizSetupComponent {
  protected readonly quiz = inject(QuizService);
  private readonly packs = inject(PacksService);
  private readonly settings = inject(SettingsService);
  private readonly attemptsService = inject(QuizAttemptsService);
  protected readonly i18n = inject(I18nService);

  protected readonly banks = inject(BanksService);
  private readonly profile = inject(ProfileService);
  /** Open sessions of this certification (the 5-session limit still counts every certification). */
  protected readonly inProgress = computed(() => {
    const packId = this.packs.activePack().id;
    return this.attemptsService.inProgressAttempts().filter((a) => a.packId === packId);
  });
  protected readonly maxInProgress = MAX_IN_PROGRESS_ATTEMPTS;
  protected readonly atInProgressLimit = computed(
    () => this.attemptsService.inProgressAttempts().length >= MAX_IN_PROGRESS_ATTEMPTS,
  );
  private static readonly DATE_LOCALES: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES', it: 'it-IT' };

  constructor() {
    void this.attemptsService.load();
    // ?domain= (Performance page "Practice") preselects one domain.
    const domain = inject(ActivatedRoute).snapshot.queryParamMap.get('domain');
    if (domain) queueMicrotask(() => this.selectedDomains.set(new Set([domain])));
  }

  protected readonly scope = signal<QuizScope>('pack');
  protected readonly mode = signal<QuizMode>('instant');
  protected readonly selectedDomains = signal<ReadonlySet<string>>(new Set());
  protected readonly countOverride = signal<number | null>(null);
  protected readonly shuffle = signal(true);
  protected readonly shuffleAlternatives = signal(true);
  protected readonly trackTime = signal(this.settings.defaultTrackTime());
  protected readonly useAccommodation = signal(
    this.settings.defaultUseAccommodation() || this.profile.profile().useAccommodationByDefault,
  );
  /** Empty = every bank (also what a certification with a single bank always uses). */
  protected readonly selectedBanks = signal<ReadonlySet<string>>(new Set());
  private readonly bankIdList = computed(() => [...this.selectedBanks()]);

  protected readonly allBanksSelected = computed(() => everyBankSelected(this.banks.banks(), this.selectedBanks()));

  protected readonly accommodationMinutes = computed(() => this.packs.activePack().accommodationMinutes ?? 0);
  protected readonly examDurationLabel = computed(() => {
    const pack = this.packs.activePack();
    return this.i18n.t('quizSetup.durationLabel', { minutes: pack.examDurationMinutes, count: pack.examTotalQuestions });
  });

  /** Instant mode always tracks time (the per-question clock); exam mode only
   * when the student turns the whole-exam clock on. */
  protected readonly timeTracked = computed(
    () => this.quiz.timerAvailable() && (this.mode() === 'instant' || this.trackTime()),
  );

  /** Seconds per question of the REAL exam: its duration (plus accommodation,
   * when used) over its official question count. Never this session's count,
   * and never a universal value: two 75-question exams with different
   * durations get different budgets. Mirrors QuizService.perQuestionSeconds. */
  protected readonly perQuestionLabel = computed(() => {
    const pack = this.packs.activePack();
    const minutes =
      (pack.examDurationMinutes ?? 0) + (this.useAccommodation() ? (pack.accommodationMinutes ?? 0) : 0);
    const total = pack.examTotalQuestions ?? 0;
    return total > 0 ? formatClock((minutes * 60) / total) : '';
  });

  protected readonly domainsList = computed(() => this.quiz.domainsForScope(this.scope(), this.bankIdList()));

  protected readonly filteredCount = computed(() => {
    const domains = this.selectedDomains();
    if (domains.size === 0) return this.quiz.poolFor(this.scope(), this.bankIdList()).length;
    return this.domainsList()
      .filter((d) => domains.has(d.name))
      .reduce((sum, d) => sum + d.count, 0);
  });

  protected readonly effectiveCount = computed(() => {
    const max = Math.max(this.filteredCount(), 1);
    const desired = this.countOverride() ?? max;
    return Math.max(1, Math.min(desired, max));
  });

  onBanksChange(next: ReadonlySet<string>): void {
    this.selectedBanks.set(next);
    this.selectedDomains.set(new Set());
    this.countOverride.set(null);
  }

  selectAllBanks(): void {
    this.selectedBanks.set(this.allBanksSelected() ? new Set() : new Set(this.banks.banks().map((b) => b.id)));
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

  onCountInput(value: number): void {
    if (!Number.isFinite(value)) return;
    this.countOverride.set(Math.round(value));
  }

  /** Same rule as the runner's own navigator (QuizService.answeredFlags): a
   * question counts once something is selected. Counting only `checked` answers
   * read 0 for every exam-mode session, which is graded only at finish(). */
  answeredCount(attempt: QuizAttempt): number {
    return attempt.answers.filter((a) => a.selected.length > 0).length;
  }

  formatStartedAt(startedAt: number): string {
    const locale = QuizSetupComponent.DATE_LOCALES[this.i18n.lang()] ?? 'en-US';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(startedAt);
  }

  onResume(attempt: QuizAttempt): void {
    this.quiz.resume(attempt);
  }

  async onDiscard(attempt: QuizAttempt): Promise<void> {
    await this.attemptsService.discard(attempt);
  }

  onStart(): void {
    // Several sessions of the same exam may coexist (that is the point of
    // interleaving them); the only gate is the total number left open.
    if (this.atInProgressLimit()) return;
    this.beginQuiz();
  }

  private beginQuiz(): void {
    this.quiz.start({
      scope: 'pack',
      bankIds: this.bankIdList(),
      mode: this.mode(),
      domains: [...this.selectedDomains()],
      count: this.effectiveCount(),
      shuffle: this.shuffle(),
      shuffleAlternatives: this.shuffleAlternatives(),
      trackTime: this.timeTracked(),
      useAccommodation: this.timeTracked() && this.useAccommodation(),
    });
  }
}
