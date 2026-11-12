import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Badge } from './Badge';
import { Button } from './Button';
import { TvIcon, LogOutIcon, DownloadIcon, UserIcon } from './Icons';
import type { ProfileRecord } from '../api';

interface NavbarProps {
  profiles: ProfileRecord[];
  activeProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
  onOpenTvPair: () => void;
  onOpenBackup: () => void;
  onLogout: () => void;
  currentRoute: string;
  onNavigate: (route: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  profiles,
  activeProfileId,
  onSelectProfile,
  onOpenTvPair,
  onOpenBackup,
  onLogout,
  currentRoute,
  onNavigate,
}) => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: '#000000',
        borderBottom: `1px solid ${oledTheme.colors.border}`,
        padding: '12px 20px',
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Brand & Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            onClick={() => onNavigate('/')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                backgroundColor: oledTheme.colors.primary,
                borderRadius: '2px',
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontWeight: 900,
                fontSize: '18px',
                letterSpacing: '0.1em',
                color: '#FFFFFF',
              }}
            >
              KUROSYNC
            </span>
          </div>

          <Badge variant={isOnline ? 'success' : 'danger'}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </Badge>
        </div>

        {/* Profile & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Profile Switcher */}
          {profiles.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: oledTheme.colors.card,
                border: `1px solid ${oledTheme.colors.border}`,
                borderRadius: oledTheme.radius.sm,
                padding: '4px 10px',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: activeProfile?.avatarColor || '#E50914',
                }}
              />
              <select
                value={activeProfile?.id || ''}
                onChange={(e) => onSelectProfile(e.target.value)}
                aria-label="Select active profile"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#FFFFFF',
                  fontFamily: FONT_MONO,
                  fontSize: '12px',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {profiles.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    style={{ backgroundColor: '#121212', color: '#FFFFFF' }}
                  >
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Quick TV Pair Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenTvPair}
            icon={<TvIcon size={14} color="#E50914" />}
            title="Pair Android TV"
          >
            PAIR TV
          </Button>

          {/* Backup Shortcut */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenBackup}
            icon={<DownloadIcon size={14} />}
            title="Backup & Restore"
          >
            BACKUP
          </Button>

          {/* Logout */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            icon={<LogOutIcon size={14} />}
            title="Logout"
            aria-label="Logout"
          />
        </div>
      </div>
    </header>
  );
};
