# Softora Fiverr Low-Touch Launch Pack

Status: concept ready for account setup  
Owner rule: Serve does not do customer contact. Serve only connects accounts, confirms sensitive actions, and links payout or provider accounts when needed.

## Decision

Use Fiverr only as a controlled test channel, not as the core business.

The core business remains Softora-owned:

- Softora public offer page: `/ai-telefonist`
- fixed packages
- intake-first onboarding
- no calls by default
- no custom scope unless it fits a predefined package
- revenue tracked from reliable sources only

Fiverr can be used to test demand, gather early proof, and get first paid orders. It must not create a freelance inbox job for Serve.

## Fiverr Constraints

Current platform constraints that affect the operating model:

- Communication and payments must stay on Fiverr before an order is placed.
- External contact details should not be used to move buyers off-platform.
- If external credentials are genuinely required for the work, they belong in the gig requirements section.
- Fiverr auto-reply can answer first messages automatically, but it does not replace the manual response needed for response metrics.
- Quick responses can make repeated replies faster, but someone or an approved automation still has to send them.
- Gig requirements can be marked required, which is essential for low-touch delivery.

Sources:

- https://help.fiverr.com/hc/en-us/articles/12792122691601-Communication-and-payment-dos-and-don-ts
- https://help.fiverr.com/hc/en-us/articles/360011451678-Everything-you-need-to-know-about-response-time-and-rate
- https://help.fiverr.com/hc/en-us/articles/360011421218-Gig-policies
- https://help.fiverr.com/hc/en-us/articles/360010451397-Creating-a-Gig
- https://help.fiverr.com/hc/en-us/articles/360011079098-How-to-effectively-use-buyer-requirements

## Launch Rule

Do not publish Fiverr gigs until one of these is true:

1. Codex can operate the Fiverr inbox in browser with user-approved boundaries.
2. A safe automation can send approved template replies inside Fiverr.
3. Serve explicitly accepts a temporary manual step for sending prepared replies.

Without one of these, Fiverr creates response pressure and violates the "Serve does nothing" operating rule.

## First Gig

Title:

I will build an AI receptionist call flow for your business

Category intent:

AI services, business automation, virtual assistant, chatbot or phone automation category. Choose the closest Fiverr category available at setup time.

Gig positioning:

This gig gives a business a ready-to-use AI receptionist blueprint: call script, qualification logic, handoff rules, setup checklist, and provider-ready prompt. It is designed for missed calls, appointment requests, and lead capture.

Not included:

- live phone number setup unless purchased as an extra
- off-platform calls
- custom CRM development
- legal, medical, financial, or emergency decision-making
- outbound cold calling
- unlimited revisions

## Packages

Basic - AI Receptionist Blueprint

- Price target: EUR 75 to EUR 125
- Delivery: 2 days
- Includes: one call flow, one AI prompt, intake questions, handoff rules, implementation checklist
- Revision: 1
- Goal: easy first orders and reviews

Standard - AI Receptionist Setup Kit

- Price target: EUR 225 to EUR 349
- Delivery: 4 days
- Includes: everything in Basic, plus business-specific knowledge base, call summary template, missed-call workflow, provider setup guide
- Revision: 2
- Goal: main Fiverr offer

Premium - AI Receptionist Launch Plan

- Price target: EUR 600 to EUR 995
- Delivery: 7 days
- Includes: everything in Standard, plus integration map for agenda or CRM, test-call checklist, launch SOP, staff handoff guide
- Revision: 2
- Goal: bridge to Softora-owned subscription

Optional extras:

- faster delivery
- extra call flow
- extra language
- CRM or calendar integration plan
- provider account setup checklist

## Required Buyer Questions

All questions should be required unless Fiverr category rules prevent it.

1. What is your business name and website?
2. What type of calls should the AI handle?
3. What calls should the AI never handle?
4. What are your opening hours?
5. What services, locations, or products should the AI know about?
6. What should count as a qualified lead?
7. Where should call summaries go inside Fiverr delivery notes?
8. Do you use a calendar or CRM? If yes, which one?
9. Which language and tone should the AI use?
10. Confirm: you understand this gig delivers a setup blueprint unless you purchased a launch/setup extra.

Do not ask for passwords in the public requirement form. If credentials are unavoidable, ask the buyer to use Fiverr-approved secure methods and only after the order exists.

## Auto-Reply

Use this as Fiverr auto-reply:

Thanks for your message. This service is built as a structured AI receptionist package, so everything starts from the Fiverr order requirements instead of a call.

Please choose the package that fits your situation and complete the required questions. If your request is outside the listed scope, I will let you know inside Fiverr before work starts.

For safety and Fiverr compliance, all communication and payment stay here on Fiverr.

## Quick Responses

Scope fit:

Thanks. This fits the AI receptionist package. Please place the order and fill in the required questions so I can start from complete information.

Needs package:

Thanks. Based on your message, the best fit is the Standard package because it includes the business-specific knowledge base and missed-call workflow.

Out of scope:

Thanks for checking. I do not offer that inside this gig because the service is fixed-scope. I can only deliver the listed AI receptionist flow, prompt, setup checklist, and handoff rules.

No call:

This service is designed without a meeting. The required questions replace the intake call and keep the project fast and clear.

Off-platform request:

For safety and Fiverr compliance, communication and payment need to stay on Fiverr. Please send the details here in the order requirements.

Missing requirements:

I need the required questions completed before I can deliver accurately. Please update the order requirements with the missing information.

Delivery note:

Your AI receptionist package is attached below. It includes the call flow, AI prompt, handoff rules, call summary format, and setup checklist. Please review the included checklist first, then request a revision only for items inside the original package scope.

Revision boundary:

I can adjust items that are inside the original package scope. New call flows, new languages, CRM implementation, or live provider setup are separate extras.

## Delivery Structure

Every delivery should use the same structure:

1. Executive summary
2. AI receptionist role and boundaries
3. Caller qualification questions
4. Call flow
5. Escalation and handoff rules
6. AI system prompt
7. Knowledge base starter
8. Call summary template
9. Provider setup checklist
10. Test-call checklist
11. Launch notes

## Automation Plan

Phase 1 - manual asset pack:

- use this document to fill Fiverr profile, gig, packages, auto-reply, quick responses, and requirements
- do not publish until payout and inbox operating model are solved

Phase 2 - operator-assisted Fiverr:

- Codex prepares replies and delivery files
- Serve only approves account-level or sensitive external actions
- no free-form client negotiation

Phase 3 - Softora-owned funnel:

- add own intake form behind `/ai-telefonist`
- add payment provider
- store inquiries and revenue state in a structured source
- generate delivery documents automatically
- reserve Fiverr for top-of-funnel proof, not operations

## Revenue Tracking

No reliable revenue source is connected yet.

Minimum connection needed:

- Fiverr seller account with payout connected, or
- payment provider account for Softora-owned checkout, or
- bank or invoice export source that can be checked safely.

Until then, revenue status must be reported as "not connected" rather than guessed.

