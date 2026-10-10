# Cert Study Assistant — design system

Hand-authored HTML mirroring the real tokens and component CSS from
`frontend/src/styles/_variables.scss` and the components under
`frontend/src/app/**`. Not generated from a compiled component library (this
is an Angular app, not React), so it is kept in sync by hand — same approach
as `TerraformNinho/design-system`.

Published at claude.ai/design via the `DesignSync` tool. To update: edit the
files here, then re-run the sync (list the project, finalize a plan covering
the changed paths, write the files). See the project's root `CLAUDE.md` for
the current published URL.

For full-screen mockups and exploration (not token-level, not kept in sync
automatically) use the `/design` skill instead — that publishes a separate,
disposable Claude Artifact.

## `foundations/` and `components/`

Hand-authored. `foundations/` covers color, type and the icon set (paths
generated from `ICONS` in `shared/components/icon.component.ts`).
`components/ui-primitives.html` inlines `src/styles/_ui.scss` compiled
verbatim (`npx sass`) and shows every `ui-*` primitive the
certification-centric pages compose; `components/app-shell.html` is the
sticky header plus the workspace head and tabs. `buttons-inputs.html` and
`cards-badges.html` document the older component-local classes
(`generate-btn`, `domain-badge`, …) still used by the transcripts/chat/review
features.

## `screens/`

Full-page mirrors of every shipped route — Home, the Add certification
dialog, Profile, Settings, Costs, and each workspace tab (`/exam/:packId/…`:
banks, questions + review, import, mock exam setup, performance, notes,
transcripts, chat, export) — plus Login, tagged `@dsCard group="Screens"`.

Except Login (hand-authored from `login.component.ts` so it can show all four states side by side), these are **captured from the running app**,
not retyped: with `npm start` running and signed in, a small script in the
browser clones the rendered app shell and collects every CSS rule from the
app's stylesheets that applies to it (reset, `_ui.scss`, component styles —
the `_ngcontent`/`_nghost` attributes are Angular's emulated encapsulation and
are kept so scoped rules still match). Colors come only from the tokens in
`styles.css`, so the theme toggle works on every screen. Real account data is
replaced with sample data before capture (masked email, a sample question in
the review, trimmed lists) — this repo is public. When a screen changes,
recapture it rather than hand-editing the captured markup.

No `concepts/` right now: the practice-quiz concept shipped as the Mock exams
tab and was removed. New speculative features can go back under `concepts/`
with `@dsCard group="Concepts (proposed, not yet built)"`.
