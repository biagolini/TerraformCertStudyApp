import { IconComponent } from '../../shared/components/icon.component';
import { ActivatedRoute } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAX_IN_PROGRESS_ATTEMPTS, QuizAttempt } from '../../core/models/quiz-attempt.model';
import { QuizMode, QuizScope } from '../../core/models/quiz.model';
import { PacksService } from '../../core/services/packs.service';
import { BanksService, groupByAuthor } from '../../core/services/banks.service';
import { ProfileService } from '../../core/services/profile.service';
import { QuestionsService } from '../../core/services/questions.service';
import { QuizAttemptsService } from '../../core/services/quiz-attempts.service';
import { QuizService } from '../../core/services/quiz.service';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-quiz-setup',
  standalone: true,
  imports: [FormsModule, IconComponent],
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
          <span class="field-label">{{ i18n.t('quizSetup.inProgressCount', { count: inProgress().length, max: maxInProgress }) }}</span>
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
                <button type="button" class="btn-ghost-sm" (click)="onDiscard(attempt)">{{ i18n.t('quizSetup.discard') }}</button>
                <button type="button" class="btn-resume" (click)="onResume(attempt)">{{ i18n.t('quizSetup.resume') }}</button>
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
        <span class="field-label">{{ i18n.t('quizSetup.banks') }}</span>
        @if (bankGroups().length > 0) {
          <button type="button" class="history-link" (click)="selectAllBanks()">
            {{ allBanksSelected() ? i18n.t('quizSetup.clearBanks') : i18n.t('quizSetup.selectAllBanks') }}
          </button>
        }
      </div>
      <p class="hint-text">{{ i18n.t('quizSetup.banksHint') }}</p>
      @if (bankGroups().length === 0) {
        <p class="empty-hint">{{ i18n.t('quizSetup.noBanks') }}</p>
      }
      @for (group of bankGroups(); track group.author) {
        <div class="bank-group">
          <div class="bank-group-head">
            <span class="bank-author"><app-icon name="user" size="14" /> {{ group.author || i18n.t('banks.noAuthor') }}</span>
            <button type="button" class="history-link" (click)="toggleAuthor(group.author)">
              {{ authorFullySelected(group.author) ? i18n.t('quizSetup.unselectAuthor') : i18n.t('quizSetup.selectAuthor') }}
            </button>
          </div>
          <div class="bank-grid">
            @for (b of group.banks; track b.bank.id) {
              <button type="button" class="bank-chip" [class.selected]="selectedBanks().has(b.bank.id)" (click)="toggleBank(b.bank.id)" [attr.aria-pressed]="selectedBanks().has(b.bank.id)">
                <span class="bank-check" aria-hidden="true">@if (selectedBanks().has(b.bank.id)) { <app-icon name="check" size="12" /> }</span>
                <span class="bank-name">{{ b.bank.version || i18n.t('banks.noVersion') }}</span>
                <span class="bank-count">{{ b.count }}</span>
              </button>
            }
          </div>
        </div>
      }

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

      <button type="button" class="start-btn" [disabled]="filteredCount() === 0 || atInProgressLimit()" (click)="onStart()">
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

      .banks-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
      .bank-group { display: flex; flex-direction: column; gap: 6px; padding: var(--space-sm) var(--space-md); border: 1px solid var(--bg-border); border-radius: var(--radius-md); }
      .bank-group-head { display: flex; align-items: center; justify-content: space-between; }
      .bank-author { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }
      .bank-grid { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); }
      .bank-chip { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 10px; border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary); text-align: left; cursor: pointer; }
      .bank-chip.selected { border-color: var(--color-purple); background: rgba(108, 92, 231, 0.08); }
      .bank-check { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--bg-border); font-size: 12px; color: #fff; flex-shrink: 0; }
      .bank-chip.selected .bank-check { background: var(--color-purple); border-color: var(--color-purple); }
      .bank-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-sm); font-weight: 600; }
      .bank-count { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--text-muted); }
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
      .stepper-input {
        width: 48px; min-width: 0; text-align: center; font-weight: 600; font-size: var(--font-size-sm);
        border: none; background: transparent; color: var(--text-primary); font-family: var(--font-family);
        -moz-appearance: textfield;
      }
      .stepper-input::-webkit-outer-spin-button, .stepper-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .stepper-input:focus { outline: none; }
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

  private readonly banks = inject(BanksService);
  private readonly profile = inject(ProfileService);
  private readonly questions = inject(QuestionsService);
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
  protected readonly trackTime = signal(this.settings.defaultTrackTime());
  protected readonly useAccommodation = signal(
    this.settings.defaultUseAccommodation() || this.profile.profile().useAccommodationByDefault,
  );
  /** Empty = every bank (also what a certification with a single bank always uses). */
  protected readonly selectedBanks = signal<ReadonlySet<string>>(new Set());
  private readonly bankIdList = computed(() => [...this.selectedBanks()]);

  protected readonly bankGroups = computed(() => {
    const counts = new Map<string, number>();
    for (const q of this.questions.questions()) counts.set(q.bankId, (counts.get(q.bankId) ?? 0) + 1);
    return groupByAuthor(this.banks.banks()).map((g) => ({
      author: g.author,
      banks: g.banks.map((bank) => ({ bank, count: counts.get(bank.id) ?? 0 })),
    }));
  });
  protected readonly allBanksSelected = computed(
    () => this.banks.banks().length > 0 && this.banks.banks().every((b) => this.selectedBanks().has(b.id)),
  );

  protected readonly accommodationMinutes = computed(() => this.packs.activePack().accommodationMinutes ?? 0);
  protected readonly examDurationLabel = computed(() => {
    const pack = this.packs.activePack();
    return this.i18n.t('quizSetup.durationLabel', { minutes: pack.examDurationMinutes, count: pack.examTotalQuestions });
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

  toggleBank(id: string): void {
    const next = new Set(this.selectedBanks());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedBanks.set(next);
    this.selectedDomains.set(new Set());
    this.countOverride.set(null);
  }

  selectAllBanks(): void {
    this.selectedBanks.set(this.allBanksSelected() ? new Set() : new Set(this.banks.banks().map((b) => b.id)));
    this.selectedDomains.set(new Set());
    this.countOverride.set(null);
  }

  authorFullySelected(author: string): boolean {
    const ids = this.banks.banks().filter((b) => b.author.trim() === author).map((b) => b.id);
    return ids.length > 0 && ids.every((id) => this.selectedBanks().has(id));
  }

  toggleAuthor(author: string): void {
    const ids = this.banks.banks().filter((b) => b.author.trim() === author).map((b) => b.id);
    const next = new Set(this.selectedBanks());
    const select = !this.authorFullySelected(author);
    for (const id of ids) {
      if (select) next.add(id);
      else next.delete(id);
    }
    this.selectedBanks.set(next);
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
      trackTime: this.quiz.timerAvailable() && this.trackTime(),
      useAccommodation: this.quiz.timerAvailable() && this.trackTime() && this.useAccommodation(),
    });
  }
}
