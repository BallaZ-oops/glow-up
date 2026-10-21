import { sb, esc, $, badge, money, fmtDate, fmtDateTime, toast, errMsg, loading } from './lib';
import { openForm } from './crud';
import { R, LEAD_STATUS, LEAD_SOURCE } from './resources';

const C = { landing: 'var(--c1)', chat: 'var(--c2)', other: 'var(--c3)' };

// ---------------------------------------------------------------- charts (inline SVG)
function barChart(items: { label: string; parts: { v: number; color: string; name: string }[] }[], opts: { h?: number; fmt?: (n: number) => string } = {}): string {
  const H = opts.h || 160, W = 600, pad = 22;
  const totals = items.map((i) => i.parts.reduce((s, p) => s + p.v, 0));
  const max = Math.max(1, ...totals);
  const bw = W / items.length;
  const fmt = opts.fmt || ((n: number) => String(n));
  const bars = items.map((it, i) => {
    let y = H - pad;
    const segs = it.parts.filter((p) => p.v > 0).map((p) => {
      const h = (p.v / max) * (H - pad - 6);
      y -= h;
      return `<rect x="${i * bw + bw * 0.15}" y="${y}" width="${bw * 0.7}" height="${Math.max(h, 1)}" rx="2" fill="${p.color}"><title>${esc(it.label)} · ${esc(p.name)}: ${fmt(p.v)}</title></rect>`;
    }).join('');
    const showLabel = items.length <= 14 || i % Math.ceil(items.length / 10) === 0;
    return `${segs}${showLabel ? `<text x="${i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" class="axis">${esc(it.label)}</text>` : ''}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="axis-line"/>${bars}<text x="0" y="10" class="axis">${fmt(max)}</text></svg>`;
}

function hbars(items: { label: string; value: number; sub?: string }[], fmt: (n: number) => string = String): string {
  if (!items.length) return '<p class="muted">Данных пока нет.</p>';
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">${items.map((i) => `<div class="hbar"><div class="hbar-top"><span>${esc(i.label)}</span><b>${esc(fmt(i.value))}</b></div><div class="track"><i style="width:${Math.max(2, (i.value / max) * 100)}%"></i></div>${i.sub ? `<small class="muted">${esc(i.sub)}</small>` : ''}</div>`).join('')}</div>`;
}

function delta(cur: number, prev: number): string {
  if (!prev) return cur ? '<small class="up">новые данные</small>' : '<small class="muted">нет данных за прошлый период</small>';
  const p = Math.round(((cur - prev) / prev) * 100);
  return `<small class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% к прошлому периоду</small>`;
}

function kpi(label: string, value: string, sub = '', href = ''): string {
  const inner = `<span class="kpi-l">${esc(label)}</span><b class="kpi-v">${esc(value)}</b>${sub}`;
  return href ? `<a class="card kpi" href="${href}">${inner}</a>` : `<div class="card kpi">${inner}</div>`;
}

async function stats(): Promise<any> {
  const { data, error } = await sb.rpc('admin_stats');
  if (error) throw error;
  return data;
}

function failed(root: HTMLElement, e: unknown, retry: () => void) {
  root.innerHTML = `<div class="card empty err">Не удалось загрузить данные: ${esc(errMsg(e))}<br><small class="muted">Если вы только что подключили проект, убедитесь, что SQL-миграция supabase/migrations/0001_crm.sql выполнена.</small><br><button class="btn ghost" id="retry">Повторить</button></div>`;
  $('#retry', root)?.addEventListener('click', retry);
}

// ---------------------------------------------------------------- dashboard
export async function dashboard(root: HTMLElement): Promise<void> {
  loading(root);
  let s: any;
  try { s = await stats(); } catch (e) { return failed(root, e, () => dashboard(root)); }

  const days = (s.leads_daily as any[]).map((d) => ({
    label: d.d.slice(8, 10) + '.' + d.d.slice(5, 7),
    parts: [
      { v: d.landing, color: C.landing, name: 'Сайт' },
      { v: d.chat, color: C.chat, name: 'AI-чат' },
      { v: d.other, color: C.other, name: 'Другое' },
    ],
  }));
  const rev = (s.revenue_monthly as any[]).map((m) => ({ label: m.m.slice(5), parts: [{ v: Number(m.total), color: C.landing, name: 'Выручка' }] }));
  const conv = s.leads_total ? Math.round((s.leads_converted / s.leads_total) * 100) : 0;

  root.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p class="muted">Данные в реальном времени из Supabase</p></div>
      <div class="head-actions">
        <button class="btn ghost" data-q="lead">+ Заявка</button>
        <button class="btn ghost" data-q="member">+ Клиент</button>
        <button class="btn ghost" data-q="payment">+ Платёж</button>
        <button class="btn primary" data-q="ms">Продать абонемент</button>
      </div></div>
    <div class="kpis">
      ${kpi('Новые заявки', String(s.leads_new), delta(s.leads_7d, s.leads_prev_7d).replace('к прошлому периоду', 'за 7 дн. к прошлой неделе'), '#/leads')}
      ${kpi('Клиенты', String(s.members_total), `<small class="muted">с активным абонементом: ${s.members_active}</small>`, '#/members')}
      ${kpi('Выручка за месяц', money(s.revenue_month), delta(Number(s.revenue_month), Number(s.revenue_prev_month)), '#/payments')}
      ${kpi('Истекают за 7 дней', String(s.expiring_7d), '<small class="muted">абонементов</small>', '#/memberships')}
      ${kpi('Конверсия заявок', `${conv}%`, `<small class="muted">${s.leads_converted} из ${s.leads_total}</small>`, '#/analytics')}
      ${kpi('Записи на занятия', String(s.bookings_upcoming), '<small class="muted">предстоящие</small>', '#/bookings')}
    </div>
    <div class="grid-2">
      <div class="card"><h3>Заявки за 30 дней</h3>${barChart(days)}
        <div class="legend"><span><i style="background:${C.landing}"></i>Сайт</span><span><i style="background:${C.chat}"></i>AI-чат</span><span><i style="background:${C.other}"></i>Другое</span></div></div>
      <div class="card"><h3>Выручка по месяцам</h3>${barChart(rev, { fmt: (n) => (n >= 1000 ? `${Math.round(n / 1000)}к` : String(n)) })}</div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="sub-head"><h3>Последние заявки</h3><a href="#/leads">Все →</a></div>
        ${(s.recent_leads as any[]).length ? `<ul class="plain rows">${(s.recent_leads as any[]).map((l) => `<li><div><b>${esc(l.name)}</b> <span class="muted">${esc(l.phone)}</span><br><small class="muted">${esc(fmtDateTime(l.created_at))} · ${esc(LEAD_SOURCE.find(([k]) => k === l.source)?.[1] || l.source)}${l.interest ? ` · ${esc(l.interest)}` : ''}</small></div>${badge(LEAD_STATUS.find(([k]) => k === l.status)?.[1] || l.status, l.status === 'new' ? 'info' : l.status === 'converted' ? 'ok' : 'mute')}</li>`).join('')}</ul>` : '<p class="muted">Заявок пока нет. Отправьте форму на сайте или напишите в чат — она появится здесь.</p>'}
      </div>
      <div class="card"><div class="sub-head"><h3>Скоро заканчиваются абонементы</h3><a href="#/memberships">Все →</a></div>
        ${(s.expiring as any[]).length ? `<ul class="plain rows">${(s.expiring as any[]).map((m) => `<li><div><b>${esc(m.name)}</b> <span class="muted">${esc(m.phone)}</span><br><small class="muted">${esc(m.plan)}</small></div>${badge('до ' + fmtDate(m.ends_on), 'warn')}</li>`).join('')}</ul>` : '<p class="muted">В ближайшие 14 дней абонементы не заканчиваются.</p>'}
      </div>
    </div>`;

  const done = () => dashboard(root);
  const act: Record<string, () => void> = {
    lead: () => openForm(R.leads, null, {}, done),
    member: () => openForm(R.members, null, {}, done),
    payment: () => openForm(R.payments, null, {}, done),
    ms: () => openForm(R.memberships, null, {}, done),
  };
  root.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => b.addEventListener('click', () => act[b.dataset.q!]()));
}

// ---------------------------------------------------------------- analytics
export async function analytics(root: HTMLElement): Promise<void> {
  loading(root);
  let s: any;
  try { s = await stats(); } catch (e) { return failed(root, e, () => analytics(root)); }

  const funnel = LEAD_STATUS.map(([k, l]) => ({ label: l, value: Number(s.lead_funnel[k] || 0) }));
  const sources = LEAD_SOURCE.map(([k, l]) => ({ label: l, value: Number(s.lead_sources[k] || 0) })).filter((x) => x.value > 0);
  const conv = s.leads_total ? Math.round((s.leads_converted / s.leads_total) * 100) : 0;
  const rev = (s.revenue_monthly as any[]);
  const total12 = rev.reduce((a, m) => a + Number(m.total), 0);
  const days = (s.leads_daily as any[]).map((d) => ({
    label: d.d.slice(8, 10) + '.' + d.d.slice(5, 7),
    parts: [{ v: d.landing, color: C.landing, name: 'Сайт' }, { v: d.chat, color: C.chat, name: 'AI-чат' }, { v: d.other, color: C.other, name: 'Другое' }],
  }));

  root.innerHTML = `
    <div class="page-head"><div><h1>Аналитика</h1><p class="muted">Считается из ваших реальных заявок, клиентов и платежей</p></div></div>
    <div class="kpis">
      ${kpi('Всего заявок', String(s.leads_total))}
      ${kpi('Конверсия в клиентов', `${conv}%`, `<small class="muted">${s.leads_converted} из ${s.leads_total}</small>`)}
      ${kpi('Выручка за 12 мес.', money(total12))}
      ${kpi('Заявок за 7 дней', String(s.leads_7d), delta(s.leads_7d, s.leads_prev_7d))}
    </div>
    <div class="grid-2">
      <div class="card"><h3>Воронка заявок</h3>${hbars(funnel)}</div>
      <div class="card"><h3>Источники заявок</h3>${hbars(sources)}<p class="muted note-s">Сайт — форма на лендинге, AI-чат — заявки, оставленные через помощника.</p></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>Популярность тарифов</h3>${hbars((s.plan_popularity as any[]).map((p) => ({ label: p.name, value: Number(p.count), sub: `Выручка: ${money(p.revenue)}` })), (n) => `${n} шт.`)}</div>
      <div class="card"><h3>Загрузка направлений (записи, 30 дн.)</h3>${hbars((s.class_load as any[]).map((c) => ({ label: c.title, value: Number(c.count) })), (n) => `${n}`)}</div>
    </div>
    <div class="card"><h3>Динамика заявок за 30 дней</h3>${barChart(days, { h: 200 })}</div>`;
}

// ---------------------------------------------------------------- settings
const COMPANY_FIELDS: [string, string, 'text' | 'textarea'][] = [
  ['name', 'Название', 'text'], ['city', 'Город', 'text'], ['address', 'Адрес', 'text'], ['phone', 'Телефон', 'text'],
  ['whatsapp', 'Ссылка WhatsApp', 'text'], ['telegram', 'Ссылка Telegram', 'text'], ['hours', 'Часы работы', 'text'], ['about', 'О клубе', 'textarea'],
];

export async function settings(root: HTMLElement): Promise<void> {
  loading(root);
  const { data, error } = await sb.from('settings').select('key,value');
  if (error) return failed(root, error, () => settings(root));
  const map: Record<string, any> = Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
  const company = map.company || {};
  const bot = map.chatbot || { enabled: true };

  root.innerHTML = `
    <div class="page-head"><div><h1>Настройки</h1><p class="muted">Эти данные использует AI-помощник на сайте</p></div></div>
    <div class="grid-2">
      <form class="card form-grid" id="f-company"><h3 class="full">Информация о компании</h3>
        ${COMPANY_FIELDS.map(([k, l, t]) => `<div class="field ${t === 'textarea' ? 'full' : ''}"><label for="c_${k}">${l}</label>${t === 'textarea' ? `<textarea id="c_${k}" name="${k}" rows="3">${esc(company[k] ?? '')}</textarea>` : `<input id="c_${k}" name="${k}" value="${esc(company[k] ?? '')}"/>`}</div>`).join('')}
        <div class="actions full"><span class="spacer"></span><button class="btn primary">Сохранить</button></div></form>
      <form class="card form-grid" id="f-bot"><h3 class="full">AI-помощник</h3>
        <div class="field check full"><label><input type="checkbox" name="enabled" ${bot.enabled !== false ? 'checked' : ''}/> Чат включён на сайте</label></div>
        <div class="field full"><label for="b_greeting">Приветствие</label><textarea id="b_greeting" name="greeting" rows="3">${esc(bot.greeting ?? '')}</textarea></div>
        <div class="field full"><label for="b_extra">Дополнительные указания для помощника</label><textarea id="b_extra" name="extra_instructions" rows="5" placeholder="Например: всегда предлагай пробную тренировку; говори на «вы»">${esc(bot.extra_instructions ?? '')}</textarea><small class="muted">Факты о клубе вносите в «Базу знаний», «Тарифы» и «Расписание» — помощник берёт их оттуда.</small></div>
        <div class="field full" id="ai-status"><small class="muted">Проверяем подключение AI…</small></div>
        <div class="actions full"><span class="spacer"></span><button class="btn primary">Сохранить</button></div></form>
    </div>`;

  const save = (key: string, form: HTMLFormElement, build: (fd: FormData) => any) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button', form) as HTMLButtonElement;
      btn.disabled = true;
      const { error } = await sb.from('settings').upsert({ key, value: build(new FormData(form)) });
      btn.disabled = false;
      if (error) toast(errMsg(error), 'err'); else toast('Сохранено');
    });
  save('company', $('#f-company', root) as HTMLFormElement, (fd) => {
    const v: Record<string, string> = {};
    COMPANY_FIELDS.forEach(([k]) => { v[k] = String(fd.get(k) || '').trim(); });
    return v;
  });
  save('chatbot', $('#f-bot', root) as HTMLFormElement, (fd) => ({
    enabled: fd.get('enabled') === 'on',
    greeting: String(fd.get('greeting') || '').trim(),
    extra_instructions: String(fd.get('extra_instructions') || '').trim(),
  }));

  // состояние AI на сервере (ключ хранится только в окружении Vercel)
  try {
    const r = await fetch('/api/chat');
    const j = await r.json();
    $('#ai-status', root)!.innerHTML = j.configured
      ? `<span class="badge ok">AI подключён</span> <small class="muted">ANTHROPIC_API_KEY найден на сервере</small>`
      : `<span class="badge bad">AI не подключён</span> <small class="muted">Добавьте ANTHROPIC_API_KEY в переменные окружения Vercel и передеплойте.</small>`;
  } catch {
    $('#ai-status', root)!.innerHTML = '<small class="muted">Состояние AI недоступно в локальном режиме (нет серверной функции).</small>';
  }
}
