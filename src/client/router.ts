export type DashboardTab = 'library' | 'profiles' | 'devices' | 'mal' | 'backup';

export type LibraryTab = 'continue_watching' | 'favorites' | 'history';

export type AppRoute =
  | { kind: 'pair'; code: string }
  | { kind: 'mal-callback'; search: string }
  | {
      kind: 'dashboard';
      tab: DashboardTab;
      libraryTab: LibraryTab;
      canonicalPath: string;
    };

export const DEFAULT_APP_TITLE = 'KUROSYNC — PERSONAL CLOUDFLARE SYNC CONSOLE';

const DASHBOARD_TAB_PATHS: Record<DashboardTab, string> = {
  library: '/library',
  profiles: '/profiles',
  devices: '/devices',
  mal: '/mal',
  backup: '/backup',
};

const LIBRARY_SUBTAB_PATHS: Record<LibraryTab, string> = {
  continue_watching: '/library',
  favorites: '/library/favorites',
  history: '/library/history',
};

export function normalizePathname(pathname: string): string {
  const trimmed = (pathname || '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  const collapsed = trimmed.replace(/\/+/g, '/').replace(/\/+$/, '');
  return collapsed.startsWith('/') ? collapsed || '/' : `/${collapsed}`;
}

export function isPairPathname(pathname: string): boolean {
  const lower = normalizePathname(pathname).toLowerCase();
  return lower === '/pair' || lower.startsWith('/pair/');
}

export function isMalCallbackPathname(pathname: string): boolean {
  const lower = normalizePathname(pathname).toLowerCase();
  return lower === '/mal-callback' || lower.startsWith('/mal-callback/');
}

export function getDashboardTabPath(tab: DashboardTab, libraryTab?: LibraryTab): string {
  if (tab === 'library' && libraryTab) {
    return LIBRARY_SUBTAB_PATHS[libraryTab];
  }
  return DASHBOARD_TAB_PATHS[tab];
}

export function parseAppRoute(pathname: string, search: string = ''): AppRoute {
  const normalized = normalizePathname(pathname);
  const lower = normalized.toLowerCase();

  if (lower === '/pair' || lower.startsWith('/pair/')) {
    const params = new URLSearchParams(search);
    return {
      kind: 'pair',
      code: params.get('code') || '',
    };
  }

  if (lower === '/mal-callback' || lower.startsWith('/mal-callback/')) {
    return {
      kind: 'mal-callback',
      search: search || '?',
    };
  }

  if (lower === '/') {
    return {
      kind: 'dashboard',
      tab: 'library',
      libraryTab: 'continue_watching',
      canonicalPath: '/',
    };
  }

  if (lower === '/library' || lower === '/library/continue-watching' || lower === '/library/continue_watching') {
    return {
      kind: 'dashboard',
      tab: 'library',
      libraryTab: 'continue_watching',
      canonicalPath: '/library',
    };
  }

  if (lower === '/library/favorites') {
    return {
      kind: 'dashboard',
      tab: 'library',
      libraryTab: 'favorites',
      canonicalPath: '/library/favorites',
    };
  }

  if (lower === '/library/history') {
    return {
      kind: 'dashboard',
      tab: 'library',
      libraryTab: 'history',
      canonicalPath: '/library/history',
    };
  }

  if (lower === '/profiles') {
    return {
      kind: 'dashboard',
      tab: 'profiles',
      libraryTab: 'continue_watching',
      canonicalPath: '/profiles',
    };
  }

  if (lower === '/devices') {
    return {
      kind: 'dashboard',
      tab: 'devices',
      libraryTab: 'continue_watching',
      canonicalPath: '/devices',
    };
  }

  if (lower === '/mal') {
    return {
      kind: 'dashboard',
      tab: 'mal',
      libraryTab: 'continue_watching',
      canonicalPath: '/mal',
    };
  }

  if (lower === '/backup') {
    return {
      kind: 'dashboard',
      tab: 'backup',
      libraryTab: 'continue_watching',
      canonicalPath: '/backup',
    };
  }

  return {
    kind: 'dashboard',
    tab: 'library',
    libraryTab: 'continue_watching',
    canonicalPath: '/',
  };
}

export function getRouteTitle(route: AppRoute): string {
  if (route.kind === 'pair') {
    return 'ACCOPPIA TV — KUROSYNC';
  }
  if (route.kind === 'mal-callback') {
    return 'MYANIMELIST — KUROSYNC';
  }
  switch (route.tab) {
    case 'library':
      if (route.libraryTab === 'favorites') return 'FAVORITES — LIBRERIA — KUROSYNC';
      if (route.libraryTab === 'history') return 'WATCH HISTORY — LIBRERIA — KUROSYNC';
      return 'LIBRERIA — KUROSYNC';
    case 'profiles':
      return 'PROFILI — KUROSYNC';
    case 'devices':
      return 'DISPOSITIVI — KUROSYNC';
    case 'mal':
      return 'MYANIMELIST — KUROSYNC';
    case 'backup':
      return 'BACKUP — KUROSYNC';
  }
}

export function isPlainLeftClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}
