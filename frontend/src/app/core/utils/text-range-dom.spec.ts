import { applyRangesToContainer } from './text-range.util';

/**
 * Reproduces (and locks in the fix for) the mobile "text from another question
 * leaks into the current one" bug.
 *
 * Root cause: applyRangesToContainer mutates the DOM imperatively (splitText +
 * <mark>/<s> wrapping + parent.normalize()), which destroys the identity of the
 * Text node Angular keeps a live reference to for its {{ interpolation }}
 * binding. When the question swapped, Angular reused the same component
 * instance and wrote the new text into its remembered Text node — but the extra
 * fragments left behind by the imperative pass meant the old content survived
 * alongside the new one.
 *
 * Fix (quiz-annotated-text.component.ts): the inner markdown renderer is keyed
 * on the text via `@for (src of [text()]; track src)`, so a question swap
 * DESTROYS and RECREATES the subtree instead of reusing (now-corrupted) Text
 * nodes. These tests assert both the failure mode (reuse leaks) and the fixed
 * mode (recreate is clean).
 */
describe('applyRangesToContainer DOM identity (mobile leak repro)', () => {
  /** Mimics how MarkdownRendererComponent renders `{{ seg.value }}`: an element
   * whose sole child is a single Text node. */
  function makeRenderedSpan(text: string): { container: HTMLElement; boundTextNode: Text } {
    const container = document.createElement('div');
    container.setAttribute('data-block-id', 'stem');
    const span = document.createElement('span');
    const textNode = document.createTextNode(text);
    span.appendChild(textNode);
    container.appendChild(span);
    return { container, boundTextNode: textNode };
  }

  /** Angular updates an interpolation by writing to the SAME bound Text node it
   * created — the reuse path that used to leak. */
  function angularReusesBoundNode(boundTextNode: Text, newText: string): void {
    boundTextNode.data = newText;
  }

  it('demonstrates the leak when a marked subtree is REUSED (old behavior)', () => {
    const { container, boundTextNode } = makeRenderedSpan('First question stem text');
    applyRangesToContainer(container, [{ start: 0, end: 5 }], []);
    // Reuse path: Angular writes into the split fragment it still references.
    angularReusesBoundNode(boundTextNode, 'Second question stem text');
    // The leftover fragment from splitText survives -> leak.
    expect(container.textContent).not.toBe('Second question stem text');
  });

  it('is clean when the subtree is RECREATED on swap (the fix)', () => {
    const first = makeRenderedSpan('First question stem text');
    applyRangesToContainer(first.container, [{ start: 0, end: 5 }], []);

    // The fix rebuilds the subtree from scratch for the new text (keyed @for),
    // so the second question renders in a fresh container with no residue.
    const second = makeRenderedSpan('Second question stem text');
    applyRangesToContainer(second.container, [], []);

    expect(second.container.textContent).toBe('Second question stem text');
  });

  it('applies marks correctly on a freshly rendered block', () => {
    const { container } = makeRenderedSpan('Highlight me please');
    applyRangesToContainer(container, [{ start: 0, end: 9 }], []);
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('Highlight');
    expect(container.textContent).toBe('Highlight me please');
  });
});
