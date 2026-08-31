import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, input, viewChild } from '@angular/core';
import { MarkdownRendererComponent } from '../review-viewer/markdown-renderer.component';
import { applyRangesToContainer, TextRange } from '../../core/utils/text-range.util';

/**
 * Renders Markdown text with highlight/strikethrough ranges baked in as real
 * `<mark>`/`<s>` DOM wrapping (see text-range.util.ts — offsets are against the
 * rendered plain text, not the Markdown source, so this composes correctly with
 * `**bold**`/`*italic*` regardless of where a mark's boundary falls).
 *
 * Exposes `[attr.data-block-id]` so a toolbar elsewhere on the page can resolve
 * which block the current text selection belongs to — this component never
 * listens for selection itself, so it works identically as a live, editable
 * quiz block or a read-only History display.
 */
@Component({
  selector: 'app-annotated-text',
  standalone: true,
  imports: [MarkdownRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #container [attr.data-block-id]="blockId()">
      <app-markdown-renderer [source]="text()" />
    </div>
  `,
})
export class QuizAnnotatedTextComponent {
  readonly blockId = input.required<string>();
  readonly text = input.required<string>();
  readonly highlights = input<TextRange[]>([]);
  readonly strikethroughs = input<TextRange[]>([]);

  private readonly containerRef = viewChild.required<ElementRef<HTMLElement>>('container');

  constructor() {
    afterRenderEffect(() => {
      const highlights = this.highlights();
      const strikethroughs = this.strikethroughs();
      // Reading `text()` too so a question swap (new content, same instance) re-applies.
      this.text();
      applyRangesToContainer(this.containerRef().nativeElement, highlights, strikethroughs);
    });
  }
}
