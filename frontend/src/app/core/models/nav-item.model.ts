export type NavTabId = 'questions' | 'import' | 'quiz' | 'transcripts' | 'chat' | 'export';

export interface NavItem {
  id: NavTabId;
  path: string;
  label: string;
  /** SVG path `d` attribute — every current nav icon is a single <path>, 24x24 viewBox. */
  icon: string;
}

/** Single source of truth for the bottom tabbar, rendered by AppComponent and
 * toggled per-item in SettingsComponent — see AppSettings.hiddenNavTabs. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'questions', path: '/questions', label: 'Questions', icon: 'M12 5v14M5 12h14' },
  {
    id: 'import',
    path: '/import',
    label: 'Import',
    icon: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  },
  {
    id: 'quiz',
    path: '/quiz',
    label: 'Quiz',
    icon: 'M9 11l2.5 2.5L16 8M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z',
  },
  {
    id: 'transcripts',
    path: '/transcripts',
    label: 'Transcripts',
    icon: 'M7 4h7l5 5v11a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1zM14 4v5h5M9 13h6M9 17h6',
  },
  { id: 'chat', path: '/chat', label: 'Chat', icon: 'M4 4h16v12H8l-4 4z' },
  { id: 'export', path: '/export', label: 'Export', icon: 'M12 4v12M7 11l5 5 5-5M4 20h16' },
];
