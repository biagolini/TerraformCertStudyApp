import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BanksService } from '../../core/services/banks.service';
import { NotesService } from '../../core/services/notes.service';
import { PacksService } from '../../core/services/packs.service';
import { QuestionsService } from '../../core/services/questions.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { Flashcard, flashcardsFromMarkdown, questionToFlashcard, shuffled } from '../../core/utils/flashcard.util';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';

type Source = 'questions' | 'notes';

/**
 * /exam/:packId/flashcards — simple flip cards (no spaced repetition) built
 * from the certification's questions, or from "Front | Back" tables in its
 * notes (the format the note copilot's "Flashcards" action produces).
 */
@Component({
  selector: 'app-flashcards-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MarkdownRendererComponent],
  template: `
    <div class="ui-page">
      <header class="ui-page-head">
        <div>
          <h2>{{ i18n.t('flashcards.title') }}</h2>
          <p>{{ i18n.t('flashcards.subtitle') }}</p>
        </div>
      </header>

      <section class="ui-card setup">
        <div class="ui-chip-row" role="group" [attr.aria-label]="i18n.t('flashcards.source')">
          <button type="button" class="ui-chip" [class.active]="source() === 'questions'" (click)="setSource('questions')">{{ i18n.t('flashcards.fromQuestions') }}</button>
          <button type="button" class="ui-chip" [class.active]="source() === 'notes'" (click)="setSource('notes')">{{ i18n.t('flashcards.fromNotes') }}</button>
        </div>
        @if (source() === 'questions') {
          <div class="ui-form-row">
            <label class="ui-field">
              <span>{{ i18n.t('nav.banks') }}</span>
              <select class="ui-input" [ngModel]="bankId()" (ngModelChange)="bankId.set($event); restart()">
                <option value="">{{ i18n.t('banks.allQuestions') }}</option>
                @for (b of banks.banks(); track b.id) {
                  <option [value]="b.id">{{ b.name }}</option>
                }
              </select>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('flashcards.domain') }}</span>
              <select class="ui-input" [ngModel]="domain()" (ngModelChange)="domain.set($event); restart()">
                <option value="">{{ i18n.t('flashcards.allDomains') }}</option>
                @for (d of packs.activeDomains(); track d.name) {
                  <option [value]="d.name">{{ d.name }}</option>
                }
              </select>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('flashcards.only') }}</span>
              <select class="ui-input" [ngModel]="onlyStarred() ? 'starred' : 'all'" (ngModelChange)="onlyStarred.set($event === 'starred'); restart()">
                <option value="all">{{ i18n.t('flashcards.allQuestions') }}</option>
                <option value="starred">{{ i18n.t('flashcards.starred') }}</option>
              </select>
            </label>
          </div>
        } @else if (loadingNotes()) {
          <p class="ui-muted">{{ i18n.t('common.loading') }}</p>
        } @else if (noteCards().length === 0) {
          <p class="ui-muted">{{ i18n.t('flashcards.noNoteCards') }}</p>
        }
        <div class="ui-actions">
          <button type="button" class="ui-btn" (click)="restart(true)">🔀 {{ i18n.t('flashcards.shuffle') }}</button>
          <span class="ui-faint">{{ i18n.t('flashcards.deckSize', { n: deck().length }) }} · ✓ {{ known() }} · ↺ {{ again() }}</span>
        </div>
      </section>

      @if (current(); as card) {
        <div class="progress ui-progress" aria-hidden="true"><span [style.width.%]="((index() + 1) / deck().length) * 100"></span></div>
        <button type="button" class="card" [class.flipped]="flipped()" (click)="flipped.set(!flipped())" [attr.aria-label]="flipped() ? i18n.t('flashcards.showFront') : i18n.t('flashcards.showBack')">
          <span class="side-label">{{ flipped() ? i18n.t('flashcards.back') : i18n.t('flashcards.front') }} · {{ index() + 1 }}/{{ deck().length }}</span>
          <div class="card-body">
            <app-markdown-renderer [source]="flipped() ? card.back : card.front" />
          </div>
          <span class="card-foot ui-faint">{{ card.domain ?? card.source }}</span>
        </button>
        <div class="controls">
          <button type="button" class="ui-btn" [disabled]="index() === 0" (click)="move(-1)">← {{ i18n.t('common.back') }}</button>
          <button type="button" class="ui-btn ui-btn-soft" (click)="mark('again')">↺ {{ i18n.t('flashcards.again') }}</button>
          <button type="button" class="ui-btn ui-btn-accent" (click)="mark('known')">✓ {{ i18n.t('flashcards.gotIt') }}</button>
          <button type="button" class="ui-btn" [disabled]="index() >= deck().length - 1" (click)="move(1)">{{ i18n.t('common.next') }} →</button>
        </div>
        <p class="ui-faint hint">{{ i18n.t('flashcards.keyboardHint') }}</p>
      } @else if (deck().length > 0) {
        <section class="ui-empty">
          <h3>{{ i18n.t('flashcards.doneTitle') }}</h3>
          <p>{{ i18n.t('flashcards.doneBody', { known: known(), again: again() }) }}</p>
          <button type="button" class="ui-btn ui-btn-primary" (click)="restart(true)">{{ i18n.t('flashcards.restart') }}</button>
        </section>
      } @else if (source() === 'questions') {
        <section class="ui-empty">
          <h3>{{ i18n.t('flashcards.emptyTitle') }}</h3>
          <p>{{ i18n.t('flashcards.emptyBody') }}</p>
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
      .ui-page {
        max-width: 860px;
      }
      .setup {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        width: 100%;
        min-height: 320px;
        padding: var(--space-lg);
        border-radius: var(--radius-lg);
        border: 1px solid var(--bg-border);
        background: var(--bg-surface);
        box-shadow: var(--shadow-md);
        color: var(--text-primary);
        text-align: left;
        cursor: pointer;
        transition: border-color var(--transition-fast), background var(--transition-fast);
      }
      .card.flipped {
        border-color: var(--pack-color, var(--color-purple));
        background: linear-gradient(180deg, var(--pack-color-soft, rgba(108, 92, 231, 0.08)), transparent 200px), var(--bg-surface);
      }
      .side-label {
        font-size: var(--font-size-xs);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-faint);
      }
      .card-body {
        flex: 1;
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--space-sm);
      }
      .hint {
        text-align: center;
      }
    `,
  ],
})
export class FlashcardsPageComponent {
  protected readonly banks = inject(BanksService);
  protected readonly packs = inject(PacksService);
  private readonly questions = inject(QuestionsService);
  private readonly notes = inject(NotesService);
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();

