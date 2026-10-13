import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { SettingsService } from '../services/settings.service';
import { DEFAULT_NAV_ORDER } from '../models/nav-item.model';

/** Redirects a bare `/exam/:packId` to the first tab the user actually has
 * visible, in their chosen order — not a hardcoded `banks`. A student who
 * put Mock exams first (and hid Question banks) lands on Mock exams. Guards
 * the empty child route, so it only runs for the bare workspace URL, never
 * when a real tab is already in the path. */
export const firstWorkspaceTabGuard: CanActivateFn = (route): UrlTree => {
  const settings = inject(SettingsService);
  const router = inject(Router);

  // The parent `/exam/:packId` owns the param; the empty child has none of its own.
  const packId = route.parent?.paramMap.get('packId') ?? route.paramMap.get('packId')!;
  const hidden = settings.hiddenNavTabs();
  const first = settings.orderedNavItems().find((item) => !hidden.includes(item.id));
  // hiddenNavTabs can never hide the last tab (SettingsService.toggleNavTab),
  // so `first` is normally set; fall back to the default order's head defensively.
  const target = first?.path ?? DEFAULT_NAV_ORDER[0];
  return router.createUrlTree(['/exam', packId, target]);
};
