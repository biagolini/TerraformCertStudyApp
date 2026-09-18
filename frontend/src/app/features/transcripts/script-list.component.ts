import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Script } from '../../core/models/script.model';
import { ScriptsService } from '../../core/services/scripts.service';
import { TruncatePipe } from '../../shared/pipes/truncate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-script-list',
  standalone: true,
  imports: [TruncatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="list-card">
      <header class="card-header">
        <div class="title-row">
          <h2>{{ i18n.t('scriptList.savedScripts') }}</h2>
          <span class="count">{{ count() }}</span>
        </div>
      </header>
      @if (count() === 0) {
        <div class="empty">
          <p class="empty-title">{{ i18n.t('scriptList.noScriptsYet') }}</p>
          <p class="empty-body">{{ i18n.t('scriptList.noScriptsHint') }}</p>
        </div>
      } @else {
        <ul class="list">
          @for (script of scripts(); track script.id) {
            <li>
              <button
                type="button"
                class="row"
                [class.active]="activeId() === script.id"
                (click)="opened.emit(script)"
              >
                <span class="title">{{ script.title | truncate: 80 }}</span>
                <span class="meta">{{ i18n.t('scriptList.sourceCount', { count: script.sources.length }) }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .list-card {
        display: flex; flex-direction: column; gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
      .card-header { display: flex; flex-direction: column; gap: var(--space-xs); }
      .title-row { display: flex; align-items: center; gap: var(--space-sm); }
      .title-row h2 { font-size: var(--font-size-xl); }
      .count {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 28px; padding: 0 var(--space-sm); height: 22px;
        border-radius: var(--radius-pill);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        font-size: var(--font-size-sm); font-weight: 600;
      }
      .empty {
        padding: var(--space-xl); text-align: center;
        color: var(--text-muted);
        background: var(--bg-elevated);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
      }
      .empty-title { font-size: var(--font-size-base); color: var(--text-secondary); margin-bottom: var(--space-xs); }
      .empty-body { font-size: var(--font-size-sm); }
      .list { display: flex; flex-direction: column; gap: var(--space-xs); }
      .row {
        display: flex; flex-direction: column; gap: 2px;
        text-align: left;
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-surface);
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        transition: background var(--transition-fast), border-color var(--transition-fast);
        width: 100%;
        min-height: var(--touch-min);
      }
      .row:hover { background: var(--bg-elevated); }
      .row.active { border-color: var(--color-purple); background: var(--bg-elevated); }
      .title {
        font-size: var(--font-size-base);
        font-weight: 500;
        color: var(--text-primary);
        word-break: break-word;
      }
      .meta { font-size: var(--font-size-xs); color: var(--text-muted); }
    `,
  ],
})
export class ScriptListComponent {
  private readonly scriptsService = inject(ScriptsService);
  protected readonly i18n = inject(I18nService);
  readonly scripts = this.scriptsService.scripts;
  readonly count = this.scriptsService.count;
  readonly activeId = input<string | null>(null);
  readonly opened = output<Script>();
}
