# KuroTV_S ⚡

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/G4s01/KuroTV_S)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare_D1-F38020?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)

**KuroTV_S** is a personal, self-hosted synchronization backend for Cloudflare Workers (100% compatible with the Cloudflare Free plan), complete with an OLED Web Console and a Simple-Login pairing flow for Android TV and Smartphone, designed to synchronize multiple instances of **KuroTV Mobile (`KuroTV_M`)** and **KuroTV TV (`KuroTV_TV`)** without depending on central developer servers.

---

## ✨ Key Features

- **100% Free Plan Friendly**: Runs entirely within Cloudflare Workers and D1 Free tier allowances — zero hosting costs, no credit card required.
- **Serverless D1 Database**: Cloudflare D1 serverless SQLite storage with automatic, idempotent schema bootstrap (`ensureSchema`).
- **Pitch-Black OLED Web Console**: Responsive React + Vite dashboard styled with Kuro OLED design tokens (`#000000` pitch-black background, `#121212` cards, `#E50914` accents, and technical monospace typography).
- **Simple-Login TV Pairing**: Seamless 6-character PIN (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) and QR pairing for Android TV without requiring physical keyboard input.
- **Delta Sync Engine**: High-performance delta synchronization with Last-Write-Wins (LWW) conflict resolution, 90-day tombstone dominance, and timeline progress safeguards.
- **Smart "IN PARI" (Caught-Up) Sync**: Seamlessly preserves caught-up status and prevents episode regressions across multiple devices.
- **Full Backup & Restore**: One-click JSON backup export and import for profiles, libraries, and settings.
- **Pure TypeScript Client SDK**: Zero-dependency `@kurosync/sync-client` package compatible with Hermes, React Native MMKV, Android TV, and Web.

---

## ⚡ 3-Step Quick Start

### Step 1: Deploy to Cloudflare Workers
Click the **Deploy to Cloudflare Workers** button above, or deploy manually using Wrangler:

```bash
# Clone repository
git clone https://github.com/G4s01/KuroTV_S.git
cd KuroTV_S

# Install dependencies and build
npm install
npm run build

# Deploy to Cloudflare
npx wrangler deploy
```

> **Note on D1 Provisioning**: `wrangler.jsonc` uses dynamic binding without hardcoding a database ID. Cloudflare automatically provisions the D1 database on initial deployment. The backend's built-in `ensureSchema()` automatically creates all required tables and indexes on first run.

### Step 2: Complete Setup Wizard
1. Open your deployed Worker URL: `https://<your-subdomain>.workers.dev`.
2. The OLED Web Console will automatically greet you with the **Setup Wizard**.
3. Choose your **Master Password** and create your primary profile (e.g. `Principale`).
4. Once completed, `/api/setup` is permanently locked for maximum security.

### Step 3: Connect KuroTV Mobile & Android TV
- **Android TV**: Launch KuroTV TV, open Settings -> Sync -> "Accoppia TV". A 6-character code and QR code will appear. Visit `/pair` on your phone or Web Console, select your profile, and enter the code to pair instantly!
- **Smartphone**: Scan the Quick Connect QR code from the Web Console dashboard or enter your Worker URL and Master Password directly in the KuroTV Mobile app.

---

## 📊 Cloudflare Free Tier Allocation & Resource Limits

KuroTV_S is carefully engineered to operate well below Cloudflare's Free tier thresholds:

| Resource | Cloudflare Free Limit | KuroTV_S Implementation & Safeguards |
|---|---|---|
| **D1 Database Reads** | 5,000,000 queries / day | Delta pulls use `since=<timestamp>` index filtering; typical sync uses < 5 reads. |
| **D1 Database Writes** | 100,000 queries / day | Playback progress debounced to 45–60s intervals with immediate flush on pause/exit. |
| **D1 Database Storage** | 5 GB total | Automatic maintenance purges tombstones older than 90 days and pairing codes older than 24h. |
| **Worker Invocations** | 100,000 requests / day | Lightweight payload caching and batched updates. |
| **Batch Query Limit** | <= 50 queries per call | `pushDelta` automatically chunks atomic mutations into slices of <= 50 queries per `db.batch()`. |

---

## 🏗️ Architecture & Technology Stack

