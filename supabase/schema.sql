-- Выполнить один раз в Supabase: SQL Editor -> New query -> Run
create table if not exists public.leads (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- RLS включён и политик нет: доступ только через service_role ключ на сервере.
alter table public.leads enable row level security;
