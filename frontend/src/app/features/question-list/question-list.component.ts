import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Question } from '../../core/models/question.model';
import { QuestionsService } from '../../core/services/questions.service';
import { QuestionItemComponent } from './question-item.component';

@Component({
  selector: 'app-question-list',
  standalone: true,
  imports: [QuestionItemComponent],
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

      @if (count() === 0) {
        <div class="empty">
          <p class="empty-title">No questions yet.</p>
          <p class="empty-body">Paste a question in the Input tab to generate your first review.</p>
        </div>
      } @else {
        <ul class="list">
          @for (question of questions(); track question.id) {
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
    `,
  ],
})
export class QuestionListComponent {
  private readonly questionsService = inject(QuestionsService);

  readonly questions = this.questionsService.questions;
  readonly count = this.questionsService.count;
  readonly selectedIds = this.questionsService.selectedIds;

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
}
