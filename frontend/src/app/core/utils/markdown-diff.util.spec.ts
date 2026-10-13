import { diffMarkdown, markdownBlocks } from './markdown-diff.util';

describe('markdownBlocks', () => {
  it('splits paragraphs, headings and top-level list items, keeping nested lines and fences whole', () => {
    const md = '# Title\nIntro line\n\n- a\n  - a.1\n- b\n\n```\ncode\n\nmore\n```\nAfter';
    expect(markdownBlocks(md)).toEqual(['# Title', 'Intro line', '- a\n  - a.1', '- b', '```\ncode\n\nmore\n```', 'After']);
  });
});

describe('diffMarkdown', () => {
  it('marks only the changed blocks and merges unchanged runs', () => {
    const before = '## A\n\nOne.\n\nTwo.\n\n## B\n\nThree.';
    const after = '## A\n\nOne.\n\nTwo, fixed.\n\n## B\n\nThree.\n\nFour.';
    expect(diffMarkdown(before, after).map((s) => [s.kind, s.markdown])).toEqual([
      ['same', '## A\n\nOne.'],
      ['del', 'Two.'],
      ['add', 'Two, fixed.'],
      ['same', '## B\n\nThree.'],
      ['add', 'Four.'],
    ]);
  });

  it('keeps neighbouring list items in one list', () => {
    const segs = diffMarkdown('- a\n- b', '- a\n- b\n- c\n- d');
    expect(segs.map((s) => [s.kind, s.markdown])).toEqual([
      ['same', '- a\n- b'],
      ['add', '- c\n- d'],
    ]);
  });
});
