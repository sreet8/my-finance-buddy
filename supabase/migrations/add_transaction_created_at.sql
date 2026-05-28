-- Order recent activity by entry time within the same date.
alter table public.transactions
  add column if not exists created_at timestamptz;

update public.transactions
set created_at = now()
where created_at is null;

alter table public.transactions
  alter column created_at set default now(),
  alter column created_at set not null;
