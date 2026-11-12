import React, { useState } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { KeyIcon, ShieldIcon, CheckIcon } from '../components/Icons';
import { api } from '../api';

const AVATAR_COLORS = [
  '#E50914', // Kuro Red
  '#3B82F6', // Blue
  '#10B981', // Emerald Green
  '#F59E0B', // Amber
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#64748B', // Slate
];

interface SetupWizardProps {
  onSetupSuccess: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onSetupSuccess }) => {
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileName, setProfileName] = useState('Principale');
  const [avatarColor, setAvatarColor] = useState('#E50914');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSecurePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
    const array = new Uint32Array(16);
    crypto.getRandomValues(array);
    let pwd = '';
    for (let i = 0; i < array.length; i++) {
      pwd += chars[array[i] % chars.length];
    }
    setMasterPassword(pwd);
    setConfirmPassword(pwd);
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (masterPassword.length < 8) {
      setError('Master Password must be at least 8 characters long');
      return;
    }
    if (masterPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!profileName.trim()) {
      setError('Profile name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      await api.setup(masterPassword, profileName.trim(), avatarColor);
      onSetupSuccess();
    } catch (err: any) {
      setError(err?.message || 'Setup initialization failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000000',
        padding: '20px',
      }}
    >
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(229, 9, 20, 0.15)',
              border: '1px solid #E50914',
              marginBottom: '16px',
            }}
          >
            <ShieldIcon size={24} color="#E50914" />
          </div>
          <h1
            style={{
              fontFamily: FONT_MONO,
              fontSize: '24px',
              fontWeight: 900,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              margin: '0 0 8px 0',
            }}
          >
            KUROSYNC SETUP
          </h1>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '13px',
              color: oledTheme.colors.textSecondary,
              margin: 0,
            }}
          >
            Zero-Config initialization for your private Cloudflare Worker instance.
          </p>
        </div>

        <Card style={{ backgroundColor: '#0A0A0A', border: `1px solid ${oledTheme.colors.border}` }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {error && (
              <div
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #EF4444',
                  borderRadius: oledTheme.radius.sm,
                  color: '#EF4444',
                  fontSize: '13px',
                  fontFamily: FONT_MONO,
                }}
              >
                {error}
              </div>
            )}

            {/* Master Password Field */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <label
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: oledTheme.colors.textSecondary,
                  }}
                >
                  Master Password
                </label>
                <button
                  type="button"
                  onClick={generateSecurePassword}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#E50914',
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  GENERATE SECURE
                </button>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  backgroundColor: '#050505',
                  border: `1px solid ${oledTheme.colors.border}`,
                  borderRadius: oledTheme.radius.sm,
                  color: '#FFFFFF',
                  fontFamily: FONT_MONO,
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Confirm Password Field */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: FONT_MONO,
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: oledTheme.colors.textSecondary,
                  marginBottom: '8px',
                }}
              >
                Confirm Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat master password"
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  backgroundColor: '#050505',
                  border: `1px solid ${oledTheme.colors.border}`,
                  borderRadius: oledTheme.radius.sm,
                  color: '#FFFFFF',
                  fontFamily: FONT_MONO,
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
              <div style={{ marginTop: '6px' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontFamily: FONT_MONO,
                    color: oledTheme.colors.textMuted,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                  />
                  Show password
                </label>
              </div>
            </div>

            {/* Initial Profile Name */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: FONT_MONO,
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: oledTheme.colors.textSecondary,
                  marginBottom: '8px',
                }}
              >
                Initial Profile Name
              </label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="e.g. Principale"
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  backgroundColor: '#050505',
                  border: `1px solid ${oledTheme.colors.border}`,
                  borderRadius: oledTheme.radius.sm,
                  color: '#FFFFFF',
                  fontFamily: FONT_MONO,
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Avatar Color Picker */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: FONT_MONO,
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: oledTheme.colors.textSecondary,
                  marginBottom: '8px',
                }}
              >
                Avatar Color
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    aria-label={`Select color ${color}`}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: color,
                      border: avatarColor === color ? '2px solid #FFFFFF' : '2px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      outline: 'none',
                    }}
                  >
                    {avatarColor === color && <CheckIcon size={16} color="#FFFFFF" />}
                  </button>
                ))}
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              style={{ width: '100%', marginTop: '8px' }}
            >
              INITIALIZE INSTANCE
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
