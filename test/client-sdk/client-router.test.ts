import { describe, it, expect } from 'vitest';
import {
  getDashboardTabPath,
  getRouteTitle,
  isMalCallbackPathname,
  isPairPathname,
  isPlainLeftClick,
  normalizePathname,
  parseAppRoute,
  type DashboardTab,
  type LibraryTab,
} from '../../src/client/router';

describe('Client Web Console Router (Reload Persistence)', () => {
  it('round-trips every dashboard section path so page reloads preserve active tab', () => {
    const tabs: DashboardTab[] = ['library', 'profiles', 'devices', 'mal', 'backup'];

    for (const tab of tabs) {
      const path = getDashboardTabPath(tab);
      const parsed = parseAppRoute(path, '');
      expect(parsed).toEqual({
        kind: 'dashboard',
        tab,
        libraryTab: 'continue_watching',
        canonicalPath: path,
      });
    }
  });

  it('round-trips library sub-sections so page reloads preserve active sub-tab', () => {
    const subTabs: LibraryTab[] = ['continue_watching', 'favorites', 'history'];

    for (const subTab of subTabs) {
      const path = getDashboardTabPath('library', subTab);
      const parsed = parseAppRoute(path, '');
      expect(parsed).toEqual({
        kind: 'dashboard',
        tab: 'library',
        libraryTab: subTab,
        canonicalPath: path,
      });
    }

    expect(parseAppRoute('/library/continue-watching')).toEqual({
      kind: 'dashboard',
      tab: 'library',
      libraryTab: 'continue_watching',
      canonicalPath: '/library',
    });
  });

  it('normalizes trailing slashes, duplicate slashes, and uppercase paths', () => {
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('/mal/')).toBe('/mal');
    expect(normalizePathname('///profiles///')).toBe('/profiles');

    expect(parseAppRoute('/MAL/')).toEqual({
      kind: 'dashboard',
      tab: 'mal',
      libraryTab: 'continue_watching',
      canonicalPath: '/mal',
    });

    expect(parseAppRoute('/LIBRARY/FAVORITES/')).toEqual({
      kind: 'dashboard',
      tab: 'library',
      libraryTab: 'favorites',
      canonicalPath: '/library/favorites',
    });
  });

  it('preserves /pair and /mal-callback routes without colliding with /mal', () => {
    expect(isPairPathname('/pair')).toBe(true);
    expect(isPairPathname('/pair/')).toBe(true);
    expect(isPairPathname('/mal')).toBe(false);

    expect(isMalCallbackPathname('/mal-callback')).toBe(true);
    expect(isMalCallbackPathname('/mal-callback/')).toBe(true);
    expect(isMalCallbackPathname('/mal')).toBe(false);

    expect(parseAppRoute('/pair', '?code=K7R49P')).toEqual({
      kind: 'pair',
      code: 'K7R49P',
    });

    expect(parseAppRoute('/mal-callback', '?code=oauth_code&state=csrf_state')).toEqual({
      kind: 'mal-callback',
      search: '?code=oauth_code&state=csrf_state',
    });
  });

  it('falls back to home library route on unknown paths', () => {
    expect(parseAppRoute('/unknown/section')).toEqual({
      kind: 'dashboard',
      tab: 'library',
      libraryTab: 'continue_watching',
      canonicalPath: '/',
    });
  });

  it('generates uppercase titles for all routes in compliance with CAPS LOCK UI rules', () => {
    const routes = [
      parseAppRoute('/'),
      parseAppRoute('/library'),
      parseAppRoute('/library/favorites'),
      parseAppRoute('/library/history'),
      parseAppRoute('/profiles'),
      parseAppRoute('/devices'),
      parseAppRoute('/mal'),
      parseAppRoute('/backup'),
      parseAppRoute('/pair', '?code=ABC123'),
      parseAppRoute('/mal-callback', '?code=xyz'),
    ];

    for (const r of routes) {
      const title = getRouteTitle(r);
      expect(title.length).toBeGreaterThan(0);
      expect(title).toBe(title.toUpperCase());
    }
  });

  it('handles anchor plain left-clicks while allowing browser modified clicks (new tab/window)', () => {
    expect(
      isPlainLeftClick({
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toBe(true);

    expect(
      isPlainLeftClick({
        button: 1,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toBe(false);

    expect(
      isPlainLeftClick({
        button: 0,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toBe(false);

    expect(
      isPlainLeftClick({
        button: 0,
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toBe(false);
  });
});
