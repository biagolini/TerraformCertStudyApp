import { applyNoteEdits, parseNoteEdits } from './note-edit.util';

const NOTE = [
  '# Storage',
  '',
  '## Block storage',
  '',
  'A disk attached to one machine.',
  '',
  '### Volume types',
  '',
  '- General purpose',
  '',
  '## Object storage',
  '',
  'Files addressed by key.',
  '',
  '# Networking',
  '',
  'Subnets and routes.',
  '',
].join('\n');

const reply = (...blocks: string[]) => blocks.join('\n\n');
const edit = (action: string, section: string, content: string) =>
  `=== EDIT ===\nACTION: ${action}\nSECTION: ${section}\n=== CONTENT ===\n${content}\n=== END EDIT ===`;

describe('parseNoteEdits', () => {
  it('reads several blocks, with or without the closing marker', () => {
    const text = reply(edit('insert_after', '## Block storage', 'Snapshots copy a disk.'), '=== EDIT ===\nACTION: append\nSECTION: none\n=== CONTENT ===\n\nLast words.');
    expect(parseNoteEdits(text)).toEqual([
      { action: 'insert_after', section: '## Block storage', content: 'Snapshots copy a disk.' },
      { action: 'append', section: null, content: 'Last words.' },
    ]);
  });

  it('skips blocks without an action, a section or content', () => {
    const text = reply('=== EDIT ===\nACTION: move\nSECTION: ## X\n=== CONTENT ===\ny', '=== EDIT ===\nACTION: replace\n=== CONTENT ===\ny', edit('append', 'none', ''));
    expect(parseNoteEdits(text)).toEqual([]);
  });

  it('unwraps content the model put in a Markdown fence', () => {
    const text = edit('append', 'none', '```markdown\n## Summary\nDone.\n```');
    expect(parseNoteEdits(text)).toEqual([{ action: 'append', section: null, content: '## Summary\nDone.' }]);
  });
});

describe('applyNoteEdits', () => {
  it('inserts after the whole section, sub-sections included, and keeps the rest untouched', () => {
    const r = applyNoteEdits(NOTE, parseNoteEdits(edit('insert_after', '## Block storage', 'Snapshots copy a disk to another zone.')));
    expect(r.applied).toBe(1);
    expect(r.markdown).toContain('- General purpose\n\nSnapshots copy a disk to another zone.\n\n## Object storage');
    expect(r.markdown).toContain('# Networking\n\nSubnets and routes.');
  });

  it('replaces only the named section', () => {
    const r = applyNoteEdits(NOTE, parseNoteEdits(edit('replace', '## Object storage', '## Object storage\n\nDurable, addressed by key, with lifecycle rules.')));
    expect(r.markdown).toContain('## Object storage\n\nDurable, addressed by key, with lifecycle rules.\n\n# Networking');
    expect(r.markdown).not.toContain('Files addressed by key.');
    expect(r.markdown).toContain('### Volume types');
  });

  it('matches the heading loosely (case, emphasis, missing #) and appends at the end', () => {
    const r = applyNoteEdits(NOTE, [
      { action: 'insert_after', section: 'NETWORKING', content: 'Edge caches cut latency.' },
      { action: 'append', section: null, content: '# Review\n\nRead again.' },
    ]);
    expect(r.applied).toBe(2);
    expect(r.markdown.trimEnd().endsWith('Subnets and routes.\n\nEdge caches cut latency.\n\n# Review\n\nRead again.')).toBe(true);
  });

  it('reports sections it cannot find and changes nothing for them', () => {
    const r = applyNoteEdits(NOTE, [{ action: 'replace', section: '## Compute', content: 'x' }]);
    expect(r).toEqual({ markdown: NOTE.trim() + '\n', applied: 0, missing: ['## Compute'] });
  });

  it('replaces an exact passage, even with different spacing, only when it occurs once', () => {
    const r = applyNoteEdits(NOTE, [{ action: 'replace_text', section: null, old: 'A disk attached\nto one machine.', content: 'A disk attached to one machine at a time.' }]);
    expect(r.applied).toBe(1);
    expect(r.markdown).toContain('## Block storage\n\nA disk attached to one machine at a time.\n\n### Volume types');
    const twice = applyNoteEdits(NOTE + '\nSubnets and routes.\n', [{ action: 'replace_text', section: null, old: 'Subnets and routes.', content: 'x' }]);
    expect(twice.applied).toBe(0);
  });
});

describe('parseNoteEdits replace_text', () => {
  it('reads the OLD and CONTENT parts', () => {
    const text = '=== EDIT ===\nACTION: replace_text\n=== OLD ===\nFiles addressed by key.\n=== CONTENT ===\nFiles addressed by a unique key.\n=== END EDIT ===';
    expect(parseNoteEdits(text)).toEqual([{ action: 'replace_text', section: null, old: 'Files addressed by key.', content: 'Files addressed by a unique key.' }]);
  });
});

describe('replace_text without OLD', () => {
  const note = '## Deploy\n\nIntro.\n\nKey concepts: Application, Deployment Group.\n\nExam tip.\n';

  it('replaces the one paragraph named by SECTION', () => {
    const reply = '=== EDIT ===\nACTION: replace_text\nSECTION: Key concepts\n=== CONTENT ===\n- **Application**: container.\n- **Deployment Group**: where.\n=== END EDIT ===';
    const result = applyNoteEdits(note, parseNoteEdits(reply));
    expect(result.applied).toBe(1);
    expect(result.markdown).toBe('## Deploy\n\nIntro.\n\n- **Application**: container.\n- **Deployment Group**: where.\n\nExam tip.\n');
  });

  it('replaces a section body when SECTION is a heading, keeping the heading', () => {
    const reply = '=== EDIT ===\nACTION: replace_text\nSECTION: ## Deploy\n=== CONTENT ===\nNew body.';
    expect(applyNoteEdits(note, parseNoteEdits(reply)).markdown).toBe('## Deploy\n\nNew body.\n');
  });

  it('reports a SECTION that matches no paragraph', () => {
    const reply = '=== EDIT ===\nACTION: replace_text\nSECTION: Nothing like this\n=== CONTENT ===\nX';
    expect(applyNoteEdits(note, parseNoteEdits(reply)).missing).toEqual(['Nothing like this']);
  });
});
