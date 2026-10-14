// Vercel serverless function: принимает заявку и отправляет её в Telegram.
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
  if (!token || !chatId) {
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  const text = `🔥 Новая заявка на пробную\n\nИмя: ${cleanName}\nТелефон: ${cleanPhone}`;
  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!tg.ok) return res.status(502).json({ ok: false, error: 'telegram' });
  return res.status(200).json({ ok: true });
}