- **Runtime Backend**: [Cloudflare Workers](https://workers.cloudflare.com/) + [Hono](https://hono.dev/) framework.
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) serverless SQLite.
- **Security & Cryptography**: Native Web Crypto API (`crypto.subtle`), PBKDF2-SHA256 (100,000 iterations) with 16-byte cryptographically secure random salt, timing-safe string comparison (`crypto.subtle.timingSafeEqual`), SHA-256 device token hashing.
- **Web Console**: React 19 + TypeScript + Vite, served directly via Workers Static Assets (`@cloudflare/vite-plugin`) with single-page-application fallback.
- **Client SDK**: `@kurosync/sync-client` pure TypeScript package (zero Node dependencies, Hermes-compatible).

---

## 🔌 API Endpoints Overview

| Method | Endpoint | Description | Auth Required |
|---|---|---|:---:|
| `GET` | `/api/health` | Public health check and initialization status | No |
| `POST` | `/api/setup` | First-run setup wizard (locked once completed) | No |
| `POST` | `/api/auth/login` | Master password authentication (returns session token) | No (Rate-limited) |
| `POST` | `/api/auth/device-login` | Direct device login with profile binding | No (Rate-limited) |
| `POST` | `/api/auth/qr-token` | Generate ephemeral single-use QR token (5m TTL) | Bearer Token |
| `POST` | `/api/auth/exchange` | Atomically exchange single-use QR token for device token | No |
| `POST` | `/api/auth/logout` | Revoke session and invalidate device token | Bearer Token |
| `POST` | `/api/pair/start` | Request 6-character TV pairing code & secret | No (Rate-limited) |
| `GET` | `/api/pair/status` | Poll TV pairing status (requires `X-Pair-Secret`) | Pair Secret |
| `GET` | `/api/pair/info` | Public pairing code preview for Web Console | No |
| `POST` | `/api/pair/approve` | Authorize pairing code and issue device token | Bearer Token |
| `GET` | `/api/profiles` | List instance viewing profiles | Bearer Token |
| `POST` | `/api/profiles` | Create new viewing profile | Bearer Token |
| `GET` | `/api/devices` | List connected devices (ordered by last seen) | Bearer Token |
| `DELETE`| `/api/devices/:id` | Revoke device or permanently delete disconnected device | Bearer Token |
| `DELETE`| `/api/devices/revoked` | Bulk purge all disconnected/revoked devices | Bearer Token |
| `GET` | `/api/sync/pull` | Delta sync pull (`?since=<epochMs>`) | Bearer Token |
| `POST` | `/api/sync/push` | Batched delta sync push (atomic `db.batch() <= 50`) | Bearer Token |
| `GET` | `/api/sync/export` | Export full or profile JSON backup | Bearer Token |
| `POST` | `/api/sync/import` | Restore database from JSON backup | Bearer Token |

---

## 📦 Client SDK Usage (`@kurosync/sync-client`)

Install or link `@kurosync/sync-client` into your React Native or Web application:

```typescript
import { KuroSyncClient, mergeLocalAndRemote } from "@kurosync/sync-client";

// 1. Initialize Client
const client = new KuroSyncClient({
  baseUrl: "https://kurosync.example.workers.dev",
  deviceToken: "your_saved_device_token",
});

// 2. Simple TV Pairing Flow
const { code, pairSecret, verifyUrl } = await client.startTvPairing({
  deviceName: "Living Room Android TV",
  deviceType: "tv",
  platform: "android-tv",
});

// 3. Delta Pull & Deterministic Merge
const remoteDelta = await client.pullDelta(lastSyncTimestamp);
const { state: mergedState, appliedUpserts, appliedDeletions } = mergeLocalAndRemote(
  localMMKVState,
  remoteDelta
);

// 4. Batched Delta Push
await client.pushDelta({
  continueWatching: [updatedItem],
  deletions: [{ type: "continue_watching", key: "anime-123" }],
});
```

See [docs/CLIENT_INTEGRATION.md](docs/CLIENT_INTEGRATION.md) for the complete integration guide including MMKV storage key mappings, playback debouncing specifications, and Android TV pairing instructions.

---

## 🧪 Testing & Verification

KuroTV_S comes with a comprehensive Vitest automated test suite running against real Cloudflare `workerd` runtimes:

```bash
# Run all tests (Workers D1 in-memory + Client SDK)
npm test

# Run Client SDK tests only
npm run test:client

# Run Worker tests only
npm run test:workers

# Run TypeScript compilation checks
npm run typecheck
```

---

## 📄 License

MIT License. Designed and maintained for personal self-hosted synchronization of KuroTV clients.
