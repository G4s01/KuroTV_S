<div align="center">

<img src="public/icon.png" width="84" alt="KuroTV_S Icon" />

# ⚡ KuroTV Sync Server (KuroTV_S)

### _Backend serverless self-hosted per la sincronizzazione multi-dispositivo su Cloudflare Workers + D1, con Console Web OLED._

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/G4s01/KuroTV_S)

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare%20D1-F38020?style=for-the-badge&logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Hono](https://img.shields.io/badge/Framework-Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React 19](https://img.shields.io/badge/Console-React%2019-23272F?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/SDK-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](./packages/sync-client)
[![Free Tier](https://img.shields.io/badge/Cloudflare-Free%20Tier%20Ready-10B981?style=for-the-badge)](https://developers.cloudflare.com/workers/platform/pricing/)
[![License MIT](https://img.shields.io/badge/License-MIT-E50914?style=for-the-badge)](https://opensource.org/licenses/MIT)

<br />

**KuroTV_S** è il backend personale e self-hosted progettato per sincronizzare in tempo reale **KuroTV Mobile (`KuroTV_M`)** e **KuroTV Android TV (`KuroTV_TV`)** sul piano gratuito di Cloudflare, senza dipendere da server centrali di terze parti.

</div>

---

## 🌐 L'Ecosistema Kuro

Kuro è una suite coordinata per lo streaming anime concepita per coprire ogni schermo con sincronizzazione privata e deterministica:

| Progetto | Piattaforma | Focus & Caratteristiche | Repository |
| :--- | :--- | :--- | :--- |
| **📱 KuroTV_M** | **Android Phone & Tablet** | Touch-native 120 FPS, Live Scrubbing, capitoli YouTube, download SAF, AniSkip. | [**G4s01/KuroTV_M**](https://github.com/G4s01/KuroTV_M) |
| **📺 KuroTV_T** | **Android TV & Google TV** | Interfaccia leanback 100% D-Pad, navigazione spaziale fluida, ExoPlayer TV. | [**G4s01/KuroTV_T**](https://github.com/G4s01/KuroTV_T) |
| **⚡ KuroTV_S** | **Cloudflare Workers + D1** | Backend serverless, delta sync deterministico, profili Netflix-style, pairing TV. | [**G4s01/KuroTV_S**](https://github.com/G4s01/KuroTV_S) |
| **🖥️ KuroTV_D** | **Desktop (In programma)** | Client desktop multipiattaforma in fase di pianificazione e sviluppo. | _In arrivo_ |

---

## ✨ Funzionalità Chiave

### ☁️ Delta Sync Deterministico & Multi-Profilo
- **Isolamento Totale per Profilo**: preferiti, *Continua a guardare*, cronologia, progressi per puntata, impostazioni condivise, credenziali MAL e tombstones sono isolati per `profile_id` con pulizia atomica su `DELETE /api/profiles/:id`.
- **Doppio Clock Client / Server**: risoluzione **Last-Write-Wins (LWW)** sul timestamp logico client (`updated_at`) e replicazione delta su cursore server (`server_updated_at` / `server_deleted_at`) per evitare *delta miss* su dispositivi offline.
- **Protezione Progressi & "IN PARI"**: salvaguardia temporale contro regressioni di episodio/minutaggio, conservazione del completamento e propagazione dello stato `isCaughtUp`.
- **Tombstone Dominance (90 giorni)**: cancellazioni propagate in modo deterministico su tutti i dispositivi con auto-purge periodico.

### 🔐 Sync Credenziali MyAnimeList (`malAuth`) & Gestione Web Panel
- **Solo Stato & Token Auth**: sincronizza esclusivamente i dati OAuth MAL per singolo profilo (`clientId`, `accessToken`, `refreshToken`, `expiresAt`, `tokenType`, `username`, `userId`, `picture`, `updatedAt`, più tombstone `'mal_auth'`).
- **Zero Dati Ridondanti & Zero Segreti Hardcoded**: nessuna lista anime, cache episodi, impostazione MAL o highwater locale viene inviato al server, e nessun segreto applicativo è presente nel Worker.
- **Capability Detection Automatica**: `GET /api/sync/pull` espone sempre la chiave `deltas.malAuth` (`MalAuthSyncRecord | null`), rilevata nativamente da `KuroTV_M`.
- **Associazione Diretta dalla Console Web**: nella tab `MYANIMELIST` è presente la gestione accessi per profilo (stato token, rinnovo `@me`/refresh, ricollegamento e disconnessione sincronizzata verso mobile), collegamento OAuth 2.0 PKCE tramite `Client ID` con callback dinamica `<origin>/mal-callback` e guida rapida campo-per-campo per `myanimelist.net/apiconfig/create`.

### 📺 Simple-Login Pairing & Sicurezza Web Crypto
- **Accoppiamento Android TV**: codici brevi da 6 caratteri senza caratteri ambigui (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) e QR `/pair` con consumo atomico.
- **QR Connect Smartphone Monouso**: token effimeri `qr_*` con TTL di 5 minuti scambiati atomicamente una sola volta via `/api/auth/exchange`.
- **Crittografia Nativa**: PBKDF2-SHA256 (100.000 iterazioni, salt random 16 byte), confronti timing-safe (`crypto.subtle.timingSafeEqual`), hash SHA-256 per i token dispositivo e supporto opzionale `SYNC_ADMIN_SECRET`.

### 🖤 Console Web OLED & Disaster Recovery
- **Design Nero Assoluto (`#000000`)**: dashboard React 19 + Vite con card `#121212`, accenti `#E50914`, tipografia monospace uppercase e modali di conferma in-app (`ConfirmModal`).
- **Navigazione URL Persistente**: ogni sezione (`/library`, `/library/favorites`, `/library/history`, `/profiles`, `/devices`, `/mal`, `/backup`, `/pair`) è sincronizzata con la History API e il fallback SPA Cloudflare Workers, mantenendo la sezione attiva al reload della pagina, sui tasti Avanti/Indietro e tramite deep link.
- **Gestione Completa**: selettore profili, libreria per profilo, associazioni e accessi MyAnimeList (`Client ID` + OAuth PKCE), revoca/rinomina dispositivi, esportazione e ripristino snapshot JSON completo (`/api/sync/export` & `/api/sync/import`).

---

## ⚡ Avvio Rapido & Auto-Deploy

### 1. Deploy su Cloudflare Workers (One-Click o Fork Auto-Sync)
1. Premi **Deploy to Cloudflare Workers** in cima alla pagina, oppure esegui un **Fork** del repository.
2. Collega il fork su [Cloudflare Dashboard](https://dash.cloudflare.com/) (**Workers & Pages → Connect to Git**) per build e deploy automatici su ogni push a `main`.
3. Abilita **Actions** sul fork: [`.github/workflows/sync-upstream.yml`](./.github/workflows/sync-upstream.yml) sincronizza automaticamente gli aggiornamenti upstream ogni giorno alle `04:00 UTC`.

### 2. Deploy Manuale da CLI
```bash
git clone https://github.com/G4s01/KuroTV_S.git
cd KuroTV_S
npm install
npm run build
npm run deploy
```

> [!NOTE]
> `wrangler.jsonc` usa binding D1 dinamico (`kurosync-db`, nessun `database_id` hardcoded). `npm run deploy` applica prima le migrazioni D1 remote (`0001_init.sql`, `0002_server_replication_cursor.sql`, `0003_mal_auth.sql`) e poi pubblica il Worker; su database vergini `ensureSchema()` esegue il bootstrap automatico al primo avvio.

### 3. Configurazione & Pairing Client
1. Apri `https://<tuo-worker>.workers.dev` e completa il **Setup Wizard** impostando Master Password e profilo iniziale (`/api/setup` si blocca automaticamente al termine).
2. Su **KuroTV Mobile**: scansiona il QR rapido dalla Console Web oppure accedi con URL e Master Password scegliendo il profilo.
3. Su **KuroTV TV**: genera il codice a 6 caratteri e autorizzalo dalla Console Web (`/pair`) o dall'app Mobile.
4. **MyAnimeList (opzionale)**: dalla tab **MYANIMELIST** associa un account MAL a ogni profilo con il tuo `Client ID` (seguendo la guida integrata per inserire su `myanimelist.net/apiconfig` sia `<tuo-worker>/mal-callback` sia `kurotv://mal-callback` con `App Type: Android` o `other`).

---

## 📊 Ottimizzazione Cloudflare Free Tier

| Risorsa | Limite Free Tier | Salvaguardia KuroTV_S |
| :--- | :--- | :--- |
| **Letture D1** | 5.000.000 / giorno | Delta pull incrementali (`?since=`) indicizzati su `server_updated_at` / `server_deleted_at`. |
| **Scritture D1** | 100.000 / giorno | Debounce player a 45–60s lato client con flush immediato su pausa, uscita o fine episodio. |
| **Batch Atomic** | ≤ 50 statement / batch | Suddivisione automatica (`CHUNK_SIZE = 50`) in `sync.ts` e `backup.ts`. |
| **Storage D1** | 5 GB totali | Auto-purge automatico dei tombstones > 90 giorni e codici pairing > 24 ore. |

---

## 🛠️ Stack Tecnologico

| Componente | Tecnologia | Ruolo & Caratteristiche |
| :--- | :--- | :--- |
| **Runtime Edge** | **Cloudflare Workers** + **Hono** | Routing modulare ultra-leggero e middleware auth/rate-limit |
| **Database** | **Cloudflare D1 (SQLite)** | Migrazioni incrementali in `migrations/` + bootstrap `ensureSchema()` |
| **Crittografia** | **Web Crypto API** | PBKDF2-SHA256, `timingSafeEqual`, SHA-256 token hashing |
| **Console Web** | **React 19** + **Vite** | Static Assets serviti dal Worker (`run_worker_first: ["/api/*"]`) |
| **Client SDK** | **`@kurosync/sync-client`** | TypeScript puro zero-dipendenze (Hermes, MMKV, Android TV, Web) |
| **Test Suite** | **Vitest** + **`workerd`** | E2E su runtime Cloudflare reale (`@cloudflare/vitest-plugin`) |

---

## 🔌 Panoramica Endpoint API

<details>
<summary><strong>Mostra la tabella completa dei 29 endpoint REST (<code>/api/*</code>)</strong></summary>

<br />

| Metodo | Endpoint | Descrizione | Auth |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/health` | Stato servizio e inizializzazione istanza | — |
| `POST` | `/api/setup` | Configurazione iniziale Master Password (bloccata dopo il setup) | — |
| `POST` | `/api/auth/login` | Login Master Console Web (restituisce session token) | Rate-limited |
| `POST` | `/api/auth/device-login` | Login diretto dispositivo con binding al profilo | Rate-limited |
| `POST` | `/api/auth/profiles` | Lista profili via Master Password (selettore pre-login) | Rate-limited |
| `POST` | `/api/auth/switch-profile` | Cambio profilo attivo per la sessione dispositivo | Bearer |
| `POST` | `/api/auth/qr-token` | Genera QR token effimero monouso (TTL 5 minuti) | Bearer |
| `POST` | `/api/auth/exchange` | Scambia atomicamente un QR token con device token | — |
| `POST` | `/api/auth/logout` | Revoca la sessione e invalida il device token | Bearer |
| `POST` | `/api/pair/start` | Avvia pairing TV (codice 6 caratteri + `pairSecret`) | Rate-limited |
| `GET` | `/api/pair/status` | Polling stato pairing TV (`X-Pair-Secret`) | Pair Secret |
| `GET` | `/api/pair/info` | Anteprima pubblica codice pairing per Web Console | — |
| `POST` | `/api/pair/approve` | Approva pairing TV e associa il profilo | Bearer |
| `GET` | `/api/profiles` | Elenca i profili dell'istanza | Bearer |
| `POST` | `/api/profiles` | Crea un nuovo profilo | Bearer |
| `PUT` | `/api/profiles/:id` | Aggiorna nome e colore avatar del profilo | Bearer |
| `DELETE` | `/api/profiles/:id` | Elimina profilo e tutti i dati associati (inclusi `mal_auth` e `tombstones`) | Bearer |
| `GET` | `/api/devices` | Elenca i dispositivi connessi (`?profileId=`) | Bearer |
| `PUT` | `/api/devices/:id` | Rinomina dispositivo o cambia profilo associato | Bearer |
| `DELETE` | `/api/devices/:id` | Revoca dispositivo (o rimozione definitiva con `?purge=true`) | Bearer |
| `DELETE` | `/api/devices/revoked` | Rimozione massiva dispositivi disconnessi | Bearer |
| `GET` | `/api/sync/pull` | Delta pull (`?since=`; include sempre `deltas.malAuth` e `tombstones`) | Bearer |
| `POST` | `/api/sync/push` | Delta push atomico (inclusi `malAuth` e deletions `'mal_auth'`) | Bearer |
| `GET` | `/api/mal/accounts` | Elenca stato e associazioni MAL per profilo (senza esporre token grezzi) | Bearer |
| `POST` | `/api/mal/oauth/exchange` | Scambio OAuth PKCE MAL lato server per associare un profilo dal Web Panel | Bearer |
| `POST` | `/api/mal/accounts/:profileId/refresh` | Rinnova token OAuth MAL e aggiorna metadati `@me` del profilo | Bearer |
| `DELETE` | `/api/mal/accounts/:profileId` | Scollega MAL dal profilo e registra tombstone `'mal_auth'` per i client | Bearer |
| `GET` | `/api/sync/export` | Export snapshot JSON completo o filtrato (`?profileId=`) | Bearer |
| `POST` | `/api/sync/import` | Ripristino backup JSON (retrocompatibile con backup legacy) | Bearer |

</details>

---

## 📦 Tooling, Verifica & Rilascio

```bash
# Verifica tipi TypeScript (Worker, Web Console e @kurosync/sync-client)
npm run typecheck

# Esecuzione completa test suite (Workers D1 + Client SDK)
npm test

# Build di produzione (Worker + Console Web + SDK)
npm run build

# Verifica, commit e push su GitHub (con --deploy opzionale per Cloudflare)
./release.sh -m "feat: descrizione sintetica"
```

> [!NOTE]
> [`release.sh`](./release.sh) esegue automaticamente `typecheck`, `build` e `test` prima di creare il commit e inviarlo a `origin`. Supporta `--dry-run`, `--no-push`, `--skip-checks`, `--deploy` e `-y`.

---

## 📚 Documentazione di Dettaglio

- 🔌 [**Guida Integrazione Client**](./docs/CLIENT_INTEGRATION.md) — Mapping MMKV, debounce player, pairing TV, QR connect e sync `malAuth`
- 🧪 [**Report Suite di Test**](./TEST_READY.md) — Copertura dettagliata dei 288 test su `workerd` e `@kurosync/sync-client`
- 🤖 [**Istruzioni Agentiche & Regole**](./AGENTS.md) — Vincoli D1/Cloudflare, regole di dominio `malAuth` e pipeline operativa
- 🗄️ [**Migrazioni Database D1**](./migrations) — Schema SQL incrementale (`0001` → `0003`)
- 📦 [**Client SDK Condiviso**](./packages/sync-client) — Package TypeScript puro `@kurosync/sync-client`

---

<div align="center">

_Sviluppato per l'ecosistema Kuro • Serverless, Self-Hosted & Free-Tier Friendly_

</div>
