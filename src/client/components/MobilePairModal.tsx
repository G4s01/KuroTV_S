import React, { useState, useEffect, useRef, useCallback } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Modal } from './Modal';
import { Button } from './Button';
import { QrCode } from './QrCode';
import { CheckIcon, CopyIcon, RefreshIcon } from './Icons';
import { api, type ProfileRecord } from '../api';
import { copyTextSafe } from '../malOAuth';

interface MobilePairModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfileId: string | null;
  profiles?: ProfileRecord[];
  onSuccess?: () => void;
}

export const MobilePairModal: React.FC<MobilePairModalProps> = ({
  isOpen,
  onClose,
  activeProfileId,
  profiles,
  onSuccess,
}) => {
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    activeProfileId || profiles?.[0]?.id || ''
  );
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loginSuccess, setLoginSuccess] = useState(false);

  const modalOpenedAtRef = useRef<number>(0);
  const initialDeviceIdsRef = useRef<Set<string>>(new Set());

  const targetProfileId = selectedProfileId || activeProfileId || profiles?.[0]?.id || '';

  useEffect(() => {
    if (isOpen) {
      setSelectedProfileId(activeProfileId || profiles?.[0]?.id || '');
    }
  }, [isOpen, activeProfileId, profiles]);

  const generateQrToken = useCallback(async (profileIdOverride?: string) => {
    const profileToPair = profileIdOverride ?? targetProfileId;
    setQrLoading(true);
    setQrError(null);
    setLoginSuccess(false);
    modalOpenedAtRef.current = Date.now();
    try {
      const [devRes, tokenRes] = await Promise.all([
        api.listDevices(profileToPair || undefined).catch(() => null),
        api.createQrToken(profileToPair || undefined),
      ]);
      initialDeviceIdsRef.current = new Set((devRes?.devices || []).map((d) => d.id));
      setQrToken(tokenRes.qrToken);
      setQrExpiresAt(tokenRes.expiresAt);
    } catch (err: any) {
      setQrToken(null);
      setQrExpiresAt(null);
      setQrError(
        err?.message ? String(err.message).toUpperCase() : 'IMPOSSIBILE GENERARE IL TOKEN QR MONOUSO.'
      );
    } finally {
      setQrLoading(false);
    }
  }, [targetProfileId]);

  useEffect(() => {
    if (isOpen) {
      generateQrToken(targetProfileId);
    } else {
      setQrToken(null);
      setQrExpiresAt(null);
      setQrError(null);
      setTimeLeft(null);
      setCopied(false);
      setLoginSuccess(false);
    }
  }, [isOpen, targetProfileId, generateQrToken]);

  useEffect(() => {
    if (!qrExpiresAt) {
      setTimeLeft(null);
      return;
    }
    const updateCountdown = () => {
      setTimeLeft(Math.max(0, Math.floor((qrExpiresAt - Date.now()) / 1000)));
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt]);

  useEffect(() => {
    if (!isOpen || !qrToken || loginSuccess) return;

    let isSubscribed = true;
    const pollInterval = setInterval(async () => {
      try {
        let detected = false;

        try {
          const info = await api.getPairInfo(qrToken);
          if (info && info.status === 'consumed') {
            detected = true;
          }
        } catch {
          // Ignore transient token query failures
        }

        if (!detected) {
          try {
            const devRes = await api.listDevices(targetProfileId || undefined);
            if (devRes && Array.isArray(devRes.devices)) {
              const hasNewDevice = devRes.devices.some(
                (d) =>
                  !initialDeviceIdsRef.current.has(d.id) &&
                  !d.revoked_at &&
                  (d.created_at >= modalOpenedAtRef.current - 3000 ||
                    (d.last_seen_at && d.last_seen_at >= modalOpenedAtRef.current - 3000))
              );
              if (hasNewDevice) {
                detected = true;
              }
            }
          } catch {
            // Ignore transient device check failures
          }
        }

        if (detected && isSubscribed) {
          setLoginSuccess(true);
          onSuccess?.();
        }
      } catch {
        // Ignore polling errors
      }
    }, 2200);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
    };
  }, [isOpen, qrToken, loginSuccess, targetProfileId, onSuccess]);

  useEffect(() => {
    if (!loginSuccess) return;
    const timer = setTimeout(() => {
      onClose();
      setLoginSuccess(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [loginSuccess, onClose]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://kurosync.workers.dev';
  const connectUrl = qrToken
    ? `kurosync://connect?url=${encodeURIComponent(origin)}&token=${encodeURIComponent(
        qrToken
      )}&profile=${encodeURIComponent(targetProfileId || '')}`
    : '';

  const handleCopyConnectUrl = async () => {
    if (!connectUrl) return;
    const ok = await copyTextSafe(connectUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setLoginSuccess(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="COLLEGA SMARTPHONE"
      maxWidth="460px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        {loginSuccess ? (
          <div
            style={{
              padding: '24px 16px',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10B981',
              borderRadius: oledTheme.radius.sm,
              color: '#10B981',
              fontFamily: FONT_MONO,
              fontWeight: 700,
              fontSize: '14px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: '#10B981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#000000',
              }}
            >
              <CheckIcon size={24} aria-hidden="true" />
            </div>
            <span>ACCESSO EFFETTUATO CON SUCCESSO!</span>
            <span style={{ fontSize: '11px', color: oledTheme.colors.textMuted }}>
              CHIUSURA POP-UP IN CORSO...
            </span>
          </div>
        ) : (
          <>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: '11px',
                color: oledTheme.colors.textSecondary,
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              SCANSIONA DA KUROTV MOBILE (IMPOSTAZIONI &gt; SINCRONIZZAZIONE)
            </div>

            {profiles && profiles.length > 1 && (
              <div style={{ width: '100%', boxSizing: 'border-box' }}>
                <label
                  htmlFor="mobile-pair-profile-select"
                  style={{
                    display: 'block',
                    fontFamily: FONT_MONO,
                    fontSize: '10px',
                    fontWeight: 700,
                    color: oledTheme.colors.textMuted,
                    marginBottom: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  ASSOCIA AL PROFILO
                </label>
                <select
                  id="mobile-pair-profile-select"
                  value={targetProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    backgroundColor: '#050505',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: '12px',
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
                      {p.name.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {qrError && (
              <div
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #EF4444',
                  borderRadius: oledTheme.radius.sm,
                  color: '#EF4444',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                }}
              >
                {qrError}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '220px',
                width: '100%',
              }}
            >
              {qrLoading ? (
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '12px',
                    color: oledTheme.colors.textMuted,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  GENERAZIONE TOKEN...
                </div>
              ) : timeLeft !== null && timeLeft <= 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '24px',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    backgroundColor: '#0A0A0A',
                  }}
                >
                  <span style={{ color: '#EF4444', fontFamily: FONT_MONO, fontSize: '13px', fontWeight: 700 }}>
                    TOKEN SCADUTO
                  </span>
                  <Button variant="primary" size="sm" onClick={() => generateQrToken(targetProfileId)}>
                    RIGENERA QR
                  </Button>
                </div>
              ) : connectUrl ? (
                <QrCode value={connectUrl} size={210} />
              ) : (
                <Button variant="secondary" size="sm" onClick={() => generateQrToken(targetProfileId)}>
                  GENERA QR CODE
                </Button>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '6px 0',
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  color: timeLeft !== null && timeLeft < 60 ? '#EF4444' : '#10B981',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: timeLeft !== null && timeLeft < 60 ? '#EF4444' : '#10B981',
                  }}
                />
                {timeLeft !== null && timeLeft > 0
                  ? `SCADENZA: ${formatTime(timeLeft)}`
                  : 'SCADUTO'}
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => generateQrToken(targetProfileId)}
                loading={qrLoading}
                icon={<RefreshIcon size={12} color="#10B981" aria-hidden="true" />}
              >
                RIGENERA QR
              </Button>
            </div>

            <div style={{ width: '100%', boxSizing: 'border-box' }}>
              <label
                style={{
                  display: 'block',
                  fontFamily: FONT_MONO,
                  fontSize: '10px',
                  fontWeight: 700,
                  color: oledTheme.colors.textMuted,
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                DEEP LINK DIRETTO
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={connectUrl}
                  className="raw-token"
                  placeholder="GENERAZIONE IN CORSO..."
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    backgroundColor: '#050505',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyConnectUrl}
                  disabled={!connectUrl}
                  icon={
                    copied ? (
                      <CheckIcon size={14} color="#10B981" aria-hidden="true" />
                    ) : (
                      <CopyIcon size={14} color="#3B82F6" aria-hidden="true" />
                    )
                  }
                >
                  {copied ? 'COPIATO' : 'COPIA'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
