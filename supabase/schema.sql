-- Run in the new Supabase project: SQL Editor → New query → paste → Run

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#c9a98b',
  sort_order int not null default 0
);

insert into public.categories (name, color, sort_order) values
  ('Housing', '#c4a7cc', 0),
  ('Food', '#f5b88f', 1),
  ('Transport', '#a8c9a6', 2),
  ('Utilities', '#b8a5cc', 3),
  ('Entertainment', '#eeb0c0', 4),
  ('Shopping', '#a5c2d0', 5),
  ('Other', '#c9a98b', 6)
on conflict (name) do nothing;

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  category text not null,
  percent numeric not null default 0 check (percent >= 0 and percent <= 100),
  unique (year, month, category)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('income', 'expense')),
  amount numeric not null check (amount > 0),
  category text,
  note text,
  occurred_on date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.savings_contributions (
  id uuid primary key default gen_random_uuid(),
  amount numeric not null check (amount > 0),
  note text,
  occurred_on date not null
);

alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.transactions enable row level security;
alter table public.savings_contributions enable row level security;

create policy "categories_anon_all" on public.categories
  for all to anon using (true) with check (true);

create policy "budgets_anon_all" on public.budgets
  for all to anon using (true) with check (true);

create policy "transactions_anon_all" on public.transactions
  for all to anon using (true) with check (true);

create policy "savings_anon_all" on public.savings_contributions
  for all to anon using (true) with check (true);
