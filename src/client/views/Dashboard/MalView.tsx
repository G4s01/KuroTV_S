import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { ConfirmModal } from '../../components/ConfirmModal';
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  HelpCircleIcon,
  KeyIcon,
  LinkIcon,
  RefreshIcon,
  TrashIcon,
  UserIcon,
  ChevronDownIcon,
  AlertCircleIcon,
} from '../../components/Icons';
import { api, type MalAccountSummary, type ProfileRecord } from '../../api';
import {
  MAL_API_CONFIG_CREATE_URL,
  MAL_API_CONFIG_URL,
  MAL_MOBILE_REDIRECT_URI,
  MAL_SAMPLE_DESCRIPTION,
  beginMalOAuthRedirect,
  copyTextSafe,
  getSavedMalClientId,
  getWebMalRedirectUri,
  getWebOriginUrl,
  isValidMalClientId,
  normalizeMalClientId,
} from '../../malOAuth';

export interface MalViewStatusMessage {
  type: 'loading' | 'success' | 'error';
  text: string;
}

interface MalViewProps {
  profiles: ProfileRecord[];
  activeProfileId: string | null;
  preselectedProfileId?: string | null;
  onClearPreselectedProfile?: () => void;
  externalStatus?: MalViewStatusMessage | null;
  onClearExternalStatus?: () => void;
  onAccountsUpdated?: (accounts: MalAccountSummary[]) => void;
}

type CopyKey =
  | 'web-redirect'
  | 'mobile-redirect'
  | 'both-redirects'
  | 'homepage'
  | 'description'
  | `client-${string}`;

function formatClientIdPreview(clientId: string): string {
  if (clientId.length <= 14) return clientId;
  return `${clientId.slice(0, 6)}...${clientId.slice(-6)}`;
}

function formatDateTime(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return 'N/D';
  return new Date(ts).toLocaleString();
}

