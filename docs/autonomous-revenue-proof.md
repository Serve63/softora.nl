# Autonomous Revenue Proof

## Status

This subsystem is a proof harness, not a revenue claim. It is disabled unless
`REVENUE_PROOF_ENABLED=true`, the Supabase migration is applied and a separate
webhook secret is configured. The proof endpoint may return `proven: true` only
after three completed calendar months satisfy every gate below.

## Objective

Generate at least EUR 2,500 monthly operating contribution for Servé without
his operational input after one initial setup session. Operating contribution
means cash received minus lead acquisition, delivery, hosting/API and refund
costs, before VAT and income/corporate tax.

## Capability boundary

Codex can independently inspect live demand and account state, operate the
Softora repository, build and test sites and workflows, read and write through
connected Gmail, Supabase, GitHub and Vercel surfaces, monitor evidence and
continue a long-running goal. It can therefore run qualification, written
sales, production, delivery and proof collection after setup.

Codex cannot truthfully replace Servé for identity checks, phone verification,
bank ownership, legal authority or permission to create new costs. It also
cannot prove future revenue from forecasts. Proof requires real third-party
cash and accepted deliveries.

## Falsification findings on 22 July 2026

- Google Search Console recorded 9 clicks and 1,726 impressions in the latest
  28-day window. Organic traffic is growing in impressions but is not yet a
  revenue engine.
- Gmail contained no `Nieuwe contactaanvraag via Softora.nl` messages in 2026.
  The former website page hid price and routed primary calls to Martijn's
  WhatsApp, so it was not autonomous.
- Offerti's latest 97 public requests contained no current app/software job and
  only one website request. Its public app examples were mostly from 2016-2017.
  Buying 360 Offerti credits is therefore rejected.
- Softora's current coldmail stats showed 1,717 sends, 27 reliable bounces and
  two interested records. No external EUR 2,500+ paid order was evidenced. The
  existing coldmail alone is not proof.
- The live Google Ads draft for website intent estimated 79 clicks per week at
  EUR 2.51 average CPC and EUR 198.24 weekly cost. This is the only current
  demand signal with enough estimated volume for a controlled validation.
- Published Dutch competitors currently place complete custom sites around EUR
  3,750 to EUR 4,500, while low-end template sites start below EUR 800. A fixed
  EUR 3,950 offer is in the observable custom-site band without competing at
  the commodity bottom.

These findings reject the former Offerti/software plan. They do not prove the
new offer; they define the smallest live experiment capable of proving or
rejecting it.

## Chosen offer

Softora sells one productized Groeiwebsite for EUR 3,950 excluding VAT. A first
complete version is delivered within ten working days after complete intake.

Included:

- seven pages: home, four services, about and contact;
- information architecture and Dutch business copy;
- responsive web delivery, performance and technical SEO foundation;
- lead form, analytics and conversion measurement;
- migration of usable content from the existing site;
- one bundled revision round;
- 30 days of defect repair;

Reject ecommerce, multilingual delivery, custom software, complex integrations,
photography, brand identity work, unlimited revisions, regulated or
special-category personal data and any unbounded scope.

## Acquisition channel

The primary proof channel is one Google Search campaign for current website
intent. It remains paused until advertiser verification, offer approval and one
exact maximum pilot authorization are complete. It uses exact and phrase match,
Google Search only, no Search Partners, no Display and a dedicated intake as
the primary conversion.

Pilot limits:

- total lifetime validation spend: at most EUR 3,000 after one explicit approval;
- first stage: at most EUR 500 over 28 days;
- do not release the remaining amount unless stage one produces at least three
  qualified intakes or one accepted contract;
- hard pause after 100 clicks without a valid intake;
- hard pause when cost per valid intake exceeds EUR 250 after at least three
  valid intakes;
- never purchase, refill or raise budget automatically;
- Google Ads' average daily budget is not treated as a lifetime cap; the Softora
  ledger must stop the campaign before the authorized cumulative ceiling.

The already-paid coldmail system may be measured as a secondary zero-incremental
cost channel only after Servé approves the fixed offer and exact message. It may
not be counted as causal proof without traceable lead, acceptance and cash
evidence.

## Unit economics

| Item | EUR |
| --- | ---: |
| One collected project | 3,950 |
| Maximum monthly Google Ads spend at current estimate | -861 |
| Maximum delivery, hosting and API spend | -350 |
| Operating contribution with one collected project | 2,739 |

At the current draft estimate this means roughly 343 clicks per month. The
hypothesis needs one collected project per month, equal to about 0.29% of paid
clicks. This is a testable threshold, not assumed proof.

