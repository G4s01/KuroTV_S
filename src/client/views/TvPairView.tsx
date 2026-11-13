import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { TvIcon, CheckIcon } from '../components/Icons';
import { api, type PairInfoResponse, type ProfileRecord } from '../api';

export interface TvPairViewProps {
  initialCode?: string;
  profiles: ProfileRecord[];
  onComplete?: () => void;
  onNavigateHome?: () => void;
  isModal?: boolean;
}

export const TvPairView: React.FC<TvPairViewProps> = ({
  initialCode = '',
  profiles,
  onComplete,
  onNavigateHome,
  isModal = false,
}) => {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [deviceLabel, setDeviceLabel] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState(
    profiles[0]?.id || api.getActiveProfileId() || ''
  );
  const [pairInfo, setPairInfo] = useState<PairInfoResponse | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!pairInfo?.expiresAt) {
      setTimeLeft(null);
      return;
    }
    const updateCountdown = () => {
      setTimeLeft(Math.max(0, Math.floor((pairInfo.expiresAt - Date.now()) / 1000)));
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [pairInfo?.expiresAt]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Sync selected profile if profiles list loads
  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  // If code is 6 characters, automatically inspect metadata
  const fetchPairInfo = async (pairCode: string) => {
    if (!pairCode || pairCode.trim().length !== 6) return;
    setLoadingInfo(true);
    setError(null);
    try {
      const info = await api.getPairInfo(pairCode);
      setPairInfo(info);
      setDeviceLabel(info.deviceName || 'Android TV');
    } catch (err: any) {
      setPairInfo(null);
      setError(err?.message || 'Codice TV non valido o scaduto.');
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    if (code.length === 6) {
      fetchPairInfo(code);
    }
  }, [code]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(val);
    if (val.length < 6) {
      setPairInfo(null);
      setError(null);
    }
  };

  const handleApprove = async () => {
    if (!code || code.length !== 6) {
      setError('Inserisci un codice valido di 6 caratteri.');
      return;
    }
    if (!selectedProfileId) {
      setError('Seleziona un profilo da associare alla TV.');
      return;
    }

    setApproving(true);
    setError(null);
    try {
      await api.approvePair(code, selectedProfileId, deviceLabel);
      setSuccess(true);
      if (onComplete) onComplete();
    } catch (err: any) {
      setError(err?.message || 'Impossibile autorizzare la TV.');
    } finally {
      setApproving(false);
    }
  };

  // Form content used in both modal and standalone mode
  const renderForm = () => {
    if (success) {
      return (
        <div style={{ textAlign: 'center', padding: isModal ? '10px 0' : '16px 0' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10B981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px auto',
            }}
          >
            <CheckIcon size={22} color="#10B981" />
          </div>
          <h2
            style={{
              fontFamily: FONT_MONO,
              fontSize: '16px',
              fontWeight: 700,
              color: '#FFFFFF',
              margin: '0 0 6px 0',
            }}
          >
            TV AUTORIZZATA CON SUCCESSO!
          </h2>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '12px',
              color: oledTheme.colors.textSecondary,
              lineHeight: 1.5,
              margin: '0 0 18px 0',
            }}
          >
            La tua TV ha ricevuto le credenziali di sincronizzazione ed è ora collegata. Puoi tornare alla TV.
          </p>
          {onNavigateHome && (
            <Button variant="primary" onClick={onNavigateHome} style={{ width: '100%' }}>
              {isModal ? 'CHIUDI' : 'TORNA ALLA DASHBOARD'}
            </Button>
          )}
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {error && (
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
            {error}
          </div>
        )}

        {/* Code Input */}
        <div>
          <label
            style={{
              display: 'block',
              fontFamily: FONT_MONO,
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: oledTheme.colors.textSecondary,
              marginBottom: '6px',
              textAlign: 'center',
            }}
          >
            CODICE TV (6 CARATTERI)
          </label>
          <input
            type="text"
            value={code}
            onChange={handleCodeChange}
            placeholder="ES. K7R49P"
            maxLength={6}
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              backgroundColor: '#050505',
              border: `2px solid ${
                code.length === 6 ? oledTheme.colors.primary : oledTheme.colors.border
              }`,
              borderRadius: oledTheme.radius.md,
              color: '#FFFFFF',
              fontFamily: FONT_MONO,
              fontSize: '22px',
              fontWeight: 900,
              textAlign: 'center',
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Device Metadata Preview */}
        {loadingInfo && (
          <div style={{ textAlign: 'center', color: oledTheme.colors.textMuted, fontSize: '11px', fontFamily: FONT_MONO }}>
            Verifica codice in corso...
          </div>
        )}

        {pairInfo && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: '#121212',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${oledTheme.colors.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '11px',
              fontFamily: FONT_MONO,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: oledTheme.colors.textMuted }}>DISPOSITIVO:</span>
              <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{pairInfo.deviceName}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: oledTheme.colors.textMuted }}>PIATTAFORMA:</span>
              <span style={{ color: '#FFFFFF' }}>{pairInfo.platform}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: oledTheme.colors.textMuted }}>STATO:</span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Badge variant={pairInfo.status === 'pending' ? 'warning' : 'danger'}>
                  {pairInfo.status.toUpperCase()}
                </Badge>
                {timeLeft !== null && (
                  <Badge variant={timeLeft < 60 ? 'danger' : 'success'}>
                    {timeLeft > 0 ? `SCADENZA: ${formatTime(timeLeft)}` : 'SCADUTO'}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Profile Selection */}
        <div>
          <label
            style={{
              display: 'block',
              fontFamily: FONT_MONO,
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: oledTheme.colors.textSecondary,
              marginBottom: '6px',
            }}
          >
            Associa al Profilo
          </label>
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              backgroundColor: '#050505',
              border: `1px solid ${oledTheme.colors.border}`,
              borderRadius: oledTheme.radius.sm,
              color: '#FFFFFF',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              outline: 'none',
              cursor: 'pointer',
              boxSizing: 'border-box',
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

        {/* Device Label */}
        <div>
          <label
            style={{
              display: 'block',
              fontFamily: FONT_MONO,
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: oledTheme.colors.textSecondary,
              marginBottom: '6px',
            }}
          >
            Nome Dispositivo (Opzionale)
          </label>
          <input
            type="text"
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
            placeholder="es. Smart TV Salotto"
            style={{
              width: '100%',
              padding: '8px 12px',
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

        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          {onNavigateHome && (
            <Button
              variant="secondary"
              onClick={onNavigateHome}
              style={{ flex: 1 }}
            >
              ANNULLA
            </Button>
          )}
          <Button
            variant="primary"
            onClick={handleApprove}
            loading={approving}
            disabled={code.length !== 6}
            style={{ flex: onNavigateHome ? 2 : 1 }}
          >
            AUTORIZZA TV
          </Button>
        </div>
      </div>
    );
  };

  // If rendered inside a modal dialog, render only the compact form
  if (isModal) {
    return (
      <div style={{ width: '100%' }}>
        <p
          style={{
            fontFamily: FONT_MONO,
            fontSize: '11px',
            color: oledTheme.colors.textMuted,
            margin: '0 0 14px 0',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          INSERISCI IL CODICE DI 6 CARATTERI MOSTRATO SULLA TV
        </p>
        {renderForm()}
      </div>
    );
  }

  // Standalone page mode (/pair)
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000000',
        padding: '24px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: 'rgba(229, 9, 20, 0.15)',
              border: '1px solid #E50914',
              marginBottom: '12px',
            }}
          >
            <TvIcon size={24} color="#E50914" />
          </div>
          <h1
            style={{
              fontFamily: FONT_MONO,
              fontSize: '20px',
              fontWeight: 900,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              margin: '0 0 6px 0',
            }}
          >
            PAIR ANDROID TV
          </h1>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '12px',
              color: oledTheme.colors.textSecondary,
              margin: 0,
            }}
          >
            Inserisci il codice di 6 caratteri mostrato sullo schermo della TV.
          </p>
        </div>

        <Card style={{ backgroundColor: '#0A0A0A', border: `1px solid ${oledTheme.colors.border}`, padding: '20px' }}>
          {renderForm()}
        </Card>
      </div>
    </div>
  );
};
