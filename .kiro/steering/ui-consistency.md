---
inclusion: always
---

# UI Consistency: Reuse Before Creating

A new control must look and behave like the same kind of control elsewhere in the app. Inconsistent pieces in this codebase came from building a control from scratch without looking at how the app already does it.

## Before writing any UI

1. Search the code for an existing control of the same kind (`grep` the feature folders and `shared/components/`) and copy its structure, classes and behavior. Only build something new when nothing similar exists.
2. Read `design-system/components/ui-primitives.html` and use its `ui-*` classes (`src/styles/_ui.scss`) before adding component-local CSS.
3. Match the surrounding area: the same button size and variant as its neighbors (a header action row uses plain `ui-btn`, not `ui-btn-sm`), the same icon via `<app-icon>`, the same i18n pattern (reuse existing keys, such as `notes.sortBy`, instead of duplicating them).

## Patterns already in the app

| Need | Use | Where it lives |
|---|---|---|
| Sort a list | Trigger button ("Sort by: <field>") opening a menu of fields with a check mark, plus an A to Z / Z to A segmented control; the choice is stored in `AppSettings` | `features/notes/note-sort-menu.component.ts`, `features/banks/bank-sort-menu.component.ts` |
| Choose one of a few options inline | `ui-segmented` | `_ui.scss` |
| Search box | `ui-search` with `ui-input` | `_ui.scss` |
| Icon-only action | `ui-btn ui-btn-icon` with `aria-label` and `title` | see `ui-icons.md` |

## Do not

- Do not use a native `<select>` for toolbar or header controls. The OS draws its popup with its own colors, so it turns dark on the light theme. Use the menu pattern above. A native `<select>` is acceptable only in a form field styled with `ui-input`.
- Do not persist a UI preference in `localStorage` when a sibling control stores it in `AppSettings` (it then follows the user across browsers).
- Do not create a second component for something that exists; extract the shared part instead and tell the user.

## When a new reusable control is added

Add it to the table above, document it in `docs/frontend.md`, and note that the affected `design-system/screens/` captures need to be retaken (they are recaptured from the running app, never hand-edited; see `design-system.md`).
