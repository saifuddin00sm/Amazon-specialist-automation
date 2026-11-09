-- Catalog sync: imports a seller's listings from Amazon into products and listing_versions, nightly
-- and when an account is connected (packages/workflows). The merge rules live in packages/data
-- (catalog-sync.ts). Members still can't write the live catalog: only the backend's secret key can.

-- Not used below, so it can share this migration (see 20261101000010).
alter type public.audit_action add value 'catalog.synced';

-- The sync matches Amazon's listings to products by SKU, unique within a seller account.
create unique index products_seller_account_sku_idx on public.products (seller_account_id, sku);

-- When the sync last found the product on Amazon; null for products it never imported. Products it
-- didn't find on a complete sync are no longer listed, and become inactive.
alter table public.products add column synced_at timestamptz;

-- Each seller's Login with Amazon refresh token, sealed by packages/amazon (AES-256-GCM, bound to
-- the seller id) before it gets here. Row-level security on and no policies or grants: only the
-- secret key reads or writes it, so no member ever sees a token, sealed or not.
create table public.amazon_authorizations (
  seller_id text primary key check (seller_id ~ '^A[0-9A-Z]{12,13}$'),
  refresh_token_sealed text not null check (refresh_token_sealed like 'v1.%'),
  updated_at timestamptz not null default now()
);
alter table public.amazon_authorizations enable row level security;
revoke all on public.amazon_authorizations from anon, authenticated;

-- Commits one step of a catalog sync: upserts products, supersedes the live versions being replaced,
-- inserts their new live versions, and appends audit events, in one transaction. Secret key only.
create function public.save_catalog_sync(
  p_products jsonb,
  p_superseded_ids text[],
  p_listing_versions jsonb,
  p_events jsonb
) returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  insert into public.products
  select * from jsonb_populate_recordset(null::public.products, p_products)
  on conflict (id) do update
  set asin = excluded.asin,
      title = excluded.title,
      brand = excluded.brand,
      category = excluded.category,
      price = excluded.price,
      status = excluded.status,
      synced_at = excluded.synced_at;

  -- First, since a product has at most one live listing.
  update public.listing_versions
  set status = 'superseded'
  where id = any (p_superseded_ids) and status = 'live';

  insert into public.listing_versions
  select * from jsonb_populate_recordset(null::public.listing_versions, p_listing_versions);

  perform private.append_audit_events(p_events);
end
$$;

revoke all on function public.save_catalog_sync(jsonb, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_catalog_sync(jsonb, text[], jsonb, jsonb) to service_role;
