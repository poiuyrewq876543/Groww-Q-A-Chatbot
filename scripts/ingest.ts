// npm run ingest
// Reads sources.csv, fetches every URL, saves a raw copy under data/raw, extracts the main text,
// splits it by section heading, labels every piece, embeds it, and stores it in Neon (pgvector).
// Runs on a machine with internet, never as a Vercel function.
import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import * as cheerio from "cheerio";
import { q, toVector } from "../lib/db";
import { embedBatch, EMBED_DIM, EMBED_MODEL } from "../lib/gemini";
import { SCHEMES, SchemeId } from "../lib/schemes";

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, "data", "raw");
const TEXT_DIR = path.join(ROOT, "data", "text");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// The fund house site rejects requests that do not look like a normal browser visit.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};
const COLLECTED_ON = process.env.COLLECTED_ON || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const SKIP_EMBED = process.env.SKIP_EMBED === "1";

interface Row {
  doc_id: string;
  scheme: string;
  plan: string;
  doc_type: string;
  title: string;
  publisher: string;
  url: string;
  pages: string;
  local_file: string;
  notes: string;
}

interface Piece {
  doc_id: string;
  scheme: string;
  plan: string;
  doc_type: string;
  section: string;
  content: string;
}

function schemeName(s: string) {
  return s === "general" ? "General (all HDFC Mutual Fund schemes)" : SCHEMES[s as SchemeId]?.name ?? s;
}
function planName(p: string) {
  return p === "both" ? "Direct and Regular" : p[0].toUpperCase() + p.slice(1);
}

// curl is used because the site's bot filter accepts curl's browser-like request and rejects Node's fetch.
function curlGet(url: string): { buf: Buffer; status: number; ct: string } {
  const tmp = path.join(RAW_DIR, ".download");
  const args = ["-s", "-L", "--compressed", "-m", "90", "-o", tmp, "-w", "%{http_code} %{content_type}"];
  for (const [k, v] of Object.entries(BROWSER_HEADERS)) args.push("-H", `${k}: ${v}`);
  args.push(url);
  const meta = execFileSync("curl", args).toString().trim();
  const [code, ...ct] = meta.split(" ");
  const buf = fs.existsSync(tmp) ? fs.readFileSync(tmp) : Buffer.alloc(0);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  return { buf, status: Number(code), ct: ct.join(" ") };
}

async function fetchSource(row: Row): Promise<{ buf: Buffer; kind: "pdf" | "html"; file: string }> {
  if (row.local_file) {
    const buf = fs.readFileSync(path.join(ROOT, row.local_file));
    const kind = row.local_file.toLowerCase().endsWith(".pdf") ? "pdf" : "html";
    return { buf, kind, file: row.local_file };
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { buf, status, ct } = curlGet(row.url);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const kind = ct.includes("pdf") || buf.subarray(0, 5).toString() === "%PDF-" ? "pdf" : "html";
      const file = path.join("data", "raw", `${row.doc_id}.${kind}`);
      fs.writeFileSync(path.join(ROOT, file), buf);
      return { buf, kind, file };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ---------- PDF ----------
function pdfToLines(file: string): string[] {
  const out = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path.join(ROOT, file), "-"], {
    maxBuffer: 200 * 1024 * 1024,
  }).toString("utf8");
  return out
    .replace(/\f/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .map((l) => l.trim().replace(/\s{3,}/g, " | "));
}

// ---------- HTML ----------
// Keep the main content only. Remove header, menus, footer, scripts, and the scrolling returns ticker.
const JUNK_SELECTORS = [
  "script", "style", "noscript", "svg", "iframe", "header", "footer", "nav", "marquee", "img", "input", "select",
  "[role=navigation]", "[role=banner]", "[role=contentinfo]",
  "[class*=ticker i]", "[id*=ticker i]", "[class*=marquee i]", "[class*=scroller i]",
  "[class*=header i]:not([class*=accordion i]):not([class*=faq i]):not([class*=card i]):not([class*=question i])",
  "[id*=header i]", "[class*=footer i]", "[id*=footer i]",
  "[class*=navbar i]", "[class*=menu i]", "[id*=menu i]", "[class*=breadcrumb i]",
  "[class*=cookie i]", "[class*=modal i]", "[class*=popup i]", "[class*=disclaimer-popup i]",
  "[class*=social i]", "[class*=share i]", "[class*=download-app i]",
];

function htmlToLines(html: string): string[] {
  const $ = cheerio.load(html);
  for (const sel of JUNK_SELECTORS) {
    try {
      $(sel).remove();
    } catch {
      /* selector not supported */
    }
  }
  // FAQ questions sit inside <button><p>..</p></button>; other buttons are controls and are dropped.
  $("button").each((_, b) => {
    if (!$(b).find("p").length) $(b).remove();
  });
  const root = $("main").length ? $("main") : $("body");
  const lines: string[] = [];
  root.find("h1,h2,h3,h4,h5,h6,p,li,tr,dt,dd,div,span,label").each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase();
    const $el = $(el);
    if (tag === "tr") {
      const cells = $el.find("th,td").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get().filter(Boolean);
      if (cells.length) lines.push(cells.join(" | "));
      return;
    }
    if ($el.closest("tr").length) return;
    // Only leaf-ish blocks: skip containers that hold other block elements.
    if ((tag === "div" || tag === "span" || tag === "li") && $el.find("div,p,li,table,h1,h2,h3,h4,h5,h6").length) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (!text) return;
    lines.push(/^h[1-6]$/.test(tag) ? `## ${text}` : text);
  });
  // Remove consecutive duplicates (nested span/div pairs).
  return lines.filter((l, i) => l !== lines[i - 1]);
}

