-- Searchers run either through the paid API or through Codex on the local subscription.
-- The choice is a shared setting; changing it never starts a worker.
alter table public.softora_kvk_api_budget
  add column if not exists searcher_engine text not null default 'api'
    check (searcher_engine in ('api', 'codex'));
