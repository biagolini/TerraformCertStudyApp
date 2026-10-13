---
inclusion: always
---

# Design System

`design-system/` mirrors `frontend/src/styles/_variables.scss` and the real component CSS 1:1. It is not generated from a compiled component library (this is Angular, not React). `design-system/README.md` explains how it is built.

- `foundations/`, `components/` (except `app-shell.html`) and `screens/login.html` are hand-authored. `components/app-shell.html` and the other `screens/` are captured from the running app (rendered DOM plus the CSS rules that apply to it). A changed screen is recaptured, never hand-edited.
- Captures use neutral sample data only: masked email, "Instructor A/B" authors with example.com links, a sample certification instead of the one the user studies, other certifications removed from the switcher. Sample content may be set in the page's memory for a capture, never saved to the user's account.
- When a design token changes in `_variables.scss`, update `design-system/styles.css` to match.
- Each preview file's first line is an `<!-- @dsCard group="..." -->` marker that builds the Design System pane's card index; keep it as line 1.
- The folder is published to a claude.ai/design project named "Cert Study Assistant" and kept in sync by hand (the sync runs from Claude Code). This repo is public: never commit that project's URL or id.
