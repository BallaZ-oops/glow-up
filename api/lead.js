// Vercel serverless function: сохраняет заявку в Supabase и отправляет её в Telegram.
import { insertLead } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const { name = '', phone = '', website = '' } = req.body || {};

  // honeypot: боты заполняют скрытое поле
  if (website) return res.status(200).json({ ok: true });

  const cleanName = String(name).trim().slice(0, 100);
  const cleanPhone = String(phone).trim().slice(0, 30);
  if (!cleanName || cleanPhone.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // Сначала БД: заявка не должна потеряться, даже если Telegram недоступен.
  let saved = false;
  try {
    await insertLead({ name: cleanName, phone: cleanPhone });
    saved = true;
  } catch (e) {
    console.error('lead save failed:', e.message);
  }

  let sent = false;
  if (token && chatId) {
    try {
      const text = `🔥 Новая заявка на пробную\n\nИмя: ${cleanName}\nТелефон: ${cleanPhone}`;
      const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      sent = tg.ok;
    } catch (e) {
      console.error('telegram send failed:', e.message);
    }
  }

  // Успех, если заявка дошла хотя бы одним путём.
  if (saved || sent) return res.status(200).json({ ok: true });
  return res.status(500).json({ ok: false, error: 'failed' });
}