export const MalView: React.FC<MalViewProps> = ({
  profiles,
  activeProfileId,
  preselectedProfileId,
  onClearPreselectedProfile,
  externalStatus,
  onClearExternalStatus,
  onAccountsUpdated,
}) => {
  const [accounts, setAccounts] = useState<MalAccountSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<MalViewStatusMessage | null>(null);

  // Connect form state
  const [targetProfileId, setTargetProfileId] = useState<string>(
    preselectedProfileId || activeProfileId || profiles[0]?.id || ''
  );
  const [clientIdInput, setClientIdInput] = useState<string>(() => getSavedMalClientId());
  const [clientIdTouched, setClientIdTouched] = useState(false);
  const [clientIdError, setClientIdError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Clipboard feedback state (non-blocking, live-region announced)
  const [copiedKey, setCopiedKey] = useState<CopyKey | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState('');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopyAnnouncementRef = useRef('');

  // Image load fallback tracking per profile
  const [brokenPictures, setBrokenPictures] = useState<Record<string, boolean>>({});

  // Disconnect confirmation dialog
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    isOpen: boolean;
    account: MalAccountSummary | null;
  }>({ isOpen: false, account: null });

  const connectSectionRef = useRef<HTMLDivElement>(null);
  const clientIdInputRef = useRef<HTMLInputElement>(null);

  const webRedirectUri = useMemo(() => getWebMalRedirectUri(), []);
  const webOrigin = useMemo(() => getWebOriginUrl(), []);
  const bothRedirectUris = useMemo(
    () => `${webRedirectUri}\n${MAL_MOBILE_REDIRECT_URI}`,
    [webRedirectUri]
  );

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listMalAccounts();
      const list = res.accounts || [];
      setAccounts(list);
      onAccountsUpdated?.(list);
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || 'Impossibile caricare le associazioni MyAnimeList.',
      });
    } finally {
      setLoading(false);
    }
  }, [onAccountsUpdated]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts, profiles.length]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Keep targetProfileId valid when profiles load or active profile changes
  useEffect(() => {
    if (preselectedProfileId && profiles.some((p) => p.id === preselectedProfileId)) {
      setTargetProfileId(preselectedProfileId);
      onClearPreselectedProfile?.();
      clientIdInputRef.current?.focus();
      return;
    }

    if (targetProfileId && profiles.some((p) => p.id === targetProfileId)) {
      return;
    }

    const fallback = activeProfileId || profiles[0]?.id || '';
    if (fallback) setTargetProfileId(fallback);
  }, [profiles, activeProfileId, preselectedProfileId, targetProfileId, onClearPreselectedProfile]);

  // Pre-fill Client ID from selected profile if input is empty
  useEffect(() => {
    if (clientIdInput.trim().length > 0) return;
    const selectedAcc = accounts.find((a) => a.profileId === targetProfileId);
    if (selectedAcc?.clientId) {
      setClientIdInput(selectedAcc.clientId);
      return;
    }
    const anyConnected = accounts.find((a) => a.connected && a.clientId);
    if (anyConnected?.clientId) {
      setClientIdInput(anyConnected.clientId);
    }
  }, [accounts, targetProfileId, clientIdInput]);

  const distinctSavedClientIds = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ clientId: string; label: string }> = [];
    for (const acc of accounts) {
      if (acc.connected && acc.clientId && !seen.has(acc.clientId)) {
        seen.add(acc.clientId);
        items.push({ clientId: acc.clientId, label: acc.profileName });
      }
    }
    return items;
  }, [accounts]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.profileId === targetProfileId) || null,
    [accounts, targetProfileId]
  );

  const handleCopy = async (key: CopyKey, value: string, description: string) => {
    const ok = await copyTextSafe(value);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopiedKey(ok ? key : null);

    let announcement = ok ? `${description} copiato` : 'Copia non riuscita';
    if (announcement === lastCopyAnnouncementRef.current) {
      announcement += '\u00A0';
    }
    lastCopyAnnouncementRef.current = announcement;
    setCopyAnnouncement(announcement);

    copyTimerRef.current = setTimeout(() => {
      setCopiedKey(null);
      setCopyAnnouncement('');
    }, 2200);
  };

  const validateClientIdValue = (raw: string): string | null => {
    const clean = normalizeMalClientId(raw);
    if (!clean) {
      return 'Inserisci il Client ID della tua app MyAnimeList.';
    }
    if (!isValidMalClientId(clean)) {
      return 'Formato non valido: servono 16-128 caratteri alfanumerici (solo lettere e cifre).';
    }
    return null;
  };

  const handleClientIdChange = (val: string) => {
    setClientIdInput(val);
    if (clientIdError) {
      const nextErr = validateClientIdValue(val);
      if (!nextErr) setClientIdError(null);
    }
  };

  const handleClientIdBlur = () => {
    if (!clientIdTouched && clientIdInput.trim().length === 0) return;
    setClientIdTouched(true);
    setClientIdError(validateClientIdValue(clientIdInput));
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConnecting) return;

    setClientIdTouched(true);
    const validationErr = validateClientIdValue(clientIdInput);
    if (validationErr) {
      setClientIdError(validationErr);
      clientIdInputRef.current?.focus();
      return;
    }

    if (!targetProfileId) {
      setStatusMsg({ type: 'error', text: 'Seleziona un profilo KuroSync valido.' });
      return;
    }

    onClearExternalStatus?.();
    setStatusMsg(null);
    setIsConnecting(true);

    const authorizeUrl = beginMalOAuthRedirect({
      profileId: targetProfileId,
      clientId: clientIdInput,
    });
    window.location.assign(authorizeUrl);
  };

  const handleFocusConnectForProfile = (acc: MalAccountSummary) => {
    setTargetProfileId(acc.profileId);
    if (acc.clientId) {
      setClientIdInput(acc.clientId);
      setClientIdError(null);
    }
    connectSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => clientIdInputRef.current?.focus(), 60);
  };

  const handleRefreshAccount = async (acc: MalAccountSummary) => {
    setRefreshingId(acc.profileId);
    onClearExternalStatus?.();
    setStatusMsg(null);
    try {
      const res = await api.refreshMalAccount(acc.profileId);
      setStatusMsg({
        type: 'success',
        text: `Token MAL aggiornato per ${acc.profileName}${res.account?.username ? ` (@${res.account.username})` : ''}.`,
      });
      await fetchAccounts();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || `Impossibile aggiornare il token MAL per ${acc.profileName}.`,
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleConfirmDisconnect = async () => {
    const acc = confirmDisconnect.account;
    if (!acc) return;

    setDisconnectingId(acc.profileId);
    onClearExternalStatus?.();
    setStatusMsg(null);
    try {
      await api.disconnectMalAccount(acc.profileId);
      setStatusMsg({
        type: 'success',
        text: `Account MAL scollegato dal profilo ${acc.profileName}. I dispositivi sincronizzati riceveranno la disconnessione.`,
      });
      setConfirmDisconnect({ isOpen: false, account: null });
      await fetchAccounts();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || `Impossibile scollegare MAL da ${acc.profileName}.`,
      });
    } finally {
      setDisconnectingId(null);
    }
  };

  const activeBanner = externalStatus || statusMsg;
  const connectedCount = accounts.filter((a) => a.connected).length;

  return (
    <div className="kuro-mal-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <style>{`
        .kuro-mal-view :is(a, button, input, select):focus-visible {
          outline: 2px solid #E50914;
          outline-offset: 2px;
        }
        .kuro-mal-guide-grid {
          display: grid;
          grid-template-columns: minmax(150px, 210px) 1fr;
          gap: 10px 14px;
          align-items: start;
        }
        @media (max-width: 640px) {
          .kuro-mal-guide-grid {
            grid-template-columns: 1fr;
            gap: 4px 0;
          }
        }
      `}</style>

      {/* Visually hidden polite live region for copy actions */}
      <span
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
        }}
      >
        {copyAnnouncement}
      </span>

      {/* Top Header */}
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
            ACCESSI MYANIMELIST ({connectedCount}/{accounts.length || profiles.length})
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
            ASSOCIAZIONI OAUTH PER PROFILO • SOLO CREDENZIALI (SINCRONIZZATE CON KUROTV_M)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href={MAL_API_CONFIG_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontFamily: FONT_MONO,
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: oledTheme.colors.text,
              backgroundColor: oledTheme.colors.surface,
              border: `1px solid ${oledTheme.colors.border}`,
              borderRadius: oledTheme.radius.sm,
              textDecoration: 'none',
              minHeight: '30px',
            }}
          >
            <ExternalLinkIcon size={13} aria-hidden="true" />
            APRI APICONFIG MAL
          </a>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fetchAccounts}
            loading={loading}
            icon={<RefreshIcon size={14} aria-hidden="true" />}
            aria-label="Aggiorna associazioni MyAnimeList"
          />
        </div>
      </div>

      {/* Live Status / Callback Banner */}
      {activeBanner && (
        <div
          role={activeBanner.type === 'error' ? 'alert' : 'status'}
          aria-live={activeBanner.type === 'error' ? 'assertive' : 'polite'}
          style={{
            padding: '12px 14px',
            backgroundColor:
              activeBanner.type === 'success'
                ? 'rgba(16, 185, 129, 0.14)'
                : activeBanner.type === 'error'
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(59, 130, 246, 0.14)',
            border: `1px solid ${
              activeBanner.type === 'success'
                ? '#10B981'
                : activeBanner.type === 'error'
                ? '#EF4444'
                : '#3B82F6'
            }`,
            borderRadius: oledTheme.radius.sm,
            color:
              activeBanner.type === 'success'
                ? '#10B981'
                : activeBanner.type === 'error'
                ? '#EF4444'
                : '#93C5FD',
            fontFamily: FONT_MONO,
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            textTransform: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {activeBanner.type === 'success' ? (
              <CheckIcon size={16} aria-hidden="true" />
            ) : activeBanner.type === 'error' ? (
              <AlertCircleIcon size={16} aria-hidden="true" />
            ) : (
              <RefreshIcon size={16} aria-hidden="true" />
            )}
            <span>{activeBanner.text}</span>
          </div>
          {activeBanner.type !== 'loading' && (
            <button
              type="button"
              onClick={() => {
                setStatusMsg(null);
                onClearExternalStatus?.();
              }}
              aria-label="Chiudi avviso"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                fontSize: '16px',
                cursor: 'pointer',
                padding: '2px 6px',
                minWidth: '28px',
                minHeight: '28px',
              }}
            >
              &times;
            </button>
          )}
        </div>
      )}

      {/* Card: Associate MAL via Client ID + Expandable Setup Guide */}
      <div ref={connectSectionRef}>
        <Card
          style={{
            border: `1px solid ${oledTheme.colors.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <h3
                id="mal-connect-heading"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  margin: '0 0 4px 0',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <LinkIcon size={16} color={oledTheme.colors.primary} aria-hidden="true" />
                ASSOCIA PROFILO TRAMITE CLIENT ID
              </h3>
              <p
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  color: oledTheme.colors.textMuted,
                  margin: 0,
                  textTransform: 'uppercase',
                }}
              >
                AUTENTICAZIONE OAUTH 2.0 PKCE DIRETTA DAL PANNELLO WEB
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsGuideOpen((v) => !v)}
              aria-expanded={isGuideOpen}
              aria-controls="mal-clientid-guide"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 12px',
                backgroundColor: oledTheme.colors.surface,
                border: `1px solid ${
                  isGuideOpen ? oledTheme.colors.primary : oledTheme.colors.border
                }`,
                borderRadius: oledTheme.radius.sm,
                color: '#FFFFFF',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                cursor: 'pointer',
                minHeight: '32px',
              }}
            >
              <HelpCircleIcon size={14} color={oledTheme.colors.primary} aria-hidden="true" />
              <span>{isGuideOpen ? 'NASCONDI GUIDA FORM MAL' : 'GUIDA COMPILAZIONE CLIENT ID'}</span>
              <span
                style={{
                  display: 'inline-flex',
                  transform: isGuideOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
              >
                <ChevronDownIcon size={14} aria-hidden="true" />
              </span>
            </button>
          </div>

          {/* Collapsible Form Guide matching myanimelist.net/apiconfig/create & KuroTV_M */}
          {isGuideOpen && (
            <div
              id="mal-clientid-guide"
              style={{
                backgroundColor: '#070707',
                border: `1px solid ${oledTheme.colors.border}`,
                borderLeft: `3px solid ${oledTheme.colors.primary}`,
                borderRadius: oledTheme.radius.sm,
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                  borderBottom: `1px solid ${oledTheme.colors.border}`,
                  paddingBottom: '12px',
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#FFFFFF',
                    textTransform: 'uppercase',
                  }}
                >
                  COME COMPILARE MYANIMELIST.NET/APICONFIG/CREATE
                </span>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <a
                    href={MAL_API_CONFIG_CREATE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 11px',
                      backgroundColor: oledTheme.colors.primary,
                      border: `1px solid ${oledTheme.colors.primary}`,
                      borderRadius: oledTheme.radius.sm,
                      color: '#FFFFFF',
                      fontFamily: FONT_MONO,
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                    }}
                  >
                    <ExternalLinkIcon size={12} aria-hidden="true" />
                    APRI CREA APP MAL
                  </a>

                  <a
                    href={MAL_API_CONFIG_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 11px',
                      backgroundColor: oledTheme.colors.surface,
                      border: `1px solid ${oledTheme.colors.border}`,
                      borderRadius: oledTheme.radius.sm,
                      color: oledTheme.colors.textSecondary,
                      fontFamily: FONT_MONO,
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                    }}
                  >
                    <ExternalLinkIcon size={12} aria-hidden="true" />
                    LE TUE APP
                  </a>
                </div>
              </div>

              <div className="kuro-mal-guide-grid" style={{ fontFamily: FONT_MONO, fontSize: '12px' }}>
                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  App Name *
                </span>
                <span style={{ color: '#FFFFFF', textTransform: 'none' }}>
                  Es. <code className="raw-token">KuroTV Sync</code> (nome libero)
                </span>

                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  App Type *
                </span>
                <span style={{ color: '#FFFFFF', textTransform: 'none' }}>
                  Seleziona{' '}
                  <strong style={{ color: '#10B981' }}>Android</strong> oppure{' '}
                  <strong style={{ color: '#10B981' }}>other</strong>{' '}
                  <span style={{ color: '#F59E0B' }}>
                    (NON &quot;web&quot;, altrimenti MAL genera un Client Secret incompatibile con
                    l&apos;app mobile KuroTV_M)
                  </span>
                </span>

                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  App Description *
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ color: oledTheme.colors.textSecondary, textTransform: 'none' }}>
                    50–500 caratteri, senza simboli o caratteri speciali. Esempio pronto (69 car.):
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <code
                      className="raw-token"
                      style={{
                        backgroundColor: '#121212',
                        border: `1px solid ${oledTheme.colors.border}`,
                        borderRadius: oledTheme.radius.xs,
                        padding: '5px 8px',
                        color: '#FFFFFF',
                        fontSize: '11px',
                      }}
                    >
                      {MAL_SAMPLE_DESCRIPTION}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        handleCopy('description', MAL_SAMPLE_DESCRIPTION, 'App Description')
                      }
                      aria-label={
                        copiedKey === 'description'
                          ? 'Copiato App Description'
                          : 'Copia App Description'
                      }
                      icon={
                        copiedKey === 'description' ? (
                          <CheckIcon size={12} color="#10B981" aria-hidden="true" />
                        ) : (
                          <CopyIcon size={12} aria-hidden="true" />
                        )
                      }
                    >
                      {copiedKey === 'description' ? 'COPIATO' : 'COPIA'}
                    </Button>
                  </div>
                </div>

                <span style={{ color: oledTheme.colors.primary, fontWeight: 700 }}>
                  App Redirect URL *
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ color: oledTheme.colors.textSecondary, textTransform: 'none' }}>
                    Inserisci entrambe le URL su righe separate (&quot;Separate multiple URLs with
                    line breaks&quot;) per usare lo stesso Client ID su Web Panel e Mobile:
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <code
                      className="raw-token"
                      style={{
                        backgroundColor: '#121212',
                        border: `1px solid ${oledTheme.colors.primary}`,
                        borderRadius: oledTheme.radius.xs,
                        padding: '5px 8px',
                        color: '#FFFFFF',
                        fontSize: '11px',
                      }}
                    >
                      {webRedirectUri}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        handleCopy('web-redirect', webRedirectUri, 'Redirect URL Web Panel')
                      }
                      icon={
                        copiedKey === 'web-redirect' ? (
                          <CheckIcon size={12} color="#10B981" aria-hidden="true" />
                        ) : (
                          <CopyIcon size={12} aria-hidden="true" />
                        )
                      }
                    >
                      {copiedKey === 'web-redirect' ? 'COPIATO' : 'COPIA WEB'}
                    </Button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <code
                      className="raw-token"
                      style={{
                        backgroundColor: '#121212',
                        border: `1px solid ${oledTheme.colors.border}`,
                        borderRadius: oledTheme.radius.xs,
                        padding: '5px 8px',
                        color: '#FFFFFF',
                        fontSize: '11px',
                      }}
                    >
                      {MAL_MOBILE_REDIRECT_URI}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        handleCopy(
                          'mobile-redirect',
                          MAL_MOBILE_REDIRECT_URI,
                          'Redirect URL KuroTV Mobile'
                        )
                      }
                      icon={
                        copiedKey === 'mobile-redirect' ? (
                          <CheckIcon size={12} color="#10B981" aria-hidden="true" />
                        ) : (
                          <CopyIcon size={12} aria-hidden="true" />
                        )
                      }
                    >
                      {copiedKey === 'mobile-redirect' ? 'COPIATO' : 'COPIA MOBILE'}
                    </Button>
                  </div>

                  <div>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() =>
                        handleCopy(
                          'both-redirects',
                          bothRedirectUris,
                          'Entrambe le Redirect URL'
                        )
                      }
                      icon={
                        copiedKey === 'both-redirects' ? (
                          <CheckIcon size={12} aria-hidden="true" />
                        ) : (
                          <CopyIcon size={12} aria-hidden="true" />
                        )
                      }
                    >
                      {copiedKey === 'both-redirects'
                        ? 'ENTRAMBE COPIATE!'
                        : 'COPIA ENTRAMBE LE URL (SU 2 RIGHE)'}
                    </Button>
                  </div>
                </div>

                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  Homepage URL *
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <code
                    className="raw-token"
                    style={{
                      backgroundColor: '#121212',
                      border: `1px solid ${oledTheme.colors.border}`,
                      borderRadius: oledTheme.radius.xs,
                      padding: '5px 8px',
                      color: '#FFFFFF',
                      fontSize: '11px',
                    }}
                  >
                    {webOrigin}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCopy('homepage', webOrigin, 'Homepage URL')}
                    aria-label={
                      copiedKey === 'homepage' ? 'Copiato Homepage URL' : 'Copia Homepage URL'
                    }
                    icon={
                      copiedKey === 'homepage' ? (
                        <CheckIcon size={12} color="#10B981" aria-hidden="true" />
                      ) : (
                        <CopyIcon size={12} aria-hidden="true" />
                      )
                    }
                  >
                    {copiedKey === 'homepage' ? 'COPIATO' : 'COPIA'}
                  </Button>
                </div>

                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  Logo / Privacy / Terms
                </span>
                <span style={{ color: oledTheme.colors.textMuted, textTransform: 'none' }}>
                  Facoltativi (puoi lasciarli vuoti)
                </span>

                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  Commercial *
                </span>
                <span style={{ color: '#FFFFFF', textTransform: 'none' }}>
                  <strong>non-commercial</strong>
                </span>

                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  Name / Company *
                </span>
                <span style={{ color: '#FFFFFF', textTransform: 'none' }}>
                  Il tuo nome o nickname
                </span>

                <span style={{ color: oledTheme.colors.textSecondary, fontWeight: 700 }}>
                  Purpose of Use *
                </span>
                <span style={{ color: '#FFFFFF', textTransform: 'none' }}>
                  <strong>hobbyist</strong> (oppure personal)
                </span>
              </div>
            </div>
          )}

          {/* Association Form */}
          <form
            onSubmit={handleConnectSubmit}
            aria-labelledby="mal-connect-heading"
            noValidate
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '14px',
              }}
            >
              {/* Profile Select */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label
                  htmlFor="mal-profile-select"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    fontWeight: 700,
                    color: oledTheme.colors.textSecondary,
                    textTransform: 'uppercase',
                  }}
                >
                  PROFILO DESTINAZIONE *
                </label>
                <span
                  id="mal-profile-hint"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '10px',
                    color: oledTheme.colors.textMuted,
                    textTransform: 'none',
                  }}
                >
                  Ogni profilo mantiene un accesso e token MAL indipendente.
                </span>
                <select
                  id="mal-profile-select"
                  name="profileId"
                  required
                  aria-describedby="mal-profile-hint"
                  value={targetProfileId}
                  onChange={(e) => setTargetProfileId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#050505',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    color: '#FFFFFF',
                    fontFamily: FONT_MONO,
                    fontSize: '13px',
                    cursor: 'pointer',
                    minHeight: '42px',
                  }}
                >
                  {profiles.map((p) => {
                    const acc = accounts.find((a) => a.profileId === p.id);
                    const malLabel = acc?.connected
                      ? acc.username
                        ? ` (@${acc.username})`
                        : ' (CONNESSO)'
                      : ' (NON ASSOCIATO)';
                    return (
                      <option
                        key={p.id}
                        value={p.id}
                        style={{ backgroundColor: '#121212', color: '#FFFFFF' }}
                      >
                        {p.name}
                        {malLabel}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Client ID Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label
                  htmlFor="mal-client-id"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    fontWeight: 700,
                    color: oledTheme.colors.textSecondary,
                    textTransform: 'uppercase',
                  }}
                >
                  CLIENT ID MYANIMELIST *
                </label>
                <span
                  id="mal-client-id-hint"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '10px',
                    color: oledTheme.colors.textMuted,
                    textTransform: 'none',
                  }}
                >
                  16–128 caratteri alfanumerici da apiconfig. Non serve alcun Client Secret.
                </span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    ref={clientIdInputRef}
                    id="mal-client-id"
                    name="clientId"
                    type="text"
                    required
                    minLength={16}
                    maxLength={128}
                    pattern="[A-Za-z0-9]{16,128}"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    enterKeyHint="done"
                    className="raw-token"
                    value={clientIdInput}
                    onChange={(e) => handleClientIdChange(e.target.value)}
                    onBlur={handleClientIdBlur}
                    aria-invalid={clientIdError ? 'true' : 'false'}
                    aria-describedby={
                      clientIdError
                        ? 'mal-client-id-hint mal-client-id-error'
                        : 'mal-client-id-hint'
                    }
                    placeholder="Incolla il Client ID MAL..."
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#050505',
                      border: `1px solid ${
                        clientIdError
                          ? '#EF4444'
                          : isValidMalClientId(clientIdInput)
                          ? '#10B981'
                          : oledTheme.colors.border
                      }`,
                      borderRadius: oledTheme.radius.sm,
                      color: '#FFFFFF',
                      fontFamily: FONT_MONO,
                      fontSize: '13px',
                      minHeight: '42px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                {clientIdError && (
                  <div
                    id="mal-client-id-error"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontFamily: FONT_MONO,
                      fontSize: '11px',
                      color: '#EF4444',
                      textTransform: 'none',
                    }}
                  >
                    <AlertCircleIcon size={13} aria-hidden="true" />
                    <span>{clientIdError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick-fill pills from existing linked profiles */}
            {distinctSavedClientIds.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                }}
              >
                <span style={{ color: oledTheme.colors.textMuted }}>CLIENT ID IN USO:</span>
                {distinctSavedClientIds.map((entry) => (
                  <button
                    key={entry.clientId}
                    type="button"
                    onClick={() => {
                      setClientIdInput(entry.clientId);
                      setClientIdError(null);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 9px',
                      backgroundColor: '#141414',
                      border: `1px solid ${
                        normalizeMalClientId(clientIdInput) === entry.clientId
                          ? '#10B981'
                          : oledTheme.colors.border
                      }`,
                      borderRadius: oledTheme.radius.xs,
                      color: '#FFFFFF',
                      fontFamily: FONT_MONO,
                      fontSize: '11px',
                      cursor: 'pointer',
                      textTransform: 'none',
                    }}
                  >
                    <KeyIcon size={11} aria-hidden="true" />
                    <span>
                      {entry.label}: {formatClientIdPreview(entry.clientId)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                borderTop: `1px solid ${oledTheme.colors.border}`,
                paddingTop: '12px',
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '11px',
                  color: selectedAccount?.connected ? '#F59E0B' : oledTheme.colors.textMuted,
                  textTransform: 'none',
                }}
              >
                {selectedAccount?.connected
                  ? `Il profilo è già collegato${
                      selectedAccount.username ? ` a @${selectedAccount.username}` : ''
                    }: procedendo verrà sostituito l'accesso corrente.`
                  : 'Verrai reindirizzato su MyAnimeList per autorizzare il profilo e tornerai qui automaticamente.'}
              </span>

              <Button
                type="submit"
                variant="primary"
                loading={isConnecting}
                icon={<ExternalLinkIcon size={14} aria-hidden="true" />}
              >
                {selectedAccount?.connected ? 'RICOLLEGA ACCOUNT MAL' : 'CONNETTI CON MYANIMELIST'}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Per-Profile MAL Access & Association Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '16px',
        }}
      >
        {accounts.map((acc) => {
          const isActiveProfile = acc.profileId === activeProfileId;
          const isSelectedTarget = acc.profileId === targetProfileId;
          const clientCopyKey: CopyKey = `client-${acc.profileId}`;
          const canShowPicture = Boolean(acc.picture && !brokenPictures[acc.profileId]);

          return (
            <Card
              key={acc.profileId}
              style={{
                border: `1px solid ${
                  isSelectedTarget
                    ? oledTheme.colors.primary
                    : acc.connected
                    ? oledTheme.colors.border
                    : '#1F1F1F'
                }`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '14px',
              }}
            >
              {/* Profile Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: acc.avatarColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#FFFFFF',
                      fontFamily: FONT_MONO,
                      fontWeight: 700,
                      fontSize: '14px',
                      flexShrink: 0,
                    }}
                  >
                    {acc.profileName.charAt(0).toUpperCase()}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: '14px',
                          fontWeight: 700,
                          color: '#FFFFFF',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {acc.profileName}
                      </span>
                      {isActiveProfile && <Badge variant="info">ATTIVO</Badge>}
                    </div>
                  </div>
                </div>

                <Badge variant={acc.connected ? (acc.isExpired ? 'warning' : 'success') : 'default'}>
                  {acc.connected ? (acc.isExpired ? 'TOKEN SCADUTO' : 'CONNESSO') : 'NON ASSOCIATO'}
                </Badge>
              </div>

              {/* MAL Account Details or Empty State */}
              {acc.connected ? (
                <div
                  style={{
                    backgroundColor: '#121212',
                    border: `1px solid ${oledTheme.colors.border}`,
                    borderRadius: oledTheme.radius.sm,
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {canShowPicture ? (
                      <img
                        src={acc.picture!}
                        alt={`Avatar MyAnimeList di ${acc.username || acc.profileName}`}
                        onError={() =>
                          setBrokenPictures((prev) => ({ ...prev, [acc.profileId]: true }))
                        }
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '6px',
                          objectFit: 'cover',
                          border: `1px solid ${oledTheme.colors.border}`,
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '6px',
                          backgroundColor: '#1B1B1B',
                          border: `1px solid ${oledTheme.colors.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: oledTheme.colors.textSecondary,
                          flexShrink: 0,
                        }}
                      >
                        <UserIcon size={18} aria-hidden="true" />
                      </div>
                    )}

                    <div style={{ minWidth: 0, flex: 1 }}>
                      {acc.username ? (
                        <a
                          href={`https://myanimelist.net/profile/${encodeURIComponent(acc.username)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="raw-token"
                          style={{
                            color: '#FFFFFF',
                            fontFamily: FONT_MONO,
                            fontSize: '13px',
                            fontWeight: 700,
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                          }}
                        >
                          <span>@{acc.username}</span>
                          <ExternalLinkIcon size={12} color={oledTheme.colors.textMuted} aria-hidden="true" />
                        </a>
                      ) : (
                        <span
                          style={{
                            color: '#FFFFFF',
                            fontFamily: FONT_MONO,
                            fontSize: '13px',
                            fontWeight: 700,
                          }}
                        >
                          UTENTE MYANIMELIST
                        </span>
                      )}
                      {acc.userId ? (
                        <div
                          style={{
                            fontFamily: FONT_MONO,
                            fontSize: '10px',
                            color: oledTheme.colors.textMuted,
                            marginTop: '2px',
                          }}
                        >
                          MAL ID #{acc.userId}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      borderTop: `1px solid ${oledTheme.colors.border}`,
                      paddingTop: '8px',
                      fontFamily: FONT_MONO,
                      fontSize: '11px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span style={{ color: oledTheme.colors.textMuted }}>CLIENT ID:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <code className="raw-token" style={{ color: '#FFFFFF' }}>
                          {acc.clientId ? formatClientIdPreview(acc.clientId) : 'N/D'}
                        </code>
                        {acc.clientId && (
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(
                                clientCopyKey,
                                acc.clientId!,
                                `Client ID profilo ${acc.profileName}`
                              )
                            }
                            aria-label={`Copia Client ID di ${acc.profileName}`}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${oledTheme.colors.border}`,
                              borderRadius: oledTheme.radius.xs,
                              color:
                                copiedKey === clientCopyKey
                                  ? '#10B981'
                                  : oledTheme.colors.textSecondary,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: '24px',
                              minHeight: '24px',
                              padding: '2px',
                            }}
                          >
                            {copiedKey === clientCopyKey ? (
                              <CheckIcon size={12} color="#10B981" aria-hidden="true" />
                            ) : (
                              <CopyIcon size={12} aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ color: oledTheme.colors.textMuted }}>SCADENZA:</span>
                      <span
                        style={{
                          color: acc.isExpired ? '#F59E0B' : '#FFFFFF',
                          textTransform: 'none',
                        }}
                      >
                        {formatDateTime(acc.expiresAt)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ color: oledTheme.colors.textMuted }}>AGGIORNATO:</span>
                      <span style={{ color: oledTheme.colors.textSecondary, textTransform: 'none' }}>
                        {formatDateTime(acc.updatedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: '#090909',
                    border: '1px dashed #262626',
                    borderRadius: oledTheme.radius.sm,
                    padding: '14px',
                    fontFamily: FONT_MONO,
                    fontSize: '11px',
                    color: oledTheme.colors.textMuted,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <span>NESSUN ACCOUNT MYANIMELIST ASSOCIATO A QUESTO PROFILO.</span>
                  {acc.revokedAt ? (
                    <span style={{ fontSize: '10px', textTransform: 'none' }}>
                      Scollegato il {formatDateTime(acc.revokedAt)} (tombstone attivo per i device).
                    </span>
                  ) : null}
                </div>
              )}

              {/* Profile Card Actions */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  borderTop: `1px solid ${oledTheme.colors.border}`,
                  paddingTop: '10px',
                }}
              >
                {acc.connected ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={refreshingId === acc.profileId}
                      onClick={() => handleRefreshAccount(acc)}
                      icon={<RefreshIcon size={12} aria-hidden="true" />}
                      aria-label={`Aggiorna token MAL (${acc.profileName})`}
                    >
                      AGGIORNA
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleFocusConnectForProfile(acc)}
                      icon={<LinkIcon size={12} aria-hidden="true" />}
                      aria-label={`Ricollega MAL (${acc.profileName})`}
                    >
                      RICOLLEGA
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      loading={disconnectingId === acc.profileId}
                      onClick={() => setConfirmDisconnect({ isOpen: true, account: acc })}
                      icon={<TrashIcon size={12} aria-hidden="true" />}
                      aria-label={`Disconnetti MAL (${acc.profileName})`}
                    >
                      DISCONNETTI
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => handleFocusConnectForProfile(acc)}
                    icon={<LinkIcon size={12} aria-hidden="true" />}
                    aria-label={`Associa MAL (${acc.profileName})`}
                  >
                    ASSOCIA MAL
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Confirm Disconnect Modal */}
      <ConfirmModal
        isOpen={confirmDisconnect.isOpen}
        onClose={() => setConfirmDisconnect({ isOpen: false, account: null })}
        onConfirm={handleConfirmDisconnect}
        title="DISCONNETTI MYANIMELIST"
        message={`Vuoi scollegare l'account MAL${
          confirmDisconnect.account?.username
            ? ` (@${confirmDisconnect.account.username})`
            : ''
        } dal profilo "${confirmDisconnect.account?.profileName || ''}"?`}
        submessage="I token verranno rimossi e verrà registrato un tombstone di disconnessione verso KuroTV Mobile. Cronologia e preferiti restano intatti."
        confirmLabel="DISCONNETTI MAL"
        variant="danger"
        loading={!!disconnectingId}
      />
    </div>
  );
};
