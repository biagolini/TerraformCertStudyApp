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

## `screens/`

Full-page mirrors of every real, shipped feature screen (Login, Packs,
Question list, Review viewer, Transcripts, Chat, Export, Methods, Settings —
`frontend/src/app/features/*`), tagged `@dsCard group="Screens"`. Unlike
`components/` (atomic fragments), these show a whole feature's states
side by side (e.g. the review viewer's reading/editing/empty states). Same
1:1-fidelity contract as `components/`/`foundations/`: keep in sync by hand
whenever the real component's markup or styles change.

## `concepts/`

Speculative, not-yet-built features explored inside this same project (by
explicit choice, so stakeholders see them alongside the real UI) rather than
in a disposable `/design` Artifact. Unlike `foundations/` and `components/`,
these do **not** mirror a real Angular component — there is nothing yet to
mirror. Each file is tagged `@dsCard group="Concepts (proposed, not yet
built)"` and opens with a dashed-border notice saying so. Promote the
relevant pieces into `foundations/`/`components/` (and delete the concept
file) once/if the feature actually ships.
