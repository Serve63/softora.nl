# Luna mailbox evaluation — 2026-09-21

**Not approved for activation.** In the first round, twenty real Responses API calls were made with the existing
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

The follow-up evaluation below tests that prompt clarification. The first-round passes did not predict universal correctness.


## Second round: ten regression cases and ten new cases

A further twenty calls were explicitly approved, with USD 1 as the combined cap for both rounds.
The model/prompt remained the clarified version from `c1c2fc20`. A Unicode phone-validation fix
accepts typographic spaces/dashes/full-width digits for validation while preserving the exact
source contact text. Expectations were defined before execution. New cases include Dutch and
English forwarded headers, Japanese/Spanish signatures, a personal addition inside an HTML
signature container, side-by-side signature fields, and authored legal text.

The initial end-to-end expectation score was **16/20**, including one intentional safe fallback:

- Relevant forwarded requirements: three requirement lines labelled `quote` would disappear.
- Dutch forwarded confirmation: the deadline labelled `quote` would disappear.
- French signature: `Bien cordialement,` remained labelled `authored`.
- English forwarded headers: timeout after 45 seconds; the original is retained, no retry made.

This invalidates prompt-only reliance on the `quote` label as deletion evidence. It is not fixed
by declaring the forwarding cases unimportant or weakening their expected content.

### General safety change and recorded-output replay

Only signature-labelled lines can now be hidden; `quote` lines remain visible. A single supposed
signature line between retained nonempty content also remains visible. The latter protects the
first-round lost attribution without a list of company names, languages or header phrases.
The renderer may consequently retain extra historical text or an ambiguous one-line footer.

Replaying the **same twenty real responses** through the changed shared root/thread presentation
retained every expected authored line in all twenty cases. Root and thread bodies matched and
canonical source text remained unchanged. This replay made **zero additional API calls**. The
specific real quote-misclassification and isolated-header failure are permanent regression tests.

This proves the changed deletion rule against those observed outputs, not perfect model semantics
or all future inputs. The retained French closing and the model timeout remain limits to cleanup
quality/availability. The original text is visible on timeout; the failed job is not retried
without a new budgeted attempt under the existing conservative worker policy.

### Second-round cost evidence

Nineteen responses supplied usage: 12,503 input tokens and 8,306 output tokens. Their estimated
standard usage cost is USD 0.0124678. The timed-out request has unknown final billed usage;
its full conservative USD 0.04 reservation remains counted. Combined known token cost for both
rounds is USD 0.0247832; including that full timeout reservation yields **less than USD 0.065**.
These are pricing-based estimates/bounds, not invoices. Forty authorized calls were attempted
in total, with no automatic retry and no production activation.


## Third round: repeated holdouts within the same budget

The owner authorized continued testing within the cumulative USD 1 cap, without a per-20-call
approval limit. Sixty additional calls tested thirty constructed cases twice each: twenty
second-round cases and ten previously unseen cases with expectations fixed before execution.
New cases include authored role/availability text, promotional copy requested for a website,
contact-page instructions, requested legal wording, a one-word reply, code samples, customer
requirements in quotations, an important bare URL, discussion of mobile footers, and no signature.
The tested implementation was unchanged at `7dafea8e`.

- All 60 rendered outputs retained every expected authored line, including original fallback.
- 57 requests returned HTTP 200; three timed out at 45 seconds and retained the original.
- Two HTTP-200 footer-only cases intentionally failed validation and retained the original.
- 47 outputs contained none of the originally designated removable lines. Thirteen retained
  at least one: this includes deliberate retention of historical quotes, two footer-only
  fallbacks, the three timeouts, and imperfect signature selection. This is not a 60/60 cleanup pass.
- A French closing remained in one of two repeats. Both English-forward repeats retained
  their signoff/name/company; one requested-disclaimer repeat retained the sender signature.
  Repetition therefore demonstrates remaining selection variability, not deterministic quality.
- No extra contact values were selected. Expected contacts were missing only in one timed-out
  request, whose entire original remained available.

The runner reserved USD 0.04 before each request, settled only responses with reported token
usage, and retained the full reservation for unknown timeout billing. Previous rounds were
conservatively carried forward as USD 0.07. This round accounts for USD 0.175926, including
three USD 0.04 timeout reservations; the cumulative conservative amount is **USD 0.245926**.
This uses a conservative USD 0.25/million for all input and USD 1.20/million output and rounds
up each completed request. It is an estimated accounting bound, not a billing invoice.

There have now been 100 real evaluation attempts. These are constructed messages, not a
production mailbox sample. No production activation, migration or processing-budget approval
has occurred. `verify:critical` passed again after these tests. Next release gate remains
cleanup/availability review and authenticated end-to-end proof; retaining all expected text
in this suite must not be presented as universal future accuracy.


## Follow-up: structural failures and revised selection

Round 4 ran 76 real requests: 38 constructed cases twice each. All returned HTTP 200;
two footer-only cases intentionally fell back. Original expected body lines were retained in
74/76, **not 76/76**: both repeats of a complete signature supplied as publication copy lost
the four sample lines. Earlier residual French/forwarded/requested-disclaimer signoffs were
cleaned, but the new loss blocks activation. A preliminary progress claim of no lost text was
corrected after inspecting the complete results. Known conservative usage for this round was
USD 0.052296, bringing its carried-forward total to USD 0.302296.

