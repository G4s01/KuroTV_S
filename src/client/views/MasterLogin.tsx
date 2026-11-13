import React, { useState } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { KeyIcon, ShieldIcon } from '../components/Icons';
import { api } from '../api';

interface MasterLoginProps {
  onLoginSuccess: () => void;
}

export const MasterLogin: React.FC<MasterLoginProps> = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setError(null);
    setLoading(true);
    try {
      await api.login(password);
      onLoginSuccess();
    } catch (err: any) {
      if (err?.status === 429) {
        setError('TROPPI TENTATIVI. ATTENDI 1 MINUTO.');
      } else if (err?.status === 401) {
        setError('PASSWORD MASTER NON VALIDA.');
      } else {
        setError(err?.message ? err.message.toUpperCase() : 'ACCESSO FALLITO. RIPROVA.');
      }
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
      <div style={{ width: '100%', maxWidth: '420px' }}>
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
              fontSize: '22px',
              fontWeight: 900,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              margin: '0 0 8px 0',
            }}
          >
            KUROSYNC CONSOLE
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
            ACCESSO AMMINISTRATORE ISTANZA
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
                MASTER PASSWORD
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="INSERISCI PASSWORD..."
                required
                autoFocus
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

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              icon={<KeyIcon size={16} />}
              style={{ width: '100%' }}
            >
              ACCEDI
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
