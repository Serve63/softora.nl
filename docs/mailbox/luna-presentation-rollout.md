# Mailbox Luna presentation — activation gate

Initial rollout status (superseded by the dated sections below): disabled by default, production budget zero. Real evaluation found that both prompt-only
selection and quote-label deletion can lose meaningful content. Selection now proposes footer
indices only; a second Luna review can only restore candidate lines, never delete additional
content. See `luna-evaluation-20260921.md` for the successive failures and evaluations.

The model proposes original nonempty footer-line indices, never rewrites the canonical body.
Blank lines and unselected content stay unchanged; a separate review must confirm removals.
The review can restore text and removes contact-card entries for restored lines. Invalid or
unavailable review results preserve the entire original, never the unreviewed first result. Only literal phone/address
substrings of signature lines enter Softora contact fields. Uncertain lines remain visible.
Invalid, incomplete, refused, unavailable, oversized or stale results retain the source body.
Root and timeline rendering bypass legacy cleanup after AI selection. Quote labels cannot delete text. A lone signature-labelled line between retained nonempty lines also remains visible as an ambiguous boundary. This may retain extra old quote text or an isolated footer line, deliberately preferring context preservation.

## Storage and execution

Apply `20260921093527_mailbox_luna_presentations.sql` only through the approved database release
procedure. Both tables are service-role only, with RLS and revoked public/authenticated access.
The migration approves **zero dollars**. `MAILBOX_AI_PRESENTATION_ENABLED` defaults off.
The feature uses the existing server-side OpenAI key and pins `gpt-6-luna`, `max`; the global
OpenAI model is unchanged. GET `/api/mailbox/presentation/process` requires the cron secret.
Reads enqueue/cache only; a background worker classifies at most two jobs per invocation.
No model call occurs without an atomic reservation from the persisted lifetime budget.

Every claim reserves USD 0.10 conservatively for both requests before any external request.
Each request caps serialized input at 100 KB and total output/reasoning at 16384 tokens.
The second request runs only when valid removal candidates exist. Each has a 120-second
deadline; four requests across two jobs plus storage overhead fit the configured 800-second
function limit. Longer reasoning does not block mailbox reads or trigger automatic retries. This bound uses the
verified Luna standard input/output rates of USD 0.20/1.20 per million tokens; recheck official
pricing before activation or a model/version change. No provider fallback, automatic retry, credit
purchase, refund or budget increase exists. Concurrent workers share the same locked budget.
A crash after claim leaves the job running, preserves its reservation and displays the original;
manual investigation is required, never an automatic replay of an uncertain paid request.

## Required before activation

1. Obtain the owner's concrete amount/action approval under the personal AGENTS cost rule.
   Evaluation approval now covers continued quality tests within USD 1 cumulatively, without a per-batch limit.
   This is not permission for production background processing or a credit purchase.
2. Run real-model evaluations on anonymized fixtures covering unfamiliar/multilingual signatures,
   mixed body/footer lines, source HTML, quoted third parties, inline answers, important URLs,
   prices, signatures with no contacts, personal notes after footers without P.S., and injection
   instructions inside email. Offline fixtures validate plumbing, not model classification accuracy.
3. Review actual output against manually labelled expected text/contact ownership. No loss of
   substantive authored text is acceptable. Preserve uncertainty and fix failures before rollout.
4. Follow protected main/PR release, database backup/migration and exact live-version checks.
   Set a separately approved bounded production budget; only then enable the feature.
5. Verify actual root/thread/contact-dossier rendering, pending-to-ready updates without loading
   screens, existing/new mail, and switching between Serve and Martijn in the authenticated UI.

Oversized messages (>600 lines, >60000 characters, or >100 KB serialized request) deliberately
remain original. Existing indexed inbox/allmail/provider messages seed in batches of 20; opening
other readable messages also queues them. Two jobs per minute is an initial conservative pace,
not a promise that the historical mailbox is instantly processed. Text-only historic records
have less structure than messages whose original HTML is retained.

## Rollback

Set `MAILBOX_AI_PRESENTATION_ENABLED=false` and reload the mailbox; legacy rendering is the
compatibility path. Canonical messages are never changed. Do not drop stored jobs or reset
reserved budget to retry an uncertain request. No send/reply/action-required logic is changed.

## Pilot integration corrections

The worker GET route must reach its own cron-secret guard without requiring a user session.
Background repository calls request the same five-second HTTP deadline as their operation;
interactive enqueue still has a 1.2-second outer deadline. A partial global arrival-date index
supports candidate selection across accounts (account-leading inbox indexes do not).

Presentation identity includes exact body, sender name/email, mailbox and message identity.
Optional HTML hydration is evidence, not a new version of unchanged message text. Apply
`20260921132600_mailbox_ai_stable_source.sql` with the pilot budget paused and no running jobs,
after deploying the stable-key code. It preserves prior paid decisions and reservations,
retains superseded derived entries for audit, and prevents detail hydration from reclassifying
the same content. Original mailbox records are never modified. Labelled Markdown links render
with their original destination and label instead of including markup punctuation in the URL.

