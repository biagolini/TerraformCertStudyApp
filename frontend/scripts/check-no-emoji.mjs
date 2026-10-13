// Fails if a pictographic character (emoji or Unicode symbol used as an
// icon, e.g. ✦ ✓ ✕ ★ ⏱ → ↗) appears in frontend source outside comments.
// Icons must be <app-icon> (shared/components/icon.component.ts); see
// .kiro/steering/ui-icons.md. Run: node scripts/check-no-emoji.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'src');
// Pictographic ranges: arrows, math/technical symbols, box/geometric shapes,
// misc symbols and dingbats, supplemental arrows, emoji planes.
const PICTO = /[\u2190-\u21FF\u2300-\u23FF\u2460-\u27BF\u2900-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F]/u;
// The icon registry documents the banned glyphs in a comment; nothing else is exempt.
const ALLOWED_FILES = new Set(['icon.component.ts']);
const problems = [];

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|html|scss)$/.test(full) && !full.endsWith('.spec.ts') && !ALLOWED_FILES.has(entry)) {
      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          const m = PICTO.exec(line);
          if (m) problems.push(`${full.slice(root.length + 1)}:${i + 1}  ${m[0]}  ${code.slice(0, 100)}`);
        });
    }
  }
};
walk(root);

if (problems.length) {
  console.error('Pictographic characters found (use <app-icon> instead):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('icons: no emoji or pictographic characters in source');
