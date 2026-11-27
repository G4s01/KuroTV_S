import React, { useState, useEffect, useCallback, useRef } from 'react';
import { oledTheme, FONT_MONO } from './theme';
import { Navbar } from './components/Navbar';
import { SetupWizard } from './views/SetupWizard';
import { MasterLogin } from './views/MasterLogin';
import { TvPairView } from './views/TvPairView';
import { LibraryView } from './views/Dashboard/LibraryView';
import { ProfilesView } from './views/Dashboard/ProfilesView';
import { DevicesView } from './views/Dashboard/DevicesView';
import { BackupView } from './views/Dashboard/BackupView';
import { MalView, type MalViewStatusMessage } from './views/Dashboard/MalView';
import { Modal } from './components/Modal';
import { Button } from './components/Button';
import { completeMalOAuthFromSearch } from './malOAuth';
import {
  FilmIcon,
  UserIcon,
  TvIcon,
  MalIcon,
  DownloadIcon,
} from './components/Icons';
import {
  api,
  type HealthResponse,
  type MalAccountSummary,
  type ProfileRecord,
} from './api';

const AVATAR_COLORS = [
  '#E50914',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#64748B',
];

export type DashboardTab = 'library' | 'profiles' | 'devices' | 'mal' | 'backup';

export const App: React.FC = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!api.getToken());
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(api.getActiveProfileId());
  const [activeTab, setActiveTab] = useState<DashboardTab>('library');
  const [currentPath, setCurrentPath] = useState<string>(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  const [pairCodeParam, setPairCodeParam] = useState<string>('');
  const [isTvPairModalOpen, setIsTvPairModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isCreateProfileModalOpen, setIsCreateProfileModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileColor, setNewProfileColor] = useState('#E50914');
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [createProfileError, setCreateProfileError] = useState<string | null>(null);
  const [malAccounts, setMalAccounts] = useState<MalAccountSummary[]>([]);
  const [malPreselectProfileId, setMalPreselectProfileId] = useState<string | null>(null);
  const [malStatusBanner, setMalStatusBanner] = useState<MalViewStatusMessage | null>(null);
  const [malRefreshTick, setMalRefreshTick] = useState(0);
  const [pendingMalCallbackSearch, setPendingMalCallbackSearch] = useState<string | null>(() => {
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname === '/mal-callback' ||
        window.location.pathname.startsWith('/mal-callback/'))
    ) {
      return window.location.search || '?';
    }
    return null;
  });
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Parse path and query params on mount & on popstate
  const updateRouteFromLocation = useCallback(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code') || '';
    setCurrentPath(path);
    if (path === '/mal-callback' || path.startsWith('/mal-callback/')) {
      setPendingMalCallbackSearch(window.location.search || '?');
    }
    if (code) {
      setPairCodeParam(code);
    }
  }, []);

  useEffect(() => {
    updateRouteFromLocation();
    window.addEventListener('popstate', updateRouteFromLocation);
    return () => window.removeEventListener('popstate', updateRouteFromLocation);
  }, [updateRouteFromLocation]);

  const navigate = (path: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      updateRouteFromLocation();
    }
  };

  // Check health and initialization state
  const checkInstanceHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const res = await api.checkHealth();
      setHealth(res);
    } catch {
      setHealth({ ok: false, initialized: false, version: '1.0.0' });
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  useEffect(() => {
    checkInstanceHealth();
  }, [checkInstanceHealth]);

  // Load profiles when authenticated
  const loadProfiles = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.listProfiles();
      const loaded = res.profiles || [];
      setProfiles(loaded);
      if (loaded.length > 0) {
        const stored = api.getActiveProfileId();
        const exists = loaded.some((p) => p.id === stored);
        const selectedId = exists ? stored! : loaded[0].id;
        api.setActiveProfileId(selectedId);
        setActiveProfileId(selectedId);
      }
    } catch {
      // If unauthorized, clear session
      setIsAuthenticated(false);
      api.logout();
    }
  }, [isAuthenticated]);

  const loadMalAccounts = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.listMalAccounts();
      setMalAccounts(res.accounts || []);
    } catch {
      // Ignore transient error; MalView surfaces explicit errors when active
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      loadProfiles();
      loadMalAccounts();
    }
  }, [isAuthenticated, loadProfiles, loadMalAccounts]);

  // Complete MyAnimeList OAuth 2.0 PKCE callback redirect (/mal-callback)
  useEffect(() => {
    if (!isAuthenticated || !pendingMalCallbackSearch || typeof window === 'undefined') return;

    const search = pendingMalCallbackSearch;
    if (
      window.location.pathname === '/mal-callback' ||
      window.location.pathname.startsWith('/mal-callback/')
    ) {
      window.history.replaceState({}, '', '/');
      setCurrentPath('/');
    }
    setActiveTab('mal');
    setMalStatusBanner({
      type: 'loading',
      text: 'COMPLETAMENTO COLLEGAMENTO MYANIMELIST IN CORSO...',
    });

    completeMalOAuthFromSearch(search).then((outcome) => {
      if (!isMountedRef.current) return;
      setPendingMalCallbackSearch(null);
      setMalStatusBanner({
        type: outcome.ok ? 'success' : 'error',
        text: outcome.message,
      });
      if (outcome.ok) {
        if (outcome.profileId) {
          handleSelectProfile(outcome.profileId);
        }
        setMalRefreshTick((n) => n + 1);
        loadMalAccounts();
      }
    });
  }, [isAuthenticated, pendingMalCallbackSearch, loadMalAccounts]);

  const handleSelectProfile = (id: string) => {
    api.setActiveProfileId(id);
    setActiveProfileId(id);
  };

  const handleCreateProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;
    setCreatingProfile(true);
    setCreateProfileError(null);
    try {
      const res = await api.createProfile(newProfileName.trim(), newProfileColor);
      await loadProfiles();
      setIsCreateProfileModalOpen(false);
      setNewProfileName('');
      if (res?.profile?.id) {
        handleSelectProfile(res.profile.id);
      }
    } catch (err: any) {
      setCreateProfileError(
        String(err?.message || 'IMPOSSIBILE CREARE IL PROFILO.').toUpperCase()
      );
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setIsAuthenticated(false);
    setProfiles([]);
    setActiveProfileId(null);
    setMalAccounts([]);
    setMalPreselectProfileId(null);
    setMalStatusBanner(null);
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    loadProfiles();
  };

  const handleSetupSuccess = () => {
    setIsAuthenticated(true);
    checkInstanceHealth();
    loadProfiles();
  };

  // Loading Screen
  if (loadingHealth) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '28px',
            height: '28px',
            border: '2px solid rgba(229, 9, 20, 0.3)',
            borderTopColor: '#E50914',
            borderRadius: '50%',
            animation: 'kuro-spin 0.6s linear infinite',
          }}
        />
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: '12px',
            letterSpacing: '0.1em',
            color: oledTheme.colors.textMuted,
          }}
        >
          CONNECTING TO KUROSYNC...
        </span>
        <style>{`
          @keyframes kuro-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // First Run: Setup Wizard
  if (health && !health.initialized) {
    return <SetupWizard onSetupSuccess={handleSetupSuccess} />;
  }

  // Not Authenticated: Master Login (or prompt login before /pair)
  if (!isAuthenticated) {
    return <MasterLogin onLoginSuccess={handleLoginSuccess} />;
  }

  // Route: /pair TV Approval View
  if (currentPath === '/pair' || currentPath.startsWith('/pair/')) {
    return (
      <TvPairView
        initialCode={pairCodeParam}
        profiles={profiles}
        onComplete={() => {
          loadProfiles();
        }}
        onNavigateHome={() => navigate('/')}
      />
    );
  }

  // Authenticated Dashboard
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#000000',
        color: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Navbar
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectProfile={handleSelectProfile}
        onOpenCreateProfile={() => {
          setNewProfileName('');
          setNewProfileColor('#E50914');
          setCreateProfileError(null);
          setIsCreateProfileModalOpen(true);
        }}
        onOpenTvPair={() => setIsTvPairModalOpen(true)}
        onOpenBackup={() => setIsBackupModalOpen(true)}
        onLogout={handleLogout}
        currentRoute={activeTab}
        onNavigate={(route) => {
          if (route === '/') setActiveTab('library');
          navigate('/');
        }}
      />

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          maxWidth: '1200px',
          width: '100%',
          margin: '0 auto',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: `1px solid ${oledTheme.colors.border}`,
            paddingBottom: '12px',
            overflowX: 'auto',
          }}
        >
          {(
            [
              {
                id: 'library',
                label: 'LIBRERIA',
                icon: <FilmIcon size={15} color="#E50914" aria-hidden="true" />,
              },
              {
                id: 'profiles',
                label: 'PROFILI',
                icon: <UserIcon size={15} color="#3B82F6" aria-hidden="true" />,
              },
              {
                id: 'devices',
                label: 'DISPOSITIVI',
                icon: <TvIcon size={15} color="#10B981" aria-hidden="true" />,
              },
              {
                id: 'mal',
                label: 'MYANIMELIST',
                icon: <MalIcon size={16} aria-hidden="true" />,
              },
              {
                id: 'backup',
                label: 'BACKUP',
                icon: <DownloadIcon size={15} color="#F59E0B" aria-hidden="true" />,
              },
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  fontFamily: FONT_MONO,
                  fontSize: '13px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderRadius: oledTheme.radius.sm,
                  border: `1px solid ${isActive ? oledTheme.colors.primary : 'transparent'}`,
                  backgroundColor: isActive ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
                  color: isActive ? '#FFFFFF' : oledTheme.colors.textSecondary,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Views */}
        {activeTab === 'library' && <LibraryView activeProfileId={activeProfileId} />}
        {activeTab === 'profiles' && (
          <ProfilesView
            profiles={profiles}
            activeProfileId={activeProfileId}
            malAccounts={malAccounts}
            onRefreshProfiles={async () => {
              await loadProfiles();
              await loadMalAccounts();
            }}
            onSelectProfile={handleSelectProfile}
            onManageMal={(profileId) => {
              setMalPreselectProfileId(profileId);
              setActiveTab('mal');
            }}
          />
        )}
        {activeTab === 'devices' && (
          <DevicesView
            activeProfileId={activeProfileId}
            onOpenTvPair={() => setIsTvPairModalOpen(true)}
          />
        )}
        {activeTab === 'mal' && (
          <MalView
            profiles={profiles}
            activeProfileId={activeProfileId}
            preselectedProfileId={malPreselectProfileId}
            onClearPreselectedProfile={() => setMalPreselectProfileId(null)}
            externalStatus={malStatusBanner}
            onClearExternalStatus={() => setMalStatusBanner(null)}
            refreshTrigger={malRefreshTick}
            onAccountsUpdated={setMalAccounts}
          />
        )}
        {activeTab === 'backup' && (
          <BackupView
            onRestoreSuccess={() => {
              loadProfiles();
              loadMalAccounts();
            }}
          />
        )}
      </main>

      {/* TV Pair Quick Modal */}
      <Modal
        isOpen={isTvPairModalOpen}
        onClose={() => setIsTvPairModalOpen(false)}
        title="AUTORIZZA ANDROID TV"
        maxWidth="460px"
      >
        <TvPairView
          isModal
          profiles={profiles}
          onComplete={() => {
            setIsTvPairModalOpen(false);
            loadProfiles();
          }}
          onNavigateHome={() => setIsTvPairModalOpen(false)}
        />
      </Modal>

      {/* Backup Quick Modal */}
      <Modal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        title="BACKUP & RESTORE"
        maxWidth="700px"
      >
        <BackupView onRestoreSuccess={loadProfiles} />
      </Modal>

      {/* Create Profile Quick Modal */}
      <Modal
        isOpen={isCreateProfileModalOpen}
        onClose={() => setIsCreateProfileModalOpen(false)}
        title="CREA NUOVO PROFILO"
        maxWidth="440px"
      >
        <form
          onSubmit={handleCreateProfileSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {createProfileError && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #EF4444',
                borderRadius: oledTheme.radius.sm,
                color: '#EF4444',
                fontSize: '12px',
                fontFamily: FONT_MONO,
              }}
            >
              {createProfileError}
            </div>
          )}

          <div>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                color: oledTheme.colors.textSecondary,
                marginBottom: '6px',
                textTransform: 'uppercase',
              }}
            >
              NOME PROFILO
            </label>
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="ES. CAMERA, OSPITI, SALOTTO..."
              required
              autoFocus
              maxLength={30}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#050505',
                border: `1px solid ${oledTheme.colors.border}`,
                borderRadius: oledTheme.radius.sm,
                color: '#FFFFFF',
                fontFamily: FONT_MONO,
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                color: oledTheme.colors.textSecondary,
                marginBottom: '8px',
                textTransform: 'uppercase',
              }}
            >
              COLORE AVATAR
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewProfileColor(c)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: c,
                    border:
                      newProfileColor === c ? '2px solid #FFFFFF' : '2px solid transparent',
                    boxShadow:
                      newProfileColor === c ? '0 0 8px rgba(255,255,255,0.4)' : 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.1s ease',
                  }}
                />
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '12px',
            }}
          >
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsCreateProfileModalOpen(false)}
            >
              ANNULLA
            </Button>
            <Button type="submit" variant="primary" loading={creatingProfile}>
              CREA PROFILO
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
