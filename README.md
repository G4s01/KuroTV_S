<div align="center">

<img src="public/icon.png" width="84" alt="KuroTV_S Icon" />

# ⚡ KuroTV Sync Server (KuroTV_S)

### _Backend self-hosted per la sincronizzazione multi-dispositivo (Cloudflare Workers + D1 o Docker + SQLite), con Console Web OLED._

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/G4s01/KuroTV_S)

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Docker](https://img.shields.io/badge/Docker-Self--Hosted-2496ED?style=for-the-badge&logo=docker&logoColor=white)](./compose.yaml)
[![Hono](https://img.shields.io/badge/Framework-Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React 19](https://img.shields.io/badge/Console-React%2019-23272F?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![License MIT](https://img.shields.io/badge/License-MIT-E50914?style=for-the-badge)](https://opensource.org/licenses/MIT)

</div>

---

## 🌐 L'Ecosistema Kuro

| Progetto | Piattaforma | Focus | Repository |
| :--- | :--- | :--- | :--- |
| **📱 KuroTV_M** | Android Phone & Tablet | Player touch 120 FPS, download SAF, AniSkip | [**G4s01/KuroTV_M**](https://github.com/G4s01/KuroTV_M) |
| **📺 KuroTV_T** | Android TV & Google TV | Interfaccia D-Pad leanback, ExoPlayer TV | [**G4s01/KuroTV_T**](https://github.com/G4s01/KuroTV_T) |
| **⚡ KuroTV_S** | Cloudflare / Docker | Sync server, multi-profilo, pairing TV, Console OLED | [**G4s01/KuroTV_S**](https://github.com/G4s01/KuroTV_S) |
| **🖥️ KuroTV_D** | Desktop | Client desktop multipiattaforma | _In arrivo_ |

---

## ✨ Funzionalità Principali

- **Delta Sync & Multi-Profilo**: preferiti, *Continua a guardare*, cronologia, progressi, impostazioni e stato `IN PARI` isolati per profilo con risoluzione LWW e tombstones.
- **Sync MyAnimeList (`malAuth`)**: sincronizza solo i token OAuth MAL per profilo, con collegamento PKCE diretto dalla tab **MYANIMELIST** (`<origin>/mal-callback`).
- **Pairing TV & QR Connect**: codici a 6 caratteri per Android TV (`/pair`), QR monouso per smartphone e supporto opzionale a `SYNC_ADMIN_SECRET`.
- **Console Web OLED & Backup**: gestione completa di libreria, profili, dispositivi, MAL e export/import snapshot JSON.
- **Doppio Runtime**: deploy serverless gratuito su **Cloudflare Workers + D1** oppure container **Docker (`node:24-alpine` + `node:sqlite`)** con database su disco locale.

---

## 🐳 Self-Hosting Docker (Dockhand, Portainer, Dockge, Compose)

### 1. Compose Basilare (Host Mode)

Esempio minimo pronto da incollare in **Dockhand**, **Portainer**, **Dockge** o `compose.yaml`, con directory dati esterna su `/mnt/data/docker/KuroTV_S`, `network_mode: host` e porta configurabile tramite `PORT`:

```yaml
services:
  kurotv-s:
    image: ghcr.io/g4s01/kurotv_s:latest
    container_name: kurotv-s
    restart: unless-stopped
    network_mode: host
    environment:
      PORT: "8787"
    volumes:
      - /mnt/data/docker/KuroTV_S:/data
```

### 2. Parametri e Flag Aggiuntivi (Compose & Environment)

| Parametro / Variabile | Default | Descrizione |
| :--- | :--- | :--- |
| `ports` *(al posto di `network_mode: host`)* | `8787:8787` | Espone la porta in **Bridge Mode** (es. `"9090:9090"` insieme a `PORT: "9090"`, o `"127.0.0.1:8787:8787"`). |
| `networks` | — | Collega il container alla rete Docker esterna di NPM (es. `npm_proxy`) per raggiungerlo come `http://kurotv-s:8787` senza esporre porte sull'host. |
| `user` | — *(entrypoint `1000:1000`)* | Forza `UID:GID` da Compose (es. `"1000:1000"`); richiede che la cartella host esista e sia scrivibile da tale utente. |
| `PUID` / `PGID` *(env)* | `1000` / `1000` | Usati dall'entrypoint (`su-exec`) quando `user:` non è impostato: adegua automaticamente il proprietario di `/data` ed esegue Node senza `root`. |
| `UMASK` *(env)* | `022` | Maschera permessi per nuovi file/directory in `/data` (es. `022` -> `644`, `002` -> `664` condiviso di gruppo, `077` -> `600` privato). |
| `volumes` suffix (`:rw` / `:ro`) | `:rw` | Controlla i permessi di scrittura (`:rw`) o sola lettura (`:ro`) sul bind mount `/data`. |
| `read_only` + `tmpfs` | `false` | Con `read_only: true` e `tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"]` rende immutabile il filesystem del container eccetto `/data`. |
| `cap_drop` / `security_opt` | — | Hardening consigliato quando `user:` è impostato (`cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`). |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | Indirizzo e porta di ascolto interni del server Node (letti anche dal `HEALTHCHECK` integrato). |
| `KUROSYNC_DATA_DIR` / `KUROSYNC_DB_PATH` | `/data` / `/data/kurosync.db` | Directory dati e percorso file del database SQLite nel container. |
| `KUROSYNC_READ_ONLY` | `false` | Con `true` apre SQLite in sola lettura: consente le `GET` ed esclude le scritture con HTTP `403` (abbinabile a `:ro` su DB esistente). |
| `TRUST_PROXY` | `true` | Usa `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-For` e `X-Real-IP` da NPM; imposta `false` senza reverse proxy. |
| `PUBLIC_URL` | `""` | Forza l'origin pubblico (es. `"https://kurosync.tuodominio.it"`) nei link di pairing TV (`/pair`), ignorando gli header proxy. |
| `SYNC_ADMIN_SECRET` | `""` | Se impostato, disabilita il Setup Wizard e impone questa Master Password fissa da ambiente. |
| `KUROSYNC_RESET_PASSWORD` | `""` | Reset di emergenza all'avvio (idempotente): aggiorna la password nel DB mantenendo mobile/TV attivi; rimuoverla dopo l'uso. |
| `MAX_BODY_BYTES` | `52428800` | Limite massimo payload JSON in byte per sync push e import backup (default `50 MB`). |
| `MAINTENANCE_INTERVAL_MS` | `21600000` | Intervallo in ms per la pulizia automatica di tombstones (>90g) e codici pairing (>24h); `0` disabilita il timer. |

### 3. Avvio da Repository (con `.env` o build locale)

```bash
git clone https://github.com/G4s01/KuroTV_S.git && cd KuroTV_S
cp .env.example .env
mkdir -p ./data
docker compose up -d          # oppure `--build` per compilare da sorgente
```

I riferimenti completi sono in [`compose.yaml`](./compose.yaml) e [`.env.example`](./.env.example).

### 4. Reverse Proxy con Nginx Proxy Manager (NPM)

1. **Details**: `Scheme: http` · `Forward Hostname / IP`: `127.0.0.1` (host mode), `kurotv-s` (rete Docker condivisa) o IP dell'host · `Forward Port`: `8787` (o il tuo `PORT`).
2. **SSL**: certificato Let's Encrypt, **Force SSL** e **HTTP/2 Support**.
3. **Advanced** *(per import backup JSON grandi)*:
   ```nginx
   client_max_body_size 50m;
   ```
4. **MyAnimeList OAuth**: con HTTPS attivo su NPM, inserisci `https://<tuo-dominio>/mal-callback` e `kurotv://mal-callback` in `myanimelist.net/apiconfig` (`App Type: Android` o `other`).

---

## ⚡ Deploy su Cloudflare Workers

1. **One-Click / Fork**: premi **Deploy to Cloudflare Workers** in cima alla pagina oppure esegui un fork e collegalo su **Cloudflare Dashboard → Workers & Pages → Connect to Git** ([`sync-upstream.yml`](./.github/workflows/sync-upstream.yml) mantiene sincronizzati i fork ogni giorno alle `04:00 UTC`).
2. **Manuale da CLI**:
   ```bash
   git clone https://github.com/G4s01/KuroTV_S.git && cd KuroTV_S
   npm install && npm run build && npm run deploy
   ```
3. **Primo avvio**: apri l'URL dell'istanza, completa il **Setup Wizard** e collega i client **KuroTV_M** (QR Connect o Master Password) e **KuroTV_T** (`/pair`).

---

## 🔐 Cambio & Reset Master Password

- **Da Console Web (autenticato)**: clicca **SICUREZZA** nella topbar per cambiare la Master Password o rigenerare la **Recovery Key** (disconnette solo le altre sessioni Web; smartphone e TV restano collegati).
- **Con Recovery Key (dal Login)**: clicca **PASSWORD DIMENTICATA?** e inserisci la Recovery Key generata durante il Setup Wizard.
- **Senza Recovery Key (Emergenza)**:
  - **Docker**: `docker exec kurotv-s kurosync-reset --reset-password "NuovaPassword"` oppure `--reopen-setup` (o imposta `KUROSYNC_RESET_PASSWORD` in Compose/env).
  - **Cloudflare Workers / D1**: riapri il Setup Wizard preservando profili, dati e dispositivi con:
    ```bash
    npx wrangler d1 execute kurosync-db --remote --command "UPDATE instance_config SET setup_completed = 0 WHERE id = 1"
    ```

---

## 📦 Sviluppo & Rilascio

```bash
npm run typecheck      # Verifica TypeScript (Worker, Server Node, Client, SDK)
npm run build          # Build Cloudflare Worker + Console Web + SDK
npm run build:docker   # Build bundle Docker (SPA client + server Node.js)
npm test               # Test suite Vitest (workerd, Node server, client-sdk)
./build-release.sh -m "feat: descrizione" [--docker] [--tag v1.x.y] [--deploy]
```

> [`build-release.sh`](./build-release.sh) esegue tutte le verifiche prima di committare e pushare su `origin`. I push su `main` e i tag `v*.*.*` pubblicano automaticamente le immagini multi-arch (`amd64`/`arm64`) su `ghcr.io` tramite [`.github/workflows/docker-release.yml`](./.github/workflows/docker-release.yml).

---

## 📚 Documentazione

- [**Guida Integrazione Client**](./docs/CLIENT_INTEGRATION.md) — Mapping MMKV, debounce player, pairing TV, QR Connect e sync `malAuth`
- [**Architettura & Regole**](./AGENTS.md) — Vincoli D1/SQLite, regole `malAuth` e pipeline operativa
- [**Migrazioni Database**](./migrations) — Schema SQL incrementale (`0001` → `0004`)
- [**Client SDK**](./packages/sync-client) — Package `@kurosync/sync-client`
