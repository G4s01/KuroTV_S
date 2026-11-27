import { api, type MalAccountSummary } from './api';

export const MAL_OAUTH_AUTHORIZE_URL = 'https://myanimelist.net/v1/oauth2/authorize';
export const MAL_API_CONFIG_URL = 'https://myanimelist.net/apiconfig';
export const MAL_API_CONFIG_CREATE_URL = 'https://myanimelist.net/apiconfig/create';
export const MAL_MOBILE_REDIRECT_URI = 'kurotv://mal-callback';
export const MAL_SAMPLE_DESCRIPTION =
  'Client personale per sincronizzare anime visti e preferiti con KuroTV';

const PENDING_OAUTH_STORAGE_KEY = 'kurosync_mal_oauth_pending';
const LAST_CLIENT_ID_STORAGE_KEY = 'kurosync_mal_last_client_id';
const PENDING_TTL_MS = 15 * 60 * 1000;

const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const STATE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export interface PendingMalOAuth {
  state: string;
  codeVerifier: string;
  clientId: string;
  profileId: string;
  redirectUri: string;
  createdAt: number;
}

export function getWebMalRedirectUri(): string {
  if (typeof window === 'undefined') {
    return 'https://kurosync.workers.dev/mal-callback';
  }
  return `${window.location.origin}/mal-callback`;
}

export function getWebOriginUrl(): string {
  if (typeof window === 'undefined') {
    return 'https://github.com/G4s01/KuroTV_S';
  }
  return window.location.origin;
}

export function normalizeMalClientId(raw?: string | null): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function isValidMalClientId(raw?: string | null): boolean {
  return /^[a-zA-Z0-9]{16,128}$/.test(normalizeMalClientId(raw));
}

export function getSavedMalClientId(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  return normalizeMalClientId(window.localStorage.getItem(LAST_CLIENT_ID_STORAGE_KEY));
}

export function saveLastMalClientId(clientId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const clean = normalizeMalClientId(clientId);
  if (clean) {
    window.localStorage.setItem(LAST_CLIENT_ID_STORAGE_KEY, clean);
  }
}

function generateSecureRandomString(length: number, charset: string): string {
  const charsetLen = charset.length;
  const maxValidByte = 256 - (256 % charsetLen);
  let result = '';

  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    while (result.length < length) {
      const buf = new Uint8Array(Math.max(16, length * 2));
      window.crypto.getRandomValues(buf);
      for (let i = 0; i < buf.length && result.length < length; i++) {
        if (buf[i] < maxValidByte) {
          result += charset[buf[i] % charsetLen];
        }
      }
    }
    return result;
  }

  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charsetLen)];
  }
  return result;
}

export function beginMalOAuthRedirect(params: {
  profileId: string;
  clientId: string;
}): string {
  const clientId = normalizeMalClientId(params.clientId);
  const codeVerifier = generateSecureRandomString(64, PKCE_CHARSET);
  const state = generateSecureRandomString(32, STATE_CHARSET);
  const redirectUri = getWebMalRedirectUri();

  const pending: PendingMalOAuth = {
    state,
    codeVerifier,
    clientId,
    profileId: params.profileId,
    redirectUri,
    createdAt: Date.now(),
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(PENDING_OAUTH_STORAGE_KEY, JSON.stringify(pending));
  }
  saveLastMalClientId(clientId);

  const url = new URL(MAL_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', codeVerifier);
  url.searchParams.set('code_challenge_method', 'plain');
  return url.toString();
}

export interface MalCallbackOutcome {
  ok: boolean;
  profileId?: string;
  account?: MalAccountSummary;
  message: string;
}

const inflightExchanges = new Map<string, Promise<MalCallbackOutcome>>();

export function completeMalOAuthFromSearch(search: string): Promise<MalCallbackOutcome> {
  const params = new URLSearchParams(search);
  const code = params.get('code')?.trim() || '';
  const state = params.get('state')?.trim() || '';
  const error = params.get('error')?.trim() || '';
  const errorDescription = params.get('error_description')?.trim() || '';

  const dedupeKey = `${code}:${state}:${error}`;
  const existing = inflightExchanges.get(dedupeKey);
  if (existing) {
    return existing;
  }

  const run = async (): Promise<MalCallbackOutcome> => {
    let pending: PendingMalOAuth | null = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(PENDING_OAUTH_STORAGE_KEY);
        window.localStorage.removeItem(PENDING_OAUTH_STORAGE_KEY);
        if (raw) {
          pending = JSON.parse(raw) as PendingMalOAuth;
        }
      } catch {
        pending = null;
      }
    }

    if (error) {
      const detail = errorDescription || error;
      return {
        ok: false,
        profileId: pending?.profileId,
        message:
          error === 'access_denied'
            ? 'Autorizzazione annullata su MyAnimeList.'
            : `Errore MyAnimeList: ${detail}`,
      };
    }

    if (!pending || !pending.createdAt || Date.now() - pending.createdAt > PENDING_TTL_MS) {
      return {
        ok: false,
        message: 'Sessione OAuth MAL scaduta o mancante. Avvia nuovamente il collegamento.',
      };
    }

    if (!state || state !== pending.state) {
      return {
        ok: false,
        profileId: pending.profileId,
        message: 'Verifica di sicurezza CSRF (state) fallita. Riprova.',
      };
    }

    if (!code) {
      return {
        ok: false,
        profileId: pending.profileId,
        message: 'Codice di autorizzazione mancante nel callback di MyAnimeList.',
      };
    }

    try {
      const res = await api.exchangeMalOAuth({
        profileId: pending.profileId,
        clientId: pending.clientId,
        code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
      });

      const userLabel = res.account?.username ? `@${res.account.username}` : 'account MAL';
      return {
        ok: true,
        profileId: pending.profileId,
        account: res.account,
        message: `${userLabel} associato al profilo ${res.account?.profileName || ''}`.trim(),
      };
    } catch (err: any) {
      const msg = String(err?.message || 'Scambio token MyAnimeList fallito.');
      const errCode = String(err?.data?.errorCode || '').toLowerCase();
      const needsPublicType =
        errCode === 'invalid_client' ||
        msg.toLowerCase().includes('secret') ||
        msg.toLowerCase().includes('invalid_client');

      return {
        ok: false,
        profileId: pending.profileId,
        message: needsPublicType
          ? `${msg} (Verifica che su MyAnimeList "App Type" sia "Android" o "other", non "web", e che la Redirect URL corrisponda esattamente.)`
          : msg,
      };
    }
  };

  const promise = run();
  inflightExchanges.set(dedupeKey, promise);
  setTimeout(() => inflightExchanges.delete(dedupeKey), 60_000);
  return promise;
}

function legacyCopyFallback(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.parentNode?.removeChild(field);
    previousFocus?.focus?.({ preventScroll: true });
  }
}

export async function copyTextSafe(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopyFallback(text);
    }
  }
  return legacyCopyFallback(text);
}
