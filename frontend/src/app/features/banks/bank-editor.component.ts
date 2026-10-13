import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY_BANK_DRAFT, QuestionBank, QuestionBankDraft, bankLabel } from '../../core/models/bank.model';
import { PacksService } from '../../core/services/packs.service';
import { IconComponent } from '../../shared/components/icon.component';
import { BanksService } from '../../core/services/banks.service';
import { AuthorsService } from '../../core/services/authors.service';
import { QuestionsService } from '../../core/services/questions.service';
import { I18nService } from '../../core/i18n/i18n.service';

/** Create/edit/delete a question bank, as a modal. */
@Component({
  selector: 'app-bank-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="ui-modal-backdrop" (click)="closed.emit()">
      <form class="ui-modal" role="dialog" aria-modal="true" aria-labelledby="bank-editor-title" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <header class="ui-modal-head">
          <div>
            <h2 id="bank-editor-title">{{ bank() ? i18n.t('banks.editBank') : i18n.t('banks.newBank') }}</h2>
            <p>{{ i18n.t('banks.editorHint') }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="closed.emit()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
        </header>
        <div class="ui-modal-body">
          <div class="context">
            <span class="ui-label">{{ i18n.t('banks.certification') }}</span>
            <span class="context-name">
              @if (pack()?.code) {
                <span class="ui-code" [style.--chip-color]="pack()?.color">{{ pack()?.code }}</span>
              }
              {{ pack()?.name }}
            </span>
          </div>
          <div class="ui-form-row">
            <label class="ui-field">
              <span>{{ i18n.t('banks.author') }} *</span>
              @if (newAuthor()) {
                <input class="ui-input" name="author" [(ngModel)]="draft.author" required maxlength="80" [placeholder]="i18n.t('banks.authorPlaceholder')" />
                @if (authors.authors().length > 0) {
                  <button type="button" class="ui-link" (click)="pickExisting()">{{ i18n.t('authors.pickExisting') }}</button>
                }
              } @else {
                <select class="ui-input" name="authorPick" [ngModel]="draft.author" (ngModelChange)="onAuthorPick($event)" required>
                  <option value="" disabled>{{ i18n.t('authors.choose') }}</option>
                  @for (a of authors.authors(); track a.id) {
                    <option [value]="a.name">{{ a.name }}</option>
                  }
                  <option [value]="NEW_AUTHOR">+ {{ i18n.t('authors.new') }}</option>
                </select>
              }
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('banks.version') }}</span>
              <input class="ui-input" name="version" [(ngModel)]="draft.version" [placeholder]="i18n.t('banks.versionPlaceholder')" />
            </label>
          </div>
          <label class="ui-field">
            <span>{{ i18n.t('banks.sourceUrl') }}</span>
            <input class="ui-input" name="sourceUrl" type="url" [(ngModel)]="draft.sourceUrl" placeholder="https://" />
          </label>
          <label class="ui-field">
            <span>{{ i18n.t('banks.description') }}</span>
            <textarea class="ui-input" name="description" rows="3" [(ngModel)]="draft.description"></textarea>
          </label>
          @if (confirmDelete()) {
            <div class="confirm" role="alert">
              <p>{{ i18n.t('banks.deleteConfirm', { name: label(), n: questionCount() }) }}</p>
              <div class="ui-actions">
                <button type="button" class="ui-btn ui-btn-sm" (click)="confirmDelete.set(false)">{{ i18n.t('common.cancel') }}</button>
                <button type="button" class="ui-btn ui-btn-danger ui-btn-sm" [disabled]="busy()" (click)="remove()">{{ i18n.t('common.delete') }}</button>
              </div>
            </div>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        </div>
        <footer class="ui-modal-foot">
          @if (bank()) {
            <button type="button" class="ui-btn ui-btn-danger" (click)="confirmDelete.set(true)">{{ i18n.t('banks.deleteBank') }}</button>
            <span class="spacer"></span>
          }
          <button type="button" class="ui-btn" (click)="closed.emit()">{{ i18n.t('common.cancel') }}</button>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="!draft.author.trim()">{{ i18n.t('common.save') }}</button>
        </footer>
      </form>
    </div>
  `,
  styles: [
    `
      .spacer {
        flex: 1;
      }
      .context {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
      }
      .context-name {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-weight: 600;
      }
      .confirm {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
        border: 1px solid rgba(214, 48, 49, 0.35);
        border-radius: var(--radius-md);
        background: rgba(214, 48, 49, 0.06);
      }
      .error {
        color: var(--color-red);
      }
    `,
  ],
})
export class BankEditorComponent implements OnInit {
  private readonly banks = inject(BanksService);
  private readonly questions = inject(QuestionsService);
  private readonly packs = inject(PacksService);
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();
  readonly bank = input<QuestionBank | null>(null);
  /** Preselected author for a new bank (e.g. the author filter active on the Banks page). */
  readonly author = input('');
  readonly closed = output<void>();
  readonly saved = output<QuestionBank>();
  readonly deleted = output<string>();

  protected draft: QuestionBankDraft = { ...EMPTY_BANK_DRAFT };
  readonly confirmDelete = signal(false);
  /** The certification comes from the workspace; shown read-only for context. */
  readonly pack = computed(() => this.packs.getById(this.packId()) ?? null);
  readonly label = computed(() => {
    const b = this.bank();
    return b ? bankLabel(b, this.i18n.t('banks.untitled')) : '';
  });
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly authors = inject(AuthorsService);
  protected readonly NEW_AUTHOR = '__new_author__';
  /** Typing a new author name instead of picking one; the default when none exists yet. */
  readonly newAuthor = signal(false);

  onAuthorPick(value: string): void {
    if (value === this.NEW_AUTHOR) {
      this.draft = { ...this.draft, author: '' };
      this.newAuthor.set(true);
    } else {
      this.draft = { ...this.draft, author: value };
    }
  }

  pickExisting(): void {
    this.draft = { ...this.draft, author: this.authors.byName(this.draft.author)?.name ?? '' };
    this.newAuthor.set(false);
  }
  readonly questionCount = computed(() => {
    const id = this.bank()?.id;
    return id ? this.questions.allQuestions().filter((q) => q.bankId === id).length : 0;
  });

  ngOnInit(): void {
    const b = this.bank();
    if (b) this.draft = { author: b.author, version: b.version, sourceUrl: b.sourceUrl, description: b.description };
    else if (this.author()) this.draft = { ...this.draft, author: this.authors.byName(this.author())?.name ?? this.author() };
    if (this.authors.authors().length === 0) this.newAuthor.set(true);
  }

  save(): void {
    if (!this.draft.author.trim()) return;
    // A typed name joins the author list (or reuses the one with that name, any case).
    const author = this.authors.ensure(this.draft.author);
    if (author) this.draft = { ...this.draft, author: author.name };
    const existing = this.bank();
    if (existing) {
      this.banks.update(existing.id, this.draft);
      this.saved.emit(this.banks.getById(existing.id) ?? existing);
    } else {
      this.saved.emit(this.banks.create(this.packId(), this.draft));
    }
  }

  async remove(): Promise<void> {
    const b = this.bank();
    if (!b) return;
    this.busy.set(true);
    this.error.set(null);
    const ok = await this.banks.remove(b.id);
    this.busy.set(false);
    if (ok) this.deleted.emit(b.id);
    else this.error.set(this.i18n.t('banks.deleteFailed'));
  }
}
