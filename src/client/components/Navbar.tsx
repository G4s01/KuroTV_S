import React, { useState, useEffect, useRef } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Badge } from './Badge';
import { Button } from './Button';
import {
  TvIcon,
  LogOutIcon,
  DownloadIcon,
  UserIcon,
  PlusIcon,
  CheckIcon,
  ChevronDownIcon,
} from './Icons';
import type { ProfileRecord } from '../api';

interface NavbarProps {
  profiles: ProfileRecord[];
  activeProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
  onOpenCreateProfile?: () => void;
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
  onOpenCreateProfile,
  onOpenTvPair,
  onOpenBackup,
  onLogout,
  currentRoute,
  onNavigate,
}) => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!isDropdownOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

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
          {/* Profile Switcher & Add Profile Dropdown */}
          {profiles.length > 0 && (
            <div ref={dropdownRef} style={{ position: 'relative' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: oledTheme.colors.card,
                  border: `1px solid ${isDropdownOpen ? oledTheme.colors.primary : oledTheme.colors.border}`,
                  borderRadius: oledTheme.radius.sm,
                  transition: 'border-color 0.15s ease',
                }}
              >
                {/* Dropdown toggle button */}
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen((prev) => !prev)}
                  aria-label="Menù profili"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'transparent',
                    border: 'none',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: '12px',
                    fontWeight: 600,
                    outline: 'none',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: activeProfile?.avatarColor || activeProfile?.avatar_color || '#E50914',
                    }}
                  />
                  <span>{activeProfile?.name || 'Seleziona profilo'}</span>
                  <span
                    style={{
                      display: 'inline-flex',
                      transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                      color: oledTheme.colors.textMuted,
                    }}
                  >
                    <ChevronDownIcon size={14} />
                  </span>
                </button>

                {/* Quick Add Profile icon button right in the header bar */}
                {onOpenCreateProfile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDropdownOpen(false);
                      onOpenCreateProfile();
                    }}
                    title="Aggiungi nuovo profilo"
                    aria-label="Aggiungi nuovo profilo"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '26px',
                      height: '24px',
                      background: 'transparent',
                      border: 'none',
                      borderLeft: `1px solid ${oledTheme.colors.border}`,
                      color: oledTheme.colors.textSecondary,
                      cursor: 'pointer',
                      padding: 0,
                      marginRight: '2px',
                      transition: 'color 0.15s ease, background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#FFFFFF';
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = oledTheme.colors.textSecondary;
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <PlusIcon size={13} />
                  </button>
                )}
              </div>

              {/* Dropdown Menu Popover */}
              {isDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    minWidth: '220px',
                    backgroundColor: '#0F0F0F',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.85)',
                    zIndex: 110,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 12px',
                      borderBottom: `1px solid ${oledTheme.colors.border}`,
                      fontFamily: FONT_MONO,
                      fontSize: '10px',
                      color: oledTheme.colors.textMuted,
                      letterSpacing: '0.08em',
                      fontWeight: 700,
                    }}
                  >
                    PROFILI
                  </div>

                  {/* Profile list items */}
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {profiles.map((p) => {
                      const isActive = p.id === activeProfileId;
                      const color = p.avatarColor || p.avatar_color || '#E50914';
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            onSelectProfile(p.id);
                            setIsDropdownOpen(false);
                          }}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '9px 12px',
                            border: 'none',
                            backgroundColor: isActive ? 'rgba(229, 9, 20, 0.12)' : 'transparent',
                            color: isActive ? '#FFFFFF' : oledTheme.colors.textSecondary,
                            fontFamily: FONT_MONO,
                            fontSize: '12px',
                            fontWeight: isActive ? 700 : 500,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'background-color 0.12s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = isActive
                              ? 'rgba(229, 9, 20, 0.22)'
                              : '#1A1A1A';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = isActive
                              ? 'rgba(229, 9, 20, 0.12)'
                              : 'transparent';
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: color,
                              }}
                            />
                            <span>{p.name}</span>
                          </div>
                          {isActive && <CheckIcon size={14} color="#10B981" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Add profile button inside the dropdown */}
                  {onOpenCreateProfile && (
                    <div
                      style={{
                        padding: '8px',
                        borderTop: `1px solid ${oledTheme.colors.border}`,
                        backgroundColor: '#0A0A0A',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setIsDropdownOpen(false);
                          onOpenCreateProfile();
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '7px 10px',
                          borderRadius: oledTheme.radius.sm,
                          border: '1px solid rgba(229, 9, 20, 0.5)',
                          backgroundColor: 'rgba(229, 9, 20, 0.12)',
                          color: '#FFFFFF',
                          fontFamily: FONT_MONO,
                          fontSize: '11px',
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#E50914';
                          e.currentTarget.style.borderColor = '#E50914';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(229, 9, 20, 0.12)';
                          e.currentTarget.style.borderColor = 'rgba(229, 9, 20, 0.5)';
                        }}
                      >
                        <PlusIcon size={13} />
                        <span>AGGIUNGI PROFILO</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick TV Pair Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenTvPair}
            icon={<TvIcon size={14} color="#E50914" />}
            title="ACCOPPIA ANDROID TV"
          >
            ACCOPPIA TV
          </Button>

          {/* Backup Shortcut */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenBackup}
            icon={<DownloadIcon size={14} />}
            title="BACKUP & RIPRISTINO"
          >
            BACKUP
          </Button>

          {/* Logout */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            icon={<LogOutIcon size={14} />}
            title="DISCONNETTI"
            aria-label="DISCONNETTI"
          />
        </div>
      </div>
    </header>
  );
};
