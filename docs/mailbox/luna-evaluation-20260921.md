# Luna mailbox evaluation — 2026-09-21

**Not approved for activation.** Twenty real Responses API calls were made with the existing
Softora development key, `gpt-5.6-luna`, reasoning `max`, strict structured output, and no
retries. The owner authorized this one-time evaluation with a maximum of USD 1.
No production mailbox processing, environment changes, migration or deployment was performed.

The expected kept/removed lines and contacts were defined before the calls. The test messages
were constructed examples based on reported problems and additional edge cases, not a sampled
production mailbox or a statistical future-mail benchmark.

## Results

- 18 correct source selections and literal phone/address extractions.
- 1 correct safe fallback: an email containing only an automatic footer produced no substantive
  body, so validation rejected the empty presentation and retained the original.
- 1 failure: relevant forwarded requirements retained their substantive lines but lost the
  attribution header `--- Doorgestuurd bericht van Alex ---` as a supposed signature line.
- No invented contact fields, missing expected contacts, or lost substantive requirement/price/
  scheduling lines in this evaluation. Losing the forwarded attribution still fails the gate.

| Case | Expected outcome |
| --- | --- |
| Dutch legal/print disclaimer and job title | Pass |
| Hotel reservation/social promotion | Pass |
| Outlook Android footer and separator | Pass |
| Mixed-language signoff and composite sender name | Pass |
| HTML phone-link evidence | Pass |
| Visible phone number with hidden tel target | Pass |
| Price after signature, without P.S. | Pass |
| Scheduling note after signature, without P.S. | Pass |
| Quoted third-party contact details | Pass |
| New inline answers between old quoted questions | Pass |
| Relevant forwarded content plus attribution | **Fail: attribution header removed** |
| Address/phone in authored instructions versus own signature | Pass |
| English signature and extension | Pass |
| French signature/address | Pass |
| German signature/address | Pass |
| Authored text discussing roles, availability and printing | Pass |
| Footer-only email | Pass: original retained |
| Mixed authored/signature line | Pass: mixed line retained |
| Instructions embedded in email as quoted training content | Pass |
| Unfamiliar creative signature and personal note after it | Pass |

## Usage and timing

Provider-reported usage: 11,597 input tokens and 8,330 output tokens, including 7,125 reasoning
tokens. Cached-input and cache-write tokens were zero. At the documented standard Luna rates
(USD 0.20 input / USD 1.20 output per million), estimated model usage cost is **USD 0.0123154**,
not a billing invoice. Median response time was 3.491 seconds; range 2.200–15.511 seconds.
All twenty HTTP responses were 200 and reported model `gpt-5.6-luna`. No timeout or retry occurred.
The evaluation ledger conservatively reserved the entire USD 1 before the twenty calls.

Tested implementation: `cff118a2`.
Classifier file SHA-256: `d533f90701d9f84a84027d9adec1d899aa7369e6e192dd3554432831f0e2d627`.

## Follow-up

The instructions now explicitly preserve attribution/provenance headers belonging to retained
forwarded content, and only remove an old quote header alongside its removed old content.
This is a general context-preservation rule, not a sender/company-specific filter.

The modified prompt still requires real-model re-evaluation; the prior 19 passes do not establish
its quality. The twenty authorized calls are exhausted. Do not run more model calls or enable
production until the owner authorizes the next concrete action and budget. Offline regression
checks do not substitute for this re-evaluation.