Round 5 tested two actual incoming messages from a previously reported conversation, three
times each, without writing model results to the mailbox. Four of the six requests exhausted
the 8192-output/reasoning limit and returned incomplete output. They preserved the original;
this is a processing failure, not successful cleanup. All HTTP statuses were 200. One of the
successful requests needed 33.8 seconds. Conservative usage was USD 0.049260; with rounded
prior accounting the round ended at USD 0.352260. No raw production message is committed.

Round 6 simplified content-versus-history classification and increased the output/reasoning
cap to 16384, keeping Luna/max and a 120-second request deadline. There were 82 requests:
76 constructed-message repetitions plus the same six real-message repetitions. All returned
HTTP 200, with no provider timeout or output-limit failure; two footer-only cases intentionally
fell back. All originally required lines were retained. All six real-message results retained
required content and selected the expected current-sender phone; the slowest took 93.651 seconds.
This demonstrates a case that the previous 45-second deadline would terminate, not guaranteed
provider availability. The round accounted for USD 0.088022; rounded cumulative accounting was
USD 0.443022. All these rounds were one-pass candidates, not the final two-pass implementation.

A stricter review also found that quoted address lines can be wrongly treated as a footer even
when the surrounding message asks the recipient to use those details. Earlier fixture labels
classified that entire history block as removable. The next evaluation explicitly strengthens
content-retention expectations for those address lines, inline quoted questions and attribution;
it must not be compared to earlier full-cleanup percentages as an unchanged benchmark.

### Final architecture under evaluation

Selection now returns **only footer indices**, rather than a label for every line including blanks.
Unselected lines stay visible by construction. This avoids unnecessary history classification
and position-counting output. A second Luna/max request sees the original nonempty lines and
candidate indices and must confirm safe removals. It may only restore candidate lines; unknown,
out-of-range or duplicate indices invalidate the review. Restored contacts stay in the original
text and are not duplicated into a signature card. Failure of either stage retains the source.
This remains probabilistic review by the same model, not a proof of universal semantic accuracy.

The atomic production reservation is now USD 0.10 for up to two bounded requests per job;
initial approved budget remains zero. Both calls use the same 100 KB / 16384-token bounds,
120-second deadline, strict output and no automatic retry. No environment flag, production
budget, migration or deployment has been changed.


### Two-pass evaluation and remaining limitation

Round 7 evaluated 43 messages using 80 API requests (review is skipped when no valid footer
candidates exist). Expectations were declared before the calls. Quoted contact details,
inline questions and attribution were explicitly required to remain. **40/43** met all cleanup
expectations; all 43 retained required content and expected contacts. Three retained unnecessary
footer text: a signoff after requested disclaimer copy, office availability in an identity block,
and a quoted sender footer. Both actual messages passed in both repetitions. Root/thread body
output agreed for every case and source data was unchanged. Accounting reached USD 0.487252.

After clarifying the review's distinction between actual office availability and scheduling
requests, and between quoted requirements and their sender footer, round 8 evaluated 46 messages
with 85 API requests. It repeated the 43 cases and added three previously unseen holdouts:
office-hours context, a German forwarded footer, and an English complete signature example.

- **45/46** fully matched the declared expectations, including one intentional footer-only fallback.
- **46/46** retained every required content line and matched expected signature contacts.
- No provider timeout, incomplete generation, invalid review or invented contact occurred.
- Both actual mails passed twice. Their total selection/review times ranged 1.868–32.967 seconds.
- Root/thread output agreed and canonical source stayed unchanged in all 46 cases.
- The remaining miss is explicit: `Graag deze exacte tekst toevoegen:` followed by a disclaimer
  and a closing/name/company block resulted in no proposed removals. That entire passage stayed.
  This is safe content retention but incomplete cleanup, not a perfect result or a changed expectation.

The last round conservatively accounted for USD 0.047251 on top of USD 0.488 carried forward:
**USD 0.535251 cumulative** including rounded prior usage and earlier unknown-timeout reservations.
Across the entire evaluation there have been 429 paid requests (264 through round 6, then 80 and 85).
No automatic request retry, credit purchase, production classification or activation occurred.
The two-pass design adds a safeguard, not mathematical certainty: the same model can still
misunderstand an unknown message. The known ambiguous-footer miss remains visible for rollout review.

The implementation is suitable for a separately approved, bounded live pilot, not an unrestricted
claim that every existing/future mail is clean. Production backup/migration, protected release,
explicit production processing budget and authenticated feature-enabled UI proof remain required.
The browser inspection in this evaluation read source messages from the existing live mailbox;
it did not run or demonstrate the new feature on production.

Final classifier SHA-256: `6e0f1fbfe210b0f634c96158a43784af1b68e02b49a7beb1fc2f8696e086b611`.
Removal reviewer SHA-256: `1c86ed5cf8ea136f460b3ecaaed3d7c6955520e273ae608e405460143d7ac6cc`.
