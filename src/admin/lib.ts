import { createClient } from '@supabase/supabase-js';

// URL и publishable-ключ Supabase публичны по замыслу (доступ ограничивает RLS).
const URL = import.meta.env.PUBLIC_SUPABASE_URL || 'https://vczndifclqohjybejbul.supabase.co';
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_1yTMNtmZg-J09oQ_XUtfsQ_80NI64Dv';

export const sb = createClient(URL, KEY);

export const TZ = 'Asia/Bishkek';

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

export function money(n: unknown): string {
  return `${Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} сом`;
}
export function fmtDate(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : String(v));
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: String(v).length <= 10 ? undefined : TZ });
}
export function fmtDateTime(v: unknown): string {
  if (!v) return '—';
  return new Date(String(v)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
export function todayISO(): string {
  return new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}
export function toLocalInput(v?: string | null): string {
  const d = v ? new Date(v) : new Date();
  const s = new Date(d.getTime() + 6 * 3600 * 1000).toISOString();
  return s.slice(0, 16);
}
export function fromLocalInput(v: string): string {
  return new Date(`${v}:00+06:00`).toISOString();
}

export function badge(text: string, tone: 'ok' | 'warn' | 'bad' | 'info' | 'mute' = 'mute'): string {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

// ---------- toast ----------
export function toast(msg: string, type: 'ok' | 'err' = 'ok'): void {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), type === 'err' ? 5000 : 2500);
  setTimeout(() => t.remove(), type === 'err' ? 5400 : 2900);
}

export function errMsg(e: any): string {
  const m = String(e?.message || e || 'Ошибка');
  if (/foreign key|violates foreign/i.test(m)) return 'Нельзя: запись связана с другими данными.';
  if (/duplicate key/i.test(m)) return 'Такая запись уже существует.';
  if (/check constraint/i.test(m)) return 'Значение не прошло проверку данных.';
  if (/row-level security|42501|forbidden/i.test(m)) return 'Недостаточно прав.';
  return m;
}

// ---------- modal ----------
export interface ModalHandle { el: HTMLElement; body: HTMLElement; close: () => void }

export function openModal(title: string, opts: { wide?: boolean } = {}): ModalHandle {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="Закрыть">✕</button></header>
    <div class="modal-body"></div></div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  const close = () => {
    wrap.remove();
    if (!document.querySelector('.modal-wrap')) document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    const all = document.querySelectorAll('.modal-wrap');
    if (e.key === 'Escape' && all[all.length - 1] === wrap) close();
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $('[data-x]', wrap)!.addEventListener('click', close);
  return { el: wrap, body: $('.modal-body', wrap)!, close };
}

export function confirmDialog(text: string, okLabel = 'Удалить'): Promise<boolean> {
  return new Promise((resolve) => {
    const m = openModal('Подтверждение');
    m.body.innerHTML = `<p>${esc(text)}</p><div class="actions"><button class="btn ghost" data-no>Отмена</button><button class="btn danger" data-ok>${esc(okLabel)}</button></div>`;
    let done = false;
    const fin = (v: boolean) => { if (done) return; done = true; m.close(); resolve(v); };
    $('[data-no]', m.body)!.addEventListener('click', () => fin(false));
    $('[data-ok]', m.body)!.addEventListener('click', () => fin(true));
    $('[data-x]', m.el)!.addEventListener('click', () => fin(false));
    m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) fin(false); });
  });
}

export function loading(el: HTMLElement): void {
  el.innerHTML = '<div class="loader"><span></span></div>';
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms = 300): T {
  let t: any;
  return ((...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as T;
}
