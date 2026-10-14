// Webhook Telegram-бота: /history — история заявок (из Supabase) с пагинацией.
// Доступно только чату TELEGRAM_CHAT_ID.
import { listLeads } from './_lib/supabase.js';

const PAGE = 10;

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.ok;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: process.env.TIMEZONE || 'Asia/Bishkek',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function renderPage(page) {
  const { rows, total } = await listLeads({ offset: page * PAGE, limit: PAGE });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (!rows.length && page > 0) return renderPage(pages - 1);
  const body = rows.length
    ? rows.map((l) => `#${l.id} · ${fmtDate(l.created_at)}\n${l.name} — ${l.phone}`).join('\n\n')
    : 'Заявок пока нет.';
  const text = `📋 Заявки (всего: ${total}), стр. ${page + 1}/${pages}\n\n${body}`;
  const nav = [];
  if (page > 0) nav.push({ text: '← Новее', callback_data: `h:${page - 1}` });
  if (page + 1 < pages) nav.push({ text: 'Старее →', callback_data: `h:${page + 1}` });
  return { text, reply_markup: { inline_keyboard: nav.length ? [nav] : [] } };
}

export default async function handler(req, res) {
  // Telegram присылает секрет, заданный при setWebhook
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ ok: false });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const update = req.body || {};
  const allowed = String(process.env.TELEGRAM_CHAT_ID || '');

  try {
    const cb = update.callback_query;
    if (cb) {
      const chat = cb.message?.chat?.id;
      if (String(chat) !== allowed) return res.status(200).json({ ok: true });
      const m = /^h:(\d+)$/.exec(cb.data || '');
      if (m) {
        const view = await renderPage(Number(m[1]));
        await tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, ...view });
      }
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
      return res.status(200).json({ ok: true });
    }

    const msg = update.message;
    if (!msg?.text) return res.status(200).json({ ok: true });
    const chat = msg.chat.id;
    if (String(chat) !== allowed) return res.status(200).json({ ok: true });

    const cmd = msg.text.split(/[\s@]/)[0].toLowerCase();
    if (cmd === '/history' || cmd === '/leads') {
      await tg('sendMessage', { chat_id: chat, ...(await renderPage(0)) });
    } else if (cmd === '/start' || cmd === '/help') {
      await tg('sendMessage', { chat_id: chat, text: 'Команды:\n/history — история заявок' });
    }
  } catch (e) {
    console.error('telegram webhook error:', e.message);
  }
  // Всегда 200, чтобы Telegram не ретраил обновление
  return res.status(200).json({ ok: true });
}
