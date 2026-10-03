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
      :host {
        display: block;
        grid-column: 1 / -1;
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
