import { inject } from '@angular/core';
import { RedirectCommand, ResolveFn, Router } from '@angular/router';
import { PacksService } from '../services/packs.service';
import { SettingsService } from '../services/settings.service';

/** `PacksService` bootstraps its pack list from a constructor `effect()`
 * that reacts to `StorageService.ready()` — effects flush on the next
 * tick, never synchronously with the signal write that triggered them. On
 * a hard page load (typed/bookmarked/refreshed URL), a resolver can be the
 * very first thing to `inject(PacksService)`, running in the same
 * synchronous tick that constructs it — before its bootstrap effect has
 * had a chance to run even once. At that instant `packs.packs()` is still
 * `[]`, so a perfectly valid packId looks unknown and gets redirected away
 * from — this is what made a bookmarked question URL fail to show its
 * question. Give the effect a few ticks to populate before trusting
 * `packs.packs()`/`getById()`. `PacksService`'s effect always seeds at
 * least one pack once it runs, so this only ever waits a handful of ticks
 * in practice; the timeout is just a safety bound — see the `timedOut`
 * return below for why callers must check it before redirecting. */
async function waitForPacksReady(packs: PacksService): Promise<{ timedOut: boolean }> {
  for (let i = 0; i < 100 && packs.packs().length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { timedOut: packs.packs().length === 0 };
}

/** Makes the `:packId` route segment the source of truth for "which pack
 * am I viewing" — runs before the target page component is created, so
 * `PacksService.activePack()` (still backed by the persisted, synced
 * `activePackId` setting) is already correct on first render, with no
 * one-frame flash of the previous pack's data. An unknown/deleted packId
 * redirects to a real pack instead of silently falling back, surfacing
 * `PacksService.activePack()`'s existing fallback behavior as a real
 * navigation rather than a mismatch between the URL and what's shown. */
export const packIdResolver: ResolveFn<string> = async (route) => {
  const packs = inject(PacksService);
  const settings = inject(SettingsService);
  const router = inject(Router);

  const requestedId = route.paramMap.get('packId')!;
  const { timedOut } = await waitForPacksReady(packs);
  // If packs genuinely never loaded, PacksService.activePack() would return
  // its internal placeholder pack (id "__placeholder__") — redirecting
  // there would just re-run this same resolver against the same
  // never-satisfiable condition, looping forever. Let the requested id
  // through as-is instead; the page renders an empty state rather than
  // spinning.
  if (timedOut) return requestedId;

  if (packs.getById(requestedId)) {
    settings.setActivePackId(requestedId);
    return requestedId;
  }
  return new RedirectCommand(router.createUrlTree(['/questions', packs.activePack().id]));
};

/** Same wait, for the bare `/questions` index redirect (see app.routes.ts)
 * — same race applies there: reading `activePack()` before the pack list
 * has loaded would send a fresh page load to the placeholder pack instead
 * of the user's real active pack. */
export async function resolveActivePackIdForRedirect(packs: PacksService): Promise<string> {
  await waitForPacksReady(packs);
  return packs.activePack().id;
}
