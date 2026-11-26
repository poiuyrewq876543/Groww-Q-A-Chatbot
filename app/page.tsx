"use client";
// One chat screen. The conversation lives only in this browser tab's memory: nothing is saved on the server.
import { useEffect, useRef, useState } from "react";

type SchemeId = "flexi-cap" | "mid-cap" | "balanced-advantage" | "general";
const OPTIONS: { id: SchemeId; label: string }[] = [
  { id: "flexi-cap", label: "HDFC Flexi Cap Fund" },
  { id: "mid-cap", label: "HDFC Mid Cap Fund" },
  { id: "balanced-advantage", label: "HDFC Balanced Advantage Fund" },
  { id: "general", label: "General question" },
];
const EXAMPLES: Record<SchemeId, string[]> = {
  "flexi-cap": ["What is the exit load?", "What is the expense ratio of the direct plan?", "What is the benchmark?"],
  "mid-cap": ["What is the minimum SIP amount?", "What is the riskometer level?", "What is the exit load?"],
  "balanced-advantage": ["What is the exit load?", "What is the benchmark?", "What is the expense ratio?"],
  general: [
    "How do I download my consolidated account statement?",
    "What is the minimum SIP for HDFC Mid Cap Fund?",
    "What is the riskometer of HDFC Flexi Cap Fund?",
  ],
};

interface Msg {
  role: "user" | "bot";
  text: string;
  type?: string;
  source?: { title: string; url: string } | null;
  lastUpdated?: string | null;
}

function formatDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function Home() {
  const [scheme, setScheme] = useState<SchemeId>("mid-cap");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [prevQuestion, setPrevQuestion] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Block body on purpose: newer browsers return a Promise from scrollIntoView,
  // and React would try to call a returned value as the effect's cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function ask(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, scheme, previousQuestion: prevQuestion }),
      });
      const data = await res.json();
      setMsgs((m) => [...m, { role: "bot", text: data.text, type: data.type, source: data.source, lastUpdated: data.lastUpdated }]);
      if (data.resolvedQuestion) setPrevQuestion(data.resolvedQuestion);
    } catch {
      setMsgs((m) => [...m, { role: "bot", text: "Something went wrong. Please try again.", type: "error" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <div className="top">
        <div className="bar">
          <div className="logo" aria-hidden>MF</div>
          <div>
            <h1>Mutual Fund Facts Assistant</h1>
            <p>Answers from official HDFC Mutual Fund documents</p>
          </div>
        </div>
        <div className="facts-note" role="note">Facts-only. No investment advice.</div>
        <div className="selector">
          <label htmlFor="scheme">Scheme</label>
          <select
            id="scheme"
            value={scheme}
            onChange={(e) => {
              setScheme(e.target.value as SchemeId);
              setPrevQuestion(null);
            }}
          >
            {OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <section className="chat" aria-live="polite">
        <div className="msg bot welcome">
          Hi! Ask me a factual question about an HDFC Mutual Fund scheme, such as its exit load, expense ratio, minimum SIP,
          riskometer, or benchmark, or how to download your statement. Every answer links to the official source.
          <div className="examples">
            {EXAMPLES[scheme].map((q) => (
              <button key={q} onClick={() => ask(q)} disabled={busy}>{q}</button>
            ))}
          </div>
        </div>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.type ?? ""}`}>
            {m.text}
            {m.role === "bot" && (m.source || m.lastUpdated) && (
              <div className="meta">
                {m.source && (
                  <span>
                    Source: <a href={m.source.url} target="_blank" rel="noopener noreferrer">{m.source.title}</a>
                  </span>
                )}
                {m.lastUpdated && <span>Last updated from sources: {formatDate(m.lastUpdated)}</span>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="typing">Checking official sources...</div>}
        <div ref={endRef} />
      </section>

      <div className="composer">
        <p className="hint">Do not enter PAN, Aadhaar, phone, or account details.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a factual question..."
            maxLength={500}
            aria-label="Your question"
          />
          <button type="submit" disabled={busy || !input.trim()}>Ask</button>
        </form>
      </div>
    </main>
  );
}