// Fund pages are a Next.js app. The fund facts are in the page's __NEXT_DATA__ JSON.
// Only the Overview block is kept. Performance data, holdings, menus, footer and the
// returns ticker are never read, so no return figure can reach the store.
const strip = (v: unknown) =>
  String(v ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/[.#]?[\w-]+\s*\{[^{}]*\}/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

function fundPageToLines(html: string, row: Row): string[] | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const data = JSON.parse(m[1])?.props?.pageProps?.singleFundResponse?.data;
  if (!data?.details) return null;
  const ovSec = data.details.find((s: any) => s.Overview)?.Overview;
  if (!ovSec) return null;
  const ov = ovSec.data || {};
  const name = SCHEMES[row.scheme as SchemeId]?.name ?? row.title;
  const planLabel = row.plan === "direct" ? "Direct Plan" : row.plan === "regular" ? "Regular Plan" : "";
  const out: string[] = [];
  const sec = (h: string, ...lines: (string | null | undefined)[]) => {
    const body = lines.filter((l) => l && String(l).trim()) as string[];
    if (!body.length) return;
    out.push(`## ${h}`, ...body, "");
  };
  sec(
    "Scheme overview",
    `Scheme: ${name}`,
    planLabel ? `Plan shown on this page: ${planLabel}` : null,
    ovSec.overviewDescription ? `Type of scheme: ${strip(ovSec.overviewDescription)}` : null,
    data.banner?.categories ? `Category: ${strip(Array.isArray(data.banner.categories) ? data.banner.categories.map((c: any) => c?.name ?? c).join(", ") : data.banner.categories)}` : null,
    ov.inceptionDate ? `Inception date: ${ov.inceptionDate}` : null,
    ov.aum ? `Assets under management (AUM): ${ov.aum} ${ov.aumAsMonth ?? ""}`.trim() : null,
  );
  sec("Exit load", ov.exitLoadValue ? `Exit load: ${strip(ov.exitLoadValue)}` : null, ov.exitLoad ? `Exit load: ${strip(ov.exitLoad)}` : null);
  sec(
    "Total Expense Ratio (TER)",
    ov.terDirecct ? `Total Expense Ratio (TER), Direct Plan: ${ov.terDirecct}%` : null,
    ov.terRegular ? `Total Expense Ratio (TER), Regular Plan: ${ov.terRegular}%` : null,
  );
  sec("Minimum SIP amount", ov.minimumSip ? `Minimum SIP amount: Rs ${ov.minimumSip}` : null);
  sec(
    "Riskometer",
    Array.isArray(ov.risk) && ov.risk.length ? `Riskometer (risk level): ${ov.risk.map((r: any) => r.name).join(", ")}` : null,
  );
  sec("Benchmark", Array.isArray(ov.benchmark) && ov.benchmark.length ? `Benchmark index: ${ov.benchmark.join("; ")}` : null);
  sec(
    "Lock-in period",
    ov.lockInValue ? `Lock-in period: ${strip(ov.lockInValue)}` : null,
  );
  sec("Entry load", ov.entryLoadValue ? `Entry load: ${strip(ov.entryLoadValue)}` : null);
  sec(
    "Investment horizon and suitability",
    ov.suggestedFor ? `Suggested investment horizon: ${ov.suggestedFor}` : null,
    Array.isArray(ov.sutiableFor) && ov.sutiableFor.length ? `Suitable for: ${ov.sutiableFor.join(", ")}` : null,
  );
  const mgr = data.details.find((s: any) => s.managers)?.managers;
  if (mgr) sec("Fund managers", ...Object.values(mgr).map((x: any) => `Fund manager: ${x.managerName} ${x.since ?? ""}`.trim()));
  return out;
}

// Lines that look like return figures of other funds (ticker residue) are dropped as a second guard.
function looksLikeTicker(line: string): boolean {
  return /\b(1Y|3Y|5Y|1 Yr|3 Yr|5 Yr)\b.*%/.test(line) && line.length < 120 && /fund/i.test(line);
}

// ---------- Splitting ----------
function isHeading(line: string, next: string | undefined): boolean {
  if (line.startsWith("## ")) return true;
  if (line.length < 3 || line.length > 90) return false;
  if (line.includes(" | ")) return false;
  if (/[.,;:]$/.test(line) && !/:$/.test(line)) return false;
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  const upperRatio = line.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio > 0.8 && line.split(/\s+/).length <= 12) return true;
  if (/^(section\s+)?([IVX]+|\d+(\.\d+)*|[A-Z])[.)]\s+[A-Z]/.test(line) && line.split(/\s+/).length <= 14) return true;
  return false;
}

