export interface TextRange {
  start: number;
  end: number;
}

/** Sorts and merges overlapping/touching ranges into a minimal non-overlapping set. */
export function normalizeRanges(ranges: TextRange[]): TextRange[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function isFullyCovered(ranges: TextRange[], target: TextRange): boolean {
  let coveredUntil = target.start;
  for (const r of ranges) {
    if (r.start > coveredUntil) break;
    if (r.end > coveredUntil) coveredUntil = r.end;
    if (coveredUntil >= target.end) return true;
  }
  return coveredUntil >= target.end;
}

function subtractRange(ranges: TextRange[], target: TextRange): TextRange[] {
  const result: TextRange[] = [];
  for (const r of ranges) {
    if (r.end <= target.start || r.start >= target.end) {
      result.push(r);
      continue;
    }
    if (r.start < target.start) result.push({ start: r.start, end: target.start });
    if (r.end > target.end) result.push({ start: target.end, end: r.end });
  }
  return result;
}

/**
 * Applies the confirmed toggle rule: if `next` is already fully covered by
 * `existing`, subtract it (remove the mark); otherwise union it in (expand
 * to cover the whole new selection, even if part of it was already marked).
 */
export function toggleRanges(existing: TextRange[], next: TextRange): TextRange[] {
  const normalized = normalizeRanges(existing);
  if (next.end <= next.start) return normalized;
  return isFullyCovered(normalized, next)
    ? subtractRange(normalized, next)
    : normalizeRanges([...normalized, next]);
}

/** Finds the nearest ancestor (or self) carrying a `data-block-id` attribute. */
function findBlock(node: Node | null): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el && el.dataset['blockId'] === undefined) el = el.parentElement;
  return el;
}

/** Plain-text offset of a DOM position within `container`, via a text-node walk. */
function offsetWithin(container: HTMLElement, targetNode: Node, targetOffset: number): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + targetOffset;
    offset += node.textContent?.length ?? 0;
  }
  // targetNode may be an element (e.g. the container itself) rather than a text node —
  // treat targetOffset as a child index and sum the text length of preceding children.
  if (targetNode instanceof HTMLElement || targetNode === container) {
    return offset;
  }
  return null;
}

/**
 * Reads the current browser selection and, if both ends fall within the same
 * annotatable block (`[data-block-id]`), returns that block's id and the
 * selection's plain-text offset range. Returns null for a collapsed/empty
 * selection or one spanning two different blocks.
 */
export function resolveSelectionBlock(): { blockId: string; range: TextRange } | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const anchorBlock = findBlock(selection.anchorNode);
  const focusBlock = findBlock(selection.focusNode);
  if (!anchorBlock || !focusBlock || anchorBlock !== focusBlock) return null;

  const domRange = selection.getRangeAt(0);
  const start = offsetWithin(anchorBlock, domRange.startContainer, domRange.startOffset);
  const end = offsetWithin(anchorBlock, domRange.endContainer, domRange.endOffset);
  if (start === null || end === null || start === end) return null;

  const blockId = anchorBlock.dataset['blockId'] ?? '';
  return start < end ? { blockId, range: { start, end } } : { blockId, range: { start: end, end: start } };
}

function unwrapTag(container: HTMLElement, tagName: string): void {
  const els = Array.from(container.querySelectorAll(tagName));
  for (const el of els) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }
}

function wrapSingleRange(container: HTMLElement, target: TextRange, tagName: string): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) textNodes.push(node as Text);

  let offset = 0;
  for (const textNode of textNodes) {
    const len = textNode.textContent?.length ?? 0;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset += len;

    const overlapStart = Math.max(nodeStart, target.start);
    const overlapEnd = Math.min(nodeEnd, target.end);
    if (overlapStart >= overlapEnd) continue;

    const localStart = overlapStart - nodeStart;
    const localEnd = overlapEnd - nodeStart;

    let middle: Text = textNode;
    if (localEnd < len) middle.splitText(localEnd);
    if (localStart > 0) middle = middle.splitText(localStart);

    const wrapper = document.createElement(tagName);
    middle.parentNode?.insertBefore(wrapper, middle);
    wrapper.appendChild(middle);
  }
}

/**
 * Re-renders a block's highlight/strikethrough marks from scratch: unwraps any
 * existing `<mark>`/`<s>` back to plain text, then re-wraps from the given
 * ranges (highlights first, so an overlap nests as `<mark><s>…</s></mark>`).
 * Built on a TreeWalker over text nodes, so it's correct regardless of nested
 * `<strong>`/`<em>` from the Markdown renderer.
 */
export function applyRangesToContainer(
  container: HTMLElement,
  highlights: TextRange[],
  strikethroughs: TextRange[],
): void {
  unwrapTag(container, 'mark');
  unwrapTag(container, 's');
  for (const range of normalizeRanges(highlights)) wrapSingleRange(container, range, 'mark');
  for (const range of normalizeRanges(strikethroughs)) wrapSingleRange(container, range, 's');
}
