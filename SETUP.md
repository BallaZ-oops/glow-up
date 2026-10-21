# GlowUP: CRM, AI-чат — запуск

1. **Миграция БД.** Supabase → SQL Editor → вставить `supabase/migrations/0001_crm.sql` → Run (повторный запуск безопасен).
2. **Администратор.** Supabase → Authentication → Users → Add user (email + пароль, «Auto confirm»). Затем в SQL Editor:
   `insert into public.admins (user_id) select id from auth.users where email = 'ВАШ_EMAIL';`
   Authentication → Sign In / Providers → отключите «Allow new users to sign up».
3. **Vercel → Settings → Environment Variables:** `ANTHROPIC_API_KEY` (обязательно для чата),
   `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` (уже есть для заявок; допустим также `SUPABASE_SECRET_KEY`).
   Необязательно: `ANTHROPIC_MODEL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (иначе используются значения проекта по умолчанию).
4. Задеплоить (git push / `vercel --prod`). Админка: `/admin`.

Локально: `npm run dev` (страницы и /admin). Серверные функции `/api/*` локально работают только через `vercel dev`.

Поиск по базе знаний — полнотекстовый (Postgres, `russian`), фрагменты строятся триггером при сохранении документа.
Векторный поиск (pgvector) не подключён: нужен ключ провайдера embeddings.
