alter function public.set_updated_at() set search_path = public;
alter function public.memberships_fill_defaults() set search_path = public;
alter function public.kb_split(text, integer) set search_path = public;
alter function public.kb_search(text, integer) set search_path = public;
revoke all on function public.kb_reindex_document() from public, anon, authenticated;