## Evidence chain

Every paid order must contain all seven autonomous evidence events:

1. `lead_qualified`
2. `lead_cost`, including an explicit zero when acquisition was free
3. `proposal_sent`
4. `contract_accepted`
5. `cash_in`
6. `delivery_cost`, including an explicit zero when no direct cost was incurred
7. `delivery_accepted`

Lead, proposal, contract and delivery evidence must be written through the
admin-protected event route with:

- a stable external event ID such as a Google click ID, contact message ID or
  Gmail message ID;
- a SHA-256 evidence hash;
- a non-empty automation run ID;
- `autonomous=true` set server-side.

`cash_in` cannot be written through the admin event route. It is accepted only
from the dedicated bunq callback, with a positive EUR amount and a description
containing `SOFTORA-<order-id>`.

## Proof rule

`GET /api/revenue-proof/status` may return `proof.proven=true` only when:

- the previous three completed Europe/Amsterdam calendar months each have at
  least EUR 2,500 operating contribution;
- every order contributing cash in those months has the complete evidence
  chain;
- every chain event is marked autonomous and has both an external evidence hash
  and an automation run ID;
- all recorded lead, delivery and refund costs are deducted in the month in
  which they occurred.

The current partial month never counts. An offer, verbal agreement, unpaid
active order or self-authored status assertion never counts as revenue proof.

## Security and cost controls

- The ledger table has RLS enabled and grants nothing to `anon` or
  `authenticated`; only the server-side Supabase service role may access it.
- A database trigger rejects updates and deletes, including service-role
  mutations; corrections must be appended as new evidence.
- No bank API key is stored by this subsystem.
- The bunq callback requires a high-entropy shared callback secret and, by
  default, a source IP inside bunq's documented production range
  `185.40.108.0/22`.
- The callback stores a redacted IBAN, minimal payment metadata and a hash, not
  the full bank payload.
- The feature fails closed when disabled, unconfigured, sent from an untrusted
  IP or presented with an invalid secret.
- Codex must never buy or refill credits, create paid API usage, upgrade a plan
  or enable chargeable overages. Google Ads stays paused until Servé gives one
  new explicit instruction authorizing the exact EUR 3,000 maximum for this one
  gated validation. No amount may be inferred from this document.

## Required one-time setup by Servé

1. Complete the open Google advertiser identity step with Servé's own phone,
   mobile-provider account and matching address. Codex may not submit identity
   or OTP data on Servé's behalf.
2. Approve or reject one exact maximum of EUR 3,000 for the gated Google Search
   validation. Codex performs no paid request before that explicit instruction.
3. Approve the EUR 3,950 fixed offer, two 50% payment moments, scope, standard
   terms, rejection rules and authority for autonomous written sales replies.
4. Configure a dedicated high-entropy `BUNQ_REVENUE_WEBHOOK_SECRET`.
5. Register the HTTPS `PAYMENT` notification target in bunq while Servé is
   present, then remove all bunq API credentials from the Softora runtime.
6. Apply the Supabase migration and enable the revenue-proof environment flag
   only after the callback is verified in a non-production test.

After these steps, normal lead selection, proposal, communication, build,
delivery, proof recording and monitoring must not require Servé.

## Environment variables

- `REVENUE_PROOF_ENABLED=false` by default
- `BUNQ_REVENUE_WEBHOOK_SECRET`
- `BUNQ_REVENUE_REQUIRE_TRUSTED_IP=true`
- `REVENUE_PROOF_ORDER_REFERENCE_PREFIX=SOFTORA`
- `REVENUE_PROOF_MONTHLY_TARGET_EUR=2500`
- `REVENUE_PROOF_REQUIRED_MONTHS=3`
- `REVENUE_PROOF_TIME_ZONE=Europe/Amsterdam`

## Authoritative external references

- OpenAI Codex harness evidence:
  https://openai.com/index/harness-engineering/
- Current Dutch unsolicited electronic communication law:
  https://wetten.overheid.nl/BWBR0009950/2026-07-01/0?labelid=2780664
- ACM spam guidance:
  https://www.acm.nl/nl/verkoop-aan-consumenten/reclame-en-verleiden/spam-voorkomen-uw-reclame
- Google Ads average daily and monthly spending limits:
  https://support.google.com/google-ads/answer/6385083
- Google advertiser verification:
  https://support.google.com/adspolicy/answer/9703665?hl=nl
- Offerti request and credit model, retained as rejected-channel evidence:
  https://offerti.nl/veelgestelde-vragen
- bunq callback categories, source range and retry behavior:
  https://doc.bunq.com/basics/callbacks-webhooks
