-- Векторный RAG (OpenAI text-embedding-3-small = 1536 измерений), источник заявок ai_chat, учёт токенов.
-- Идемпотентно.

create extension if not exists vector with schema extensions;

-- ---------- векторы ----------
alter table public.kb_chunks
  add column if not exists embedding extensions.vector(1536),
  add column if not exists embedded_at timestamptz,
  add column if not exists has_embedding boolean generated always as (embedding is not null) stored;

create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Заголовок входит в смысл фрагмента, поэтому вектор переиспользуем только при том же заголовке.
-- Пересборка фрагментов сохраняет векторы у неизменившегося текста (не платим за embeddings повторно).
alter table public.kb_chunks add column if not exists title_snapshot text;
update public.kb_chunks c set title_snapshot = d.title from public.kb_documents d where d.id = c.document_id and c.title_snapshot is null;

create or replace function public.kb_reindex_document() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare max_old bigint;
begin
  select coalesce(max(id), 0) into max_old from public.kb_chunks where document_id = new.id;
  if new.is_published then
    insert into public.kb_chunks (document_id, chunk_index, content, tsv, title_snapshot, embedding, embedded_at)
    select new.id,
           (row_number() over ())::int - 1,
           t.c,
           setweight(to_tsvector('russian', new.title), 'A') || setweight(to_tsvector('russian', t.c), 'B'),
           new.title,
           o.embedding,
           o.embedded_at
    from public.kb_split(new.content) as t(c)
    left join lateral (
      select k.embedding, k.embedded_at from public.kb_chunks k
      where k.document_id = new.id and k.id <= max_old and k.content = t.c
        and k.embedding is not null and k.title_snapshot is not distinct from new.title
      limit 1
    ) o on true;
  end if;
  delete from public.kb_chunks where document_id = new.id and id <= max_old;
  return new;
end $$;
revoke all on function public.kb_reindex_document() from public, anon, authenticated;

-- Семантический поиск по косинусной близости.
create or replace function public.kb_match(
  query_embedding extensions.vector(1536),
  match_count integer default 5,
  min_similarity double precision default 0.3
) returns table (document_id uuid, title text, category text, content text, similarity double precision)
language sql stable set search_path = public, extensions as $$
  select d.id, d.title, d.category, c.content, 1 - (c.embedding <=> query_embedding)
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where d.is_published and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------- источник заявок: ai_chat ----------
alter table public.leads drop constraint if exists leads_source_check;
update public.leads set source = 'ai_chat' where source = 'chat';
alter table public.leads add constraint leads_source_check
  check (source in ('landing', 'ai_chat', 'manual', 'telegram'));

-- ---------- учёт токенов ----------
alter table public.chat_messages
  add column if not exists model text,
  add column if not exists tokens_in integer,
  add column if not exists tokens_out integer;

-- ---------- статистика (источник ai_chat) ----------
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
    'ai_tokens_30d', (select jsonb_build_object(
                        'in', coalesce(sum(tokens_in), 0), 'out', coalesce(sum(tokens_out), 0),
                        'replies', count(*) filter (where role = 'assistant'))
                      from chat_messages where created_at >= now() - interval '30 days'),
    'leads_daily', (select coalesce(jsonb_agg(jsonb_build_object(
                      'd', d::date,
                      'landing', (select count(*) from leads l where l.source = 'landing' and (l.created_at at time zone 'Asia/Bishkek')::date = d::date),
                      'chat', (select count(*) from leads l where l.source = 'ai_chat' and (l.created_at at time zone 'Asia/Bishkek')::date = d::date),
                      'other', (select count(*) from leads l where l.source not in ('landing','ai_chat') and (l.created_at at time zone 'Asia/Bishkek')::date = d::date)
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
