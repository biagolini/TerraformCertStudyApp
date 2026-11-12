import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { QuizService } from '../../core/services/quiz.service';
import { PacksService } from '../../core/services/packs.service';
import { QuizHistoryComponent } from './quiz-history.component';
import { QuizResultsComponent } from './quiz-results.component';
import { QuizRunnerComponent } from './quiz-runner.component';
import { QuizSetupComponent } from './quiz-setup.component';

@Component({
  selector: 'app-quiz',
  standalone: true,
  imports: [QuizSetupComponent, QuizRunnerComponent, QuizResultsComponent, QuizHistoryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (quiz.phase()) {
      @case ('setup') {
        <app-quiz-setup />
      }
      @case ('running') {
        <app-quiz-runner />
      }
      @case ('results') {
        <app-quiz-results />
      }
      @case ('history') {
        <app-quiz-history />
      }
    }
  `,
  styles: [
    `
      // Spans both columns of the workspace grid (ExamWorkspaceComponent).
      // min-width: 0 because a grid item defaults to its min-content width: a
      // wide image or table in a question stretched the whole column past the
      // screen, and the shell's overflow-x: clip hid the excess with no way to
      // scroll. With it, images shrink to fit and tables scroll on their own.
      :host {
        display: block;
        grid-column: 1 / -1;
        min-width: 0;
      }
    `,
  ],
})
export class QuizComponent {
  protected readonly quiz = inject(QuizService);
  private readonly packs = inject(PacksService);

  constructor() {
    // QuizService is app-wide: a session (or results view) left open in
    // another certification is parked/cleared instead of shown here.
    const owner = this.quiz.sessionPackId();
    if (owner && owner !== this.packs.activePack().id) this.quiz.release();
  }
}
