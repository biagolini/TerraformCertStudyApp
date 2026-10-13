---
inclusion: always
---

# Icons and Visual Symbols

The frontend never uses emojis, and never uses Unicode pictographs as icons (for example ✦ ✓ ✕ ★ ⏱ ⋮ → ↗ 🗑 👤). They render differently on every OS, look unprofessional, and are invisible to the design system. This applies to templates, TypeScript strings and i18n dictionaries.

Every icon is an outline SVG drawn through the shared component `frontend/src/app/shared/components/icon.component.ts`:

```html
<app-icon name="sparkles" />          <!-- decorative, 16px -->
<app-icon name="user" size="14" />
```

- Style: 24x24 grid, 2px stroke, round caps and joins, `currentColor`, no fill (the Lucide look). Keep new icons in that style.
- Need an icon that is not there? Add its path data to `ICONS` in that file; do not inline a one-off SVG, add an icon font, or add an icon package without a reason.
- Icons are `aria-hidden`. An icon-only button must carry its own `aria-label` (and preferably `title`).
- Text glyphs that are typography, not icons, stay as text: middle dot `·`, en/em dash, ellipsis `…`, Spanish `¿ ¡`, the multiplication sign in counts such as `3×`.
- Older components still hold a few single-path inline SVGs from before the registry existed (header actions, theme toggle, sync pill). They are fine as they are; move them to `<app-icon>` when touching that code.

`node scripts/check-no-emoji.mjs` (from `frontend/`) fails on any pictographic character outside comments, so run it with the other frontend checks.
