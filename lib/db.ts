// Neon Postgres over HTTPS. DATABASE_URL comes from the environment only.
import { neon } from "@neondatabase/serverless";

let _sql: ReturnType<typeof neon> | null = null;

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params)) as T[];
}

export function toVector(v: number[]): string {
  return `[${v.map((x) => x.toFixed(6)).join(",")}]`;
}
