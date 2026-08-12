-- Split the single free-text note into a required-ish Title and an optional
-- Description. Existing note text is preserved as the Title.
alter table public.transactions
  add column if not exists title text;

alter table public.transactions
  add column if not exists description text;

update public.transactions
  set title = note
  where title is null and note is not null;
