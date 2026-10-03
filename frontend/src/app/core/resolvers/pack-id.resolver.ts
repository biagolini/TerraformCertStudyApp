import { inject } from '@angular/core';
import { RedirectCommand, ResolveFn, Router } from '@angular/router';
import { PacksService } from '../services/packs.service';
import { SettingsService } from '../services/settings.service';

/** `PacksService` loads its list from a constructor effect, which runs on a
 * later tick than the resolver that may be the first to inject it (hard
 * page load on a deep link). Wait for that first load before deciding a
 * packId is unknown; `loaded` flips even when the user has no packs. */
async function waitForPacksLoaded(packs: PacksService): Promise<void> {
  for (let i = 0; i < 250 && !packs.loaded(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Makes `/exam/:packId` the source of truth for the active certification:
 * it becomes `activePackId` before any workspace page renders, so every
 * pack-scoped service (questions, banks, chats, quiz) already points at it.
 * An unknown or deleted id goes back to Home instead of silently showing
 * another certification. */
export const packIdResolver: ResolveFn<string> = async (route) => {
  const packs = inject(PacksService);
  const settings = inject(SettingsService);
  const router = inject(Router);

  const requestedId = route.paramMap.get('packId')!;
  await waitForPacksLoaded(packs);
  if (packs.getById(requestedId)) {
    settings.setActivePackId(requestedId);
    packs.touch(requestedId);
    return requestedId;
  }
  return new RedirectCommand(router.createUrlTree(['/']));
};
