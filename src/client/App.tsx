import React, { useState, useEffect, useCallback } from 'react';
import { oledTheme, FONT_MONO } from './theme';
import { Navbar } from './components/Navbar';
import { SetupWizard } from './views/SetupWizard';
import { MasterLogin } from './views/MasterLogin';
import { TvPairView } from './views/TvPairView';
import { LibraryView } from './views/Dashboard/LibraryView';
import { ProfilesView } from './views/Dashboard/ProfilesView';
import { DevicesView } from './views/Dashboard/DevicesView';
import { BackupView } from './views/Dashboard/BackupView';
import { Modal } from './components/Modal';
import {
  api,
  type HealthResponse,
  type ProfileRecord,
} from './api';

export type DashboardTab = 'library' | 'profiles' | 'devices' | 'backup';

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

  // Parse path and query params on mount & on popstate
  const updateRouteFromLocation = useCallback(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code') || '';
    setCurrentPath(path);
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

  useEffect(() => {
    if (isAuthenticated) {
      loadProfiles();
    }
  }, [isAuthenticated, loadProfiles]);

  const handleSelectProfile = (id: string) => {
    api.setActiveProfileId(id);
    setActiveProfileId(id);
  };

  const handleLogout = () => {
    api.logout();
    setIsAuthenticated(false);
    setProfiles([]);
    setActiveProfileId(null);
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
          <button
            onClick={() => setActiveTab('library')}
            style={{
              padding: '8px 16px',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${
                activeTab === 'library' ? oledTheme.colors.primary : 'transparent'
              }`,
              backgroundColor:
                activeTab === 'library' ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
              color: activeTab === 'library' ? '#FFFFFF' : oledTheme.colors.textSecondary,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            LIBRERIA
          </button>
          <button
            onClick={() => setActiveTab('profiles')}
            style={{
              padding: '8px 16px',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${
                activeTab === 'profiles' ? oledTheme.colors.primary : 'transparent'
              }`,
              backgroundColor:
                activeTab === 'profiles' ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
              color: activeTab === 'profiles' ? '#FFFFFF' : oledTheme.colors.textSecondary,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            PROFILI
          </button>
          <button
            onClick={() => setActiveTab('devices')}
            style={{
              padding: '8px 16px',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${
                activeTab === 'devices' ? oledTheme.colors.primary : 'transparent'
              }`,
              backgroundColor:
                activeTab === 'devices' ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
              color: activeTab === 'devices' ? '#FFFFFF' : oledTheme.colors.textSecondary,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            DISPOSITIVI
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            style={{
              padding: '8px 16px',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${
                activeTab === 'backup' ? oledTheme.colors.primary : 'transparent'
              }`,
              backgroundColor:
                activeTab === 'backup' ? 'rgba(229, 9, 20, 0.15)' : 'transparent',
              color: activeTab === 'backup' ? '#FFFFFF' : oledTheme.colors.textSecondary,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            BACKUP
          </button>
        </div>

        {/* Tab Views */}
        {activeTab === 'library' && <LibraryView activeProfileId={activeProfileId} />}
        {activeTab === 'profiles' && (
          <ProfilesView
            profiles={profiles}
            activeProfileId={activeProfileId}
            onRefreshProfiles={loadProfiles}
            onSelectProfile={handleSelectProfile}
          />
        )}
        {activeTab === 'devices' && (
          <DevicesView
            activeProfileId={activeProfileId}
            onOpenTvPair={() => setIsTvPairModalOpen(true)}
          />
        )}
        {activeTab === 'backup' && <BackupView onRestoreSuccess={loadProfiles} />}
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
        title="BACKUP &amp; RESTORE"
        maxWidth="700px"
      >
        <BackupView onRestoreSuccess={loadProfiles} />
      </Modal>
    </div>
  );
};
