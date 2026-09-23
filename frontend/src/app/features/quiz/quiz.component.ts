import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { QuizService } from '../../core/services/quiz.service';
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
      // Routed directly at /quiz — this host element sits as a direct
      // child of .app-main's 2-column grid (a sibling of <router-outlet>,
      // inserted by the router rather than written in AppComponent's own
      // template, so a rule from THAT component's stylesheet can't reach
      // it under Angular's view encapsulation — :host is the correct way
      // to size this component's own host element instead).
      :host {
        display: block;
        grid-column: 1 / -1;
      }
    `,
  ],
})
export class QuizComponent {
  protected readonly quiz = inject(QuizService);
}
