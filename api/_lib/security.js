import crypto from 'node:crypto';
import { getDb } from './supabase.js';

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'unknown';
}

export function ipKey(req) {
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_URL || 'glowup';
  return crypto.createHash('sha256').update(salt + clientIp(req)).digest('hex').slice(0, 24);
}

const memory = new Map(); // запасной счётчик, если БД недоступна (на один экземпляр функции)

// true = запрос разрешён.
export async function allow(scope, req, windowSeconds, max) {
  const key = `${scope}:${ipKey(req)}`;
  try {
    const { data, error } = await getDb().rpc('rate_limit_hit', {
      p_key: key, p_window_seconds: windowSeconds, p_max: max,
    });
    if (!error && typeof data === 'boolean') return data;
  } catch {}
  const now = Date.now();
  const e = memory.get(key);
  if (!e || now - e.t > windowSeconds * 1000) { memory.set(key, { t: now, n: 1 }); return true; }
  e.n += 1;
  return e.n <= max;
}

// Общий (не по IP) лимит — потолок расходов на AI в сутки.
export async function allowGlobal(scope, windowSeconds, max) {
  try {
    const { data, error } = await getDb().rpc('rate_limit_hit', { p_key: 'global:' + scope, p_window_seconds: windowSeconds, p_max: max });
    if (!error && typeof data === 'boolean') return data;
  } catch {}
  return true;
}

export function cleanPhone(v) {
  const s = String(v ?? '').trim().slice(0, 30);
  return s.replace(/\D/g, '').length >= 9 && /^[+\d\s()\-]+$/.test(s) ? s : null;
}

export function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

export async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return r.ok;
  } catch (e) {
    console.error('telegram send failed:', e.message);
    return false;
  }
}
