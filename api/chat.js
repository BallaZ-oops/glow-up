// POST /api/chat — диалог с AI-агентом. GET /api/chat — состояние виджета (включён ли, есть ли ключ).
import { getDb } from './_lib/supabase.js';
import { allow, cleanText } from './_lib/security.js';
import { runAgent, aiConfigured } from './_lib/agent.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function chatSettings() {
  try {
    const { data } = await getDb().from('settings').select('key,value').in('key', ['chatbot', 'company']);
    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    return { bot: map.chatbot || { enabled: true }, company: map.company || {} };
  } catch {
    return { bot: { enabled: true }, company: {} };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const { bot, company } = await chatSettings();
    return res.status(200).json({
      enabled: bot.enabled !== false,
      configured: aiConfigured(),
      greeting: bot.greeting || null,
      phone: company.phone || null,
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false });
  }

  const { bot } = await chatSettings();
  if (bot.enabled === false) return res.status(503).json({ ok: false, error: 'disabled' });
  if (!aiConfigured()) return res.status(503).json({ ok: false, error: 'ai_not_configured' });

  // --- валидация ---
  const body = req.body || {};
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 60) {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }
  let history = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: cleanText(m.content, 2000) }))
    .filter((m) => m.content);
  history = history.slice(-20);
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }

  if (!(await allow('chat', req, 600, 20))) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  // --- диалог в БД (сбой записи не должен ломать ответ) ---
  const db = getDb();
  let conversationId = typeof body.conversation_id === 'string' && UUID.test(body.conversation_id) ? body.conversation_id : null;
  try {
    if (conversationId) {
      const { data } = await db.from('chat_conversations').select('id').eq('id', conversationId).maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const { data } = await db.from('chat_conversations').insert({}).select('id').single();
      conversationId = data?.id || null;
    }
  } catch (e) {
    console.error('conversation save failed:', e.message);
    conversationId = null;
  }

  const store = async (role, content) => {
    if (!conversationId) return;
    try {
      await db.from('chat_messages').insert({ conversation_id: conversationId, role, content });
      await db.from('chat_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);
    } catch (e) { console.error('message save failed:', e.message); }
  };
  await store('user', history[history.length - 1].content);

  try {
    const { reply, leadCreated } = await runAgent({ history, conversationId, req });
    await store('assistant', reply);
    return res.status(200).json({ ok: true, reply, conversation_id: conversationId, lead_created: leadCreated });
  } catch (e) {
    console.error('agent failed:', e.status || '', e.message);
    return res.status(502).json({ ok: false, error: 'agent_failed' });
  }
}
