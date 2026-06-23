import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { Pack, packDisplayLabel } from '../../core/models/pack.model';
import { PacksService } from '../../core/services/packs.service';
import { QuestionsService } from '../../core/services/questions.service';
import { PackEditorComponent } from './pack-editor.component';

@Component({
  selector: 'app-packs-drawer',
  standalone: true,
  imports: [PackEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="drawer">
      <header class="drawer-header">
        <h2>Exam Packs</h2>
        <button
          type="button"
          class="close-btn"
          (click)="closed.emit()"
          aria-label="Close packs"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              d="M5 5l14 14M19 5L5 19"
            />
          </svg>
        </button>
      </header>

      <div class="drawer-body">
        <p class="hint">
          Each pack is its own collection of reviewed questions, domains, and color. Switch packs to keep different certifications or simulado batches separated.
        </p>

        <ul class="pack-list">
          @for (pack of packs(); track pack.id) {
            <li
              class="pack-row"
              [class.active]="pack.id === activeId()"
              [style.--pack-color]="pack.color"
            >
              <button
                type="button"
                class="select-btn"
                (click)="onSelect(pack)"
                [attr.aria-pressed]="pack.id === activeId()"
                [attr.aria-label]="'Switch to ' + label(pack)"
              >
                <span class="dot" [style.background]="pack.color" aria-hidden="true"></span>
                <span class="meta">
                  <span class="name">{{ pack.name }}</span>
                  @if (pack.version) {
                    <span class="version">{{ pack.version }}</span>
                  }
                  <span class="count">{{ countFor(pack.id) }} question{{ countFor(pack.id) === 1 ? '' : 's' }}</span>
                </span>
                @if (pack.id === activeId()) {
                  <span class="check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5L20 7"/>
                    </svg>
                  </span>
                }
              </button>
              <button
                type="button"
                class="edit-btn"
                (click)="openEdit(pack)"
                [attr.aria-label]="'Edit ' + label(pack)"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
                  />
                </svg>
              </button>
            </li>
          }
        </ul>

        <button type="button" class="new-btn" (click)="openCreate()">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/>
          </svg>
          <span>New pack</span>
        </button>
      </div>

      @if (editorOpen()) {
        <app-pack-editor
          [pack]="editingPack()"
          (cancelled)="closeEditor()"
          (saved)="onPackSaved($event)"
          (deleted)="onPackDeleted($event)"
        />
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .drawer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-surface);
        color: var(--text-primary);
      }
      .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-md) var(--space-lg);
        border-bottom: 1px solid var(--bg-border);
        position: sticky;
        top: 0;
        background: var(--bg-surface);
        z-index: 1;
      }
      .drawer-header h2 {
        font-size: var(--font-size-xl);
      }
      .close-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-muted);
      }
      .close-btn:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .hint {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        line-height: 1.5;
      }
      .pack-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .pack-row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: stretch;
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }
      .pack-row.active {
        border-color: var(--pack-color, var(--color-purple));
        box-shadow: 0 0 0 1px var(--pack-color, var(--color-purple));
      }
      .select-btn {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        background: transparent;
        text-align: left;
        color: var(--text-primary);
        min-height: var(--touch-min);
      }
      .select-btn:hover {
        background: var(--bg-subtle);
      }
      .dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .name {
        font-weight: 600;
        font-size: var(--font-size-base);
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }
      .version {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .count {
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }
      .check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--pack-color, var(--color-purple));
        flex-shrink: 0;
      }
      .edit-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 var(--space-md);
        color: var(--text-muted);
        border-left: 1px solid var(--bg-border);
      }
      .edit-btn:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .new-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-xs);
        min-height: var(--touch-min);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
        color: var(--text-secondary);
        background: transparent;
        margin-top: var(--space-sm);
      }
      .new-btn:hover {
        border-color: var(--color-purple);
        color: var(--color-purple);
        background: var(--bg-subtle);
      }
    `,
  ],
})
export class PacksDrawerComponent {
  private readonly packsService = inject(PacksService);
  private readonly questionsService = inject(QuestionsService);

  readonly closed = output<void>();

  readonly packs = this.packsService.packs;
  readonly activeId = computed(() => this.packsService.activePack().id);

  protected readonly editorOpen = signal(false);
  protected readonly editingPack = signal<Pack | null>(null);

  label(pack: Pack): string {
    return packDisplayLabel(pack);
  }

  countFor(packId: string): number {
    return this.questionsService.allQuestions().filter((q) => q.packId === packId).length;
  }

  onSelect(pack: Pack): void {
    this.packsService.setActive(pack.id);
    this.closed.emit();
  }

  openCreate(): void {
    this.editingPack.set(null);
    this.editorOpen.set(true);
  }

  openEdit(pack: Pack): void {
    this.editingPack.set(pack);
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
    this.editingPack.set(null);
  }

  onPackSaved(pack: Pack): void {
    this.closeEditor();
    // If a new pack was created, the service already set it active.
    if (this.activeId() === pack.id) {
      this.closed.emit();
    }
  }

  onPackDeleted(_id: string): void {
    this.closeEditor();
  }
}
