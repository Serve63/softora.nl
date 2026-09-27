# Database availability incident, 27 September 2026

## Evidence

- Production login returned 503 when the persisted premium user row could not be read.
- PostgreSQL logs on 26 September show unclean recovery at 13:17, 18:34, 22:34 and 23:58 UTC. The last occurred after the earlier manual recovery; a restart alone did not prevent recurrence.
- The Supabase memory chart showed swap increasing to roughly 1 GB before the last crash. This establishes memory pressure; application logs do not identify the operating-system process that triggered the crash.
- The Data API had 20 pooled connections. Repeated `softora_mailbox_ai_candidates` calls scanned up to 4,000 historical rows, took 6.5–7.2 seconds and repeatedly hit the statement timeout.

## Changes

- Set the existing project's Data API **Pool size** to **10** in Supabase Integrations → Data API → Settings. Keep the same Small compute; no paid upgrade. This setting is external to Git and must be preserved during infrastructure changes. Rollback: unset Pool size to restore the previous automatic configuration.
- Migration `20260927000452_bound_mailbox_background_reads.sql` bounds historical candidate discovery to 200 rows and skips a cursor already locked by another worker. The separate 20-row recent lane, full campaign proof, existing budget and concurrency guards are preserved. History may take more rounds to inspect.
- The session watchdog redirects only on a conclusive unauthenticated session response. Missing/malformed JSON or explicit unavailability must not trigger logout. Server-side authentication and fresh validation for sensitive operations remain unchanged. Bump the injected script version so browsers receive this change.

## Validation

- The deployed candidate function matched the prior migration before replacement (source MD5 `bffa1d0449e1f3505fec0bf14d60a226`).
- A production `EXPLAIN (ANALYZE, BUFFERS)` after replacement completed in 139.6 ms with no temporary blocks written. This sampled page returned no candidates; it does not establish a universal worst-case bound.
- Regression tests cover historical cursor progress over multiple small pages, priority for new replies, budget and anonymous access rejection, malformed/unavailable session responses, and genuine logout.
- These are recurrence mitigations. Do not claim all future infrastructure outages are impossible; verify production uptime and memory after normal traffic and investigate further if either regresses.