## New incoming mail gate (22 September)

The approved follow-up is one-time EUR 20 for incoming mail cleanup, not a purchase or
recurring allowance. Keep existing lifetime reservations. Activate only after deployment
by setting `incoming_after` to the activation timestamp and increasing the lifetime USD
allowance conservatively by USD 18 (ECB 2026-09-22: USD 1.1463/EUR; leaves exchange/tax
headroom). The 0.10 USD per-job reservation is deliberately not refunded: this permits
at most 180 additional jobs and can stop well before actual spend reaches EUR 20.
No automatic top-up. Existing queued historical messages are excluded by their canonical
index creation timestamp; opening an old conversation cannot consume this allowance.

The derived presentation suppresses a new message's unprocessed body while its durable
job is queued/running. Sender/subject remain accessible with a processing notice, not a
vanishing conversation. The existing cached-result poll releases the body after review.
On failure, exhausted budget or a ten-minute hold timeout, show the original with an
explicit notice. This is a display gate, not deletion or rewriting of canonical mail.
Unsupported/oversized mail remains original. No promise of perfect classification.
The SQL status RPC is read-only and restricted to service_role. Candidate seeding also
stops at the exhausted cap, avoiding an ever-growing historical queue.

## Usage settlement and full received-mail backlog (23 September)

The owner requested GPT-6 Luna max, all existing received mail and future incoming mail,
and removal of the premature reservation stop within the existing EUR 20 authorization.
The migration never increases the approved ceiling. Activation lowers the runtime ceiling to USD 18 to retain exchange/tax headroom within EUR 20, conservatively counting earlier pilot spend inside that amount. This supersedes the no-refund/180-job
and incoming-only restrictions described above; it does not authorize automatic top-ups.

`20260923105207_mailbox_ai_settle_usage.sql` adds idempotent settlement: only complete
recorded usage releases the unused part of a claim. `reserved_micro_usd` remains the
compatibility counter for known spend plus outstanding/uncertain holds; `spent_micro_usd`
is recorded token-based spend. Legacy successful Luna 5.6 jobs use conservative uncached
rates of $0.25/$1.20 per million (including the maximum input cache-write premium). Failed/missing usage remains fully reserved.
New Luna 6 requests explicitly use Standard service and record cached input, cache writes, per-request
long-context pricing, model, completeness, and rounded-up micro-USD. These estimates
are usage-derived, not an independently reconciled provider invoice.

Both passes still use max reasoning and unchanged content-preservation prompts.
Limits are 240,000 source characters, 2,400 lines and 400 KB serialized request bytes;
a $0.30 pre-request hold bounds both calls including long-context/cache-write premiums.
The observed backlog maximum was below these limits. Larger future inputs remain original
rather than being truncated for classification. Missing provider body text cannot be
classified until normal mailbox hydration retrieves it; no empty substitute is sent to AI.

Worker throughput is two waves of four parallel jobs, globally capped at eight recent
running jobs by the budget lock. Incoming messages precede historical ones. Unchanged
source identities reuse existing paid decisions. `include_history=true` is the explicit
activation switch for historical processing. It is not enabled by schema migration alone.

Validation: SQL-engine tests cover exactly-once settlement, missing usage, authorization,
ceiling preservation, incoming priority, history activation and global concurrency.
Usage tests cover cached tokens, long requests and incomplete data. No retry or provider
fallback is introduced. A failed/uncertain attempt must be investigated; any deliberate
retry retains its old hold in `prior_uncertain_micro_usd` and claims a fresh hold.

Explicit prompt caching stores only the unchanged developer rubric, never the changing mail body. This preserves prompt text and max reasoning while avoiding cache-write premiums on unique email content. Missing cache-write details retain the maximum input premium for budget safety.

The received-mail selector includes `coldmail` as well as inbox/allmail/Instantly; the earlier selector omitted campaign reply folders. Paragraph restoration happens inside classification only when HTML contains exactly the same non-whitespace characters. A derived `decision.displayBody` carries that whitespace-only layout; the renderer revalidates equality before applying line indices. Original bodies and source identities remain untouched.

Queue performance: `20260923111119_mailbox_ai_queue_lookup_indexes.sql` adds the missing identity-branch index and a received-date index including coldmail. The same read-only candidate selection measured 81.35 seconds before and 0.29 seconds after on production; both indexes are compatible with the old worker. Claim selection uses primary keys first and identity fallback only for stale keys.

Follow-up live verification: queued historic messages retain the established readable paragraph/quote formatting until AI is ready, with an explicit waiting notice. Complete provider usage is captured before output validation and settled even if the content is unusable; a failed second transport call keeps the full uncertain hold. `20260923112643_mailbox_ai_failed_usage_settlement.sql` also splits canonical-key and identity NOT EXISTS lookups, preventing the actual RPC planner from scanning an entire account for its OR predicate.
