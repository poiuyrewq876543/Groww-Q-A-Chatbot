// search(question, scheme): filtered retrieval over the stored pieces.
// 1. Filter to the selected scheme plus general documents.
// 2. Rank by meaning (vector similarity), optionally fused with keyword search.
// 3. Prefer fund pages, scheme summaries and KIMs over low-trust Fund Facts.
// 4. Return the top 5, or nothing when no piece clears the minimum score.
import crypto from "node:crypto";
import { q, toVector } from "./db";
import { EMBED_MODEL, embedQuery } from "./gemini";
import { detectPlan, SchemeId } from "./schemes";

export interface Piece {
  id: number;
  doc_id: string;
  scheme: string;
  plan: string;
  doc_type: string;
  section: string;
  content: string;
  similarity: number;
  score: number;
}

export const MIN_SIMILARITY = Number(process.env.MIN_SIMILARITY || 0.58);
const TOP_K = 5;
const KEYWORD_WEIGHT = Number(process.env.KEYWORD_WEIGHT || 0.1);

const DOC_TYPE_BOOST: Record<string, number> = {
  "Fund page": 0.03,
  "Scheme summary": 0.025,
  KIM: 0.02,
  SID: 0,
  "FAQ page": 0.01,
  "Statement help page": 0.01,
  "Tax guide": 0,
  "Fund Facts": -0.04,
};

export async function search(question: string, scheme: SchemeId, opts: { hybrid?: boolean } = {}): Promise<Piece[]> {
  const schemes = scheme === "general" ? ["general"] : [scheme, "general"];
  const vec = await queryVector(question);
  const rows = await q<Omit<Piece, "score">>(
    `select id, doc_id, scheme, plan, doc_type, section, content,
            1 - (embedding <=> $1::vector) as similarity
       from mf_chunks
      where scheme = any($2)
      order by embedding <=> $1::vector
      limit 30`,
    [vec, schemes],
  );

  const hybrid = opts.hybrid ?? process.env.HYBRID_SEARCH !== "0";
  let keywordRank = new Map<number, number>();
  if (hybrid) {
    const kw = await q<{ id: number }>(
      `select id from mf_chunks
        where scheme = any($2) and tsv @@ websearch_to_tsquery('english', $1)
        order by ts_rank_cd(tsv, websearch_to_tsquery('english', $1), 1) desc
        limit 30`,
      [keywordQuery(question), schemes],
    );
    kw.forEach((r, i) => keywordRank.set(r.id, i));
    // Bring in strong keyword matches that the vector search missed.
    const missing = kw.slice(0, 10).map((r) => r.id).filter((id) => !rows.some((x) => x.id === id));
    if (missing.length) {
      const extra = await q<Omit<Piece, "score">>(
        `select id, doc_id, scheme, plan, doc_type, section, content,
                1 - (embedding <=> $1::vector) as similarity
           from mf_chunks where id = any($2)`,
        [vec, missing],
      );
      rows.push(...extra);
    }
  }

  const plan = detectPlan(question);
  const scored: Piece[] = rows.map((r) => {
    let score = Number(r.similarity) + (DOC_TYPE_BOOST[r.doc_type] ?? 0);
    if (plan && r.plan !== "both" && r.plan !== plan) score -= 0.05;
    // Reciprocal-rank style bonus: the best keyword matches get a clear lift, the tail almost none.
    if (hybrid && keywordRank.has(r.id)) score += KEYWORD_WEIGHT / (1 + keywordRank.get(r.id)!);
    return { ...r, similarity: Number(r.similarity), score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.filter((p) => p.similarity >= MIN_SIMILARITY);
  return best.slice(0, TOP_K);
}

// Query embeddings are cached by a hash of the search text, so repeated questions
// (such as the tappable examples) do not spend embedding quota. The text itself is not stored.
async function queryVector(question: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(`${EMBED_MODEL}:${question.trim().toLowerCase()}`).digest("hex");
  try {
    const hit = await q<{ v: string }>(`select embedding::text as v from mf_query_cache where hash = $1`, [hash]);
    if (hit.length) return hit[0].v;
  } catch {
    /* cache table missing: fall through */
  }
  const vec = toVector(await embedQuery(question));
  q(`insert into mf_query_cache (hash, embedding) values ($1, $2::vector) on conflict do nothing`, [hash, vec]).catch(() => {});
  return vec;
}

// Keyword query: keep the content words, drop question filler.
// Scheme names are dropped too: the scheme filter already applies them, and every piece label repeats them.
const STOP = new Set(
  "what is the of for in a an on to does do how much and or this that it its fund hdfc scheme plan tell me about flexi cap mid midcap balanced advantage baf".split(" "),
);
function keywordQuery(question: string): string {
  const words = question.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  return words.join(" or ");
}
