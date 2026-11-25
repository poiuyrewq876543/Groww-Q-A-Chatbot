// Minimal Gemini REST client for embeddings and text generation.
// The key is read from GEMINI_API_KEY and sent in a header, never in a URL or a log line.

const BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
export const EMBED_MODEL = process.env.EMBED_MODEL || "gemini-embedding-2";
export const CHAT_MODEL = process.env.CHAT_MODEL || "gemini-3.1-flash-lite";
export const EMBED_DIM = 768;

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY is not set");
  return k;
}

async function post(path: string, body: unknown, attempt = 0): Promise<any> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify(body),
  });
  // 429 = per-minute quota on the free tier. Wait for the window to reset and retry.
  if (res.status === 429 && attempt < (Number(process.env.GEMINI_MAX_RETRIES) || 2)) {
    await new Promise((r) => setTimeout(r, Number(process.env.GEMINI_429_WAIT_MS) || 3000));
    return post(path, body, attempt + 1);
  }
  if (res.status >= 500 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return post(path, body, attempt + 1);
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${path.split(":")[1] || path} failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return res.json();
}

function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export async function embedBatch(texts: string[], task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  const out: number[][] = [];
  const size = Number(process.env.EMBED_BATCH) || 100;
  for (let i = 0; i < texts.length; i += size) {
    const slice = texts.slice(i, i + size);
    const json = await post(`models/${EMBED_MODEL}:batchEmbedContents`, {
      requests: slice.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t }] },
        taskType: task,
        outputDimensionality: EMBED_DIM,
      })),
    });
    for (const e of json.embeddings) out.push(normalise(e.values));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  return (await embedBatch([text], "RETRIEVAL_QUERY"))[0];
}

export async function generate(opts: {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const body: any = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: opts.maxTokens ?? 400,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (process.env.CHAT_THINKING_LEVEL) body.generationConfig.thinkingConfig = { thinkingLevel: process.env.CHAT_THINKING_LEVEL };
  const json = await post(`models/${CHAT_MODEL}:generateContent`, body);
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => (p.thought ? "" : p.text || "")).join("").trim();
}
