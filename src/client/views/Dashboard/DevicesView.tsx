import React, { useState, useEffect, useRef } from 'react';
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
  const modalOpenedAtRef = useRef<number>(0);
  const initialDeviceIdsRef = useRef<Set<string>>(new Set());

  // Edit Device Name Modal State
  const [editingDevice, setEditingDevice] = useState<DeviceRecord | null>(null);
  const [editDeviceName, setEditDeviceName] = useState('');
  const [savingDevice, setSavingDevice] = useState(false);
  const [editDeviceError, setEditDeviceError] = useState<string | null>(null);

  const handleOpenEditDevice = (device: DeviceRecord) => {
    setEditingDevice(device);
    setEditDeviceName(device.name);
    setEditDeviceError(null);
  };

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDevice || !editDeviceName.trim()) return;
    setSavingDevice(true);
    setEditDeviceError(null);
    try {
      await api.updateDevice(editingDevice.id, { name: editDeviceName.trim() });
      await fetchDevices();
      setEditingDevice(null);
    } catch (err: any) {
      setEditDeviceError(err?.message || 'IMPOSSIBILE RINOMINARE IL DISPOSITIVO.');
    } finally {
      setSavingDevice(false);
    }
  };

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
      modalOpenedAtRef.current = Date.now();
      initialDeviceIdsRef.current = new Set(devices.map((d) => d.id));
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

  // Auto-close polling: detects when device exchanges the QR token (dual-check)
  useEffect(() => {
    if (!isQrModalOpen || !qrToken || loginSuccess) return;

    let isSubscribed = true;
    const pollInterval = setInterval(async () => {
      try {
        let detected = false;

        // 1. Primary check: Ephemeral QR token status query
        try {
          const info = await api.getPairInfo(qrToken);
          if (info && info.status === 'consumed') {
            detected = true;
          }
        } catch {
          // Token query fallback ignore
        }

        // 2. Secondary check: Direct devices listing check
        if (!detected) {
          try {
            const devRes = await api.listDevices(activeProfileId || undefined);
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
            // Devices check ignore
          }
        }

        if (detected && isSubscribed) {
          setLoginSuccess(true);
          fetchDevices().catch(() => {});
        }
      } catch {
        // Polling loop ignore
      }
    }, 2200);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
    };
  }, [isQrModalOpen, qrToken, loginSuccess, activeProfileId]);

  // Auto-close modal after successful QR login
  useEffect(() => {
    if (!loginSuccess) return;
    const timer = setTimeout(() => {
      setIsQrModalOpen(false);
      setLoginSuccess(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [loginSuccess]);

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
  const activeDevices = devices.filter((d) => !d.revoked_at);
  const revokedDevices = devices.filter((d) => !!d.revoked_at);

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active / Connected Devices */}
          {activeDevices.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#10B981',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '2px',
                }}
              >
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                <span>DISPOSITIVI CONNESSI ({activeDevices.length})</span>
              </div>
              {activeDevices.map((device) => (
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
                    gap: '12px',
                    flexWrap: 'wrap',
                    transition: 'all 0.2s ease',
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
                        <Badge variant="info">
                          {device.device_type.toUpperCase()}
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
                        <span style={{ color: '#FFFFFF' }}>
                          {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'N/D'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenEditDevice(device)}
                      title="Rinomina dispositivo"
                      style={{ width: '90px' }}
                    >
                      MODIFICA
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionId === device.id}
                      onClick={() => handleRevoke(device.id, device.name)}
                      icon={<TrashIcon size={12} />}
                      title="Disconnetti sessione"
                      style={{ width: '135px' }}
                    >
                      DISCONNETTI
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Disconnected / Revoked Devices */}
          {revokedDevices.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                marginTop: activeDevices.length > 0 ? '8px' : '0',
              }}
            >
              {activeDevices.length > 0 && (
                <div style={{ borderTop: '1px dashed #222222', margin: '10px 0 16px 0' }} />
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  fontWeight: 700,
                  color: oledTheme.colors.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '2px',
                }}
              >
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
                <span>DISPOSITIVI SCONNESSI ({revokedDevices.length})</span>
              </div>
              {revokedDevices.map((device) => (
                <div
                  key={device.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    backgroundColor: '#0A0A0A',
                    border: '1px dashed #262626',
                    borderRadius: oledTheme.radius.md,
                    opacity: 0.75,
                    gap: '12px',
                    flexWrap: 'wrap',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: oledTheme.radius.sm,
                        backgroundColor: '#111111',
                        border: '1px solid #1C1C1C',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: oledTheme.colors.textMuted,
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
                            color: oledTheme.colors.textSecondary,
                          }}
                        >
                          {device.name}
                        </span>
                        <Badge variant="danger">
                          DISCONNESSO
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
                        <span style={{ color: oledTheme.colors.textMuted }}>
                          {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'N/D'}
                        </span>
                        {device.revoked_at && (
                          <span> • Disconnesso il: {new Date(device.revoked_at).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenEditDevice(device)}
                      title="Rinomina dispositivo"
                      style={{ width: '90px' }}
                    >
                      MODIFICA
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionId === device.id}
                      onClick={() => handlePermanentDelete(device.id, device.name)}
                      icon={<TrashIcon size={12} />}
                      title="Elimina definitivamente dalla lista"
                      style={{ width: '135px' }}
                    >
                      RIMUOVI
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Connect Smartphone Modal with Ephemeral Single-Use QR Code */}
      <Modal
        isOpen={isQrModalOpen}
        onClose={() => {
          setIsQrModalOpen(false);
          setLoginSuccess(false);
        }}
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

      {/* Edit Device Name Modal */}
      <Modal
        isOpen={!!editingDevice}
        onClose={() => setEditingDevice(null)}
        title="MODIFICA DISPOSITIVO"
        maxWidth="440px"
      >
        <form onSubmit={handleSaveDeviceName} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {editDeviceError && (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #EF4444',
                borderRadius: oledTheme.radius.sm,
                color: '#EF4444',
                fontFamily: FONT_MONO,
                fontSize: '12px',
              }}
            >
              {editDeviceError}
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
              NOME DISPOSITIVO
            </label>
            <input
              type="text"
              value={editDeviceName}
              onChange={(e) => setEditDeviceName(e.target.value)}
              placeholder="ES. PIXEL 8 PRO, TV SALOTTO"
              maxLength={50}
              required
              autoFocus
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: '#121212',
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditingDevice(null)}
              disabled={savingDevice}
            >
              ANNULLA
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={savingDevice}
              disabled={!editDeviceName.trim()}
            >
              SALVA
            </Button>
          </div>
        </form>
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
