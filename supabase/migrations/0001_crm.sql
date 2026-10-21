-- GlowUP CRM: схема, RLS, база знаний (полнотекстовый поиск), лимиты, статистика.
-- Выполнить один раз: Supabase -> SQL Editor -> New query -> вставить -> Run.
-- Скрипт идемпотентный: повторный запуск безопасен.

-- ============================================================
-- 0. Служебное
-- ============================================================
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- 1. Администраторы (доступ в /admin)
--    Публичной регистрации с правами нет: админом становится только тот,
--    чей user_id вручную добавлен в эту таблицу (см. README, шаг 2).
-- ============================================================
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ============================================================
-- 2. Каталог: абонементы, направления, тренеры, расписание
-- ============================================================
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  duration_days integer not null check (duration_days > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trainers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text,
  bio text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  trainer_id uuid references public.trainers(id) on delete set null,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = Пн ... 7 = Вс
  start_time time not null,
  duration_min integer not null default 60 check (duration_min > 0),
  capacity integer check (capacity > 0),                      -- null = лимит мест не задан
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists class_sessions_program_idx on public.class_sessions (program_id);
create index if not exists class_sessions_weekday_idx on public.class_sessions (weekday, start_time);

-- ============================================================
-- 3. Клиенты, абонементы клиентов, платежи, записи на занятия
-- ============================================================
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text,
  birth_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists members_phone_idx on public.members (phone);
create index if not exists members_name_idx on public.members (lower(full_name));

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  starts_on date not null default current_date,
  ends_on date not null,
  price numeric(10,2) not null check (price >= 0),
  status text not null default 'active' check (status in ('active', 'frozen', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists memberships_member_idx on public.memberships (member_id);
create index if not exists memberships_ends_idx on public.memberships (ends_on);

-- Если срок или цена не указаны — берём из выбранного абонемента.
create or replace function public.memberships_fill_defaults() returns trigger
language plpgsql as $$
declare p public.plans;
begin
  select * into p from public.plans where id = new.plan_id;
  if new.starts_on is null then new.starts_on := current_date; end if;
  if new.ends_on is null then new.ends_on := new.starts_on + p.duration_days; end if;
  if new.price is null then new.price := p.price; end if;
  return new;
end $$;
drop trigger if exists memberships_defaults on public.memberships;
create trigger memberships_defaults before insert on public.memberships
  for each row execute function public.memberships_fill_defaults();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  membership_id uuid references public.memberships(id) on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'card', 'transfer', 'other')),
  paid_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists payments_member_idx on public.payments (member_id);
create index if not exists payments_paid_idx on public.payments (paid_at desc);

-- ============================================================
-- 4. Заявки (таблица leads уже существует — расширяем)
-- ============================================================
create table if not exists public.leads (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);
alter table public.leads
  add column if not exists email text,
  add column if not exists message text,
  add column if not exists interest text,
  add column if not exists source text not null default 'landing',
  add column if not exists status text not null default 'new',
  add column if not exists assignee text,
  add column if not exists notes text,
  add column if not exists member_id uuid references public.members(id) on delete set null,
  add column if not exists conversation_id uuid,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_source_check') then
    alter table public.leads add constraint leads_source_check
      check (source in ('landing', 'chat', 'manual', 'telegram'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_status_check') then
    alter table public.leads add constraint leads_status_check
      check (status in ('new', 'contacted', 'trial', 'converted', 'lost'));
  end if;
end $$;
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_source_idx on public.leads (source);
create index if not exists leads_member_idx on public.leads (member_id);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade,
  lead_id bigint references public.leads(id) on delete set null,
  guest_name text,
  guest_phone text,
  booking_date date not null,
  status text not null default 'booked' check (status in ('booked', 'attended', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (member_id is not null or lead_id is not null or guest_name is not null)
);
create index if not exists bookings_session_date_idx on public.bookings (session_id, booking_date);
create index if not exists bookings_member_idx on public.bookings (member_id);

-- ============================================================
-- 5. Чат: диалоги и сообщения (пишет только сервер)
-- ============================================================
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id bigint references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conv_idx on public.chat_messages (conversation_id, id);

-- ============================================================
-- 6. База знаний (RAG): документы -> фрагменты -> полнотекстовый поиск
-- ============================================================
create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (category in ('company', 'faq', 'service', 'pricing', 'policy', 'other')),
  content text not null,
  source_name text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kb_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  tsv tsvector not null
  -- Позже для векторного поиска: create extension vector; alter table kb_chunks add column embedding vector(N);
);
create index if not exists kb_chunks_doc_idx on public.kb_chunks (document_id, chunk_index);
create index if not exists kb_chunks_tsv_idx on public.kb_chunks using gin (tsv);

-- Разбиение текста на фрагменты по абзацам (до p_max символов).
create or replace function public.kb_split(p_text text, p_max integer default 700)
returns setof text language plpgsql immutable as $$
declare
  para text;
  buf text := '';
  piece text;
  cut integer;
begin
  foreach para in array regexp_split_to_array(coalesce(p_text, ''), E'\\n\\s*\\n') loop
    para := btrim(para);
    continue when para = '';
    while length(para) > p_max loop
      piece := left(para, p_max);
      cut := length(piece) - position(' ' in reverse(piece)) + 1;
      if cut > p_max / 2 then piece := left(piece, cut - 1); end if;
      if buf <> '' then return next buf; buf := ''; end if;
      return next btrim(piece);
      para := btrim(substr(para, length(piece) + 1));
    end loop;
    continue when para = '';
    if buf = '' then
      buf := para;
    elsif length(buf) + length(para) + 2 <= p_max then
      buf := buf || E'\n\n' || para;
    else
      return next buf;
      buf := para;
    end if;
  end loop;
  if buf <> '' then return next buf; end if;
end $$;

-- Индекс обновляется автоматически при любом изменении документа.
create or replace function public.kb_reindex_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.kb_chunks where document_id = new.id;
  if new.is_published then
    insert into public.kb_chunks (document_id, chunk_index, content, tsv)
    select new.id,
           (row_number() over ())::int - 1,
           t.c,
           setweight(to_tsvector('russian', new.title), 'A') || setweight(to_tsvector('russian', t.c), 'B')
    from public.kb_split(new.content) as t(c);
  end if;
  return new;
end $$;
drop trigger if exists kb_documents_reindex on public.kb_documents;
create trigger kb_documents_reindex after insert or update of title, content, is_published
  on public.kb_documents for each row execute function public.kb_reindex_document();

-- Поиск по базе знаний. Вызывается сервером (service_role); для anon RLS ничего не отдаёт.
create or replace function public.kb_search(p_query text, p_limit integer default 5)
returns table (document_id uuid, title text, category text, content text, rank real)
language plpgsql stable as $$
#variable_conflict use_column
declare
  tq tsquery;
  words text[];
begin
  select array_agg(w) into words from (
    select distinct lower(x) as w
    from regexp_split_to_table(coalesce(p_query, ''), '[^a-zA-Z0-9а-яА-ЯёЁ]+') as x
    where length(x) >= 3 limit 12
  ) s;
  if words is null then return; end if;

  begin
    tq := to_tsquery('russian', (select string_agg(w || ':*', ' | ') from unnest(words) w));
  exception when others then
    tq := null;
  end;

  if tq is not null then
    return query
      select d.id, d.title, d.category, c.content, ts_rank(c.tsv, tq)
      from public.kb_chunks c
      join public.kb_documents d on d.id = c.document_id
      where d.is_published and c.tsv @@ tq
      order by 5 desc
      limit p_limit;
    if found then return; end if;
  end if;

  -- запасной вариант: подстрока
  return query
    select d.id, d.title, d.category, c.content, 0.01::real
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    where d.is_published and exists (
      select 1 from unnest(words) w where c.content ilike '%' || w || '%' or d.title ilike '%' || w || '%'
    )
    limit p_limit;
end $$;

-- ============================================================
-- 7. Настройки и лимиты запросов
-- ============================================================
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

-- true = запрос разрешён. Атомарный счётчик в окне.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare h integer;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning r.hits into h;
  return h <= p_max;
end $$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ============================================================
-- 8. updated_at и RLS
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['plans','programs','trainers','class_sessions','members','memberships',
                           'leads','bookings','kb_documents','settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated', t);
  end loop;

  -- RLS: включён везде; полный доступ только администраторам (anon не видит ничего).
  foreach t in array array['plans','programs','trainers','class_sessions','members','memberships','payments',
                           'leads','bookings','chat_conversations','chat_messages','kb_documents','kb_chunks',
                           'settings','rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin full access" on public.%I', t);
    if t <> 'rate_limits' then
      execute format('create policy "admin full access" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop;
end $$;

alter table public.admins enable row level security;
drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row" on public.admins for select to authenticated using (user_id = auth.uid());

-- ============================================================
-- 9. Статистика для Dashboard / Аналитики (только для админов)
-- ============================================================
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Bishkek')::date;
  res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select jsonb_build_object(
    'members_total', (select count(*) from members),
    'members_active', (select count(distinct member_id) from memberships
                       where status = 'active' and ends_on >= today and starts_on <= today),
    'leads_total', (select count(*) from leads),
    'leads_new', (select count(*) from leads where status = 'new'),
    'leads_7d', (select count(*) from leads where created_at >= now() - interval '7 days'),
    'leads_prev_7d', (select count(*) from leads where created_at >= now() - interval '14 days'
                      and created_at < now() - interval '7 days'),
    'leads_converted', (select count(*) from leads where status = 'converted'),
    'revenue_month', (select coalesce(sum(amount), 0) from payments
                      where date_trunc('month', paid_at at time zone 'Asia/Bishkek') = date_trunc('month', today)),
    'revenue_prev_month', (select coalesce(sum(amount), 0) from payments
                      where date_trunc('month', paid_at at time zone 'Asia/Bishkek') = date_trunc('month', today) - interval '1 month'),
    'expiring_7d', (select count(*) from memberships
                    where status = 'active' and ends_on between today and today + 7),
    'bookings_upcoming', (select count(*) from bookings where status = 'booked' and booking_date >= today),
    'leads_daily', (select coalesce(jsonb_agg(jsonb_build_object(
                      'd', d::date,
                      'landing', (select count(*) from leads l where l.source = 'landing' and (l.created_at at time zone 'Asia/Bishkek')::date = d::date),
                      'chat', (select count(*) from leads l where l.source = 'chat' and (l.created_at at time zone 'Asia/Bishkek')::date = d::date),
                      'other', (select count(*) from leads l where l.source not in ('landing','chat') and (l.created_at at time zone 'Asia/Bishkek')::date = d::date)
                    ) order by d), '[]'::jsonb)
                    from generate_series(today - 29, today, interval '1 day') d),
    'revenue_monthly', (select coalesce(jsonb_agg(jsonb_build_object(
                      'm', to_char(m, 'YYYY-MM'),
                      'total', (select coalesce(sum(amount), 0) from payments p
                                where date_trunc('month', p.paid_at at time zone 'Asia/Bishkek') = m)
                    ) order by m), '[]'::jsonb)
                    from generate_series(date_trunc('month', today) - interval '11 months', date_trunc('month', today), interval '1 month') m),
    'lead_funnel', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from leads group by status) s),
    'lead_sources', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from leads group by source) s),
    'plan_popularity', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n, 'revenue', rev) order by n desc), '[]'::jsonb)
                        from (select p.name, count(m.id) n, coalesce(sum(m.price), 0) rev
                              from plans p left join memberships m on m.plan_id = p.id and m.status <> 'cancelled'
                              group by p.id, p.name) s),
    'class_load', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'count', n) order by n desc), '[]'::jsonb)
                   from (select pr.title, count(b.id) n
                         from programs pr
                         left join class_sessions cs on cs.program_id = pr.id
                         left join bookings b on b.session_id = cs.id and b.status <> 'cancelled'
                              and b.booking_date >= today - 30
                         group by pr.id, pr.title) s),
    'expiring', (select coalesce(jsonb_agg(jsonb_build_object(
                    'member_id', m.id, 'name', m.full_name, 'phone', m.phone, 'ends_on', ms.ends_on, 'plan', p.name
                 ) order by ms.ends_on), '[]'::jsonb)
                 from memberships ms join members m on m.id = ms.member_id join plans p on p.id = ms.plan_id
                 where ms.status = 'active' and ms.ends_on between today and today + 14),
    'recent_leads', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
                     from (select id, name, phone, source, status, interest, created_at
                           from leads order by created_at desc limit 8) l)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- ============================================================
