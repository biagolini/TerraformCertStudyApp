import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { STUDY_METHODS, StudyMethod, StudyMethodEntry } from '../../core/models/method.model';
import { SettingsService } from '../../core/services/settings.service';

@Component({
  selector: 'app-methods-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="methods">
      <header class="methods-header">
        <h2>Study methods</h2>
        <p class="hint">Choose how you want to feed material into the model. Your choice persists across sessions and applies to the Create tab.</p>
      </header>

      <ul class="grid">
        @for (method of methods; track method.id) {
          <li>
            <button
              type="button"
              class="card"
              [class.active]="active() === method.id"
              [class.preview]="method.status === 'preview'"
              (click)="onChoose(method)"
              [attr.aria-pressed]="active() === method.id"
            >
              <span class="card-head">
                <span class="card-title">{{ method.name }}</span>
                @if (method.status === 'preview') {
                  <span class="tag">Preview</span>
                }
                @if (active() === method.id) {
                  <span class="check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5L20 7"/>
                    </svg>
                  </span>
                }
              </span>
              <span class="card-body">{{ method.description }}</span>
            </button>
          </li>
        }
      </ul>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .methods { display: flex; flex-direction: column; gap: var(--space-lg); }
      .methods-header h2 { font-size: var(--font-size-xl); margin-bottom: var(--space-xs); }
      .hint { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; }
      .grid {
        display: grid; gap: var(--space-md);
        grid-template-columns: 1fr;
      }
      @media (min-width: 600px) {
        .grid { grid-template-columns: repeat(2, 1fr); }
      }
      @media (min-width: 900px) {
        .grid { grid-template-columns: repeat(3, 1fr); }
      }
      .card {
        display: flex; flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-lg);
        border-radius: var(--radius-lg);
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        text-align: left;
        cursor: pointer;
        transition: border-color var(--transition-fast), transform var(--transition-fast);
        min-height: 160px;
      }
      .card:hover { border-color: var(--color-purple); transform: translateY(-1px); }
      .card.active { border-color: var(--pack-color, var(--color-purple)); box-shadow: 0 0 0 1px var(--pack-color, var(--color-purple)); }
      .card-head { display: flex; align-items: center; gap: var(--space-sm); }
      .card-title { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); }
      .tag {
        padding: 1px 8px;
        background: var(--bg-elevated);
        color: var(--text-muted);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        border-radius: var(--radius-pill);
        letter-spacing: 0.04em;
      }
      .check { color: var(--pack-color, var(--color-purple)); margin-left: auto; }
      .card-body { color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; }
    `,
  ],
})
export class MethodsTabComponent {
  private readonly settings = inject(SettingsService);
  readonly active = this.settings.activeMethod;
  readonly methods: StudyMethodEntry[] = STUDY_METHODS;
  readonly chosen = output<StudyMethod>();

  onChoose(method: StudyMethodEntry): void {
    this.settings.setActiveMethod(method.id);
    this.chosen.emit(method.id);
  }
}
