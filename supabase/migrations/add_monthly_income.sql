-- Custom per-month income to budget against (resets each month). Replaces
-- deriving the budget income from income transactions.
create table if not exists public.monthly_income (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  amount numeric not null default 0 check (amount >= 0),
  unique (year, month)
);

alter table public.monthly_income enable row level security;

create policy "monthly_income_anon_all" on public.monthly_income
  for all to anon using (true) with check (true);
