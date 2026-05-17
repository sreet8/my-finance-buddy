-- Run in SQL Editor if you already created tables from an older schema.sql

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

alter table public.categories enable row level security;

do $$ begin
  create policy "categories_anon_all" on public.categories
    for all to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;
