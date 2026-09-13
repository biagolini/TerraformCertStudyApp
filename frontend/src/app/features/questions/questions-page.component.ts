import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Question } from '../../core/models/question.model';
import { QuestionsService } from '../../core/services/questions.service';
import { ViewportService } from '../../core/services/viewport.service';
import { QuestionInputComponent } from '../question-input/question-input.component';
import { QuestionListComponent } from '../question-list/question-list.component';
import { ReviewViewerComponent } from '../review-viewer/review-viewer.component';

/** Routed at /questions/:packId and /questions/:packId/:questionId — a
 * direct port of app.component.ts's old `@case ('question')` block. `packId`
 * and `questionId` are bound straight from the route (withComponentInputBinding),
 * so this page's notion of "which pack" can never go stale the way the old
 * import-exam constructor snapshot did. */
@Component({
  selector: 'app-questions-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuestionInputComponent, QuestionListComponent, ReviewViewerComponent],
  template: `
    @if (showLeftColumn()) {
      <section class="column column-left">
        <div class="stack">
          @if (showInputForm()) {
            <app-question-input [packId]="packId()" (generated)="onGenerated($event)" />
          }
          @if (showListPanel()) {
            <app-question-list [activeId]="questionId()" (opened)="onOpenQuestion($event)" />
          }
        </div>
      </section>
    }
    @if (showViewerPanel()) {
      <section class="column column-right">
        <app-review-viewer
          [question]="activeQuestion()"
          [showBackButton]="isMobile()"
          (back)="onCloseViewer()"
          (newQuestion)="onNewQuestion()"
          (deleted)="onQuestionDeleted($event)"
        />
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class QuestionsPageComponent {
  private readonly router = inject(Router);
  private readonly questionsService = inject(QuestionsService);
  private readonly viewport = inject(ViewportService);

  readonly packId = input.required<string>();
  readonly questionId = input<string | null>(null);

  readonly isMobile = this.viewport.isMobile;

  // Mirrors the pack-scoped lookup app.component.ts used to do — questions()
  // is already filtered to the active pack. Using the global
  // QuestionsService.getById() here instead would reopen the cross-pack-leak
  // bug class this migration exists to close.
  readonly activeQuestion = computed<Question | null>(() => {
    const id = this.questionId();
    if (!id) return null;
    return this.questionsService.questions().find((q) => q.id === id) ?? null;
  });

  readonly showInputForm = computed(() => !(this.isMobile() && this.questionId()));
  readonly showListPanel = computed(() => !this.isMobile() || !this.questionId());
  readonly showViewerPanel = computed(() => !this.isMobile() || !!this.questionId());
  readonly showLeftColumn = computed(() => this.showInputForm() || this.showListPanel());

  onGenerated(question: Question): void {
    this.router.navigate(['/questions', this.packId(), question.id]);
  }

  onOpenQuestion(question: Question): void {
    this.router.navigate(['/questions', this.packId(), question.id]);
  }

  onCloseViewer(): void {
    this.router.navigate(['/questions', this.packId()]);
  }

  onNewQuestion(): void {
    this.router.navigate(['/questions', this.packId()]);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  onQuestionDeleted(id: string): void {
    if (this.questionId() === id) {
      this.router.navigate(['/questions', this.packId()]);
    }
  }
}
