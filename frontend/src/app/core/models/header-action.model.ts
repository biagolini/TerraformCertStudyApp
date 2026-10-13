/** Optional buttons of the global app header. Settings is not in this list on
 * purpose: it is always shown (last) and cannot be removed, because it is the
 * only way back to this configuration. The contextual indicators (offline,
 * running import) are not configurable either; they only appear when relevant. */
export type HeaderActionId = 'home' | 'costs' | 'backup' | 'profile' | 'theme' | 'sync' | 'signOut';

export interface HeaderActionDef {
  id: HeaderActionId;
  /** i18n key for the name shown in Settings. */
  labelKey: string;
}

export const HEADER_ACTIONS: HeaderActionDef[] = [
  { id: 'home', labelKey: 'headerActions.home' },
  { id: 'costs', labelKey: 'headerActions.costs' },
  { id: 'backup', labelKey: 'headerActions.backup' },
  { id: 'profile', labelKey: 'headerActions.profile' },
  { id: 'theme', labelKey: 'headerActions.theme' },
  { id: 'sync', labelKey: 'headerActions.sync' },
  { id: 'signOut', labelKey: 'headerActions.signOut' },
];

/** Only Settings by default: on a phone the full set no longer fit next to
 * the brand and the certification crumb, overlapped it, and widened the page
 * past the viewport (Safari then zoomed out and showed a dark strip on the right). */
export const DEFAULT_HEADER_ACTIONS: HeaderActionId[] = [];

export function isHeaderActionId(value: unknown): value is HeaderActionId {
  return typeof value === 'string' && HEADER_ACTIONS.some((a) => a.id === value);
}

/** Cleans a stored list: unknown ids and duplicates are dropped, order is kept. */
export function resolveHeaderActions(stored: readonly unknown[] | undefined | null): HeaderActionId[] {
  const result: HeaderActionId[] = [];
  for (const id of stored ?? []) {
    if (isHeaderActionId(id) && !result.includes(id)) result.push(id);
  }
  return result;
}
