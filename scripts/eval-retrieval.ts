// npm run eval:retrieval
// Stage 2 gate: for every question that expects a factual answer, is an expected source in the top 3?
// Runs search() directly, before any model writes an answer.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { search } from "../lib/search";
import { detectScheme, SCHEMES, SchemeId } from "../lib/schemes";

async function main() {
  const rows: any[] = parse(fs.readFileSync(path.join(process.cwd(), "eval", "questions.csv")), { columns: true, skip_empty_lines: true });
  const factual = rows.filter((r) => r.expected_type === "answer");
  let hits = 0;
  const lines: string[] = [];
  for (const r of factual) {
    const scheme: SchemeId = detectScheme(r.question) ?? detectScheme(r.previous_question || "") ?? r.scheme;
    // Follow-ups are searched with the previous question for context, as the rewrite step would supply.
    let text = r.previous_question ? `${r.previous_question} ${r.question}` : r.question;
    if (!/hdfc/i.test(text) && scheme !== "general") text = `${text} for ${SCHEMES[scheme].name}`;
    const pieces = await search(text, scheme);
    const top3 = pieces.slice(0, 3).map((p) => p.doc_id);
    const expected = r.expected_doc_id.split("|");
    const hit = top3.some((d: string) => expected.includes(d));
    if (hit) hits++;
    lines.push(`${hit ? "HIT " : "MISS"} ${r.id} [${top3.join(", ")}] sims=${pieces.slice(0, 3).map((p) => p.similarity.toFixed(3)).join("/")} :: ${r.question}`);
  }
  const rate = Math.round((1000 * hits) / factual.length) / 10;
  lines.push(`\nRetrieval hit rate: ${hits}/${factual.length} = ${rate}% (gate: 90%)`);
  console.log(lines.join("\n"));
  fs.writeFileSync(path.join(process.cwd(), "eval", "retrieval-results.txt"), lines.join("\n") + "\n");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
