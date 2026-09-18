import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PacksService } from '../../core/services/packs.service';
import { ImportExamComponent } from './import-exam.component';

/** Routed at /import — its own top-level nav item (alongside Questions,
 * Quiz, Transcripts, Chat, Export), not a tab buried inside "New Question"
 * anymore. `ImportExamComponent` itself is unchanged: it already has its
 * own target-pack `<select>` (a "simulado" upload can target any pack, not
 * necessarily the one currently active) and only needed an initial pack id
 * to default that selector to — the currently active pack, same default
 * the old routed-tab version used. */
@Component({
  selector: 'app-import-exam-page',
  standalone: true,
  imports: [ImportExamComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-card">
      <header class="card-header">
        <h2>Import Exam</h2>
        <p class="subtitle">Upload a whole exam file and let AI extract every question in it.</p>
      </header>
      <app-import-exam [packId]="packs.activePack().id" />
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        grid-column: 1 / -1;
      }
      @media (min-width: 768px) {
        :host {
          max-width: 960px;
          margin: 0 auto;
          width: 100%;
        }
      }
      .page-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
      .card-header h2 {
        font-size: var(--font-size-xl);
        margin: 0;
      }
      .subtitle {
        color: var(--text-muted);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        margin: var(--space-xs) 0 0;
      }
    `,
  ],
})
export class ImportExamPageComponent {
  protected readonly packs = inject(PacksService);
}