const TARGET = 2600;
const MAX = 3800;

function splitIntoPieces(lines: string[]): { section: string; text: string }[] {
  const sections: { heading: string; lines: string[] }[] = [];
  let cur = { heading: "Overview", lines: [] as string[] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      cur.lines.push("");
      continue;
    }
    if (isHeading(line, lines[i + 1])) {
      if (cur.lines.some((l) => l.trim())) sections.push(cur);
      cur = { heading: line.replace(/^##\s*/, "").slice(0, 120), lines: [] };
      continue;
    }
    cur.lines.push(line);
  }
  if (cur.lines.some((l) => l.trim())) sections.push(cur);

  const pieces: { section: string; text: string }[] = [];
  for (const s of sections) {
    // Paragraph = block of lines separated by blank lines. Lines are never split, so table rows stay whole.
    const paras: string[] = [];
    let buf: string[] = [];
    for (const l of s.lines) {
      if (!l.trim()) {
        if (buf.length) paras.push(buf.join("\n"));
        buf = [];
      } else buf.push(l);
    }
    if (buf.length) paras.push(buf.join("\n"));

    let acc = "";
    const flush = () => {
      if (acc.trim().length > 20) pieces.push({ section: s.heading, text: acc.trim() });
      acc = "";
    };
    for (const p of paras) {
      if (p.length > MAX) {
        // An oversized paragraph is split on line boundaries only.
        for (const l of p.split("\n")) {
          if (acc.length + l.length > TARGET) flush();
          acc += l + "\n";
        }
        continue;
      }
      if (acc.length + p.length > TARGET) flush();
      acc += p + "\n\n";
    }
    flush();
  }
  // Merge tiny pieces into the previous piece of the same section.
  const merged: typeof pieces = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.section === p.section && (p.text.length < 400 || last.text.length < 400) && last.text.length + p.text.length < MAX) {
      last.text += "\n\n" + p.text;
    } else merged.push({ ...p });
  }
  return merged;
}

function selectPages(lines: string[], pages: string): string[] {
  return lines; // page ranges are empty in sources.csv; all pages are kept
}

