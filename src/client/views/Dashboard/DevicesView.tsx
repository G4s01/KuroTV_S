import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Card } from '../../components/Card';
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
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDevices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDevices(activeProfileId || undefined);
      setDevices(res.devices || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load devices.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [activeProfileId]);

  const handleRevoke = async (id: string, name: string) => {
    const confirmed = window.confirm(
      `Revoke device "${name}"? It will be disconnected immediately and its token invalidated.`
    );
    if (!confirmed) return;

    setRevokingId(id);
    try {
      await api.revokeDevice(id);
      await fetchDevices();
    } catch (err: any) {
      alert(`Failed to revoke device: ${err?.message || 'Unknown error'}`);
    } finally {
      setRevokingId(null);
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
            Connected Devices ({devices.length})
          </h2>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '12px',
              color: oledTheme.colors.textSecondary,
              margin: 0,
            }}
          >
            Manage active authorizations for Android TV, KuroTV Mobile, and Web sessions.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsQrModalOpen(true)}
            icon={<QrIcon size={14} />}
          >
            CONNECT SMARTPHONE
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onOpenTvPair}
            icon={<TvIcon size={14} />}
          >
            PAIR TV
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDevices}
            loading={loading}
            icon={<RefreshIcon size={14} />}
            title="Refresh"
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
          No devices registered yet. Connect your smartphone or Android TV.
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
                  opacity: isRevoked ? 0.5 : 1,
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: oledTheme.radius.sm,
                      backgroundColor: '#171717',
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
                        {isRevoked ? 'REVOKED' : device.device_type.toUpperCase()}
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
                      Platform: {device.platform} • Last seen:{' '}
                      {new Date(device.last_seen_at).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div>
                  {!isRevoked ? (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={revokingId === device.id}
                      onClick={() => handleRevoke(device.id, device.name)}
                      icon={<TrashIcon size={12} />}
                    >
                      REVOKE
                    </Button>
                  ) : (
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: '11px',
                        color: oledTheme.colors.error,
                      }}
                    >
                      Disconnected
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connect Smartphone Modal with QR Code */}
      <Modal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        title="CONNECT SMARTPHONE"
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '13px',
              color: oledTheme.colors.textSecondary,
              textAlign: 'center',
              margin: 0,
            }}
          >
            Scan this QR code in KuroTV Mobile under Settings &gt; Sync Instance to connect automatically.
          </p>

          <QrCode value={connectUrl} size={200} />

          <div style={{ width: '100%' }}>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                color: oledTheme.colors.textMuted,
                marginBottom: '6px',
                textTransform: 'uppercase',
              }}
            >
              Direct Connect Deep Link
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={connectUrl}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: '#050505',
                  border: `1px solid ${oledTheme.colors.border}`,
                  borderRadius: oledTheme.radius.sm,
                  color: '#FFFFFF',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  outline: 'none',
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyConnectUrl}
                icon={copied ? <CheckIcon size={14} color="#10B981" /> : <CopyIcon size={14} />}
              >
                {copied ? 'COPIED' : 'COPY'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