-- 10. Начальные данные — только то, что уже есть на лендинге
-- ============================================================
insert into public.plans (name, description, price, duration_days, sort_order)
select * from (values
  ('Месяц',   'Безлимитный зал, раздевалки, сауна.', 2500::numeric,  30,  1),
  ('Полгода', 'Зал и групповые программы. Две заморозки.', 12000::numeric, 182, 2),
  ('Год',     'Всё включено и 3 персональные тренировки.', 20000::numeric, 365, 3)
) v(name, description, price, duration_days, sort_order)
where not exists (select 1 from public.plans);

insert into public.programs (title, description, sort_order)
select * from (values
  ('Силовой тренинг', 'Свободные веса и тренажёры с персональным планом.', 1),
  ('Функциональный',  'Круговые тренировки на выносливость и координацию.', 2),
  ('Йога и растяжка', 'Мобильность, дыхание и восстановление.', 3),
  ('Кардио',          'Групповые занятия для жиросжигания и тонуса.', 4),
  ('Персональные',    'Индивидуальная работа с тренером под вашу цель.', 5)
) v(title, description, sort_order)
where not exists (select 1 from public.programs);

insert into public.trainers (full_name, role)
select * from (values ('Амир', 'Тренер для мужчин'), ('Эля', 'Тренер для женщин')) v(full_name, role)
where not exists (select 1 from public.trainers);

