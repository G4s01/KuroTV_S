/**
 * KuroTV_S Database Maintenance Queries
 * - Auto-purge tombstones older than 90 days
 * - Auto-purge expired pairing codes older than 24 hours
 */

export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Purges tombstones older than 90 days across all profiles.
 * @param db Cloudflare D1 database binding
 * @param now Optional timestamp in milliseconds for determinism in tests
 */
export async function purgeOldTombstones(db: D1Database, now: number = Date.now()): Promise<number> {
  const cutoff = now - NINETY_DAYS_MS;
  const res = await db.prepare("DELETE FROM tombstones WHERE deleted_at < ?")
    .bind(cutoff)
    .run();
  return res.meta.changes || 0;
}

/**
 * Purges expired or consumed pairing codes older than 24 hours.
 * @param db Cloudflare D1 database binding
 * @param now Optional timestamp in milliseconds for determinism in tests
 */
export async function purgeExpiredPairingCodes(db: D1Database, now: number = Date.now()): Promise<number> {
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  const res = await db.prepare(
    "DELETE FROM pairing_codes WHERE expires_at < ? OR (status = 'consumed' AND created_at < ?)"
  )
    .bind(cutoff, cutoff)
    .run();
  return res.meta.changes || 0;
}
