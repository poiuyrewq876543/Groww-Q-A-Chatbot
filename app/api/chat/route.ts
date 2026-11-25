// POST /api/chat
// Body: { message: string, scheme: "flexi-cap" | "mid-cap" | "balanced-advantage" | "general", previousQuestion?: string }
// Messages are never logged or stored. Only a salted hash of the visitor's IP is kept, for rate limiting.
import { NextRequest, NextResponse } from "next/server";
import replies from "../../../config/replies.json";
import { answerQuestion } from "../../../lib/assistant";
import { checkRateLimit } from "../../../lib/rate-limit";
import { isSchemeId } from "../../../lib/schemes";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ type: "error", text: replies.error }, { status: 400 });
  }
  const message = typeof body?.message === "string" ? body.message : "";
  const scheme = isSchemeId(body?.scheme) ? body.scheme : "general";
  const previousQuestion = typeof body?.previousQuestion === "string" ? body.previousQuestion.slice(0, 500) : null;
  if (!message.trim()) return NextResponse.json({ type: "error", text: replies.empty }, { status: 400 });
  if (message.length > 500) return NextResponse.json({ type: "error", text: replies.too_long }, { status: 400 });

  const evalToken = process.env.EVAL_TOKEN;
  const isEval = !!evalToken && req.headers.get("x-eval-token") === evalToken;
  if (!isEval) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
    const ok = await checkRateLimit(ip).catch(() => true);
    if (!ok) return NextResponse.json({ type: "rate_limited", text: replies.rate_limited, source: null, lastUpdated: null }, { status: 429 });
  }

  try {
    const reply = await answerQuestion({ message, scheme, previousQuestion, debug: isEval && body?.debug === true });
    return NextResponse.json(reply);
  } catch (e: any) {
    // Log only the error class, never the message text.
    console.error("chat_error", e?.name || "Error");
    return NextResponse.json({ type: "error", text: replies.error, source: null, lastUpdated: null }, { status: 500 });
  }
}