insert into public.class_sessions (program_id, weekday, start_time)
select p.id, d.wd, v.t::time
from (values
  ('1,3,5', '08:00', 'Функциональный'), ('1,3,5', '19:00', 'Кардио'), ('1,3,5', '20:30', 'Йога и растяжка'),
  ('2,4',   '09:00', 'Йога и растяжка'), ('2,4',   '18:30', 'Силовой тренинг'), ('2,4',   '20:00', 'Функциональный'),
  ('6,7',   '10:00', 'Кардио'), ('6,7',   '11:30', 'Функциональный'), ('6,7',   '13:00', 'Йога и растяжка')
) v(days, t, title)
cross join lateral unnest(string_to_array(v.days, ',')::smallint[]) as d(wd)
join public.programs p on p.title = v.title
where not exists (select 1 from public.class_sessions);

insert into public.settings (key, value) values
  ('company', jsonb_build_object(
     'name', 'GlowUP', 'city', 'Бишкек', 'address', 'г. Бишкек',
     'phone', '+996 220 531 410', 'whatsapp', 'https://wa.me/996220531410',
     'telegram', 'https://t.me/GlowUp_up_bot', 'hours', 'Ежедневно, 7:00 — 23:00',
     'about', 'Тренажёрный зал в Бишкеке с зонами силового и функционального тренинга, групповыми программами и раздевалками.')),
  ('chatbot', jsonb_build_object(
     'enabled', true,
     'greeting', 'Здравствуйте! Я AI-помощник GlowUP. Расскажу про абонементы, расписание и помогу записаться на пробную тренировку.',
     'extra_instructions', ''))
on conflict (key) do nothing;

insert into public.kb_documents (title, category, content)
select * from (values
  ('О зале GlowUP', 'company',
   E'GlowUP — тренажёрный зал в Бишкеке с зонами силового и функционального тренинга, групповыми программами и раздевалками.\n\nРаботаем ежедневно с 7:00 до 23:00.\n\nВ зале работают два тренера: Амир (тренер для мужчин) и Эля (тренер для женщин).'),
  ('Как записаться на пробную тренировку', 'faq',
   E'Оставьте заявку в форме на сайте или через чат — мы перезвоним и согласуем удобное время.'),
  ('Что взять с собой на тренировку', 'faq',
   E'Сменную обувь, форму и полотенце. Раздевалки и душевые есть в зале.'),
  ('Заморозка абонемента', 'policy',
   E'Заморозить абонемент можно. На полугодовом абонементе доступно две заморозки, на годовом — больше.'),
  ('Подойдёт ли зал новичкам', 'faq',
   E'Да. Тренер составит программу с учётом вашего уровня и цели.')
) v(title, category, content)
where not exists (select 1 from public.kb_documents);
