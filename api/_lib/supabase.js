// Серверный клиент Supabase (service_role). Ключ живёт только в переменных окружения Vercel.
import { createClient } from '@supabase/supabase-js';

let client = null;

export function getDb() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('supabase_not_configured');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// Создаёт заявку. Если CRM-миграция ещё не применена (нет новых колонок),
// откатывается на базовые поля, чтобы форма на лендинге не ломалась.
export async function insertLead({ name, phone, source = 'landing', email, message, interest, conversation_id }) {
  const db = getDb();
  const full = { name, phone, source };
  if (email) full.email = email;
  if (message) full.message = message;
  if (interest) full.interest = interest;
  if (conversation_id) full.conversation_id = conversation_id;

  let { data, error } = await db.from('leads').insert(full).select().single();
  if (error && /column|schema cache/i.test(error.message || '')) {
    ({ data, error } = await db.from('leads').insert({ name, phone }).select().single());
  }
  if (error) throw new Error(`supabase_insert: ${error.message}`);
  return data;
}

// Возвращает { rows, total } — страница заявок, новые первыми.
export async function listLeads({ offset = 0, limit = 10 } = {}) {
  const db = getDb();
  const { data, count, error } = await db
    .from('leads')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`supabase_list: ${error.message}`);
  return { rows: data || [], total: count || 0 };
}
