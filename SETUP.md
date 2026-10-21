# GlowUP: CRM и AI-чат (OpenAI) — запуск

AI: OpenAI Responses API, чат-модель `gpt-6-luna`, embeddings `text-embedding-3-small` (1536 измерений, pgvector).
Все запросы к OpenAI выполняются только на сервере (`/api/chat`, `/api/kb-embed`).

1. **Миграции БД** (Supabase → SQL Editor, по порядку; скрипты идемпотентны):
   `supabase/migrations/0001_crm.sql`, `0002_hardening.sql`, `0003_openai_rag.sql`.
2. **Администратор.** Authentication → Users → Add user (Auto confirm), затем:
   `insert into public.admins (user_id) select id from auth.users where email = 'ВАШ_EMAIL';`
   Отключите «Allow new users to sign up».
3. **Vercel → Settings → Environment Variables (Production, Preview):**
   - `OPENAI_API_KEY` — секретный ключ (тип Sensitive), **обязательно**;
   - `OPENAI_MODEL=gpt-6-luna`, `OPENAI_EMBEDDING_MODEL=text-embedding-3-small` (значения по умолчанию);
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (или `SUPABASE_SECRET_KEY`) — уже нужны для заявок;
   - необязательно: `CHAT_DAILY_LIMIT` (ответов в сутки на сайт, по умолчанию 1500), `OPENAI_REASONING_EFFORT` (`low` по умолчанию).
   После добавления — Redeploy.
4. В `/admin` → «База знаний» нажмите «Обновить векторы» (векторы также строятся автоматически при сохранении документа).

Локально: `npm run dev` (страницы и /admin). Функции `/api/*` локально работают только через `vercel dev`.
Не помещайте ключ в публичные переменные (`PUBLIC_*`) и в репозиторий.
