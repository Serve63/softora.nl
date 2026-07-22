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

## Chosen offer

Softora sells one narrowly scoped internal planning, CRM or workflow app for
EUR 4,950 excluding VAT, delivered within ten working days.

Included:

- one business workflow;
- at most three user roles;
- one structured data import;
- one external integration;
- responsive web delivery;
- 30 days of defect repair;
- optional support and continuous improvement at EUR 149 per month.

Reject requests requiring physical presence, regulated or special-category
personal data, native app stores, open-ended integrations, unlimited revisions
or an unbounded scope.

## Acquisition channel

The primary pilot channel is Offerti because the requester explicitly asks for
offers. No scraped or unsolicited coldmail address may be used by this pilot.

Pilot limits:

- at most 12 paid proposals per calendar month;
- at most 30 Offerti credits per proposal;
- at most 360 prepaid credits, equal to EUR 468 excluding VAT at the published
  standard credit price;
- no Premium account and no automatic credit purchase or refill;
- stop immediately when the prepaid balance is exhausted;
- stop and reject the channel after 12 paid proposals without a contract.

Every accepted lead must be remote, commercially identifiable, concrete enough
to quote, and realistically deliverable inside the fixed scope.

## Unit economics

| Item | EUR |
| --- | ---: |
| One collected project | 4,950 |
| Maximum lead spend | -468 |
| Maximum delivery, hosting and API spend | -350 |
| Expected operating contribution | 4,132 |

The economic hypothesis therefore needs one sale per 12 selected requests, or
an 8.33% win rate. This is a testable hypothesis, not assumed proof.

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

- a stable external event ID such as an Offerti request or Gmail message ID;
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
  or enable chargeable overages. Existing prepaid balances may be consumed only
  inside the explicit pilot limits.

## Required one-time setup by Servé

1. Create the Offerti professional account, select Website/Apps, accept the
   current terms and enable daily request emails.
2. Buy exactly 360 credits once if Servé accepts the EUR 468 excluding VAT
   pilot risk. Codex does not perform this purchase.
3. Approve the fixed offer, fixed scope, standard terms and rejection rules.
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
- Offerti professional and credit model:
  https://offerti.nl/veelgestelde-vragen
- bunq callback categories, source range and retry behavior:
  https://doc.bunq.com/basics/callbacks-webhooks
