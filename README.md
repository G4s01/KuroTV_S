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

### 1. Compose Standalone (Pronto da incollare)

Se hai già un host Docker pronto e vuoi incollare lo stack direttamente su **Dockhand**, **Portainer**, **Dockge** o **Dockerman** senza clonare la repository, usa questo esempio modificando porta, percorso dati e permessi:

```yaml
services:
  kurotv-s:
    image: ghcr.io/g4s01/kurotv_s:latest
    container_name: kurotv-s
    restart: unless-stopped

    # Permessi: imposta UID:GID del tuo utente host (es. `id -u` e `id -g`).
    # La cartella dati sull'host deve esistere ed essere scrivibile da tale UID:GID.
    # Se preferisci che il container sistemi automaticamente i permessi di /data all'avvio,
    # commenta `user:` e `cap_drop:` (l'entrypoint userà PUID/PGID tramite su-exec).
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

    # Root filesystem del container in sola lettura (scrivibile solo /data se :rw)
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=16m

    # Porta (Bridge mode). Per Host mode: commenta `ports:`, decommenta `network_mode: host`
    # e imposta la porta desiderata su `PORT` sotto.
    # network_mode: host
    ports:
      - "8787:8787"

    environment:
      PORT: "8787"                      # Porta di ascolto interna (allineata a ports o host mode)
      PUID: "1000"                      # Usato dall'entrypoint solo se `user:` è commentato
      PGID: "1000"                      # Usato dall'entrypoint solo se `user:` è commentato
      KUROSYNC_DATA_DIR: /data          # Directory dati nel container
      KUROSYNC_DB_PATH: /data/kurosync.db
      KUROSYNC_READ_ONLY: "false"       # "true" per avviare il database in sola lettura
      TRUST_PROXY: "true"               # "true" dietro reverse proxy (NPM, Traefik, Caddy)
      PUBLIC_URL: ""                    # Opzionale: es. "https://kurosync.tuodominio.it"
      SYNC_ADMIN_SECRET: ""             # Opzionale: password fissa da env (disabilita Setup Wizard)
      MAX_BODY_BYTES: "52428800"        # Limite payload upload/import backup (50 MB)

    volumes:
      # Cartella esterna persistente su host -> /data (:rw lettura/scrittura, :ro sola lettura)
      - /percorso/tuoi/dati/kurosync:/data:rw

    healthcheck:
      test:
        [
          "CMD-SHELL",
          "node -e \"fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>r.json()).then(d=>process.exit(d&&d.ok?0:1)).catch(()=>process.exit(1))\"",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

    # Opzionale: collega il container alla rete Docker esterna del reverse proxy (es. NPM)
    # networks:
    #   - npm_proxy

# networks:
#   npm_proxy:
#     external: true
```

### 2. Avvio da Repository (con `.env` o build locale)

```bash
git clone https://github.com/G4s01/KuroTV_S.git && cd KuroTV_S
cp .env.example .env
mkdir -p ./data
docker compose up -d          # oppure `--build` per compilare da sorgente
```

Tutti i parametri (`KUROSYNC_DATA_DIR`, `KUROSYNC_DATA_MODE`, `KUROSYNC_READ_ONLY`, `PUID`, `PGID`, `KUROSYNC_PORT`, `TRUST_PROXY`, `PUBLIC_URL`, `SYNC_ADMIN_SECRET`) sono documentati in [`.env.example`](./.env.example) e [`compose.yaml`](./compose.yaml).

### 3. Reverse Proxy con Nginx Proxy Manager (NPM)

1. **Details**: `Scheme: http` · `Forward Hostname / IP`: `kurotv-s` (rete Docker condivisa), `127.0.0.1` (host mode) o IP dell'host · `Forward Port`: `8787` (o il tuo `PORT`).
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
- [**Migrazioni Database**](./migrations) — Schema SQL incrementale (`0001` → `0003`)
- [**Client SDK**](./packages/sync-client) — Package `@kurosync/sync-client`
