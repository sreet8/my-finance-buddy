-- Mark expenses paid via Venmo or Zelle.
alter table public.transactions
  add column if not exists venmo_zelle boolean not null default false;
