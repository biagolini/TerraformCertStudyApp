# Cert Study Assistant — design system

Hand-authored HTML mirroring the real tokens and component CSS from
`frontend/src/styles/_variables.scss` and the components under
`frontend/src/app/**`. Not generated from a compiled component library (this
is an Angular app, not React), so it is kept in sync by hand — same approach
as `TerraformNinho/design-system`.

Published at claude.ai/design via the `DesignSync` tool. To update: edit the
files here, then re-run the sync (list the project, finalize a plan covering
the changed paths, write the files). The project's URL and id are never
committed (this repo is public): find it with `DesignSync` → `list_projects`
by its name, "Cert Study Assistant".

For full-screen mockups and exploration (not token-level, not kept in sync
automatically) use the `/design` skill instead — that publishes a separate,
disposable Claude Artifact.

## `foundations/` and `components/`

Hand-authored. `foundations/` covers color, type and the icon set (paths
generated from `ICONS` in `shared/components/icon.component.ts`).
`styles.css` also mirrors the `.reading-theme-light/-dark/-sepia` classes:
the same token sets scoped to one element, used for a study note's text theme.
`components/ui-primitives.html` inlines `src/styles/_ui.scss` compiled
verbatim (`npx sass`) and shows every `ui-*` primitive the
certification-centric pages compose; `components/app-shell.html` is the
sticky header plus the workspace head and tabs. `cards-badges.html` documents the domain badges and AI disclaimer, which
are standalone components rather than `ui-*` classes. Every page now builds
its buttons, inputs, switches, segmented choices and progress bars from
`ui-*`; the older component-local classes (`generate-btn`, `btn-ghost-sm`,
`select-input`, …) are gone.

## `screens/`

Full-page mirrors of every shipped route — Home, the Add certification
dialog, Profile, Settings, Costs, Backup, and each workspace tab
(`/exam/:packId/…`: banks plus its Authors dialog, questions + review, the
import hub and a practice exam's upload page, mock exam setup and results,
performance, the notes list plus a note in reading mode with its heading
index, text theme and export menus, editing mode and version history,
transcripts, chat, export) — plus Login, tagged
`@dsCard group="Screens"`.

Except Login (hand-authored from `login.component.ts` so it can show all four states side by side), these are **captured from the running app**,
not retyped: with `npm start` running and signed in, a small script in the
browser clones the rendered app shell and collects every CSS rule from the
app's stylesheets that applies to it (reset, `_ui.scss`, component styles —
the `_ngcontent`/`_nghost` attributes are Angular's emulated encapsulation and
are kept so scoped rules still match). Colors come only from the tokens in
`styles.css`, so the theme toggle works on every screen. Real account data is
replaced with sample data before capture (masked email, a sample question in
the review, trimmed lists, the user's bank authors renamed "Instructor A/B"
with example.com links, other certifications removed from the switcher) —
this repo is public. Where the sample account has nothing to show (import
history, processed uploads), sample rows are inserted into the live page just
for the capture so their real CSS is collected, then removed. The note screens
show a sample note and sample versions set in the page's memory only, never
saved. When a screen changes,
recapture it rather than hand-editing the captured markup.

No `concepts/` right now: the practice-quiz concept shipped as the Mock exams
tab and was removed. New speculative features can go back under `concepts/`
with `@dsCard group="Concepts (proposed, not yet built)"`.
