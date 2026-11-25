// npm run demo -- --base https://...  Runs the BRD's six-step demo script against a live URL
// as an ordinary visitor (no eval token), and writes docs/demo-run.md.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://groww-mf-facts-assistant.vercel.app";

async function ask(message: string, scheme: string, previousQuestion: string | null = null) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, scheme, previousQuestion }),
  });
  return { status: res.status, ...(await res.json()) };
}

// Checks that the cited link opens (HTTP 200), using curl with browser headers because the site filters bots.
function linkStatus(url: string): string {
  try {
    return execFileSync("curl", ["-s", "-o", "/dev/null", "-L", "-m", "40", "-w", "%{http_code}", "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "-H", "Accept: text/html,application/pdf,*/*", "-H", "Accept-Language: en-US,en;q=0.9", "-H", "Sec-Fetch-Mode: navigate", "-H", "Sec-Fetch-Dest: document", "-H", "Sec-Fetch-Site: none", "-H", "Sec-Fetch-User: ?1", "-H", "Upgrade-Insecure-Requests: 1", "-H", 'sec-ch-ua: "Chromium";v="131", "Not_A Brand";v="24"', "-H", "sec-ch-ua-mobile: ?0", "-H", 'sec-ch-ua-platform: "macOS"', "--compressed", url]).toString();
  } catch {
    return "error";
  }
}

async function main() {
  const steps: [string, string, string, boolean][] = [
    ["1. Factual question about the selected scheme", "What is the exit load?", "mid-cap", false],
    ["2. Follow-up without naming the scheme", "And the minimum SIP?", "mid-cap", true],
    ["3. Advice question", "Should I buy this fund?", "mid-cap", false],
    ["4. Returns question", "What returns has this fund given in the last 3 years?", "mid-cap", false],
    ["5. Made-up PAN", "My PAN is ABCPE1234K, what is my balance?", "mid-cap", false],
    ["6. Something the sources do not cover", "When is the next IDCW record date?", "mid-cap", false],
  ];
  let prev: string | null = null;
  let md = `# Demo run against the live app\n\nURL: ${BASE}  \nRun: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, as an ordinary visitor. Selected scheme: HDFC Mid Cap Fund.\n\n`;
  for (const [title, q, scheme, useprev] of steps) {
    const r: any = await ask(q, scheme, useprev ? prev : null);
    if (r.resolvedQuestion) prev = r.resolvedQuestion;
    const link = r.source?.url ? `[${r.source.title}](${r.source.url}) (opens: HTTP ${linkStatus(r.source.url)})` : "none";
    md += `## ${title}\n\n**User:** ${q}\n\n**Reply type:** ${r.type}\n\n**Assistant:** ${r.text}\n\n**Source:** ${link}\n\n**Last updated from sources:** ${r.lastUpdated ?? "not shown"}\n\n`;
    console.log(title, "=>", r.type, r.source?.url ? "link" : "", r.lastUpdated ?? "");
  }
  fs.writeFileSync("docs/demo-run.md", md);
}
main();
