-- Run in the new Supabase project: SQL Editor → New query → paste → Run

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
  occurred_on date not null
);

create table if not exists public.savings_contributions (
  id uuid primary key default gen_random_uuid(),
  amount numeric not null check (amount > 0),
  note text,
  occurred_on date not null
);

alter table public.budgets enable row level security;
alter table public.transactions enable row level security;
alter table public.savings_contributions enable row level security;

create policy "budgets_anon_all" on public.budgets
  for all to anon using (true) with check (true);

create policy "transactions_anon_all" on public.transactions
  for all to anon using (true) with check (true);

create policy "savings_anon_all" on public.savings_contributions
  for all to anon using (true) with check (true);
