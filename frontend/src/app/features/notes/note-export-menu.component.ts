import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';
import { ExportService } from '../../core/services/export.service';
import { ImageAssetService } from '../../core/services/image-asset.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';
import { exportNoteDocx, exportNoteMarkdown } from './note-export';

type ExportFormat = 'markdown' | 'docx';

/**
 * "Export" menu of a study note: Markdown (a .zip with an img/ folder when
 * the note has images) or Word (.docx with the images embedded).
 */
@Component({
  selector: 'app-note-export-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button type="button" class="ui-btn ui-btn-sm" [disabled]="busy() !== null" (click)="open.set(!open())" aria-haspopup="menu" [attr.aria-expanded]="open()">
      <app-icon name="download" /> {{ busy() ? i18n.t('notes.exporting') : i18n.t('notes.export') }}
    </button>
    @if (open()) {
      <div class="menu" role="menu" [attr.aria-label]="i18n.t('notes.export')">
        <button type="button" role="menuitem" class="item" (click)="run('markdown')">
          <app-icon name="file-text" />
          <span><strong>Markdown</strong><small>{{ i18n.t('notes.exportMarkdownHint') }}</small></span>
        </button>
        <button type="button" role="menuitem" class="item" (click)="run('docx')">
          <app-icon name="file-text" />
          <span><strong>Word (.docx)</strong><small>{{ i18n.t('notes.exportDocxHint') }}</small></span>
        </button>
      </div>
    }
    @if (error()) {
      <span class="error" role="alert">{{ error() }}</span>
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
      }
      .menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 20;
        width: 280px;
        display: flex;
        flex-direction: column;
        padding: var(--space-xs);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        box-shadow: var(--shadow-md);
      }
      .item {
        display: flex;
        align-items: flex-start;
        gap: var(--space-sm);
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        text-align: left;
      }
      .item:hover {
        background: var(--bg-subtle);
      }
      .item span {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: var(--font-size-sm);
      }
      .item small {
        color: var(--text-muted);
        font-size: var(--font-size-xs);
      }
      .error {
        color: var(--color-red);
        font-size: var(--font-size-xs);
      }
    `,
  ],
})
export class NoteExportMenuComponent {
  private readonly exporter = inject(ExportService);
  private readonly images = inject(ImageAssetService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly i18n = inject(I18nService);

  readonly title = input.required<string>();
  readonly markdown = input.required<string>();

  readonly open = signal(false);
  readonly busy = signal<ExportFormat | null>(null);
  readonly error = signal<string | null>(null);

  async run(format: ExportFormat): Promise<void> {
    this.open.set(false);
    this.busy.set(format);
    this.error.set(null);
    try {
      const fetchImage = (ref: string) => this.images.download(ref);
      const title = this.title() || this.i18n.t('notes.untitled');
      const file = format === 'markdown' ? await exportNoteMarkdown(title, this.markdown(), fetchImage) : await exportNoteDocx(title, this.markdown(), fetchImage);
      this.exporter.downloadBlob(file.blob, file.filename);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(null);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
