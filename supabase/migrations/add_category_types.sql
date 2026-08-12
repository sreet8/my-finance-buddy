-- Group categories by how they're used: budgeted spending, income sources, or
-- savings/investments. Run in SQL Editor for existing projects.

alter table public.categories
  add column if not exists type text not null default 'expense'
  check (type in ('expense', 'income', 'savings'));

-- Categories previously classified as savings by name become type 'savings'.
update public.categories
  set type = 'savings'
  where type = 'expense'
    and (lower(name) like '%saving%' or lower(name) like '%investment%');

-- Seed the built-in income sources and savings/investment accounts. These are
-- editable (rename, recolor, add more) just like expense categories.
insert into public.categories (name, color, sort_order, type) values
  ('Direct Deposit', '#9ec5a8', 0, 'income'),
  ('Zelle', '#8bb7e0', 1, 'income'),
  ('Venmo Transfer', '#7fa8d8', 2, 'income'),
  ('Other Income', '#c9b8a0', 3, 'income'),
  ('Schwab Individual', '#a8c6d8', 0, 'savings'),
  ('Schwab Roth', '#c4b0d8', 1, 'savings'),
  ('Apple Savings', '#b8bcc4', 2, 'savings')
on conflict (name) do nothing;
