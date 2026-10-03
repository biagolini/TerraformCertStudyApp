/** Tabs of the certification workspace (/exam/:packId/<path>). */
export type NavTabId = 'banks' | 'quiz' | 'performance' | 'notes' | 'flashcards' | 'transcripts' | 'chat' | 'export';

export interface NavItem {
  id: NavTabId;
  /** Child route under /exam/:packId. */
  path: string;
  label: string;
  /** SVG path `d` attribute — every nav icon is a single <path>, 24x24 viewBox. */
  icon: string;
}

/** Single source of truth for the workspace tab bar, rendered by
 * ExamWorkspaceComponent and toggled/reordered in Settings — see
 * AppSettings.hiddenNavTabs / navOrder. */
export const NAV_ITEMS: NavItem[] = [
  {
    id: 'banks',
    path: 'banks',
    label: 'Question banks',
    icon: 'M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zm0 0v6c0 1.1 3.6 2 8 2s8-.9 8-2V6M4 12v6c0 1.1 3.6 2 8 2s8-.9 8-2v-6',
  },
  {
    id: 'quiz',
    path: 'quiz',
    label: 'Mock exams',
    icon: 'M9 11l2.5 2.5L16 8M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z',
  },
  { id: 'performance', path: 'performance', label: 'Performance', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  {
    id: 'notes',
    path: 'notes',
    label: 'Notes',
    icon: 'M7 4h7l5 5v11a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1zM14 4v5h5M9 13h6M9 17h6',
  },
  {
    id: 'flashcards',
    path: 'flashcards',
    label: 'Flashcards',
    icon: 'M8 4h11a1 1 0 011 1v11M4 8h11a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V9a1 1 0 011-1z',
  },
  {
    id: 'transcripts',
    path: 'transcripts',
    label: 'Transcripts',
    icon: 'M4 6h16M4 10h16M4 14h10M4 18h7',
  },
  { id: 'chat', path: 'chat', label: 'Chat', icon: 'M4 4h16v12H8l-4 4z' },
  { id: 'export', path: 'export', label: 'Export', icon: 'M12 4v12M7 11l5 5 5-5M4 20h16' },
];

export const DEFAULT_NAV_ORDER: NavTabId[] = NAV_ITEMS.map((item) => item.id);

/** Resolves a stored nav order into the actual NavItem list, in that
 * order — tolerant of a stale/incomplete order (a new NAV_ITEMS entry
 * shipped after the user's order was saved, or an unrecognized id left
 * over from a removed one): known ids come first in the given order,
 * followed by any current nav items missing from it, so a nav item never
 * just disappears because the stored order predates it. */
export function resolveNavOrder(order: readonly string[]): NavItem[] {
  const byId = new Map(NAV_ITEMS.map((item) => [item.id, item]));
  const ordered: NavItem[] = [];
  const seen = new Set<NavTabId>();
  for (const id of order) {
    const item = byId.get(id as NavTabId);
    if (item && !seen.has(item.id)) {
      ordered.push(item);
      seen.add(item.id);
    }
  }
  for (const item of NAV_ITEMS) {
    if (!seen.has(item.id)) ordered.push(item);
  }
  return ordered;
}
