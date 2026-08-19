import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

type InlineSegment = { kind: 'text' | 'bold' | 'italic'; value: string };

type Block =
  | { kind: 'h2' | 'h3'; inline: InlineSegment[] }
  | { kind: 'hr' }
  | { kind: 'p'; inline: InlineSegment[]; muted: boolean }
  | { kind: 'ul'; items: InlineSegment[][] };

@Component({
  selector: 'app-markdown-renderer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="markdown">
      @for (block of blocks(); track $index) {
        @switch (block.kind) {
          @case ('h2') {
            <h2 class="md-h2">
              @for (seg of asInline(block); track $index) {
                @if (seg.kind === 'bold') {
                  <strong>{{ seg.value }}</strong>
                } @else if (seg.kind === 'italic') {
                  <em>{{ seg.value }}</em>
                } @else {
                  <span>{{ seg.value }}</span>
                }
              }
            </h2>
          }
          @case ('h3') {
            <h3 class="md-h3">
              @for (seg of asInline(block); track $index) {
                @if (seg.kind === 'bold') {
                  <strong>{{ seg.value }}</strong>
                } @else if (seg.kind === 'italic') {
                  <em>{{ seg.value }}</em>
                } @else {
                  <span>{{ seg.value }}</span>
                }
              }
            </h3>
          }
          @case ('hr') {
            <hr class="md-hr" />
          }
          @case ('p') {
            <p class="md-p" [class.muted]="asParagraph(block).muted">
              @for (seg of asParagraph(block).inline; track $index) {
                @if (seg.kind === 'bold') {
                  <strong>{{ seg.value }}</strong>
                } @else if (seg.kind === 'italic') {
                  <em>{{ seg.value }}</em>
                } @else {
                  <span>{{ seg.value }}</span>
                }
              }
            </p>
          }
          @case ('ul') {
            <ul class="md-ul">
              @for (item of asList(block).items; track $index) {
                <li>
                  @for (seg of item; track $index) {
                    @if (seg.kind === 'bold') {
                      <strong>{{ seg.value }}</strong>
                    } @else if (seg.kind === 'italic') {
                      <em>{{ seg.value }}</em>
                    } @else {
                      <span>{{ seg.value }}</span>
                    }
                  }
                </li>
              }
            </ul>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .markdown {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        color: var(--text-primary);
        font-size: var(--font-size-base);
        line-height: 1.6;
      }
      .md-h2 {
        font-size: var(--font-size-xl);
        color: var(--text-primary);
        margin-top: var(--space-sm);
      }
      .md-h3 {
        font-size: var(--font-size-lg);
        color: var(--text-secondary);
        margin-top: var(--space-sm);
      }
      .md-hr {
        border: none;
        border-top: 1px solid var(--bg-border);
        margin: var(--space-sm) 0;
      }
      .md-p.muted {
        color: var(--text-muted);
        font-size: calc(var(--font-size-base) - 1px);
      }
      .md-ul {
        padding-left: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .md-ul li {
        list-style: disc;
        margin-left: 0;
        color: var(--text-primary);
      }
      strong {
        color: var(--text-primary);
        font-weight: 700;
      }
      em {
        font-style: italic;
      }
    `,
  ],
})
export class MarkdownRendererComponent {
  readonly source = input.required<string>();

  readonly blocks = computed<Block[]>(() => parseMarkdown(this.source()));

  asInline(block: Block): InlineSegment[] {
    return block.kind === 'h2' || block.kind === 'h3' ? block.inline : [];
  }
  asParagraph(block: Block): { inline: InlineSegment[]; muted: boolean } {
    return block.kind === 'p' ? { inline: block.inline, muted: block.muted } : { inline: [], muted: false };
  }
  asList(block: Block): { items: InlineSegment[][] } {
    return block.kind === 'ul' ? { items: block.items } : { items: [] };
  }
}

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let listBuffer: InlineSegment[][] | null = null;

  const flushList = () => {
    if (listBuffer && listBuffer.length > 0) {
      blocks.push({ kind: 'ul', items: listBuffer });
    }
    listBuffer = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      continue;
    }
    if (trimmed === '---' || /^[-*_]{3,}$/.test(trimmed)) {
      flushList();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      // Map: # and ## -> h2 (larger), ### and deeper -> h3 (smaller)
      const kind = level <= 2 ? 'h2' : 'h3';
      blocks.push({ kind, inline: parseInline(headingMatch[2]) });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!listBuffer) listBuffer = [];
      listBuffer.push(parseInline(trimmed.replace(/^[-*]\s+/, '')));
      continue;
    }

    flushList();

    const muted = /^\*[\s\S]+\*$/.test(trimmed) && !/\*\*/.test(trimmed);
    blocks.push({ kind: 'p', inline: parseInline(trimmed), muted });
  }

  flushList();
  return blocks;
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let i = 0;
  let textBuffer = '';

  const flushText = () => {
    if (textBuffer) {
      segments.push({ kind: 'text', value: textBuffer });
      textBuffer = '';
    }
  };

  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flushText();
        segments.push({ kind: 'bold', value: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && end !== i + 1) {
        flushText();
        segments.push({ kind: 'italic', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    textBuffer += text[i];
    i++;
  }

  flushText();
  return segments;
}
