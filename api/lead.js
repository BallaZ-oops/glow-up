// Vercel serverless function: сохраняет заявку с лендинга в Supabase (CRM) и шлёт её в Telegram.
import { insertLead } from './_lib/supabase.js';
import { allow, cleanPhone, cleanText, notifyTelegram } from './_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const { name = '', phone = '', website = '' } = req.body || {};

  // honeypot: боты заполняют скрытое поле
  if (website) return res.status(200).json({ ok: true });

  const cleanName = cleanText(name, 100);
  const phoneOk = cleanPhone(phone);
  if (!cleanName || !phoneOk) return res.status(400).json({ ok: false, error: 'invalid' });

  if (!(await allow('lead', req, 3600, 5))) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  // Сначала БД: заявка не должна потеряться, даже если Telegram недоступен.
  let saved = false;
  try {
    await insertLead({ name: cleanName, phone: phoneOk, source: 'landing' });
    saved = true;
  } catch (e) {
    console.error('lead save failed:', e.message);
  }

  const sent = await notifyTelegram(`🔥 Новая заявка на пробную\n\nИмя: ${cleanName}\nТелефон: ${phoneOk}`);

  // Успех, если заявка дошла хотя бы одним путём.
  if (saved || sent) return res.status(200).json({ ok: true });
  return res.status(500).json({ ok: false, error: 'failed' });
}
