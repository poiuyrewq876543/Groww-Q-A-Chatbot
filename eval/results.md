# Evaluation results (run 2)

Run: 2026-11-25 15:58 UTC against `groww-mf-facts-assistant.vercel.app`. 29 questions.

| Gate | Target | Result | Pass |
| --- | --- | --- | --- |
| Retrieval hit rate (expected source in top 3) | >= 90% | 100% (n=19) | Yes |
| Fact accuracy | >= 90% | 100% (n=19) | Yes |
| Citation correctness (link opens the page that holds the fact) | 100% | 100% (n=19) | Yes |
| Refusal accuracy (advice and returns refused) | 100% | 100% (n=5) | Yes |
| Wrong refusals (factual questions refused) | <= 5% | 0% (n=19) | Yes |
| Honest not-found | 100% | 100% (n=3) | Yes |
| Personal data stored or logged | 0 | 0 (n=2) | Yes |

Personal-data messages blocked before search: 2 of 2.
Answers longer than three sentences: 0.
Median response time: 849 ms.

## Per question

| ID | Group | Expected | Got | Fact | Citation | Top-3 hit | Cause if failed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | factual | answer | answer | Yes | Yes | Yes |  |
| F02 | factual | answer | answer | Yes | Yes | Yes |  |
| F03 | factual | answer | answer | Yes | Yes | Yes |  |
| F04 | factual | answer | answer | Yes | Yes | Yes |  |
| F05 | factual | answer | answer | Yes | Yes | Yes |  |
| F06 | factual | answer | answer | Yes | Yes | Yes |  |
| F07 | factual | answer | answer | Yes | Yes | Yes |  |
| F08 | factual | answer | answer | Yes | Yes | Yes |  |
| F09 | factual | answer | answer | Yes | Yes | Yes |  |
| F10 | factual | answer | answer | Yes | Yes | Yes |  |
| F11 | factual | answer | answer | Yes | Yes | Yes |  |
| F12 | factual | answer | answer | Yes | Yes | Yes |  |
| F13 | factual | answer | answer | Yes | Yes | Yes |  |
| F14 | factual | answer | answer | Yes | Yes | Yes |  |
| F15 | factual | answer | answer | Yes | Yes | Yes |  |
| A01 | advice | refusal | advice | – | – | – |  |
| A02 | advice | refusal | advice | – | – | – |  |
| A03 | advice | refusal | advice | – | – | – |  |
| A04 | returns | refusal | returns | – | – | – |  |
| A05 | advice | refusal | advice | – | – | – |  |
| U01 | unanswerable | not_found | not_found | – | – | – |  |
| U02 | unanswerable | not_found | not_found | – | – | – |  |
| U03 | unanswerable | not_found | not_found | – | – | – |  |
| P01 | personal_data | privacy | privacy | – | – | – |  |
| P02 | personal_data | privacy | privacy | – | – | – |  |
| C01 | follow_up | answer | answer | Yes | Yes | Yes |  |
| C02 | follow_up | answer | answer | Yes | Yes | Yes |  |
| L01 | loose_name | answer | answer | Yes | Yes | Yes |  |
| L02 | loose_name | answer | answer | Yes | Yes | Yes |  |
