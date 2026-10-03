// Fails if any literal i18n.t('key') used under src/app is missing from the
// English dictionary (the other three are checked against English by
// src/app/core/i18n/i18n.spec.ts). Run: node scripts/check-i18n-keys.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'src', 'app');
const en = readFileSync(join(root, 'core', 'i18n', 'en.ts'), 'utf8');
const known = new Set([...en.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
const missing = new Map();

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
      for (const m of readFileSync(full, 'utf8').matchAll(/i18n\.t\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (m[1].endsWith('.') || m[1].endsWith('_') || m[1] === 'key') continue; // dynamic prefix or doc example
        if (!known.has(m[1])) missing.set(m[1], full.slice(root.length + 1));
      }
    }
  }
};
walk(root);

if (missing.size) {
  for (const [key, file] of missing) console.error(`missing: ${key}  (${file})`);
  process.exit(1);
}
console.log(`i18n: all literal keys present (${known.size} keys in en.ts)`);
