import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ImageAssetService } from '../../core/services/image-asset.service';

/** Lets the user attach a hand-picked image to a question being written or
 * edited by hand (Add ready-made / edit mode) — separate from the bulk
 * import pipeline's own image handling. Uploads the file, then shows the
 * Markdown snippet to copy and paste into whichever field (stem, an
 * alternative, a comment) it belongs in — deliberately not auto-inserted,
 * since there's no single obvious target field here. */
@Component({
  selector: 'app-image-upload-helper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="image-upload">
      <span class="field-label">Attach an image</span>
      <div class="upload-row">
        <input
          #fileInput
          type="file"
          accept=".png,.jpg,.jpeg,.gif,.webp"
          hidden
          (change)="onFileSelected($event)"
        />
        <button type="button" class="btn-ghost-sm" (click)="fileInput.click()" [disabled]="uploading()">
          Choose image
        </button>
        @if (selectedFile()) {
          <span class="filename">{{ selectedFile()!.name }}</span>
        }
        <button
          type="button"
          class="btn-ghost-sm"
          (click)="onUpload()"
          [disabled]="!selectedFile() || uploading()"
        >
          @if (uploading()) { Uploading… } @else { Upload }
        </button>
      </div>

      @if (error()) {
        <p class="upload-error" role="alert">{{ error() }}</p>
      }

      @if (snippet()) {
        <div class="snippet-row">
          <code class="snippet">{{ snippet() }}</code>
          <button type="button" class="btn-ghost-sm" (click)="onCopy()">
            {{ copied() ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <p class="upload-hint">Paste this where you want the image — in the question, an alternative, or a comment.</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .image-upload {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        padding: var(--space-sm);
        border: 1px dashed var(--bg-border);
        border-radius: var(--radius-md);
      }
      .field-label {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .upload-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-wrap: wrap;
      }
      .filename {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 240px;
      }
      .upload-error {
        color: var(--color-red);
        font-size: var(--font-size-sm);
        margin: 0;
      }
      .snippet-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .snippet {
        flex: 1;
        padding: var(--space-xs) var(--space-sm);
        background: var(--bg-elevated);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        overflow-x: auto;
        white-space: nowrap;
      }
      .upload-hint {
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--text-faint);
      }
      .btn-ghost-sm {
        flex-shrink: 0;
        padding: 0 var(--space-md);
        min-height: 36px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
      }
      .btn-ghost-sm:hover:not(:disabled) {
        border-color: var(--color-purple);
        color: var(--text-primary);
      }
      .btn-ghost-sm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class ImageUploadHelperComponent {
  private readonly imageAssets = inject(ImageAssetService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly snippet = signal<string | null>(null);
  protected readonly copied = signal(false);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
    this.error.set(null);
    this.snippet.set(null);
    this.copied.set(false);
  }

  async onUpload(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;
    this.uploading.set(true);
    this.error.set(null);
    try {
      const result = await this.imageAssets.uploadManual(file);
      if ('error' in result) {
        this.error.set(result.error);
        return;
      }
      const alt = file.name.replace(/\.[^./]+$/, '');
      this.snippet.set(`![${alt}](${result.relativeKey})`);
      this.selectedFile.set(null);
      const input = this.fileInput()?.nativeElement;
      if (input) input.value = '';
    } finally {
      this.uploading.set(false);
    }
  }

  async onCopy(): Promise<void> {
    const text = this.snippet();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) — the
      // snippet text is still visible to select and copy by hand.
    }
  }
}
