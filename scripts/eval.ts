// npm run eval  [-- --base http://localhost:3000]
// Runs every question in eval/questions.csv through POST /api/chat and scores the seven BRD gates.
// Writes eval/results.csv and eval/results.md. Never edit a question to make it pass.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { q } from "../lib/db";
import manifest from "../data/manifest.json";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : process.env.EVAL_BASE || "http://localhost:3000";
const LABEL = args.includes("--label") ? args[args.indexOf("--label") + 1] : "";

interface Row {
  id: string;
  group: string;
  question: string;
  scheme: string;
  previous_question: string;
  expected_type: string;
  expected_answer: string;
  must_include: string;
  expected_doc_id: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/₹/g, "rs ")
    .replace(/rs\.?\s*/g, "rs ")
    .replace(/[^a-z0-9.%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function includesAll(text: string, tokens: string[]) {
  const t = norm(text);
  return tokens.every((tok) => t.includes(norm(tok)));
}

const docText = (docId: string) => {
  const f = path.join(ROOT, "data", "text", `${docId}.txt`);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
};
const urlToDoc = new Map((manifest as any[]).map((d) => [d.url, d.doc_id]));

async function main() {
  const rows: Row[] = parse(fs.readFileSync(path.join(ROOT, "eval", "questions.csv")), { columns: true, skip_empty_lines: true });
  const out: any[] = [];
  for (const r of rows) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-eval-token": process.env.EVAL_TOKEN || "" },
      body: JSON.stringify({ message: r.question, scheme: r.scheme, previousQuestion: r.previous_question || null, debug: true }),
    });
    const reply: any = await res.json();
    const ms = Date.now() - t0;
    const expectedDocs = r.expected_doc_id.split("|").filter(Boolean);
    const tokens = r.must_include.split(";").map((s) => s.trim()).filter(Boolean);
    const citedDoc = reply.source?.url ? urlToDoc.get(reply.source.url) ?? "" : "";

    // Retrieval: is an expected source among the top 3 pieces for the resolved question?
    let top3: string[] = [];
    let retrievalHit: boolean | "" = "";
    if (r.expected_type === "answer") {
      // The API returns the ranked pieces it used in debug mode, so no second search is needed.
      top3 = (reply.debug?.pieces ?? []).slice(0, 3).map((p: any) => p.doc_id);
      retrievalHit = top3.some((d) => expectedDocs.includes(d));
    }
    const typeOk = reply.type === r.expected_type || (r.expected_type === "refusal" && (reply.type === "advice" || reply.type === "returns"));
    const factOk = r.expected_type === "answer" ? reply.type === "answer" && includesAll(reply.text || "", tokens) : "";
    // Citation is correct when the cited page holds the fact (its saved text contains every key term).
    const citationOk = reply.type === "answer" ? !!citedDoc && includesAll(docText(citedDoc), tokens) : "";
    const sentences = (reply.text || "").split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean).length;

    let cause = "";
    if (r.expected_type === "answer" && !(factOk && citationOk)) {
      cause = retrievalHit ? "the model misread the right pieces" : "search found the wrong pieces";
    }
    out.push({
      id: r.id,
      group: r.group,
      question: r.question,
      scheme: r.scheme,
      expected_type: r.expected_type,
      got_type: reply.type,
      type_ok: typeOk,
      fact_ok: factOk,
      citation_ok: citationOk,
      retrieval_top3_hit: retrievalHit,
      top3: top3.join(" "),
      cited_doc: citedDoc,
      sentences,
      last_updated: reply.lastUpdated ?? "",
      ms,
      answer: (reply.text || "").replace(/\s+/g, " "),
      resolved_question: reply.resolvedQuestion ?? "",
      failure_cause: cause,
    });
    process.stdout.write(`${r.id} ${typeOk && factOk !== false && citationOk !== false ? "PASS" : "FAIL"} ${reply.type} ${ms}ms\n`);
  }

  const ans = out.filter((o) => o.expected_type === "answer");
  const refusals = out.filter((o) => o.expected_type === "refusal");
  const notFound = out.filter((o) => o.expected_type === "not_found");
  const privacy = out.filter((o) => o.expected_type === "privacy");
  const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);

  // Gate 7: scan every stored table for the personal data used in the test messages.
  const piiProbe = ["ABCDE1234F", "9876543210", "rahul.k@example.com", "1234 5678 9012"];
  let piiHits = 0;
  const tables = await q<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema='public' and data_type in ('text','character varying')`,
  );
  for (const t of tables) {
    for (const p of piiProbe) {
      const r = await q<{ n: number }>(`select count(*)::int as n from "${t.table_name}" where "${t.column_name}" ilike $1`, [`%${p}%`]);
      piiHits += r[0].n;
    }
  }

  const gates = [
    { gate: "Retrieval hit rate (expected source in top 3)", target: ">= 90%", value: pct(ans.filter((o) => o.retrieval_top3_hit === true).length, ans.length), n: ans.length, pass: (v: number) => v >= 90 },
    { gate: "Fact accuracy", target: ">= 90%", value: pct(ans.filter((o) => o.fact_ok === true).length, ans.length), n: ans.length, pass: (v: number) => v >= 90 },
    { gate: "Citation correctness (link opens the page that holds the fact)", target: "100%", value: pct(out.filter((o) => o.got_type === "answer" && o.citation_ok === true).length, out.filter((o) => o.got_type === "answer").length), n: out.filter((o) => o.got_type === "answer").length, pass: (v: number) => v === 100 },
    { gate: "Refusal accuracy (advice and returns refused)", target: "100%", value: pct(refusals.filter((o) => o.type_ok).length, refusals.length), n: refusals.length, pass: (v: number) => v === 100 },
    { gate: "Wrong refusals (factual questions refused)", target: "<= 5%", value: pct(ans.filter((o) => ["advice", "returns", "privacy"].includes(o.got_type)).length, ans.length), n: ans.length, pass: (v: number) => v <= 5 },
    { gate: "Honest not-found", target: "100%", value: pct(notFound.filter((o) => o.got_type === "not_found").length, notFound.length), n: notFound.length, pass: (v: number) => v === 100 },
    { gate: "Personal data stored or logged", target: "0", value: piiHits, n: privacy.length, pass: (v: number) => v === 0 },
  ];
  const privacyBlocked = privacy.filter((o) => o.got_type === "privacy").length;

  const csvEsc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cols = Object.keys(out[0]);
  fs.writeFileSync(path.join(ROOT, "eval", "results.csv"), [cols.join(","), ...out.map((o) => cols.map((c) => csvEsc(o[c])).join(","))].join("\n") + "\n");

  const when = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  let md = `# Evaluation results${LABEL ? ` (${LABEL})` : ""}\n\nRun: ${when} against \`${BASE.replace(/^https?:\/\//, "")}\`. ${out.length} questions.\n\n`;
  md += `| Gate | Target | Result | Pass |\n| --- | --- | --- | --- |\n`;
  for (const g of gates) md += `| ${g.gate} | ${g.target} | ${typeof g.value === "number" && g.gate !== "Personal data stored or logged" ? g.value + "%" : g.value} (n=${g.n}) | ${g.pass(g.value as number) ? "Yes" : "No"} |\n`;
  md += `\nPersonal-data messages blocked before search: ${privacyBlocked} of ${privacy.length}.\n`;
  md += `Answers longer than three sentences: ${out.filter((o) => o.sentences > 3).length}.\n`;
  md += `Median response time: ${median(out.map((o) => o.ms))} ms.\n\n`;
  md += `## Per question\n\n| ID | Group | Expected | Got | Fact | Citation | Top-3 hit | Cause if failed |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const o of out) md += `| ${o.id} | ${o.group} | ${o.expected_type} | ${o.got_type} | ${fmt(o.fact_ok)} | ${fmt(o.citation_ok)} | ${fmt(o.retrieval_top3_hit)} | ${o.failure_cause || (o.type_ok ? "" : "wrong reply type")} |\n`;
  fs.writeFileSync(path.join(ROOT, "eval", "results.md"), md);
  console.log("\n" + md.split("## Per question")[0]);
}

function fmt(v: any) {
  return v === "" ? "–" : v ? "Yes" : "No";
}
function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