async function ensureSchema() {
  await q(`create extension if not exists vector`);
  await q(`create table if not exists mf_documents (
    doc_id text primary key, scheme text, plan text, doc_type text, title text, publisher text,
    url text, collected_on date, raw_file text, fetch_ok boolean, pieces int)`);
  await q(`create table if not exists mf_chunks (
    id serial primary key, doc_id text references mf_documents(doc_id) on delete cascade,
    scheme text, plan text, doc_type text, section text, content text,
    embedding vector(${EMBED_DIM}),
    tsv tsvector generated always as (to_tsvector('english', coalesce(section,'') || ' ' || content)) stored)`);
  await q(`create index if not exists mf_chunks_scheme_idx on mf_chunks(scheme)`);
  await q(`create index if not exists mf_chunks_tsv_idx on mf_chunks using gin(tsv)`);
  await q(`create table if not exists mf_rate_limits (key text primary key, window_start timestamptz, count int)`);
  // Cache of query embeddings keyed by a hash of the search text, to save embedding quota. No text is stored.
  await q(`create table if not exists mf_query_cache (hash text primary key, embedding vector(${EMBED_DIM}), created_at timestamptz default now())`);
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(TEXT_DIR, { recursive: true });
  const rows: Row[] = parse(fs.readFileSync(path.join(ROOT, "sources.csv")), { columns: true, skip_empty_lines: true });
  if (!SKIP_EMBED) await ensureSchema();

  const manifestPath = path.join(ROOT, "data", "manifest.json");
  const prev: any[] = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : [];
  const manifest: any[] = [];
  const report: any[] = [];

  for (const row of rows) {
    const old = prev.find((d) => d.doc_id === row.doc_id);
    if (ONLY && !ONLY.includes(row.doc_id)) {
      manifest.push(old ?? { ...pick(row), collected_on: null, fetch_ok: false });
      continue;
    }
    if (process.env.SKIP_EXISTING === "1" && !SKIP_EMBED) {
      const have = await q<{ n: number }>(`select count(*)::int as n from mf_chunks where doc_id = $1`, [row.doc_id]);
      if (have[0].n > 0 && old?.fetch_ok) {
        console.log(`- ${row.doc_id} ... already stored (${have[0].n} pieces), skipped`);
        manifest.push(old);
        report.push({ doc_id: row.doc_id, url: row.url, ok: true, pieces: have[0].n, skipped: true });
        continue;
      }
    }
    process.stdout.write(`- ${row.doc_id} ... `);
    let lines: string[] = [];
    let rawFile = "";
    try {
      const { buf, kind, file } = await fetchSource(row);
      rawFile = file;
      if (kind === "pdf") lines = selectPages(pdfToLines(file), row.pages);
      else lines = (row.doc_type === "Fund page" && fundPageToLines(buf.toString("utf8"), row)) || htmlToLines(buf.toString("utf8"));
      lines = lines.filter((l) => !looksLikeTicker(l));
    } catch (e: any) {
      console.log(`FETCH FAILED (${e.message})`);
      report.push({ doc_id: row.doc_id, url: row.url, ok: false, error: e.message });
      manifest.push({ ...pick(row), collected_on: null, fetch_ok: false });
      continue;
    }
    fs.writeFileSync(path.join(TEXT_DIR, `${row.doc_id}.txt`), lines.join("\n"));

    const label = (section: string) =>
      `Scheme: ${schemeName(row.scheme)} | Plan: ${planName(row.plan)} | Document: ${row.title} | Section: ${section}`;
    const pieces: Piece[] = splitIntoPieces(lines).map((p) => ({
      doc_id: row.doc_id,
      scheme: row.scheme,
      plan: row.plan,
      doc_type: row.doc_type,
      section: p.section,
      content: `${label(p.section)}\n${p.text}`,
    }));
    console.log(`${lines.length} lines, ${pieces.length} pieces`);
    fs.writeFileSync(path.join(TEXT_DIR, `${row.doc_id}.pieces.json`), JSON.stringify(pieces, null, 1));

    if (!SKIP_EMBED && pieces.length) {
      const vecs = await embedBatch(pieces.map((p) => p.content), "RETRIEVAL_DOCUMENT");
      await q(`delete from mf_chunks where doc_id = $1`, [row.doc_id]);
      await q(
        `insert into mf_documents (doc_id, scheme, plan, doc_type, title, publisher, url, collected_on, raw_file, fetch_ok, pieces)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)
         on conflict (doc_id) do update set scheme=excluded.scheme, plan=excluded.plan, doc_type=excluded.doc_type,
           title=excluded.title, publisher=excluded.publisher, url=excluded.url, collected_on=excluded.collected_on,
           raw_file=excluded.raw_file, fetch_ok=true, pieces=excluded.pieces`,
        [row.doc_id, row.scheme, row.plan, row.doc_type, row.title, row.publisher, row.url, COLLECTED_ON, rawFile, pieces.length],
      );
      for (let i = 0; i < pieces.length; i += 40) {
        const batch = pieces.slice(i, i + 40);
        const params: unknown[] = [];
        const values = batch.map((p, j) => {
          const b = j * 7;
          params.push(p.doc_id, p.scheme, p.plan, p.doc_type, p.section, p.content, toVector(vecs[i + j]));
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::vector)`;
        });
        await q(`insert into mf_chunks (doc_id, scheme, plan, doc_type, section, content, embedding) values ${values.join(",")}`, params);
      }
    }
    report.push({ doc_id: row.doc_id, url: row.url, ok: true, lines: lines.length, pieces: pieces.length, raw_file: rawFile });
    manifest.push({ ...pick(row), collected_on: COLLECTED_ON, fetch_ok: true });
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(
    path.join(ROOT, "data", "ingest-report.json"),
    JSON.stringify({ collected_on: COLLECTED_ON, embed_model: EMBED_MODEL, docs: report }, null, 2) + "\n",
  );
  const failed = report.filter((r) => !r.ok);
  console.log(`\nDone. ${report.length - failed.length} fetched, ${failed.length} failed.`);
  for (const f of failed) console.log(`  FAILED: ${f.doc_id} ${f.url} (${f.error})`);
}

function pick(r: Row) {
  return { doc_id: r.doc_id, scheme: r.scheme, plan: r.plan, doc_type: r.doc_type, title: r.title, publisher: r.publisher, url: r.url };
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
