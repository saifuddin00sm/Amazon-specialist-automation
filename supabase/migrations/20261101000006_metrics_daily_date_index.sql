-- The dashboard asks for the first and last day an account has metrics. The primary key leads with
-- entity_type and entity_id, so without this index that scans every metrics row of the account.

create index metrics_daily_seller_account_id_date_idx on public.metrics_daily (seller_account_id, date);
