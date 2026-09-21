# Mailbox Luna presentation — activation gate

Status: disabled by default, production budget zero. Real evaluation found that both prompt-only
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
The feature uses the existing server-side OpenAI key and pins `gpt-5.6-luna`, `max`; the global
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
