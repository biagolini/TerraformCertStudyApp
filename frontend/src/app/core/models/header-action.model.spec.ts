import { describe, expect, it } from 'vitest';
import { DEFAULT_HEADER_ACTIONS, resolveHeaderActions } from './header-action.model';
import { CURRENT_LAYOUT_VERSION, DEFAULT_SETTINGS, migrateSettings } from './settings.model';

describe('resolveHeaderActions', () => {
  it('defaults to no optional buttons (Settings only)', () => {
    expect(DEFAULT_HEADER_ACTIONS).toEqual([]);
    expect(resolveHeaderActions(undefined)).toEqual([]);
  });

  it('keeps the stored order and drops unknown or duplicated ids', () => {
    expect(resolveHeaderActions(['profile', 'nope', 'home', 'profile', 'settings'])).toEqual(['profile', 'home']);
  });
});

describe('migrateSettings', () => {
  it('moves settings saved before v1 to a 2-row quiz toolbar', () => {
    const stored = { ...DEFAULT_SETTINGS, quizToolbarRows: 1 };
    delete stored.layoutVersion;
    const migrated = migrateSettings(stored);
    expect(migrated.quizToolbarRows).toBe(2);
    expect(migrated.layoutVersion).toBe(CURRENT_LAYOUT_VERSION);
  });

  it('keeps a larger row count chosen before v1', () => {
    expect(migrateSettings({ ...DEFAULT_SETTINGS, quizToolbarRows: 3 }).quizToolbarRows).toBe(3);
  });

  it('leaves already-migrated settings untouched, so a later choice of 1 row sticks', () => {
    const current = { ...DEFAULT_SETTINGS, quizToolbarRows: 1, layoutVersion: CURRENT_LAYOUT_VERSION };
    expect(migrateSettings(current)).toBe(current);
  });
});
