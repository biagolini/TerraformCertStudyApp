import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { QuizService } from '../../core/services/quiz.service';
import { QuizResultsComponent } from './quiz-results.component';
import { QuizRunnerComponent } from './quiz-runner.component';
import { QuizSetupComponent } from './quiz-setup.component';

@Component({
  selector: 'app-quiz',
  standalone: true,
  imports: [QuizSetupComponent, QuizRunnerComponent, QuizResultsComponent],
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
    }
  `,
})
export class QuizComponent {
  protected readonly quiz = inject(QuizService);
}
