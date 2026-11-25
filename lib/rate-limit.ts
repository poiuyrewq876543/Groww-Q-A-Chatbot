// Per-visitor limit: RATE_LIMIT questions per RATE_WINDOW_MIN minutes.
// The key is a salted SHA-256 hash of the IP, so no raw IP address is stored.
import crypto from "node:crypto";
import { q } from "./db";

const LIMIT = Number(process.env.RATE_LIMIT || 20);
const WINDOW_MIN = Number(process.env.RATE_WINDOW_MIN || 60);

export async function checkRateLimit(ip: string): Promise<boolean> {
  const salt = process.env.RATE_SALT || "groww-mf-facts";
  const key = crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
  const rows = await q<{ count: number }>(
    `insert into mf_rate_limits (key, window_start, count) values ($1, now(), 1)
     on conflict (key) do update set
       count = case when mf_rate_limits.window_start < now() - ($2 || ' minutes')::interval then 1 else mf_rate_limits.count + 1 end,
       window_start = case when mf_rate_limits.window_start < now() - ($2 || ' minutes')::interval then now() else mf_rate_limits.window_start end
     returning count`,
    [key, String(WINDOW_MIN)],
  );
  return (rows[0]?.count ?? 0) <= LIMIT;
}
