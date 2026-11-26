# AGENTS.md — Architettura, Regole & Linee Guida per KuroTV_S

Questo documento definisce le regole architetturali, i vincoli di dominio, gli standard di sicurezza e le procedure operative per **KuroTV_S** (backend di sincronizzazione self-hosted su Cloudflare Workers + Hono + D1, OLED Web Console e SDK `@kurosync/sync-client`).

---

## 1. Architettura & Stack

- **Runtime Backend**: Cloudflare Workers + [Hono](https://hono.dev/) (`src/worker/index.ts`, `src/worker/routes/*`, `src/worker/middleware/auth.ts`).
- **Database**: Cloudflare D1 (SQLite serverless) con migrazioni incrementali in `migrations/` e bootstrap idempotente `ensureSchema()` in `src/worker/schema.ts`.
- **Web Console OLED**: React 19 + TypeScript + Vite (`src/client/*`), servita tramite Workers Static Assets (`ASSETS` binding, `run_worker_first: ["/api/*"]`). Design OLED pitch-black (`#000000`, `#121212`, `#E50914`), tipografia monospace uppercase e modali di conferma in-app (`ConfirmModal.tsx`).
- **Client SDK Condiviso**: `packages/sync-client` (`@kurosync/sync-client`) — puro TypeScript con zero dipendenze runtime, compatibile con Hermes, React Native MMKV, Android TV, Node.js e browser. **Vietato** importare moduli `node:*` in `packages/sync-client/src/*` o `src/worker/*`.

---

## 2. Regole Cloudflare Workers, D1 & Configurazione

1. **Zero Hardcoded Secrets & Zero `database_id` Statico**:
   - È tassativamente vietato inserire segreti, token o credenziali applicative (inclusi segreti Master, admin o client/app secret MyAnimeList) nel codice sorgente o in `wrangler.jsonc`.
   - `wrangler.jsonc` mantiene il binding dinamico `"binding": "DB"`, `"database_name": "kurosync-db"`, `"migrations_dir": "migrations"` senza `database_id` hardcoded (supporto fork & Deploy Button).
   - Mantenere `observability.enabled: true` e `observability.traces.enabled: true` in `wrangler.jsonc`.
   - Dopo qualsiasi modifica ai binding in `wrangler.jsonc`, rigenerare i tipi con `npm run cf-typegen` (`wrangler types`).

2. **Allineamento Obbligatorio Migrazioni D1 & `schema.ts`**:
   - Ogni modifica allo schema D1 deve avere sia una migrazione esplicita in `migrations/000X_*.sql` sia il corrispondente aggiornamento in `INIT_SCHEMA_SQL` e nei tipi di `src/worker/schema.ts`.
   - Quando si ricostruisce una tabella SQLite per modificare vincoli `CHECK` (es. `tombstones` in `0003_mal_auth.sql`), preservare sempre tutte le colonne esistenti (`deleted_at`, `server_deleted_at`), copiare i dati prima di `DROP TABLE` + `ALTER TABLE ... RENAME TO ...` e ricreare tutti gli indici.
   - **Prima del deploy**, verificare e applicare sempre le migrazioni su D1 locale (`npx wrangler d1 migrations apply DB --local`) e remoto (`npx wrangler d1 migrations apply DB --remote`). Il comando `npm run deploy` esegue prima `wrangler d1 migrations apply DB --remote` e poi `wrangler deploy`.

3. **Compliance Cloudflare Free Tier (`db.batch <= 50`)**:
   - Ogni `c.env.DB.batch(...)` in `sync.ts` e `backup.ts` deve rispettare il chunking `<= 50` statement per invocazione.
   - Preservare i task di manutenzione automatica in `src/worker/maintenance.ts`: purge dei tombstones più vecchi di 90 giorni (`purgeOldTombstones`) e dei codici di pairing scaduti/consumati oltre le 24 ore (`purgeExpiredPairingCodes`).

4. **Sicurezza & Crittografia Web Crypto**:
   - Autenticazione Master via `SYNC_ADMIN_SECRET` (se configurato) oppure PBKDF2-SHA256 (100.000 iterazioni, salt random 16 byte in `instance_config`), con confronto timing-safe (`crypto.subtle.timingSafeEqual`).
   - I token dispositivo vengono salvati esclusivamente come hash SHA-256 (`devices.token_hash`).
   - I token QR monouso (`/api/auth/qr-token` -> `/api/auth/exchange`) e i codici pairing TV (`/api/pair/*`) devono essere consumati atomicamente (`UPDATE ... WHERE status = 'approved'`).

---

## 3. Regole di Dominio & Protocollo KuroSync

1. **Isolamento Stretto per `profile_id`**:
   - Tutte le tabelle dati utente (`favorites`, `continue_watching`, `watch_history`, `watch_progress`, `shared_settings`, `mal_auth`, `tombstones`) sono isolate per `profile_id` con `ON DELETE CASCADE` verso `profiles(id)` e rimozione esplicita nel batch atomico di `DELETE /api/profiles/:id` (`src/worker/routes/profiles.ts`).
   - L'override del profilo via `X-Profile-Id`, `?profileId=` o `body.profileId` è consentito esclusivamente alle sessioni `device_type = 'web'` e solo per ID profilo validi esistenti; per dispositivi `mobile`/`tv` fa fede unicamente il `profile_id` associato al token dispositivo. Non fidarsi mai di campi `profileId` annidati nei payload entità (es. `malAuth.profileId`).

2. **Regole Specifiche MyAnimeList Auth (`malAuth`)**:
   - **Scope esclusivo credenziali**: sincronizzare e salvare **SOLO** lo stato/credenziali auth MAL (`clientId`, `accessToken`, `refreshToken`, `expiresAt`, `tokenType`, `username`, `userId`, `picture`, `updatedAt`, più tombstone `'mal_auth'`). **MAI** sincronizzare o salvare liste MAL, cache episodi, impostazioni MAL o highwater locale.
   - **Validazione push**: se `malAuth` è presente (diverso da `null`/`undefined`) in `POST /api/sync/push`, validare che `clientId`, `accessToken` e `refreshToken` siano stringhe non vuote (`400` se non valide). `malAuth: null` nel push va ignorato senza errore (le cancellazioni passano da `deletions`).
   - **Capability Detection in `GET /api/sync/pull`**: la chiave `malAuth` deve essere **SEMPRE** presente dentro `deltas` (`MalAuthSyncRecord | null`), così `KuroTV_M` rileva automaticamente la capability del server tramite `'malAuth' in remotePull.deltas`. `malAuth: null` indica assenza o nessuna modifica dopo `since` (non una cancellazione) — in `mergeLocalAndRemote()` un `remote.deltas.malAuth === null` preserva il `local.malAuth` esistente se non è presente un tombstone dominante.
   - **LWW & Tombstones `mal_auth`**:
     - `POST /api/sync/push` risolve LWW con `incoming.updatedAt >= existing.updated_at` e blocca i push con `itemUpdatedAt <= tombstone.deleted_at`.
     - Il tombstone `'mal_auth'` viene invalidato solo quando arriva un `malAuth` legittimo con `updatedAt > tombstone.deleted_at` (re-login).
     - `deletions` accetta `type === 'mal_auth'` (default `key = 'default'`), elimina la riga `mal_auth` solo se `updated_at <= deletedAt` e registra il tombstone con `deleted_at` e `server_deleted_at`.
     - `mergeLocalAndRemote()` in `packages/sync-client/src/merge.ts` gestisce la dominanza di `'mal_auth:default'` e `'mal_auth:malAuth'` e LWW su `malAuth.updatedAt`.

3. **Doppio Clock: Logico Client vs Cursore di Replica Server**:
   - LWW e dominanza tombstones usano il timestamp logico client (`updated_at` / `deleted_at`).
   - Le query delta `GET /api/sync/pull?since=...` usano il cursore di replica server (`server_updated_at > since` / `server_deleted_at > since`, con fallback `OR updated_at > since` / `OR deleted_at > since`) calcolato via `computeServerTimestamp(now, clientTime)`, garantendo che modifiche/cancellazioni effettuate offline con clock precedente all'ultimo `serverTime` vengano comunque propagate agli altri dispositivi.

4. **Backup & Ripristino (`/api/sync/export`, `/api/sync/import`)**:
   - Mantenere retrocompatibilità negli import di backup legacy che non includono `malAuth`.
   - Gestire il ripristino sia dei record `malAuth` sia dei tombstones `'mal_auth'`.

---

## 4. Pipeline di Verifica & Rilascio

Prima di qualsiasi commit, rilascio o deploy, eseguire e verificare senza errori:

```bash
npm run typecheck
npm run build
npm test
npx wrangler deploy --dry-run
```

Per creare un commit verificato e inviarlo su GitHub (`origin`):

```bash
./release.sh -m "feat: descrizione sintetica"
```

Flag supportati da `./release.sh`:
- `-m, --message "<msg>"`: messaggio di commit (se omesso viene richiesto interattivamente).
- `--skip-checks`: salta `typecheck`, `build` e `test`.
- `--no-push`: esegue solo il commit locale senza `git push`.
- `--deploy`: esegue `npm run deploy` dopo il push su GitHub.
- `--dry-run`: esegue le verifiche e mostra lo stato senza alterare git o effettuare push.
- `-y, --yes`: salta la conferma interattiva.
