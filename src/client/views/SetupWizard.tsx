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
      setError('LA PASSWORD MASTER DEVE CONTENERE ALMENO 8 CARATTERI');
      return;
    }
    if (masterPassword !== confirmPassword) {
      setError('LE PASSWORD NON COINCIDONO');
      return;
    }
    if (!profileName.trim()) {
      setError('IL NOME PROFILO NON PUÒ ESSERE VUOTO');
      return;
    }

    setLoading(true);
    try {
      await api.setup(masterPassword, profileName.trim(), avatarColor);
      onSetupSuccess();
    } catch (err: any) {
      setError(err?.message ? err.message.toUpperCase() : 'INIZIALIZZAZIONE FALLITA. RIPROVA.');
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
              fontSize: '11px',
              color: oledTheme.colors.textMuted,
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            CONFIGURAZIONE PRIMO AVVIO ISTANZA
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
                  fontSize: '12px',
                  fontFamily: FONT_MONO,
                  textTransform: 'uppercase',
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
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: oledTheme.colors.textSecondary,
                  }}
                >
                  MASTER PASSWORD
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
                  GENERA SICURA
                </button>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                placeholder="MIN. 8 CARATTERI"
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
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Confirm Password Field */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: oledTheme.colors.textSecondary,
                  marginBottom: '8px',
                }}
              >
                CONFERMA PASSWORD
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="RIPETI MASTER PASSWORD"
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
                  boxSizing: 'border-box',
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
                    textTransform: 'uppercase',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                  />
                  MOSTRA PASSWORD
                </label>
              </div>
            </div>

            {/* Initial Profile Name */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: oledTheme.colors.textSecondary,
                  marginBottom: '8px',
                }}
              >
                NOME PRIMO PROFILO
              </label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="ES. PRINCIPALE"
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
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Avatar Color Picker */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: oledTheme.colors.textSecondary,
                  marginBottom: '8px',
                }}
              >
                COLORE AVATAR
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
              INIZIALIZZA ISTANZA
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
