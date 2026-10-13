---
inclusion: always
---

# Frontend Conventions

How to write Angular code in `frontend/`. Routing, services and deploy detail are in `docs/frontend.md`.

## Components

- Angular 21, standalone components, Signals, `ChangeDetectionStrategy.OnPush` everywhere, template and styles inline in the `.ts`.
- New control flow only: `@if` / `@for`, never `*ngIf` / `*ngFor`.
- Plain SCSS, no Tailwind. Prefer the global `ui-*` primitives in `src/styles/_ui.scss` (buttons, inputs, cards, chips, switches, segmented controls, modals, progress bars) over new component-local classes.
- Icons only through `<app-icon>`, never emojis (see `ui-icons.md`).

## Theming and Design Tokens

- Every color, spacing and radius value is a CSS custom property from `src/styles/_variables.scss`, the single source of truth for design tokens. Themes are switched by an `html.theme-light` / `html.theme-dark` class (`ThemeService`).
- Never hardcode a hex color or a raw pixel value in a component's `styles`; use the existing `--bg-*`, `--text-*`, `--color-*`, `--space-*`, `--radius-*` tokens. There are no remaining exceptions.
- `.reading-theme-light/-dark/-sepia` apply the same token sets to one element (a study note's text theme). Custom properties inherit, so everything inside follows them.

## i18n

- The interface ships in English, Portuguese, Spanish, and Italian. Every component that renders user-facing text injects `I18nService` and calls `i18n.t('some.key')` directly in the template, never through a pipe: a signal read in a template expression is what OnPush tracks, so a language switch re-renders every view.
- String tables are `core/i18n/{en,pt,es,it}.ts`, one flat `Record<string, string>` per language keyed by dot-path. `en.ts` is the authoritative key list; every key added there must be added to the other three (`node scripts/check-i18n-keys.mjs` checks this). Keys built dynamically are listed in `core/i18n/i18n.spec.ts`.
- "Interface language" (the app's own chrome) and "Output language" (AI-generated text only) are separate settings.
- Backend/SDK error strings (Cognito errors, exceptions surfaced verbatim from `/data`) are intentionally not translated.

## Data Sync (`StorageService`)

- Saves diff the incoming array against the previous in-memory snapshot (`diffAndSync`) and debounce one `PUT /data/<kind>/<id>` per changed item. Do not go back to whole-dataset writes: bulk `PUT /data` (`pushAll`) exists only for the one-time localStorage-to-cloud migration on first login.
- `flushPendingSync()` fires pending per-item writes immediately; call it before anything that pulls remote data, so a pull never discards an unsaved edit.
- Concurrent edits to the same item are still last-write-wins (no versioning or optimistic concurrency yet). A `visibilitychange` listener re-pulls `/data` when the tab regains focus, throttled to once per 20 seconds.
