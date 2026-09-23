# Mobile Safari pitfall: `touchstart.preventDefault()` silently kills `click`

A general-purpose write-up of a browser-event gotcha we hit and fixed in this app's quiz text-annotation toolbar (Highlight / Strikethrough buttons). Kept here — not folded into `frontend.md` — specifically so it's easy to find again in a *different* project the next time the same symptom shows up: "a button works fine with a mouse, does nothing on an iPhone."

## TL;DR

> On WebKit/Safari, calling `event.preventDefault()` inside a `touchstart` handler suppresses every synthesized mouse event that would normally follow it — `mousedown`, `mouseup`, and **`click`**. If your button's real action is wired to `(click)`, a `touchstart.preventDefault()` anywhere in that chain makes the button silently do nothing on iOS, while continuing to work perfectly with a mouse on desktop. This is *why* desktop testing alone cannot catch this class of bug.

## The general problem this applies to

Any UI where **(a)** the user first makes a text selection, then **(b)** taps a toolbar button elsewhere on the screen to act on that selection — a highlighter, a "copy as quote", an inline comment tool, a rich-text editor's format bar — runs into two *competing* mobile-browser behaviors:

1. **Selection loss on tap-away.** Mobile Safari (and most touch browsers) collapses the active text selection as part of handling a tap on an element that isn't inside that selection. A toolbar button sitting below the selected text is exactly such an element. By the time your `click` handler runs and reads `document.getSelection()`, there may be nothing left to read.
2. **Click suppression from over-fixing #1.** The standard fix for #1 is to call `event.preventDefault()` in the button's `touchstart` (or `mousedown`) handler, since `preventDefault()` on the pointer-down phase stops the browser from shifting focus/collapsing the selection before your actual handler runs. This genuinely works for *preserving the selection*. But on WebKit specifically, `touchstart.preventDefault()` has a second, less advertised effect: it cancels the synthetic mouse event sequence WebKit would otherwise generate from that touch, **including the `click` event itself**. If your action logic lives in `(click)`, the fix for problem #1 becomes a new, total failure: the selection is preserved, but the handler that was supposed to *use* it never runs at all.

Neither of these two behaviors reproduces on desktop Safari (mouse selection isn't cleared by clicking a button the way touch selection is) or on desktop Chrome/Firefox (they don't suppress `click` after a `touchstart.preventDefault()` the same way WebKit does) — so a bug born from this interaction is essentially **invisible to any desktop-only test pass, including "responsive mode" / device-emulation in desktop DevTools**, which simulates touch geometry but not this specific WebKit click-synthesis rule. It only reproduces on real iOS/iPadOS Safari (or the Safari-based WebView some hybrid apps embed).

## What this looked like concretely in this repo

`frontend/src/app/features/quiz/quiz-runner.component.ts` has a "Highlight" and a "Strikethrough" button above the question text. The intended flow: select some text, tap the button, the selected range gets wrapped in a `<mark>`/`<s>`.

- **First bug report**: on iPhone, tapping "Highlight" after selecting text did nothing — matches failure mode #1 above. The button's only binding was `(click)="onHighlightClick()"`, which read `document.getSelection()` and found it already collapsed.
- **First fix (incomplete)**: added `(mousedown)="$event.preventDefault()"` and `(touchstart)="$event.preventDefault()"` to the button. This is the standard, correct-looking fix for #1, and it worked for #1 — but introduced failure mode #2. Desktop testing (mouse-driven, no real `touchstart`) showed the fix working perfectly, so it shipped.
- **Second bug report**: same symptom as before — tapping "Highlight" on iPhone still did nothing — but now for the *opposite* reason. Confirmed by connecting Safari's Web Inspector to the real device (desktop Safari cannot reproduce this, so remote-debugging the actual phone was required) and logging every relevant event: `touchstart` fired reliably on every tap, but the `click` handler's log line never once appeared, across six consecutive taps in the captured session. That asymmetry — `touchstart` firing, `click` never following — is the fingerprint of this exact WebKit behavior.
- **Working fix**: keep the `touchstart`/`mousedown` `preventDefault()` (still needed to protect the selection), but move the *action* itself into a `(touchend)` handler instead of waiting for the now-suppressed `click`. `touchend` still fires normally even when its preceding `touchstart` called `preventDefault()`. `click` is kept as the mouse/desktop code path, guarded by a short timestamp check so a device that happens to *also* fire `click` after `touchend` (some touch+mouse hybrids) doesn't run the action twice:

  ```ts
  private lastTouchHandledAt = 0;

  onHighlightTouchEnd(event: Event): void {
    event.preventDefault();
    this.lastTouchHandledAt = Date.now();
    this.performHighlight();
  }

  onHighlightClick(): void {
    if (Date.now() - this.lastTouchHandledAt < 500) return; // already handled via touchend
    this.performHighlight();
  }
  ```

  ```html
  <button
    (mousedown)="$event.preventDefault()"
    (touchstart)="$event.preventDefault()"
    (touchend)="onHighlightTouchEnd($event)"
    (click)="onHighlightClick()"
  >Highlight</button>
  ```

## The generalizable rule of thumb

- If a button's `touchstart` (or `mousedown`) handler calls `preventDefault()` for *any* reason — preserving a selection, blocking a native context menu, stopping a scroll — **do not assume `click` will still fire on touch devices.** Verify it on real WebKit/Safari, not just desktop Chrome/Firefox or a device-emulation panel.
- The safe pattern for "prevent default on pointer-down, but still need the actual action to run on this tap" is: put the *real logic* in `touchend` (which is unaffected), and keep `click` only for the mouse/desktop path — never assume both fire together on every platform.
- When a bug **only reproduces on a specific mobile OS/browser** and not in desktop testing, suspect a browser-specific event-synthesis rule before suspecting your own application logic. These rules are rarely documented next to the API you're calling (`preventDefault()` itself looks identical everywhere; its *side effects* are what differ).
- **Debugging this class of bug requires the real device.** Desktop Safari's "Responsive Design Mode" and Chrome's device toolbar both simulate touch *geometry* (viewport size, `touchstart`/`touchend` firing) but not necessarily every platform-specific synthesis rule like this one. The fastest path to ground truth is Safari's Web Inspector connected to a physical iPhone/iPad over USB (Settings → Safari → Advanced → Web Inspector on the device; Safari → Settings → Advanced → "Show features for web developers" on the Mac; then Develop menu → the device's name, or "Inspect Apps and Devices" on newer Safari). A temporary, unconditional `console.log` (or a small on-screen debug overlay, useful when a cable/Mac isn't available yet) at each event handler — `touchstart`, `touchend`, `click`, `selectionchange` — showing exactly which fired and which didn't is usually enough to identify which half of this trap you're in within a few taps.

## Related docs

- [Frontend documentation](./frontend.md)
