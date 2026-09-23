-- The complete personnel database reads active customers in this exact order.
-- A single partial index avoids sorting large JSON payloads for every archive page.
set local lock_timeout = '2s';

create index if not exists softora_customers_active_archive_order_idx
  on public.softora_customers (updated_at desc, customer_id asc)
  where deleted_at is null;
