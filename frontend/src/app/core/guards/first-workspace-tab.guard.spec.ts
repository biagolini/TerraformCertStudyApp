
import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { firstWorkspaceTabGuard } from './first-workspace-tab.guard';
import { SettingsService } from '../services/settings.service';

function run(hiddenNavTabs: string[], navOrder: string[]): UrlTree {
  const settings = {
    hiddenNavTabs: () => hiddenNavTabs,
    orderedNavItems: () => navOrder.map((id) => ({ id, path: id })),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: SettingsService, useValue: settings }],
  });
  const router = TestBed.inject(Router);
  const route = { parent: { paramMap: new Map([['packId', 'p1']]) } } as unknown as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => firstWorkspaceTabGuard(route, {} as never)) as UrlTree;
}

describe('firstWorkspaceTabGuard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('redirects a bare workspace URL to the first visible tab in the user order', () => {
    const tree = run([], ['banks', 'quiz', 'performance']);
    expect(tree.toString()).toBe('/exam/p1/banks');
  });

  it('skips hidden tabs: a student with Mock exams first and Question banks hidden lands on quiz', () => {
    const tree = run(['banks'], ['quiz', 'banks', 'performance']);
    expect(tree.toString()).toBe('/exam/p1/quiz');
  });

  it('honours a reordered list even with nothing hidden', () => {
    const tree = run([], ['notes', 'banks', 'quiz']);
    expect(tree.toString()).toBe('/exam/p1/notes');
  });
});
