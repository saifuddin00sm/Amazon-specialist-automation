-- Target ACoS per seller account: what the bid optimizer steers toward and what the dashboard
-- compares actual ACoS against. A fraction, 0.3 = 30%.

alter table public.seller_accounts
  add column target_acos numeric(5, 4) not null default 0.3 check (target_acos > 0 and target_acos <= 1);

-- Owners change it like the other account settings; the existing update policy already limits
-- which rows they can touch.
grant update (target_acos) on public.seller_accounts to authenticated;
