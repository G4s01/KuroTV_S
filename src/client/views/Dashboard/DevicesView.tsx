import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
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
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDevices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDevices(activeProfileId || undefined);
      const list = res.devices || [];
      // Ensure sorted by last seen (descending)
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

  const handleRevoke = async (id: string, name: string) => {
    const confirmed = window.confirm(
      `Disconnettere "${name}"? La sessione verrà invalidata immediatamente.`
    );
    if (!confirmed) return;

    setActionId(id);
    try {
      await api.revokeDevice(id);
      await fetchDevices();
    } catch (err: any) {
      alert(`Errore: ${err?.message || 'Impossibile disconnettere il dispositivo'}`);
    } finally {
      setActionId(null);
    }
  };

  const handlePermanentDelete = async (id: string, name: string) => {
    const confirmed = window.confirm(
      `Rimuovere definitivamente "${name}" dalla lista dei dispositivi?`
    );
    if (!confirmed) return;

    setActionId(id);
    try {
      await api.deleteDevicePermanently(id);
      await fetchDevices();
    } catch (err: any) {
      alert(`Errore: ${err?.message || 'Impossibile rimuovere il dispositivo'}`);
    } finally {
      setActionId(null);
    }
  };

  const handlePurgeAllRevoked = async () => {
    const confirmed = window.confirm(
      'Rimuovere definitivamente tutte le sessioni disconnesse?'
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      await api.purgeRevokedDevices(activeProfileId || undefined);
      await fetchDevices();
    } catch (err: any) {
      alert(`Errore: ${err?.message || 'Impossibile rimuovere le sessioni'}`);
    } finally {
      setLoading(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://kurosync.workers.dev';
  const token = api.getToken() || '';
  const connectUrl = `kurosync://connect?url=${encodeURIComponent(origin)}&token=${encodeURIComponent(
    token
  )}&profile=${encodeURIComponent(activeProfileId || '')}`;

  const handleCopyConnectUrl = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(connectUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
            Dispositivi Connessi ({devices.length})
          </h2>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '12px',
              color: oledTheme.colors.textSecondary,
              margin: 0,
            }}
          >
            Gestisci le autorizzazioni per Android TV, KuroTV Mobile e sessioni Web (ordinati per ultimo accesso).
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

      {/* Connect Smartphone Modal with High-Contrast QR Code */}
      <Modal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        title="COLLEGA SMARTPHONE"
        maxWidth="460px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '12px',
              color: oledTheme.colors.textSecondary,
              textAlign: 'center',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Inquadra questo QR code dall'app <strong>KuroTV Mobile</strong> su <em>Impostazioni &gt; Sincronizzazione</em> per collegarti all'istante.
          </p>

          <QrCode value={connectUrl} size={210} />

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
              Oppure copia il Deep Link diretto
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={connectUrl}
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
                icon={copied ? <CheckIcon size={14} color="#10B981" /> : <CopyIcon size={14} />}
              >
                {copied ? 'COPIATO' : 'COPIA'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
