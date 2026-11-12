import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { TvIcon, CheckIcon, ShieldIcon, RefreshIcon } from '../components/Icons';
import { api, type PairInfoResponse, type ProfileRecord } from '../api';

interface TvPairViewProps {
  initialCode?: string;
  profiles: ProfileRecord[];
  onComplete?: () => void;
  onNavigateHome?: () => void;
}

export const TvPairView: React.FC<TvPairViewProps> = ({
  initialCode = '',
  profiles,
  onComplete,
  onNavigateHome,
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
      setError(err?.message || 'Invalid or expired pairing code.');
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
      setError('Please enter a valid 6-character pairing code');
      return;
    }
    if (!selectedProfileId) {
      setError('Please select a profile to link with this TV');
      return;
    }

    setApproving(true);
    setError(null);
    try {
      await api.approvePair(code, selectedProfileId, deviceLabel);
      setSuccess(true);
      if (onComplete) onComplete();
    } catch (err: any) {
      setError(err?.message || 'Failed to approve pairing code.');
    } finally {
      setApproving(false);
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
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              backgroundColor: 'rgba(229, 9, 20, 0.15)',
              border: '1px solid #E50914',
              marginBottom: '16px',
            }}
          >
            <TvIcon size={28} color="#E50914" />
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
            PAIR ANDROID TV
          </h1>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '13px',
              color: oledTheme.colors.textSecondary,
              margin: 0,
            }}
          >
            Enter the 6-character code shown on your KuroTV TV screen.
          </p>
        </div>

        <Card style={{ backgroundColor: '#0A0A0A', border: `1px solid ${oledTheme.colors.border}` }}>
          {success ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid #10B981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px auto',
                }}
              >
                <CheckIcon size={24} color="#10B981" />
              </div>
              <h2
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  marginBottom: '8px',
                }}
              >
                TV PAIRED SUCCESSFULLY!
              </h2>
              <p
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '13px',
                  color: oledTheme.colors.textSecondary,
                  lineHeight: 1.5,
                  marginBottom: '24px',
                }}
              >
                Your TV has received its sync credentials and is now linked to your profile. You can return to your TV.
              </p>
              {onNavigateHome && (
                <Button variant="primary" onClick={onNavigateHome} style={{ width: '100%' }}>
                  RETURN TO DASHBOARD
                </Button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

              {/* Code Input */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: FONT_MONO,
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: oledTheme.colors.textSecondary,
                    marginBottom: '8px',
                    textAlign: 'center',
                  }}
                >
                  6-CHARACTER TV CODE
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={handleCodeChange}
                  placeholder="e.g. 7K9P2X"
                  maxLength={6}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '14px',
                    backgroundColor: '#050505',
                    border: `2px solid ${
                      code.length === 6 ? oledTheme.colors.primary : oledTheme.colors.border
                    }`,
                    borderRadius: oledTheme.radius.md,
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: '24px',
                    fontWeight: 900,
                    textAlign: 'center',
                    letterSpacing: '0.3em',
                    textTransform: 'uppercase',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Device Metadata Preview */}
              {loadingInfo && (
                <div style={{ textAlign: 'center', color: oledTheme.colors.textMuted, fontSize: '13px' }}>
                  Verifying TV code...
                </div>
              )}

              {pairInfo && (
                <div
                  style={{
                    padding: '12px 16px',
                    backgroundColor: '#121212',
                    borderRadius: oledTheme.radius.sm,
                    border: `1px solid ${oledTheme.colors.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '12px',
                    fontFamily: FONT_MONO,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: oledTheme.colors.textMuted }}>DEVICE:</span>
                    <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{pairInfo.deviceName}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: oledTheme.colors.textMuted }}>PLATFORM:</span>
                    <span style={{ color: '#FFFFFF' }}>{pairInfo.platform}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: oledTheme.colors.textMuted }}>STATUS:</span>
                    <Badge variant={pairInfo.status === 'pending' ? 'warning' : 'danger'}>
                      {pairInfo.status}
                    </Badge>
                  </div>
                </div>
              )}

              {/* Profile Selection */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: FONT_MONO,
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: oledTheme.colors.textSecondary,
                    marginBottom: '8px',
                  }}
                >
                  Assign to Profile
                </label>
                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: '#050505',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: '14px',
                    outline: 'none',
                    cursor: 'pointer',
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
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: oledTheme.colors.textSecondary,
                    marginBottom: '8px',
                  }}
                >
                  Device Label (Optional)
                </label>
                <input
                  type="text"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                  placeholder="e.g. Salotto TV"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: '#050505',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                {onNavigateHome && (
                  <Button
                    variant="secondary"
                    onClick={onNavigateHome}
                    style={{ flex: 1 }}
                  >
                    CANCEL
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={handleApprove}
                  loading={approving}
                  disabled={code.length !== 6}
                  style={{ flex: onNavigateHome ? 2 : 1 }}
                >
                  APPROVE TV PAIRING
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
