import React, { useState, useEffect, useCallback } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { MobilePairModal } from '../../components/MobilePairModal';
import {
  TvIcon,
  MobileIcon,
  WebIcon,
  TrashIcon,
  RefreshIcon,
  QrIcon,
} from '../../components/Icons';
import { api, type DeviceRecord } from '../../api';

interface DevicesViewProps {
  activeProfileId: string | null;
  onOpenTvPair: () => void;
  refreshTrigger?: number;
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  activeProfileId,
  onOpenTvPair,
  refreshTrigger = 0,
}) => {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  // QR Modal state
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

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
      setEditDeviceError(
        err?.message ? String(err.message).toUpperCase() : 'IMPOSSIBILE RINOMINARE IL DISPOSITIVO.'
      );
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

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDevices(activeProfileId || undefined);
      const list = res.devices || [];
      list.sort((a, b) => (b.last_seen_at || b.created_at) - (a.last_seen_at || a.created_at));
      setDevices(list);
    } catch (err: any) {
      setError(
        err?.message ? String(err.message).toUpperCase() : 'IMPOSSIBILE CARICARE I DISPOSITIVI.'
      );
    } finally {
      setLoading(false);
    }
  }, [activeProfileId]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices, refreshTrigger]);

  // Revoke device dialog
  const handleRevoke = (id: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'DISCONNETTI DISPOSITIVO',
      message: `VUOI DISCONNETTERE "${name.toUpperCase()}"?`,
      submessage:
        'LA SESSIONE DEL DISPOSITIVO VERRÀ INVALIDATA IMMEDIATAMENTE E LE SUCCESSIVE RICHIESTE SARANNO RIFIUTATE.',
      confirmLabel: 'DISCONNETTI',
      action: async () => {
        setActionId(id);
        try {
          await api.revokeDevice(id);
          await fetchDevices();
        } catch (err: any) {
          setError(
            `ERRORE DURANTE LA DISCONNESSIONE: ${(err?.message || 'ERRORE SCONOSCIUTO').toUpperCase()}`
          );
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
      message: `RIMUOVERE DEFINITIVAMENTE "${name.toUpperCase()}"?`,
      submessage: 'IL RECORD VERRÀ ELIMINATO IN MODO PERMANENTE DAL DATABASE D1.',
      confirmLabel: 'ELIMINA',
      action: async () => {
        setActionId(id);
        try {
          await api.deleteDevicePermanently(id);
          await fetchDevices();
        } catch (err: any) {
          setError(
            `ERRORE DURANTE L'ELIMINAZIONE: ${(err?.message || 'ERRORE SCONOSCIUTO').toUpperCase()}`
          );
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
      message: 'RIMUOVERE DEFINITIVAMENTE TUTTE LE SESSIONI DISCONNESSE?',
      submessage:
        'TUTTI I DISPOSITIVI REVOCATI VERRANNO CANCELLATI IN MODO PERMANENTE DAL DATABASE D1.',
      confirmLabel: 'PULISCI TUTTO',
      action: async () => {
        setLoading(true);
        try {
          await api.purgeRevokedDevices(activeProfileId || undefined);
          await fetchDevices();
        } catch (err: any) {
          setError(
            `ERRORE DURANTE LA PULIZIA: ${(err?.message || 'ERRORE SCONOSCIUTO').toUpperCase()}`
          );
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
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <TvIcon size={20} color="#10B981" aria-hidden="true" />
            <span>DISPOSITIVI CONNESSI ({devices.length})</span>
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
            icon={<QrIcon size={14} color="#3B82F6" aria-hidden="true" />}
          >
            COLLEGA SMARTPHONE
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onOpenTvPair}
            icon={<TvIcon size={14} aria-hidden="true" />}
          >
            AUTORIZZA TV
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDevices}
            loading={loading}
            icon={<RefreshIcon size={14} color="#10B981" aria-hidden="true" />}
            title="AGGIORNA LISTA"
            aria-label="AGGIORNA LISTA"
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
          NESSUN DISPOSITIVO REGISTRATO FINORA. COLLEGA UNO SMARTPHONE O UNA ANDROID TV.
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
                        PIATTAFORMA: {device.platform.toUpperCase()} • ULTIMO ACCESSO:{' '}
                        <span style={{ color: '#FFFFFF' }}>
                          {device.last_seen_at
                            ? new Date(device.last_seen_at).toLocaleString().toUpperCase()
                            : 'N/D'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenEditDevice(device)}
                      title="RINOMINA DISPOSITIVO"
                      style={{ width: '90px' }}
                    >
                      MODIFICA
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionId === device.id}
                      onClick={() => handleRevoke(device.id, device.name)}
                      icon={<TrashIcon size={12} aria-hidden="true" />}
                      title="DISCONNETTI SESSIONE"
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
                        PIATTAFORMA: {device.platform.toUpperCase()} • ULTIMO ACCESSO:{' '}
                        <span style={{ color: oledTheme.colors.textMuted }}>
                          {device.last_seen_at
                            ? new Date(device.last_seen_at).toLocaleString().toUpperCase()
                            : 'N/D'}
                        </span>
                        {device.revoked_at && (
                          <span>
                            {' '}
                            • DISCONNESSO IL: {new Date(device.revoked_at).toLocaleString().toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenEditDevice(device)}
                      title="RINOMINA DISPOSITIVO"
                      style={{ width: '90px' }}
                    >
                      MODIFICA
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionId === device.id}
                      onClick={() => handlePermanentDelete(device.id, device.name)}
                      icon={<TrashIcon size={12} aria-hidden="true" />}
                      title="ELIMINA DEFINITIVAMENTE DALLA LISTA"
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
      <MobilePairModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        activeProfileId={activeProfileId}
        onSuccess={fetchDevices}
      />

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
