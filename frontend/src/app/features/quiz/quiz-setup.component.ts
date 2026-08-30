import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { packDisplayLabel } from '../../core/models/pack.model';
import { QuizMode, QuizScope } from '../../core/models/quiz.model';
import { PacksService } from '../../core/services/packs.service';
import { QuizService } from '../../core/services/quiz.service';

@Component({
  selector: 'app-quiz-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="setup-card">
      <header class="card-header">
        <h2>Start a practice quiz</h2>
        <p class="subtitle">Answer your own reviewed questions as a quiz.</p>
      </header>

      <span class="field-label">Scope</span>
      <div class="scope-group">
        <button
          type="button"
          class="scope-card"
          [class.selected]="scope() === 'pack'"
          (click)="onSelectScope('pack')"
        >
          <span class="scope-title">This pack</span>
          <span class="scope-count">{{ activePackLabel() }} — {{ readyLabel('pack') }}</span>
        </button>
        <button
          type="button"
          class="scope-card"
          [class.selected]="scope() === 'exam'"
          (click)="onSelectScope('exam')"
        >
          <span class="scope-title">All packs for this exam</span>
          <span class="scope-count">{{ examLabel() }} — {{ readyLabel('exam') }}</span>
        </button>
        <button
          type="button"
          class="scope-card"
          [class.selected]="scope() === 'all'"
          (click)="onSelectScope('all')"
        >
          <span class="scope-title">All packs</span>
          <span class="scope-count">Every certification you track — {{ readyLabel('all') }}</span>
        </button>
      </div>

      <span class="field-label">Mode</span>
      <div class="mode-toggle" role="tablist" aria-label="Quiz mode">
        <button
          type="button"
          class="mode-btn"
          [class.active]="mode() === 'instant'"
          (click)="mode.set('instant')"
          role="tab"
          [attr.aria-selected]="mode() === 'instant'"
        >Instant feedback</button>
        <button
          type="button"
          class="mode-btn"
          [class.active]="mode() === 'exam'"
          (click)="mode.set('exam')"
          role="tab"
          [attr.aria-selected]="mode() === 'exam'"
        >Exam simulation</button>
      </div>

      @if (domainsList().length > 0) {
        <span class="field-label">Filter by domain (optional)</span>
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
        <span class="switch-label">Questions</span>
        <div class="stepper">
          <button type="button" (click)="onChangeCount(-5)" [disabled]="effectiveCount() <= 1">−</button>
          <span>{{ effectiveCount() }}</span>
          <button type="button" (click)="onChangeCount(5)" [disabled]="effectiveCount() >= filteredCount()">+</button>
        </div>
        <span class="hint-text">of {{ filteredCount() }} available</span>
      </div>

      <div class="filters-row">
        <button
          type="button"
          class="switch"
          [class.on]="shuffle()"
          (click)="shuffle.set(!shuffle())"
          role="switch"
          [attr.aria-checked]="shuffle()"
          aria-label="Shuffle order"
        ><span class="thumb"></span></button>
        <span class="switch-label">Shuffle order</span>
      </div>

      @if (filteredCount() === 0) {
        <p class="empty-hint">No questions in this scope yet — add some from the Create tab first.</p>
      }

      <button type="button" class="start-btn" [disabled]="filteredCount() === 0" (click)="onStart()">
        Start quiz
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
      .card-header h2 { font-size: var(--font-size-xl); margin-bottom: var(--space-xs); }
      .subtitle { color: var(--text-muted); font-size: var(--font-size-sm); }
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
      .switch .thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left var(--transition-fast); }
      .switch.on .thumb { left: 18px; }

      .empty-hint { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; margin: 0; }

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
  private readonly quiz = inject(QuizService);
  private readonly packs = inject(PacksService);

  protected readonly scope = signal<QuizScope>('pack');
  protected readonly mode = signal<QuizMode>('instant');
  protected readonly selectedDomains = signal<ReadonlySet<string>>(new Set());
  protected readonly countOverride = signal<number | null>(null);
  protected readonly shuffle = signal(true);

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
    return count === 1 ? '1 question' : `${count} questions`;
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

  onStart(): void {
    this.quiz.start({
      scope: this.scope(),
      mode: this.mode(),
      domains: [...this.selectedDomains()],
      count: this.effectiveCount(),
      shuffle: this.shuffle(),
    });
  }
}
