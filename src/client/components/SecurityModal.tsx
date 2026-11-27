import React, { useState, useEffect, useCallback } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Modal } from './Modal';
import { Button } from './Button';
import { Badge } from './Badge';
import { RecoveryKeyBox } from './RecoveryKeyBox';
import { AlertCircleIcon, CheckIcon, KeyIcon, RefreshIcon, ShieldIcon } from './Icons';
import { api, type SecurityStatusResponse } from '../api';

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<SecurityStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Change password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  // Recovery key regeneration form
  const [regenPassword, setRegenPassword] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);

  const loadSecurityStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await api.getSecurityStatus();
      setStatus(res);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSecurityStatus();
      setPwdError(null);
      setPwdSuccess(null);
      setRegenError(null);
    } else {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswords(false);
      setRegenPassword('');
      setNewRecoveryKey(null);
      setPwdError(null);
      setPwdSuccess(null);
      setRegenError(null);
    }
  }, [isOpen, loadSecurityStatus]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (!currentPassword) {
      setPwdError('INSERISCI LA MASTER PASSWORD ATTUALE.');
      return;
    }
    if (newPassword.length < 8) {
      setPwdError('LA NUOVA PASSWORD DEVE CONTENERE ALMENO 8 CARATTERI.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('LE NUOVE PASSWORD NON COINCIDONO.');
      return;
    }

    setChangingPwd(true);
    try {
      const res = await api.changeMasterPassword(currentPassword, newPassword);
      const revokedCount = res.revokedWebSessions || 0;
      setPwdSuccess(
        revokedCount > 0
          ? `MASTER PASSWORD AGGIORNATA. DISCONNESSE ${revokedCount} ALTRE SESSIONI WEB (SMARTPHONE E TV RESTANO ATTIVI).`
          : 'MASTER PASSWORD AGGIORNATA CON SUCCESSO (SMARTPHONE E TV RESTANO ATTIVI).'
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      loadSecurityStatus();
    } catch (err: any) {
      if (err?.status === 401) {
        setPwdError('PASSWORD ATTUALE NON VALIDA.');
      } else if (err?.status === 429) {
        setPwdError('TROPPI TENTATIVI. ATTENDI 1 MINUTO.');
      } else {
        setPwdError(
          err?.message
            ? String(err.message).toUpperCase()
            : 'IMPOSSIBILE AGGIORNARE LA MASTER PASSWORD.'
        );
      }
    } finally {
      setChangingPwd(false);
    }
  };

  const handleRegenerateRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenError(null);
    setNewRecoveryKey(null);

    if (!regenPassword) {
      setRegenError('INSERISCI LA MASTER PASSWORD PER RIGENERARE LA RECOVERY KEY.');
      return;
    }

    setRegenerating(true);
    try {
      const res = await api.regenerateRecoveryKey(regenPassword);
      setNewRecoveryKey(res.recoveryKey);
      setRegenPassword('');
      loadSecurityStatus();
    } catch (err: any) {
      if (err?.status === 401) {
        setRegenError('MASTER PASSWORD NON VALIDA.');
      } else if (err?.status === 429) {
        setRegenError('TROPPI TENTATIVI. ATTENDI 1 MINUTO.');
      } else {
        setRegenError(
          err?.message
            ? String(err.message).toUpperCase()
            : 'IMPOSSIBILE RIGENERARE LA RECOVERY KEY.'
        );
      }
    } finally {
      setRegenerating(false);
    }
  };

  const inputStyle: React.CSSProperties = {
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
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: FONT_MONO,
    fontSize: '10px',
    fontWeight: 700,
    color: oledTheme.colors.textSecondary,
    marginBottom: '6px',
    letterSpacing: '0.05em',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="SICUREZZA & MASTER PASSWORD"
      maxWidth="540px"
    >
      {loadingStatus && !status ? (
        <div
          style={{
            padding: '28px 12px',
            textAlign: 'center',
            fontFamily: FONT_MONO,
            fontSize: '12px',
            color: oledTheme.colors.textMuted,
          }}
        >
          CARICAMENTO STATO SICUREZZA...
        </div>
      ) : status?.adminSecretActive ? (
        <div
          style={{
            padding: '16px',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid #F59E0B',
            borderRadius: oledTheme.radius.sm,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            fontFamily: FONT_MONO,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#F59E0B', fontWeight: 700, fontSize: '12px' }}>
            <AlertCircleIcon size={16} color="#F59E0B" aria-hidden="true" />
            <span>MODALITÀ SYNC_ADMIN_SECRET ATTIVA</span>
          </div>
          <p style={{ margin: 0, fontSize: '11px', color: oledTheme.colors.textSecondary, lineHeight: 1.5 }}>
            LA MASTER PASSWORD È GESTITA DALLA VARIABILE D&apos;AMBIENTE SYNC_ADMIN_SECRET (SU DOCKER O CLOUDFLARE SECRETS). IL CAMBIO PASSWORD E LA RECOVERY KEY VIA CONSOLE WEB SONO DISABILITATI.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Section 1: Change Master Password */}
          <form
            onSubmit={handleChangePassword}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '14px',
              backgroundColor: '#0A0A0A',
              border: `1px solid ${oledTheme.colors.border}`,
              borderRadius: oledTheme.radius.sm,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <ShieldIcon size={15} color="#E50914" aria-hidden="true" />
                CAMBIA MASTER PASSWORD
              </span>
            </div>

            {pwdError && (
              <div
                style={{
                  padding: '9px 12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #EF4444',
                  borderRadius: oledTheme.radius.sm,
                  color: '#EF4444',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                }}
              >
                {pwdError}
              </div>
            )}

            {pwdSuccess && (
              <div
                style={{
                  padding: '9px 12px',
                  backgroundColor: 'rgba(16, 185, 129, 0.14)',
                  border: '1px solid #10B981',
                  borderRadius: oledTheme.radius.sm,
                  color: '#10B981',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <CheckIcon size={14} color="#10B981" aria-hidden="true" />
                <span>{pwdSuccess}</span>
              </div>
            )}

            <div>
              <label htmlFor="sec-current-pwd" style={labelStyle}>
                PASSWORD ATTUALE
              </label>
              <input
                id="sec-current-pwd"
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="PASSWORD MASTER ATTUALE..."
                required
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="sec-new-pwd" style={labelStyle}>
                NUOVA PASSWORD (MIN. 8 CARATTERI)
              </label>
              <input
                id="sec-new-pwd"
                type={showPasswords ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="MIN. 8 CARATTERI..."
                required
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="sec-confirm-pwd" style={labelStyle}>
                CONFERMA NUOVA PASSWORD
              </label>
              <input
                id="sec-confirm-pwd"
                type={showPasswords ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="RIPETI NUOVA PASSWORD..."
                required
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
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
                  checked={showPasswords}
                  onChange={(e) => setShowPasswords(e.target.checked)}
                />
                MOSTRA PASSWORD
              </label>

              <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: oledTheme.colors.textMuted }}>
                DISCONNETTE LE ALTRE SESSIONI WEB; MOBILE/TV RESTANO ATTIVI
              </span>
            </div>

            <Button type="submit" variant="primary" size="sm" loading={changingPwd}>
              AGGIORNA MASTER PASSWORD
            </Button>
          </form>

          {/* Section 2: Emergency Recovery Key */}
          <form
            onSubmit={handleRegenerateRecoveryKey}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '14px',
              backgroundColor: '#0A0A0A',
              border: `1px solid ${oledTheme.colors.border}`,
              borderRadius: oledTheme.radius.sm,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <KeyIcon size={15} color="#F59E0B" aria-hidden="true" />
                RECOVERY KEY DI EMERGENZA
              </span>

              <Badge variant={status?.recoveryConfigured ? 'success' : 'warning'}>
                {status?.recoveryConfigured ? 'ATTIVA' : 'NON CONFIGURATA'}
              </Badge>
            </div>

            <p style={{ margin: 0, fontFamily: FONT_MONO, fontSize: '11px', color: oledTheme.colors.textMuted, lineHeight: 1.45 }}>
              PERMETTE DI RESETTARE LA MASTER PASSWORD DAL LOGIN IN CASO DI SMARRIMENTO. LA RIGENERAZIONE INVALIDA L&apos;EVENTUALE RECOVERY KEY PRECEDENTE.
            </p>

            {regenError && (
              <div
                style={{
                  padding: '9px 12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #EF4444',
                  borderRadius: oledTheme.radius.sm,
                  color: '#EF4444',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                }}
              >
                {regenError}
              </div>
            )}

            {newRecoveryKey && (
              <RecoveryKeyBox
                recoveryKey={newRecoveryKey}
                title="NUOVA RECOVERY KEY GENERATA"
                subtitle="COPIA O SCARICA QUESTA CHIAVE ORA. NON VERRÀ MOSTRATA NUOVAMENTE."
              />
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <label htmlFor="sec-regen-pwd" style={labelStyle}>
                  CONFERMA MASTER PASSWORD
                </label>
                <input
                  id="sec-regen-pwd"
                  type="password"
                  value={regenPassword}
                  onChange={(e) => setRegenPassword(e.target.value)}
                  placeholder="INSERISCI PASSWORD..."
                  style={inputStyle}
                />
              </div>

              <Button
                type="submit"
                variant="secondary"
                size="sm"
                loading={regenerating}
                icon={<RefreshIcon size={13} color="#F59E0B" aria-hidden="true" />}
                style={{ height: '38px' }}
              >
                {status?.recoveryConfigured ? 'RIGENERA KEY' : 'GENERA KEY'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
};