  readonly source = signal<Source>('questions');
  readonly bankId = signal('');
  readonly domain = signal('');
  readonly onlyStarred = signal(false);
  readonly noteCards = signal<Flashcard[]>([]);
  readonly loadingNotes = signal(false);

  readonly deck = signal<Flashcard[]>([]);
  readonly index = signal(0);
  readonly flipped = signal(false);
  readonly known = signal(0);
  readonly again = signal(0);

  readonly current = computed(() => this.deck()[this.index()] ?? null);

  private readonly questionCards = computed(() => {
    const bank = this.bankId();
    const domain = this.domain();
    const starred = this.onlyStarred();
    const bankNames = new Map(this.banks.banks().map((b) => [b.id, b.name]));
    return this.questions
      .questions()
      .filter((q) => (!bank || q.bankId === bank) && (!domain || q.domain === domain) && (!starred || q.starred))
      .map((q) => questionToFlashcard(q, bankNames.get(q.bankId) ?? ''));
  });

  constructor() {
    queueMicrotask(() => this.restart(true));
  }

  async setSource(source: Source): Promise<void> {
    this.source.set(source);
    if (source === 'notes' && this.noteCards().length === 0) await this.loadNoteCards();
    this.restart(true);
  }

  /** Rebuilds the deck from the current filters. */
  restart(shuffle = false): void {
    const cards = this.source() === 'questions' ? this.questionCards() : this.noteCards();
    this.deck.set(shuffle ? shuffled(cards) : cards);
    this.index.set(0);
    this.flipped.set(false);
    this.known.set(0);
    this.again.set(0);
  }

  move(delta: number): void {
    this.index.set(Math.max(0, Math.min(this.deck().length - 1, this.index() + delta)));
    this.flipped.set(false);
  }

  /** "Again" re-queues the card at the end of the deck; "Got it" just moves on. */
  mark(kind: 'known' | 'again'): void {
    const card = this.current();
    if (!card) return;
    if (kind === 'known') this.known.update((n) => n + 1);
    else {
      this.again.update((n) => n + 1);
      this.deck.update((d) => [...d, card]);
    }
    this.index.update((i) => i + 1);
    this.flipped.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (!this.current()) return;
    if (event.key === ' ') {
      event.preventDefault();
      this.flipped.update((f) => !f);
    } else if (event.key === 'ArrowRight') this.move(1);
    else if (event.key === 'ArrowLeft') this.move(-1);
  }

  private async loadNoteCards(): Promise<void> {
    this.loadingNotes.set(true);
    try {
      const cards: Flashcard[] = [];
      for (const note of this.notes.notes()) {
        const body = await this.notes.loadBody(note.id).catch(() => '');
        cards.push(...flashcardsFromMarkdown(body, note.title, note.id));
      }
      this.noteCards.set(cards);
    } finally {
      this.loadingNotes.set(false);
    }
  }
}
