import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { QrCode } from '../../components/QrCode';
import {
  TvIcon,
  MobileIcon,
  WebIcon,
  TrashIcon,
  RefreshIcon,
  CopyIcon,
  CheckIcon,
  QrIcon,
} from '../../components/Icons';
import { api, type DeviceRecord } from '../../api';

interface DevicesViewProps {
  activeProfileId: string | null;
  onOpenTvPair: () => void;
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  activeProfileId,
  onOpenTvPair,
}) => {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  // QR Modal & Ephemeral Single-Use Token
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loginSuccess, setLoginSuccess] = useState(false);

  // Integrated UI Confirmation Dialog (replaces browser confirm)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    submessage?: string;
    confirmLabel: string;
    action: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'CONFERMA',
    action: async () => {},
  });

  const fetchDevices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDevices(activeProfileId || undefined);
      const list = res.devices || [];
      list.sort((a, b) => (b.last_seen_at || b.created_at) - (a.last_seen_at || a.created_at));
      setDevices(list);
    } catch (err: any) {
      setError(err?.message || 'Impossibile caricare i dispositivi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [activeProfileId]);

  // Generate a fresh Single-Use Ephemeral QR token when opening modal
  const generateQrToken = async () => {
    setQrLoading(true);
    setError(null);
    try {
      const res = await api.createQrToken(activeProfileId || undefined);
      setQrToken(res.qrToken);
      setQrExpiresAt(res.expiresAt);
    } catch (err: any) {
      setError(err?.message || 'Impossibile generare il token QR monouso.');
    } finally {
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (isQrModalOpen) {
      setLoginSuccess(false);
      generateQrToken();
    } else {
      setQrToken(null);
      setQrExpiresAt(null);
      setTimeLeft(null);
      setLoginSuccess(false);
    }
  }, [isQrModalOpen, activeProfileId]);

  // Real-time Countdown Timer for Ephemeral QR
  useEffect(() => {
    if (!qrExpiresAt) {
      setTimeLeft(null);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((qrExpiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt]);

  // Auto-close polling: detects when device exchanges the QR token
  useEffect(() => {
    if (!isQrModalOpen || !qrToken || loginSuccess) return;

    let isSubscribed = true;
    const pollInterval = setInterval(async () => {
      try {
        const info = await api.getPairInfo(qrToken);
        if (!isSubscribed) return;
        if (info.status === 'consumed') {
          setLoginSuccess(true);
          await fetchDevices();
          setTimeout(() => {
            if (isSubscribed) {
              setIsQrModalOpen(false);
              setLoginSuccess(false);
            }
          }, 1200);
        }
      } catch {
        // Polling ignore
      }
    }, 1500);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
    };
  }, [isQrModalOpen, qrToken, loginSuccess]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://kurosync.workers.dev';
  const connectUrl = qrToken
    ? `kurosync://connect?url=${encodeURIComponent(origin)}&token=${encodeURIComponent(
        qrToken
      )}&profile=${encodeURIComponent(activeProfileId || '')}`
    : '';

  const handleCopyConnectUrl = () => {
    if (connectUrl && navigator.clipboard) {
      navigator.clipboard.writeText(connectUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Revoke device dialog
  const handleRevoke = (id: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'DISCONNETTI DISPOSITIVO',
      message: `Vuoi disconnettere "${name}"?`,
      submessage: 'La sessione del dispositivo verrà invalidata immediatamente e le successive richieste saranno rifiutate.',
      confirmLabel: 'DISCONNETTI',
      action: async () => {
        setActionId(id);
        try {
          await api.revokeDevice(id);
          await fetchDevices();
        } catch (err: any) {
          setError(`Errore durante la disconnessione: ${err?.message || 'Errore sconosciuto'}`);
        } finally {
          setActionId(null);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  // Permanent delete dialog
  const handlePermanentDelete = (id: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'ELIMINA DEFINITIVAMENTE',
      message: `Rimuovere definitivamente "${name}"?`,
      submessage: 'Il record verrà eliminato in modo permanente dal database D1.',
      confirmLabel: 'ELIMINA',
      action: async () => {
        setActionId(id);
        try {
          await api.deleteDevicePermanently(id);
          await fetchDevices();
        } catch (err: any) {
          setError(`Errore durante l'eliminazione: ${err?.message || 'Errore sconosciuto'}`);
        } finally {
          setActionId(null);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  // Purge all revoked devices dialog
  const handlePurgeAllRevoked = () => {
    setConfirmModal({
      isOpen: true,
      title: 'PULISCI DISCONNESSI',
      message: 'Rimuovere definitivamente tutte le sessioni disconnesse?',
      submessage: 'Tutti i dispositivi revocati verranno cancellati in modo permanente dal database D1.',
      confirmLabel: 'PULISCI TUTTO',
      action: async () => {
        setLoading(true);
        try {
          await api.purgeRevokedDevices(activeProfileId || undefined);
          await fetchDevices();
        } catch (err: any) {
          setError(`Errore durante la pulizia: ${err?.message || 'Errore sconosciuto'}`);
        } finally {
          setLoading(false);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'tv':
        return <TvIcon size={20} color="#E50914" />;
      case 'mobile':
        return <MobileIcon size={20} color="#3B82F6" />;
      default:
        return <WebIcon size={20} color="#10B981" />;
    }
  };

  const hasRevoked = devices.some((d) => !!d.revoked_at);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: `1px solid ${oledTheme.colors.border}`,
          paddingBottom: '16px',
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: FONT_MONO,
              fontSize: '18px',
              fontWeight: 700,
              color: '#FFFFFF',
              margin: '0 0 4px 0',
              textTransform: 'uppercase',
            }}
          >
            DISPOSITIVI CONNESSI ({devices.length})
          </h2>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '11px',
              color: oledTheme.colors.textMuted,
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            SESSIONI ATTIVE E DISCONNESSE (ORDINE ULTIMO ACCESSO)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {hasRevoked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePurgeAllRevoked}
              style={{
                color: '#EF4444',
                borderColor: 'rgba(239, 68, 68, 0.4)',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
              }}
            >
              PULISCI DISCONNESSI
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsQrModalOpen(true)}
            icon={<QrIcon size={14} />}
          >
            COLLEGA SMARTPHONE
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onOpenTvPair}
            icon={<TvIcon size={14} />}
          >
            AUTORIZZA TV
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDevices}
            loading={loading}
            icon={<RefreshIcon size={14} />}
            title="Aggiorna lista"
          />
        </div>
      </div>

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

      {devices.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: oledTheme.colors.textMuted,
            fontFamily: FONT_MONO,
          }}
        >
          Nessun dispositivo registrato finora. Collega uno smartphone o una Android TV.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {devices.map((device) => {
            const isRevoked = !!device.revoked_at;

            return (
              <div
                key={device.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  backgroundColor: oledTheme.colors.card,
                  border: `1px solid ${oledTheme.colors.border}`,
                  borderRadius: oledTheme.radius.md,
                  opacity: isRevoked ? 0.6 : 1,
                  gap: '12px',
                  flexWrap: 'wrap',
                  transition: 'opacity 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: oledTheme.radius.sm,
                      backgroundColor: '#171717',
                      border: `1px solid ${oledTheme.colors.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {getDeviceIcon(device.device_type)}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontWeight: 700,
                          fontSize: '14px',
                          color: '#FFFFFF',
                        }}
                      >
                        {device.name}
                      </span>
                      <Badge variant={isRevoked ? 'danger' : 'info'}>
                        {isRevoked ? 'DISCONNESSO' : device.device_type.toUpperCase()}
                      </Badge>
                    </div>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: '11px',
                        color: oledTheme.colors.textMuted,
                        marginTop: '4px',
                      }}
                    >
                      Piattaforma: {device.platform} • Ultimo accesso:{' '}
                      <span style={{ color: isRevoked ? oledTheme.colors.textMuted : '#FFFFFF' }}>
                        {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'N/D'}
                      </span>
                      {isRevoked && device.revoked_at && (
                        <span> • Disconnesso il: {new Date(device.revoked_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {!isRevoked ? (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionId === device.id}
                      onClick={() => handleRevoke(device.id, device.name)}
                      icon={<TrashIcon size={12} />}
                      title="Disconnetti sessione"
                    >
                      DISCONNETTI
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionId === device.id}
                      onClick={() => handlePermanentDelete(device.id, device.name)}
                      icon={<TrashIcon size={12} />}
                      title="Elimina definitivamente dalla lista"
                    >
                      RIMUOVI
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connect Smartphone Modal with Ephemeral Single-Use QR Code */}
      <Modal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
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
                <CheckIcon size={24} />
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
                    <Button variant="primary" size="sm" onClick={generateQrToken}>
                      RIGENERA QR
                    </Button>
                  </div>
                ) : connectUrl ? (
                  <QrCode value={connectUrl} size={210} />
                ) : (
                  <Button variant="secondary" size="sm" onClick={generateQrToken}>
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
                  onClick={generateQrToken}
                  loading={qrLoading}
                  icon={<RefreshIcon size={12} />}
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
                    icon={copied ? <CheckIcon size={14} color="#10B981" /> : <CopyIcon size={14} />}
                  >
                    {copied ? 'COPIATO' : 'COPIA'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Integrated In-UI Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.action}
        title={confirmModal.title}
        message={confirmModal.message}
        submessage={confirmModal.submessage}
        confirmLabel={confirmModal.confirmLabel}
      />
    </div>
  );
};
