import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BanksService, groupByAuthorWithRegistered } from '../../core/services/banks.service';
import { AuthorsService } from '../../core/services/authors.service';
import { PacksService } from '../../core/services/packs.service';
import { examPath } from '../../core/utils/routes.util';
import { QuestionsService } from '../../core/services/questions.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from './icon.component';

/**
 * The active certification's question banks grouped by author, each a
 * toggleable chip with its question count, plus "select author" per group.
 * Shared by Quiz setup and Export so both pick banks the same way. The parent
 * owns the selection (empty = every bank) and renders its own heading.
 */
@Component({
  selector: 'app-bank-picker',
  standalone: true,
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length === 0) {
      <p class="empty-hint">{{ i18n.t('quizSetup.noBanks') }}</p>
    }
    @for (group of groups(); track group.author) {
      <div class="bank-group">
        <div class="bank-group-head">
          <span class="bank-author"><app-icon name="user" size="14" /> {{ group.author || i18n.t('banks.noAuthor') }} <span class="bank-count">({{ group.banks.length }})</span></span>
          @if (group.banks.length > 0) {
            <button type="button" class="ui-btn ui-btn-sm" (click)="toggleAuthor(group.author)">
              {{ authorFullySelected(group.author) ? i18n.t('quizSetup.unselectAuthor') : i18n.t('quizSetup.selectAuthor') }}
            </button>
          } @else {
            <a class="ui-btn ui-btn-sm" [routerLink]="importLink()" [queryParams]="{ author: group.author }"><app-icon name="upload" size="12" /> {{ i18n.t('banks.importZipShort') }}</a>
          }
        </div>
        @if (group.banks.length === 0) {
          <p class="empty-hint">{{ i18n.t('banks.authorEmpty') }}</p>
        }
        <div class="bank-grid">
          @for (b of group.banks; track b.bank.id) {
            <button type="button" class="bank-chip" [class.selected]="selected().has(b.bank.id)" (click)="toggleBank(b.bank.id)" [attr.aria-pressed]="selected().has(b.bank.id)">
              <span class="bank-check" aria-hidden="true">@if (selected().has(b.bank.id)) { <app-icon name="check" size="12" /> }</span>
              <span class="bank-name">{{ b.bank.version || i18n.t('banks.noVersion') }}</span>
              <span class="bank-count">{{ b.count }}</span>
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--space-sm); }
      .empty-hint { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; margin: 0; }
      .bank-group { display: flex; flex-direction: column; gap: 6px; padding: var(--space-sm) var(--space-md); border: 1px solid var(--bg-border); border-radius: var(--radius-md); }
      .bank-group-head { display: flex; align-items: center; justify-content: space-between; }
      .bank-author { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }
      .bank-grid:empty { display: none; }
      .bank-grid { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); }
      .bank-chip { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 10px; border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary); text-align: left; cursor: pointer; }
      .bank-chip.selected { border-color: var(--color-purple); background: rgba(108, 92, 231, 0.08); }
      .bank-check { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--bg-border); font-size: 12px; color: #fff; flex-shrink: 0; }
      .bank-chip.selected .bank-check { background: var(--color-purple); border-color: var(--color-purple); }
      .bank-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-sm); font-weight: 600; }
      .bank-count { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--text-muted); }
    `,
  ],
})
export class BankPickerComponent {
  private readonly banks = inject(BanksService);
  private readonly questions = inject(QuestionsService);
  private readonly authors = inject(AuthorsService);
  private readonly packs = inject(PacksService);
  protected readonly i18n = inject(I18nService);

  readonly selected = input.required<ReadonlySet<string>>();
  readonly selectedChange = output<ReadonlySet<string>>();

  protected readonly groups = computed(() => {
    const counts = new Map<string, number>();
    for (const q of this.questions.questions()) counts.set(q.bankId, (counts.get(q.bankId) ?? 0) + 1);
    const registered = this.authors.authors().map((a) => a.name);
    return groupByAuthorWithRegistered(this.banks.banks(), registered).map((g) => ({
      author: g.author,
      banks: g.banks.map((bank) => ({ bank, count: counts.get(bank.id) ?? 0 })),
    }));
  });

  importLink(): string[] {
    return examPath(this.packs.activePack().id, 'import');
  }

  toggleBank(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedChange.emit(next);
  }

  authorFullySelected(author: string): boolean {
    const ids = this.authorBankIds(author);
    return ids.length > 0 && ids.every((id) => this.selected().has(id));
  }

  toggleAuthor(author: string): void {
    const next = new Set(this.selected());
    const select = !this.authorFullySelected(author);
    for (const id of this.authorBankIds(author)) {
      if (select) next.add(id);
      else next.delete(id);
    }
    this.selectedChange.emit(next);
  }

  private authorBankIds(author: string): string[] {
    return this.banks.banks().filter((b) => b.author.trim() === author).map((b) => b.id);
  }
}

/** Whether every bank of the active certification is in `selected`. */
export function everyBankSelected(banks: readonly { id: string }[], selected: ReadonlySet<string>): boolean {
  return banks.length > 0 && banks.every((b) => selected.has(b.id));
}
