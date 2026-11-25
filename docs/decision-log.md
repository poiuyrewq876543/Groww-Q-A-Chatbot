# Decision log

Each entry records a decision, the options that were weighed, and why the chosen option won.

## 1. Build a RAG pipeline, not a facts table

- **Chosen:** retrieval-augmented generation over the 19 official documents.
- **Considered:** a hand-typed facts table (one row per scheme, one column per fact), and pasting whole documents into the prompt.
- **Why:** the course brief grades retrieval with accurate citations, and a model on its own does not reliably know a scheme's current exit load. A facts table is accurate and cheap for three schemes, and it would be a sensible first version of a real product, but it shows no retrieval and fails on any unplanned question. Whole documents in the prompt are slow and costly, because scheme documents run past 100 pages, and they make exact citations harder.

## 2. Narrow scope on purpose

- **Chosen:** one fund house, three schemes, six fact types, English only, no accounts.
- **Why:** a small corpus lets every source be checked by hand and every answer be tested. Advice needs SEBI registration, so it is refused. Return figures are banned by the brief, so they are never stated or computed.

## 3. Stack

| Part | Choice | Reason |
| --- | --- | --- |
| App and API | One Next.js app on Vercel | One deploy, a live link for reviewers |
| Document store | Neon Postgres with pgvector | Hosted, free tier, vector and keyword search in one database |
| Embeddings | `gemini-embedding-2` at 768 dimensions | Low cost; the daily free quota for `gemini-embedding-001` was exhausted during the build, and `gemini-embedding-2` has its own quota |
| Answers | `gemini-3.1-flash-lite` with JSON output, temperature 0 | Lowest-cost current Gemini model; the task is rephrasing short retrieved text |
| Ingestion | A script run by hand, never a Vercel function | Reading large PDFs would time out a short-lived function |

## 4. Citations are attached by code

The model returns the number of the piece it used. Code maps that piece to its document in `data/manifest.json` and attaches the URL and collection date. The model never writes a link or a date, so it cannot invent one.

## 5. Fund pages are read from structured data

The fund pages are a Next.js app. Their facts (TER for both plans, exit load, minimum SIP, riskometer, benchmark) sit in the page's embedded JSON. Ingestion reads only the Overview block. It never reads the performance block, holdings, menus, footer or the scrolling returns ticker, so no return figure can reach the store.

## 6. Fund Facts PDFs are low-trust

Fund Facts PDFs print labels and values in separate blocks, so a number can be paired with the wrong label. They stay in the corpus, because they are the link used for returns questions, but search ranks fund pages, scheme summaries and KIMs above them.

## 7. Safety checks run before search, in a fixed order

Personal data, then advice, then returns, then the follow-up rewrite, then search. A message with personal data never reaches the model, the database or the logs. Rule-based checks catch most advice; the answer prompt also lets the model flag disguised advice, which then gets the same fixed refusal.

## 8. Separate database tables

The Neon database already held `chunks` and `documents` tables from an earlier attempt. To avoid deleting anything, this build uses its own tables: `mf_documents`, `mf_chunks`, `mf_rate_limits` and `mf_query_cache`.
