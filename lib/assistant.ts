// The question path, in the fixed order required by the BRD:
// 1 personal data -> 2 advice -> 3 returns -> 4 follow-up rewrite -> 5 search -> 6 answer -> 7 citation by code.
import fs from "node:fs";
import path from "node:path";
import replies from "../config/replies.json";
import { generate } from "./gemini";
import { getDoc } from "./manifest";
import { findPersonalData, isAdvice, isReturnsQuestion, looksLikeFollowUp } from "./safety";
import { detectPlan, detectScheme, SCHEMES, SchemeId } from "./schemes";
import { Piece, search } from "./search";

export type ReplyType = "answer" | "privacy" | "advice" | "returns" | "not_found" | "error";

export interface ChatReply {
  type: ReplyType;
  text: string;
  source: { title: string; url: string } | null;
  lastUpdated: string | null;
  /** The complete question used for search, so the browser can send it back as context for a follow-up. */
  resolvedQuestion: string | null;
  scheme: SchemeId;
  debug?: { pieces: { doc_id: string; section: string; similarity: number; score: number }[]; sourceDoc?: string };
}

const PROMPT_DIR = path.join(process.cwd(), "config", "prompts");
function prompt(name: string): string {
  return fs.readFileSync(path.join(PROMPT_DIR, name), "utf8");
}

function cite(docId: string | undefined) {
  const d = docId ? getDoc(docId) : undefined;
  if (!d) return { source: null, lastUpdated: null };
  return { source: { title: d.title, url: d.url }, lastUpdated: d.collected_on };
}

/** Keep at most three sentences. Decimal points and "Rs." do not end a sentence. */
export function limitSentences(text: string, max = 3): string {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z(])/);
  return parts.slice(0, max).join(" ").trim();
}

export async function answerQuestion(input: {
  message: string;
  scheme: SchemeId;
  previousQuestion?: string | null;
  debug?: boolean;
}): Promise<ChatReply> {
  const message = input.message.trim();
  const selected = input.scheme;

  // 1. Personal data. Nothing is searched, sent to the model, stored, or logged.
  if (findPersonalData(message)) {
    return { type: "privacy", text: replies.privacy, source: null, lastUpdated: null, resolvedQuestion: null, scheme: selected };
  }

  // A scheme named in the question wins over the selector (handles loose names such as "HDFC midcap").
  const named = detectScheme(message);
  const scheme: SchemeId = named ?? selected;
  const info = SCHEMES[scheme];

  // 2. Advice or opinion.
  if (isAdvice(message)) return adviceReply(scheme);

  // 3. Returns or performance: no numbers, link to the scheme's Fund Facts.
  if (isReturnsQuestion(message)) return returnsReply(scheme);

  // 4. Follow-up: rewrite into a complete question that names the scheme.
  let question = message;
  const prev = (input.previousQuestion || "").trim();
  if (!named && prev && looksLikeFollowUp(message)) {
    const prevScheme = detectScheme(prev);
    const target = scheme !== "general" ? info.name : prevScheme ? SCHEMES[prevScheme].name : "";
    try {
      const rewritten = await generate({
        system: prompt("rewrite.md"),
        user: `Scheme: ${target || "(not named)"}\nPrevious question: ${prev}\nFollow-up: ${message}`,
        maxTokens: 120,
      });
      if (rewritten && rewritten.length < 300) question = rewritten.split("\n")[0].replace(/^["']|["']$/g, "");
    } catch {
      question = `${message} (${target})`;
    }
  }
  let searchScheme: SchemeId = detectScheme(question) ?? scheme;
  if (!/hdfc/i.test(question) && searchScheme !== "general") question = `${question.replace(/\?*$/, "")} for ${SCHEMES[searchScheme].name}?`;

  // A rewritten follow-up could turn out to be advice or returns.
  if (isAdvice(question)) return adviceReply(searchScheme);
  if (isReturnsQuestion(question)) return returnsReply(searchScheme);

  // 5. Search.
  const pieces = await search(question, searchScheme);
  const debug = input.debug
    ? { pieces: pieces.map((p) => ({ doc_id: p.doc_id, section: p.section, similarity: round(p.similarity), score: round(p.score) })) }
    : undefined;
  if (!pieces.length) return notFound(searchScheme, question, debug);

  // 6. Answer from the retrieved pieces only.
  const plan = detectPlan(question);
  const user =
    `Question: ${question}\n` +
    `Plan named by the user: ${plan ? plan : "none"}\n\n` +
    pieces.map((p, i) => `[${i + 1}] (${p.doc_type})\n${p.content}`).join("\n\n---\n\n");
  let parsed: { type?: string; answer?: string; source?: number } = {};
  // One retry covers a malformed reply or a brief model outage.
  for (let attempt = 0; attempt < 2 && !parsed.type; attempt++) {
    try {
      const raw = await generate({ system: prompt("answer.md"), user, json: true, maxTokens: 500 });
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
    } catch {
      parsed = {};
    }
  }
  if (!parsed.type) {
    return { type: "error", text: replies.error, source: null, lastUpdated: null, resolvedQuestion: question, scheme: searchScheme, debug };
  }
  if (parsed.type === "advice") return adviceReply(searchScheme);
  const chosen: Piece | undefined = pieces[(parsed.source ?? 0) - 1];
  if (parsed.type !== "answer" || !parsed.answer || !chosen) return notFound(searchScheme, question, debug);

  // 7. Code attaches exactly one link and the collection date from the manifest.
  const c = cite(chosen.doc_id);
  return {
    type: "answer",
    text: stripLinks(limitSentences(parsed.answer)),
    ...c,
    resolvedQuestion: question,
    scheme: searchScheme,
    debug: debug ? { ...debug, sourceDoc: chosen.doc_id } : undefined,
  };
}

function adviceReply(scheme: SchemeId): ChatReply {
  return {
    type: "advice",
    text: replies.advice,
    source: { title: replies.advice_link_title, url: replies.advice_link_url },
    lastUpdated: null,
    resolvedQuestion: null,
    scheme,
  };
}

function returnsReply(scheme: SchemeId): ChatReply {
  const info = SCHEMES[scheme];
  if (!info.fundFactsDoc) {
    return { type: "returns", text: replies.returns_general, source: null, lastUpdated: null, resolvedQuestion: null, scheme };
  }
  return { type: "returns", text: replies.returns.replace("{scheme}", info.name), ...cite(info.fundFactsDoc), resolvedQuestion: null, scheme };
}

function notFound(scheme: SchemeId, question: string, debug?: ChatReply["debug"]): ChatReply {
  const info = SCHEMES[scheme];
  if (!info.directPageDoc) {
    return { type: "not_found", text: replies.not_found_general, ...cite("gen-investor-faqs"), resolvedQuestion: question, scheme, debug };
  }
  return { type: "not_found", text: replies.not_found, ...cite(info.directPageDoc), resolvedQuestion: question, scheme, debug };
}

function stripLinks(t: string) {
  return t.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
