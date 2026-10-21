// POST /api/kb-embed — создаёт embeddings (OpenAI) для новых/изменённых фрагментов базы знаний.
// Доступно только администраторам: проверяется Supabase-токен вызывающего и его запись в admins.
import { createClient } from '@supabase/supabase-js';
import { allow } from './_lib/security.js';
import { aiConfigured } from './_lib/openai.js';
import { embedPending } from './_lib/kb.js';

const URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || 'https://vczndifclqohjybejbul.supabase.co';
const ANON = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_1yTMNtmZg-J09oQ_XUtfsQ_80NI64Dv';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'unauthorized' });

  // is_admin() выполняется от имени вызывающего пользователя (auth.uid() из его токена)
  const asUser = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error } = await asUser.rpc('is_admin');
  if (error || isAdmin !== true) return res.status(403).json({ ok: false, error: 'forbidden' });

  if (!aiConfigured()) return res.status(503).json({ ok: false, error: 'ai_not_configured' });
  if (!(await allow('kbembed', req, 60, 10))) return res.status(429).json({ ok: false, error: 'rate_limited' });

  try {
    const r = await embedPending();
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('kb-embed failed:', e.status || '', String(e.message).slice(0, 200));
    return res.status(502).json({ ok: false, error: 'embed_failed' });
  }
}
