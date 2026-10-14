// Минимальный клиент Supabase REST (PostgREST) через fetch, без зависимостей.
function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

export async function insertLead({ name, phone }) {
  const c = config();
  if (!c) throw new Error('supabase_not_configured');
  const r = await fetch(`${c.url}/rest/v1/leads`, {
    method: 'POST',
    headers: headers(c.key, { Prefer: 'return=representation' }),
    body: JSON.stringify({ name, phone }),
  });
  if (!r.ok) throw new Error(`supabase_insert_${r.status}`);
  const [row] = await r.json();
  return row;
}

// Возвращает { rows, total } — страница заявок, новые первыми.
export async function listLeads({ offset = 0, limit = 10 } = {}) {
  const c = config();
  if (!c) throw new Error('supabase_not_configured');
  const r = await fetch(
    `${c.url}/rest/v1/leads?select=id,name,phone,created_at&order=created_at.desc&offset=${offset}&limit=${limit}`,
    { headers: headers(c.key, { Prefer: 'count=exact' }) },
  );
  if (!r.ok) throw new Error(`supabase_list_${r.status}`);
  const total = Number((r.headers.get('content-range') || '').split('/')[1]) || 0;
  return { rows: await r.json(), total };
}
