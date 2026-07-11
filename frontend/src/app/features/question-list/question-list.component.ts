import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Question } from '../../core/models/question.model';
import { QuestionsService } from '../../core/services/questions.service';
import { QuestionItemComponent } from './question-item.component';

@Component({
  selector: 'app-question-list',
  standalone: true,
  imports: [QuestionItemComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="list-card">
      <header class="card-header">
        <div class="title-row">
          <h2>Reviewed Questions</h2>
          <span class="count">{{ count() }}</span>
        </div>
        @if (count() > 0) {
          <div class="actions">
            <button type="button" class="link" (click)="onSelectAll()">Select all</button>
            <span class="dot" aria-hidden="true">·</span>
            <button type="button" class="link" (click)="onDeselectAll()">Deselect all</button>
          </div>
        }
      </header>

      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35"/>
        </svg>
        <input
          type="text"
          class="search-input"
          placeholder="Search questions..."
          [ngModel]="questionsService.searchQuery()"
          (ngModelChange)="onSearchChange($event)"
          aria-label="Search questions"
        />
        @if (questionsService.searchQuery()) {
          <button type="button" class="search-clear" (click)="onSearchClear()" aria-label="Clear search">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        }
      </div>
      @if (questionsService.isSearching()) {
        <label class="search-toggle">
          <input
            type="checkbox"
            [ngModel]="questionsService.searchAllPacks()"
            (ngModelChange)="onToggleAllPacks($event)"
          />
          <span>Search all packs</span>
        </label>
      }

      @if (count() === 0 && !questionsService.isSearching()) {
        <div class="empty">
          <p class="empty-title">No questions yet.</p>
          <p class="empty-body">Paste a question in the Input tab to generate your first review.</p>
        </div>
      } @else if (questionsService.isSearching() && displayQuestions().length === 0) {
        <p class="no-results">No questions match your search.</p>
      } @else {
        <ul class="list">
          @for (question of displayQuestions(); track question.id) {
            <li>
              <app-question-item
                [question]="question"
                [selected]="isSelected(question.id)"
                [active]="activeId() === question.id"
                (opened)="opened.emit(question)"
                (selectionToggled)="onToggle(question.id)"
                (domainChanged)="onDomainChanged(question.id, $event)"
              />
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .list-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
      .card-header {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .title-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .title-row h2 {
        font-size: var(--font-size-xl);
      }
      .count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        padding: 0 var(--space-sm);
        height: 22px;
        border-radius: var(--radius-pill);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-weight: 600;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-size: var(--font-size-sm);
      }
      .link {
        color: var(--color-blue);
        background: none;
        padding: 0;
        min-height: auto;
        font-weight: 500;
      }
      .link:hover {
        text-decoration: underline;
      }
      .dot {
        color: var(--text-faint);
      }
      .empty {
        padding: var(--space-xl);
        text-align: center;
        color: var(--text-muted);
        background: var(--bg-elevated);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
      }
      .empty-title {
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        margin-bottom: var(--space-xs);
      }
      .empty-body {
        font-size: var(--font-size-sm);
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .search-bar {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        height: 36px;
      }
      .search-bar:focus-within {
        border-color: var(--color-purple);
      }
      .search-icon {
        flex-shrink: 0;
        color: var(--text-muted);
      }
      .search-input {
        flex: 1;
        min-width: 0;
        border: none;
        background: transparent;
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        outline: none;
      }
      .search-input::placeholder {
        color: var(--text-faint);
      }
      .search-clear {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--bg-elevated);
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .search-clear:hover {
        background: var(--bg-border);
        color: var(--text-primary);
      }
      .search-toggle {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        cursor: pointer;
      }
      .search-toggle input {
        width: 14px;
        height: 14px;
      }
      .no-results {
        padding: var(--space-md);
        color: var(--text-muted);
        font-size: var(--font-size-sm);
        text-align: center;
      }
    `,
  ],
})
export class QuestionListComponent {
  readonly questionsService = inject(QuestionsService);

  readonly questions = this.questionsService.questions;
  readonly count = this.questionsService.count;
  readonly selectedIds = this.questionsService.selectedIds;

  readonly displayQuestions = computed(() => {
    if (this.questionsService.isSearching()) {
      return this.questionsService.searchResults().map((r) => r.question);
    }
    return this.questionsService.questions();
  });

  readonly activeId = input<string | null>(null);
  readonly opened = output<Question>();

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  onToggle(id: string): void {
    this.questionsService.toggleSelected(id);
  }

  onSelectAll(): void {
    this.questionsService.selectAll();
  }

  onDeselectAll(): void {
    this.questionsService.deselectAll();
  }

  onDomainChanged(id: string, domain: string): void {
    this.questionsService.updateDomain(id, domain);
  }

  onSearchChange(value: string): void {
    this.questionsService.setSearchQuery(value);
  }

  onSearchClear(): void {
    this.questionsService.setSearchQuery('');
  }

  onToggleAllPacks(all: boolean): void {
    this.questionsService.setSearchAllPacks(all);
  }
}
