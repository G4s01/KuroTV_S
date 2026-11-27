import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { RecoveryKeyBox } from '../components/RecoveryKeyBox';
import { AlertCircleIcon, HelpCircleIcon, KeyIcon, ShieldIcon } from '../components/Icons';
import { api, type RecoveryStatusResponse } from '../api';

interface MasterLoginProps {
  onLoginSuccess: () => void;
}

export const MasterLogin: React.FC<MasterLoginProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'recovery'>('login');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery flow state
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatusResponse | null>(null);
  const [loadingRecoveryStatus, setLoadingRecoveryStatus] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [rotatedRecoveryKey, setRotatedRecoveryKey] = useState<string | null>(null);
  const [showCliHelp, setShowCliHelp] = useState(false);

  useEffect(() => {
    if (mode !== 'recovery') return;
    let active = true;
    setLoadingRecoveryStatus(true);
    api
      .getRecoveryStatus()
      .then((res) => {
        if (active) setRecoveryStatus(res);
      })
      .catch(() => {
        if (active) setRecoveryStatus(null);
      })
      .finally(() => {
        if (active) setLoadingRecoveryStatus(false);
      });
    return () => {
      active = false;
    };
  }, [mode]);

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

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (!recoveryKey.trim()) {
      setResetError('INSERISCI LA RECOVERY KEY.');
      return;
    }
    if (newPassword.length < 8) {
      setResetError('LA NUOVA PASSWORD DEVE CONTENERE ALMENO 8 CARATTERI.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setResetError('LE PASSWORD NON COINCIDONO.');
      return;
    }

    setResetting(true);
    try {
      const res = await api.resetPasswordWithRecoveryKey(recoveryKey.trim(), newPassword);
      setRotatedRecoveryKey(res.recoveryKey);
      setRecoveryKey('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      if (err?.status === 429) {
        setResetError('TROPPI TENTATIVI. ATTENDI 1 MINUTO.');
      } else if (err?.status === 401) {
        setResetError('RECOVERY KEY NON VALIDA O NON CONFIGURATA.');
      } else {
        setResetError(
          err?.message ? String(err.message).toUpperCase() : 'IMPOSSIBILE RESETTARE LA PASSWORD.'
        );
      }
    } finally {
      setResetting(false);
    }
  };

  const openRecoveryMode = () => {
    setError(null);
    setResetError(null);
    setRotatedRecoveryKey(null);
    setShowCliHelp(false);
    setMode('recovery');
  };

  const backToLogin = () => {
    setResetError(null);
    setRotatedRecoveryKey(null);
    setMode('login');
  };

  const inputStyle: React.CSSProperties = {
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
      <div style={{ width: '100%', maxWidth: '440px' }}>
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
            <ShieldIcon size={24} color="#E50914" aria-hidden="true" />
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
            {mode === 'login' ? 'ACCESSO AMMINISTRATORE ISTANZA' : 'RIPRISTINO MASTER PASSWORD'}
          </p>
        </div>

        <Card style={{ backgroundColor: '#0A0A0A', border: `1px solid ${oledTheme.colors.border}` }}>
          {mode === 'login' ? (
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
                  htmlFor="master-login-password"
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
                  id="master-login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="INSERISCI PASSWORD..."
                  required
                  autoFocus
                  style={inputStyle}
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading}
                icon={<KeyIcon size={16} aria-hidden="true" />}
                style={{ width: '100%' }}
              >
                ACCEDI
              </Button>

              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={openRecoveryMode}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: oledTheme.colors.textMuted,
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '4px 6px',
                  }}
                >
                  PASSWORD DIMENTICATA?
                </button>
              </div>
            </form>
          ) : rotatedRecoveryKey ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <RecoveryKeyBox
                recoveryKey={rotatedRecoveryKey}
                title="PASSWORD RESETTATA & NUOVA RECOVERY KEY"
                subtitle="LA MASTER PASSWORD È STATA AGGIORNATA (DISPOSITIVI MOBILE E TV RESTANO CONNESSI). SALVA QUESTA NUOVA RECOVERY KEY PER FUTURI RIPRISTINI."
              />

              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={backToLogin}
                style={{ width: '100%' }}
              >
                TORNA AL LOGIN
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {loadingRecoveryStatus ? (
                <div
                  style={{
                    textAlign: 'center',
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    color: oledTheme.colors.textMuted,
                    padding: '12px 0',
                  }}
                >
                  VERIFICA METODI DI RIPRISTINO...
                </div>
              ) : recoveryStatus?.adminSecretActive ? (
                <div
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid #F59E0B',
                    borderRadius: oledTheme.radius.sm,
                    color: '#F59E0B',
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    lineHeight: 1.5,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                    <AlertCircleIcon size={15} color="#F59E0B" aria-hidden="true" />
                    <span>SYNC_ADMIN_SECRET ATTIVO</span>
                  </div>
                  <span>
                    QUESTA ISTANZA USA SYNC_ADMIN_SECRET DA VARIABILE D&apos;AMBIENTE (DOCKER ENV O CLOUDFLARE SECRET). AGGIORNA IL VALORE NELLA CONFIGURAZIONE DEL SERVER PER CAMBIARE PASSWORD.
                  </span>
                </div>
              ) : (
                <>
                  {recoveryStatus && !recoveryStatus.recoveryConfigured && (
                    <div
                      style={{
                        padding: '10px 12px',
                        backgroundColor: 'rgba(245, 158, 11, 0.12)',
                        border: '1px solid #F59E0B',
                        borderRadius: oledTheme.radius.sm,
                        color: '#F59E0B',
                        fontFamily: FONT_MONO,
                        fontSize: '11px',
                        lineHeight: 1.45,
                      }}
                    >
                      NESSUNA RECOVERY KEY CONFIGURATA SU QUESTA ISTANZA. USA I COMANDI DI EMERGENZA DOCKER / CLOUDFLARE QUI SOTTO.
                    </div>
                  )}

                  {(!recoveryStatus || recoveryStatus.recoveryConfigured) && (
                    <form onSubmit={handleResetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {resetError && (
                        <div
                          style={{
                            padding: '10px 12px',
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid #EF4444',
                            borderRadius: oledTheme.radius.sm,
                            color: '#EF4444',
                            fontSize: '11px',
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {resetError}
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="recovery-key-input"
                          style={{
                            display: 'block',
                            fontFamily: FONT_MONO,
                            fontSize: '11px',
                            fontWeight: 700,
                            color: oledTheme.colors.textSecondary,
                            marginBottom: '6px',
                          }}
                        >
                          RECOVERY KEY
                        </label>
                        <input
                          id="recovery-key-input"
                          type="text"
                          value={recoveryKey}
                          onChange={(e) => setRecoveryKey(e.target.value)}
                          placeholder="KURO-XXXX-XXXX-XXXX-XXXX-XXXX"
                          className="raw-token"
                          required
                          autoFocus
                          style={inputStyle}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="recovery-new-pwd"
                          style={{
                            display: 'block',
                            fontFamily: FONT_MONO,
                            fontSize: '11px',
                            fontWeight: 700,
                            color: oledTheme.colors.textSecondary,
                            marginBottom: '6px',
                          }}
                        >
                          NUOVA MASTER PASSWORD
                        </label>
                        <input
                          id="recovery-new-pwd"
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="MIN. 8 CARATTERI..."
                          required
                          style={inputStyle}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="recovery-confirm-pwd"
                          style={{
                            display: 'block',
                            fontFamily: FONT_MONO,
                            fontSize: '11px',
                            fontWeight: 700,
                            color: oledTheme.colors.textSecondary,
                            marginBottom: '6px',
                          }}
                        >
                          CONFERMA NUOVA PASSWORD
                        </label>
                        <input
                          id="recovery-confirm-pwd"
                          type={showNewPassword ? 'text' : 'password'}
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          placeholder="RIPETI NUOVA PASSWORD..."
                          required
                          style={inputStyle}
                        />
                      </div>

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
                          checked={showNewPassword}
                          onChange={(e) => setShowNewPassword(e.target.checked)}
                        />
                        MOSTRA PASSWORD
                      </label>

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        loading={resetting}
                        icon={<KeyIcon size={15} aria-hidden="true" />}
                        style={{ width: '100%' }}
                      >
                        RESETTA MASTER PASSWORD
                      </Button>
                    </form>
                  )}

                  <div style={{ borderTop: `1px solid ${oledTheme.colors.border}`, paddingTop: '12px' }}>
                    <button
                      type="button"
                      onClick={() => setShowCliHelp((v) => !v)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'none',
                        border: 'none',
                        color: oledTheme.colors.textSecondary,
                        fontFamily: FONT_MONO,
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <HelpCircleIcon size={14} color="#F59E0B" aria-hidden="true" />
                      <span>
                        {showCliHelp
                          ? 'NASCONDI RESET DOCKER / CLOUDFLARE'
                          : 'NON HAI LA RECOVERY KEY? (RESET DOCKER / CLOUDFLARE)'}
                      </span>
                    </button>

                    {showCliHelp && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '10px 12px',
                          backgroundColor: '#050505',
                          border: `1px solid ${oledTheme.colors.border}`,
                          borderRadius: oledTheme.radius.sm,
                          fontFamily: FONT_MONO,
                          fontSize: '10px',
                          color: oledTheme.colors.textSecondary,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          lineHeight: 1.5,
                        }}
                      >
                        <div>
                          <strong style={{ color: '#FFFFFF' }}>DOCKER (CLI O ENV):</strong>
                          <code
                            className="raw-token"
                            style={{ display: 'block', color: '#10B981', marginTop: '3px', wordBreak: 'break-all' }}
                          >
                            docker exec kurotv-s kurosync-reset --reopen-setup
                          </code>
                          <span style={{ display: 'block', marginTop: '3px' }}>
                            OPPURE IMPOSTA LA VARIABILE <code className="raw-token">KUROSYNC_RESET_PASSWORD</code> IN COMPOSE.
                          </span>
                        </div>

                        <div>
                          <strong style={{ color: '#FFFFFF' }}>CLOUDFLARE D1 (RIAPRI SETUP WIZARD):</strong>
                          <code
                            className="raw-token"
                            style={{ display: 'block', color: '#3B82F6', marginTop: '3px', wordBreak: 'break-all' }}
                          >
                            npx wrangler d1 execute kurosync-db --remote --command &quot;UPDATE instance_config SET setup_completed = 0 WHERE id = 1&quot;
                          </code>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={backToLogin}
                style={{ width: '100%' }}
              >
                TORNA AL LOGIN
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
