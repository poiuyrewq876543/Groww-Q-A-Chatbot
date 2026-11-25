# Evaluation history and fixes

Every failure is sorted into one of two causes: "search found the wrong pieces" or "the model misread the right pieces". No test question was edited.

## Stage 2: retrieval only (before any answers)

Retrieval hit rate 18 of 19 (94.7%), gate 90%: passed. The one miss was F10 ("What is the commission on this fund?"); the fund pages outranked the KIM and SID pieces that mention commission.

## Run 0: first deploy

The first nine questions all returned the fixed error reply. Cause: `gemini-3.1-flash-lite` answered HTTP 503 ("high demand") on the free tier. Fix: `gemini-3.5-flash-lite` became the main answer model, with `gemini-3.1-flash-lite` as an automatic fallback, and server errors now retry once instead of three times.

## Run 1 (live URL)

| Gate | Result |
| --- | --- |
| Retrieval hit rate | 94.7% |
| Fact accuracy | 84.2% (failed) |
| Citation correctness | 100% |
| Refusal accuracy | 100% |
| Wrong refusals | 0% |
| Honest not-found | 100% |
| Personal data stored | 0 |

| Failure | Cause | Fix |
| --- | --- | --- |
| F10 commission: replied "not found" | Search found the wrong pieces. The keyword query still contained the scheme name ("flexi", "cap"), so every piece of the fund page matched it and the pieces about commission did not rise. | Scheme-name words are now dropped from the keyword query (the scheme filter already applies them), and the best keyword matches get a larger reciprocal-rank lift. Retrieval rerun: 19 of 19. |
| F12 BAF expense ratio: error reply | The model misread the right pieces (the right pieces were retrieved; the model call failed or returned malformed JSON). | One retry on a failed or malformed reply, and JSON is extracted from the first {...} block. |
| F15 download a statement: replied "not found" | The model misread the right pieces. The statement page lists the form fields (PAN or folio, duration) and the statement types, but the model did not treat that as a how-to answer. | Added a rule to the answer prompt: for "how do I" questions, describe the steps or details the pieces show. |

## Run 2 (live URL): all seven gates pass

See [results.md](results.md) for the gate table and the per-question result, and [results.csv](results.csv) for every answer.
