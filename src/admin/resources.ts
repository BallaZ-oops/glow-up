import { sb, esc, $, badge, money, fmtDate, fmtDateTime, todayISO, toast, errMsg, openModal, loading } from './lib';
import { openForm, type Resource } from './crud';

export const DAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const DAY_OPTIONS: [string, string][] = DAYS.slice(1).map((d, i) => [String(i + 1), d]);

export const LEAD_STATUS: [string, string][] = [
  ['new', 'Новая'], ['contacted', 'Связались'], ['trial', 'Пробная'], ['converted', 'Стал клиентом'], ['lost', 'Отказ'],
];
export const LEAD_SOURCE: [string, string][] = [
  ['landing', 'Сайт'], ['chat', 'AI-чат'], ['manual', 'Вручную'], ['telegram', 'Telegram'],
];
const label = (list: [string, string][], v: string) => list.find(([k]) => k === v)?.[1] || v || '—';
const time = (t: string) => String(t || '').slice(0, 5);

function membershipState(ms: any): [string, 'ok' | 'warn' | 'bad' | 'mute'] {
  if (ms.status === 'cancelled') return ['Отменён', 'mute'];
  if (ms.status === 'frozen') return ['Заморожен', 'warn'];
  if (ms.ends_on < todayISO()) return ['Истёк', 'bad'];
  if (ms.starts_on > todayISO()) return ['Ожидает', 'warn'];
  return ['Активен', 'ok'];
}

const memberRef = {
  table: 'members', select: 'id,full_name,phone', order: 'full_name',
  label: (r: any) => `${r.full_name} · ${r.phone}`,
};

// ------------------------------------------------------------------ leads
const leads: Resource = {
  key: 'leads', title: 'Заявки', singular: 'Заявка', table: 'leads', select: '*',
  hint: 'Обращения с сайта и из AI-чата. Статус можно менять прямо в таблице.',
  search: ['name', 'phone', 'email', 'interest', 'message'],
  order: { col: 'created_at', asc: false },
  newLabel: 'Новая заявка',
  filters: [
    { name: 'status', label: 'Статус', options: LEAD_STATUS },
    { name: 'source', label: 'Источник', options: LEAD_SOURCE },
  ],
  titleOf: (r) => r.name,
  cols: [
    { key: 'created_at', label: 'Дата', render: (r) => esc(fmtDateTime(r.created_at)) },
    { key: 'name', label: 'Имя', render: (r) => `<b>${esc(r.name)}</b>` },
    { key: 'phone', label: 'Телефон', render: (r) => `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` },
    { key: 'source', label: 'Источник', render: (r) => badge(label(LEAD_SOURCE, r.source), r.source === 'chat' ? 'info' : 'mute') },
    { key: 'interest', label: 'Интерес', render: (r) => esc(r.interest || '—') },
    {
      key: 'status', label: 'Статус',
      render: (r) => `<select class="inline-select" data-quick="${r.id}" aria-label="Статус заявки">${LEAD_STATUS.map(([v, l]) => `<option value="${v}" ${r.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`,
    },
    { key: 'assignee', label: 'Ответственный', render: (r) => esc(r.assignee || '—') },
  ],
  fields: [
    { name: 'name', label: 'Имя', type: 'text', required: true },
    { name: 'phone', label: 'Телефон', type: 'tel', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'interest', label: 'Интерес', type: 'text', help: 'Абонемент, направление, пробная…' },
    { name: 'source', label: 'Источник', type: 'select', required: true, options: LEAD_SOURCE, default: 'manual' },
    { name: 'status', label: 'Статус', type: 'select', required: true, options: LEAD_STATUS, default: 'new' },
    { name: 'assignee', label: 'Ответственный', type: 'text' },
    { name: 'message', label: 'Сообщение клиента', type: 'textarea', rows: 3 },
    { name: 'notes', label: 'Заметки менеджера', type: 'textarea', rows: 3 },
  ],
  afterRender(tbody, _rows, reload) {
    tbody.querySelectorAll<HTMLSelectElement>('select[data-quick]').forEach((s) =>
      s.addEventListener('change', async () => {
        s.disabled = true;
        const { error } = await sb.from('leads').update({ status: s.value }).eq('id', Number(s.dataset.quick));
        s.disabled = false;
        if (error) { toast(errMsg(error), 'err'); reload(); return; }
        toast('Статус обновлён');
      }));
  },
  async detail(row, body, ctx) {
    let html = '';
    if (row.member_id) {
      html += `<div class="note ok">Клиент уже создан из этой заявки (карточка в разделе «Клиенты»).</div>`;
    } else {
      html += `<div class="actions"><button class="btn primary" data-convert>Создать клиента из заявки</button></div>`;
    }
    if (row.conversation_id) {
      const { data: msgs } = await sb.from('chat_messages').select('role,content,created_at').eq('conversation_id', row.conversation_id).order('id');
      html += `<h4>Диалог в чате</h4>${transcript(msgs || [])}`;
    }
    body.innerHTML = html;
    $('[data-convert]', body)?.addEventListener('click', async (e) => {
      const btn = e.target as HTMLButtonElement;
      btn.disabled = true;
      const { data: member, error } = await sb.from('members')
        .insert({ full_name: row.name, phone: row.phone, email: row.email, source: row.source, notes: row.message })
        .select('id').single();
      if (error) { btn.disabled = false; toast(errMsg(error), 'err'); return; }
      const { error: e2 } = await sb.from('leads').update({ member_id: member.id, status: 'converted' }).eq('id', row.id);
      if (e2) { toast(errMsg(e2), 'err'); return; }
      toast('Клиент создан');
      ctx.close();
      ctx.reload();
    });
  },
};

function transcript(msgs: any[]): string {
  if (!msgs.length) return '<p class="muted">Сообщений нет.</p>';
  return `<div class="transcript">${msgs.map((m) => `<div class="msg ${m.role}"><span>${m.role === 'user' ? 'Посетитель' : 'AI-помощник'} · ${esc(fmtDateTime(m.created_at))}</span><p>${esc(m.content)}</p></div>`).join('')}</div>`;
}

// ------------------------------------------------------------------ chats
const chats: Resource = {
  key: 'chats', title: 'Диалоги AI-чата', singular: 'Диалог', table: 'chat_conversations',
  select: '*, leads(name,phone), chat_messages(count)',
  hint: 'История разговоров посетителей с AI-помощником.',
  search: [], order: { col: 'last_message_at', asc: false }, canCreate: false, canDelete: false,
  emptyText: 'Диалогов пока нет. Они появятся, когда посетители начнут писать в чат на сайте.',
  titleOf: (r) => fmtDateTime(r.created_at),
  cols: [
    { key: 'created_at', label: 'Начало', render: (r) => esc(fmtDateTime(r.created_at)) },
    { key: 'last_message_at', label: 'Последнее', render: (r) => esc(fmtDateTime(r.last_message_at)) },
    { key: 'n', sort: '', label: 'Сообщений', render: (r) => String(r.chat_messages?.[0]?.count ?? 0) },
    { key: 'lead', sort: '', label: 'Заявка', render: (r) => (r.leads ? badge(`${r.leads.name} · ${r.leads.phone}`, 'ok') : '—') },
  ],
  fields: [],
  async detail(row, body) {
    const { data } = await sb.from('chat_messages').select('role,content,created_at').eq('conversation_id', row.id).order('id');
    body.innerHTML = transcript(data || []);
  },
};

// ------------------------------------------------------------------ members
const members: Resource = {
  key: 'members', title: 'Клиенты', singular: 'Клиент', table: 'members',
  select: '*, memberships(ends_on,starts_on,status)',
  hint: 'Карточка клиента: контакты, абонементы, платежи и связанные заявки.',
  search: ['full_name', 'phone', 'email'], order: { col: 'created_at', asc: false },
  newLabel: 'Новый клиент', titleOf: (r) => r.full_name,
  filters: [{ name: 'status', label: 'Статус', options: [['active', 'Активен'], ['inactive', 'Неактивен']] }],
  cols: [
    { key: 'full_name', label: 'Имя', render: (r) => `<b>${esc(r.full_name)}</b>` },
    { key: 'phone', label: 'Телефон', render: (r) => `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` },
    { key: 'email', label: 'Email', render: (r) => esc(r.email || '—') },
    {
      key: 'ms', label: 'Абонемент',
      render: (r) => {
        const act = (r.memberships || []).filter((m: any) => membershipState(m)[0] === 'Активен').sort((a: any, b: any) => (a.ends_on < b.ends_on ? 1 : -1))[0];
        return act ? badge(`до ${fmtDate(act.ends_on)}`, 'ok') : badge('нет активного', 'mute');
      },
    },
    { key: 'status', label: 'Статус', render: (r) => badge(r.status === 'active' ? 'Активен' : 'Неактивен', r.status === 'active' ? 'ok' : 'mute') },
    { key: 'created_at', label: 'Добавлен', render: (r) => esc(fmtDate(r.created_at)) },
  ],
  fields: [
    { name: 'full_name', label: 'Имя и фамилия', type: 'text', required: true },
    { name: 'phone', label: 'Телефон', type: 'tel', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'birth_date', label: 'Дата рождения', type: 'date' },
    { name: 'status', label: 'Статус', type: 'select', required: true, default: 'active', options: [['active', 'Активен'], ['inactive', 'Неактивен']] },
    { name: 'source', label: 'Откуда пришёл', type: 'text' },
    { name: 'notes', label: 'Заметки', type: 'textarea', rows: 3 },
  ],
  async detail(row, body, ctx) {
    const draw = async () => {
      loading(body);
      const [ms, pay, ld] = await Promise.all([
        sb.from('memberships').select('*, plans(name)').eq('member_id', row.id).order('ends_on', { ascending: false }),
        sb.from('payments').select('*').eq('member_id', row.id).order('paid_at', { ascending: false }).limit(20),
        sb.from('leads').select('id,created_at,source,status,interest').eq('member_id', row.id).order('created_at', { ascending: false }),
      ]);
      const err = ms.error || pay.error || ld.error;
      if (err) throw err;
      const total = (pay.data || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
      body.innerHTML = `
        <div class="sub-head"><h4>Абонементы</h4><button class="btn ghost sm" data-add="ms">+ Абонемент</button></div>
        ${(ms.data || []).length ? `<ul class="plain">${ms.data!.map((m: any) => { const [t, tn] = membershipState(m); return `<li><b>${esc(m.plans?.name)}</b> · ${esc(fmtDate(m.starts_on))} — ${esc(fmtDate(m.ends_on))} · ${esc(money(m.price))} ${badge(t, tn)}</li>`; }).join('')}</ul>` : '<p class="muted">Абонементов нет.</p>'}
        <div class="sub-head"><h4>Платежи <span class="muted">· всего ${esc(money(total))}</span></h4><button class="btn ghost sm" data-add="pay">+ Платёж</button></div>
        ${(pay.data || []).length ? `<ul class="plain">${pay.data!.map((p: any) => `<li>${esc(fmtDateTime(p.paid_at))} · <b>${esc(money(p.amount))}</b> · ${esc(label(PAY_METHOD, p.method))}${p.note ? ` · ${esc(p.note)}` : ''}</li>`).join('')}</ul>` : '<p class="muted">Платежей нет.</p>'}
        ${(ld.data || []).length ? `<h4>Заявки клиента</h4><ul class="plain">${ld.data!.map((l: any) => `<li>${esc(fmtDateTime(l.created_at))} · ${esc(label(LEAD_SOURCE, l.source))} · ${esc(label(LEAD_STATUS, l.status))}${l.interest ? ` · ${esc(l.interest)}` : ''}</li>`).join('')}</ul>` : ''}`;
      $('[data-add=ms]', body)?.addEventListener('click', () => openForm(R.memberships, null, { member_id: row.id }, () => { draw(); ctx.reload(); }));
      $('[data-add=pay]', body)?.addEventListener('click', () => openForm(R.payments, null, { member_id: row.id }, () => { draw(); ctx.reload(); }));
    };
    await draw();
  },
};

// ------------------------------------------------------------------ memberships
const planRef = { table: 'plans', select: 'id,name,price', order: 'sort_order', label: (r: any) => `${r.name} · ${money(r.price)}` };

const memberships: Resource = {
  key: 'memberships', title: 'Абонементы клиентов', singular: 'Абонемент клиента', table: 'memberships',
  select: '*, members(full_name,phone), plans(name)',
  hint: 'Продажа абонементов. Если срок и цену не указать — подставятся из тарифа.',
  search: [], order: { col: 'ends_on', asc: false }, newLabel: 'Продать абонемент',
  filters: [{ name: 'status', label: 'Статус', options: [['active', 'Действует'], ['frozen', 'Заморожен'], ['cancelled', 'Отменён']] }],
  titleOf: (r) => r.members?.full_name || '',
  cols: [
    { key: 'member', sort: '', label: 'Клиент', render: (r) => `<b>${esc(r.members?.full_name)}</b><br><small class="muted">${esc(r.members?.phone)}</small>` },
    { key: 'plan', sort: '', label: 'Тариф', render: (r) => esc(r.plans?.name) },
    { key: 'starts_on', label: 'С', render: (r) => esc(fmtDate(r.starts_on)) },
    { key: 'ends_on', label: 'До', render: (r) => esc(fmtDate(r.ends_on)) },
    { key: 'price', label: 'Цена', render: (r) => esc(money(r.price)) },
    { key: 'status', label: 'Состояние', sort: 'status', render: (r) => { const [t, tn] = membershipState(r); return badge(t, tn); } },
  ],
  fields: [
    { name: 'member_id', label: 'Клиент', type: 'select', required: true, ref: memberRef },
    { name: 'plan_id', label: 'Тариф', type: 'select', required: true, ref: planRef },
    { name: 'starts_on', label: 'Начало', type: 'date', required: true, default: todayISO },
    { name: 'ends_on', label: 'Окончание', type: 'date', help: 'Пусто — по сроку тарифа (только при создании)' },
    { name: 'price', label: 'Цена, сом', type: 'number', min: 0, help: 'Пусто — цена тарифа (только при создании)' },
    { name: 'status', label: 'Статус', type: 'select', required: true, default: 'active', options: [['active', 'Действует'], ['frozen', 'Заморожен'], ['cancelled', 'Отменён']] },
    { name: 'notes', label: 'Заметки', type: 'textarea', rows: 2 },
  ],
};

// ------------------------------------------------------------------ payments
const PAY_METHOD: [string, string][] = [['cash', 'Наличные'], ['card', 'Карта'], ['transfer', 'Перевод'], ['other', 'Другое']];
const payments: Resource = {
  key: 'payments', title: 'Платежи', singular: 'Платёж', table: 'payments',
  select: '*, members(full_name)', hint: 'Оплаты клиентов — основа выручки на Dashboard.',
  search: ['note'], order: { col: 'paid_at', asc: false }, newLabel: 'Добавить платёж',
  filters: [{ name: 'method', label: 'Способ', options: PAY_METHOD }],
  titleOf: (r) => money(r.amount),
  cols: [
    { key: 'paid_at', label: 'Дата', render: (r) => esc(fmtDateTime(r.paid_at)) },
    { key: 'member', sort: '', label: 'Клиент', render: (r) => `<b>${esc(r.members?.full_name)}</b>` },
    { key: 'amount', label: 'Сумма', render: (r) => esc(money(r.amount)) },
    { key: 'method', label: 'Способ', render: (r) => esc(label(PAY_METHOD, r.method)) },
    { key: 'note', label: 'Комментарий', render: (r) => esc(r.note || '—') },
  ],
  fields: [
    { name: 'member_id', label: 'Клиент', type: 'select', required: true, ref: memberRef },
    { name: 'amount', label: 'Сумма, сом', type: 'number', required: true, min: 1 },
    { name: 'method', label: 'Способ', type: 'select', required: true, default: 'cash', options: PAY_METHOD },
    { name: 'paid_at', label: 'Дата и время', type: 'datetime', required: true },
    { name: 'note', label: 'Комментарий', type: 'text', full: true },
  ],
};

// ------------------------------------------------------------------ catalog
const plans: Resource = {
  key: 'plans', title: 'Тарифы', singular: 'Тариф', table: 'plans', select: '*',
  hint: 'Абонементы клуба. Цены отсюда видит AI-помощник.',
  search: ['name', 'description'], order: { col: 'sort_order', asc: true }, newLabel: 'Новый тариф', titleOf: (r) => r.name,
  cols: [
    { key: 'name', label: 'Название', render: (r) => `<b>${esc(r.name)}</b>` },
    { key: 'price', label: 'Цена', render: (r) => esc(money(r.price)) },
    { key: 'duration_days', label: 'Срок', render: (r) => `${r.duration_days} дн.` },
    { key: 'description', label: 'Описание', render: (r) => esc(r.description || '—') },
    { key: 'is_active', label: 'Активен', render: (r) => badge(r.is_active ? 'Да' : 'Скрыт', r.is_active ? 'ok' : 'mute') },
  ],
  fields: [
    { name: 'name', label: 'Название', type: 'text', required: true },
    { name: 'price', label: 'Цена, сом', type: 'number', required: true, min: 0 },
    { name: 'duration_days', label: 'Срок, дней', type: 'number', required: true, min: 1, step: '1' },
    { name: 'sort_order', label: 'Порядок', type: 'number', required: true, default: 0, step: '1' },
    { name: 'description', label: 'Описание', type: 'textarea', rows: 3 },
    { name: 'is_active', label: 'Показывать (доступен для продажи)', type: 'bool', default: true, full: true },
  ],
};

const programs: Resource = {
  key: 'programs', title: 'Направления', singular: 'Направление', table: 'programs', select: '*',
  hint: 'Программы тренировок клуба.',
  search: ['title', 'description'], order: { col: 'sort_order', asc: true }, newLabel: 'Новое направление', titleOf: (r) => r.title,
  cols: [
    { key: 'title', label: 'Название', render: (r) => `<b>${esc(r.title)}</b>` },
    { key: 'description', label: 'Описание', render: (r) => esc(r.description || '—') },
    { key: 'is_active', label: 'Активно', render: (r) => badge(r.is_active ? 'Да' : 'Скрыто', r.is_active ? 'ok' : 'mute') },
  ],
  fields: [
    { name: 'title', label: 'Название', type: 'text', required: true },
    { name: 'sort_order', label: 'Порядок', type: 'number', required: true, default: 0, step: '1' },
    { name: 'description', label: 'Описание', type: 'textarea', rows: 3 },
    { name: 'is_active', label: 'Показывать', type: 'bool', default: true, full: true },
  ],
};

const trainers: Resource = {
  key: 'trainers', title: 'Тренеры', singular: 'Тренер', table: 'trainers', select: '*',
  search: ['full_name', 'role'], order: { col: 'full_name', asc: true }, newLabel: 'Новый тренер', titleOf: (r) => r.full_name,
  cols: [
    { key: 'full_name', label: 'Имя', render: (r) => `<b>${esc(r.full_name)}</b>` },
    { key: 'role', label: 'Специализация', render: (r) => esc(r.role || '—') },
    { key: 'phone', label: 'Телефон', render: (r) => esc(r.phone || '—') },
    { key: 'is_active', label: 'Работает', render: (r) => badge(r.is_active ? 'Да' : 'Нет', r.is_active ? 'ok' : 'mute') },
  ],
  fields: [
    { name: 'full_name', label: 'Имя', type: 'text', required: true },
    { name: 'role', label: 'Специализация', type: 'text' },
    { name: 'phone', label: 'Телефон', type: 'tel' },
    { name: 'bio', label: 'О тренере', type: 'textarea', rows: 3 },
    { name: 'is_active', label: 'Работает в клубе', type: 'bool', default: true, full: true },
  ],
};

const sessionRef = {
  table: 'class_sessions', select: 'id,weekday,start_time,programs(title)',
  label: (r: any) => `${DAYS[r.weekday]} ${time(r.start_time)} · ${r.programs?.title}`,
};

const sessions: Resource = {
  key: 'sessions', title: 'Расписание', singular: 'Занятие', table: 'class_sessions',
  select: '*, programs(title), trainers(full_name)',
  hint: 'Недельное расписание. Вместимость нужна для проверки свободных мест (пусто — лимит не задан).',
  search: [], order: { col: 'weekday', asc: true }, newLabel: 'Новое занятие',
  filters: [{ name: 'weekday', label: 'День', options: DAY_OPTIONS }],
  titleOf: (r) => `${DAYS[r.weekday]} ${time(r.start_time)}`,
  cols: [
    { key: 'weekday', label: 'День', render: (r) => `<b>${DAYS[r.weekday]}</b>` },
    { key: 'start_time', label: 'Время', render: (r) => time(r.start_time) },
    { key: 'program', sort: '', label: 'Направление', render: (r) => esc(r.programs?.title) },
    { key: 'trainer', sort: '', label: 'Тренер', render: (r) => esc(r.trainers?.full_name || '—') },
    { key: 'capacity', label: 'Мест', render: (r) => (r.capacity ?? '—') as string },
    { key: 'is_active', label: 'Активно', render: (r) => badge(r.is_active ? 'Да' : 'Нет', r.is_active ? 'ok' : 'mute') },
  ],
  fields: [
    { name: 'program_id', label: 'Направление', type: 'select', required: true, ref: { table: 'programs', select: 'id,title', order: 'sort_order', label: (r) => r.title } },
    { name: 'trainer_id', label: 'Тренер', type: 'select', ref: { table: 'trainers', select: 'id,full_name', order: 'full_name', label: (r) => r.full_name } },
    { name: 'weekday', label: 'День недели', type: 'select', required: true, options: DAY_OPTIONS, default: '1' },
    { name: 'start_time', label: 'Начало', type: 'time', required: true },
    { name: 'duration_min', label: 'Длительность, мин', type: 'number', required: true, default: 60, min: 1, step: '1' },
    { name: 'capacity', label: 'Вместимость', type: 'number', min: 1, step: '1' },
    { name: 'is_active', label: 'Проводится', type: 'bool', default: true, full: true },
  ],
};

const BOOK_STATUS: [string, string][] = [['booked', 'Записан'], ['attended', 'Пришёл'], ['no_show', 'Не пришёл'], ['cancelled', 'Отменено']];
const bookings: Resource = {
  key: 'bookings', title: 'Записи на занятия', singular: 'Запись', table: 'bookings',
  select: '*, class_sessions(weekday,start_time,programs(title)), members(full_name)',
  hint: 'Записи клиентов и гостей. Учитываются при проверке свободных мест AI-помощником.',
  search: ['guest_name', 'guest_phone'], order: { col: 'booking_date', asc: false }, newLabel: 'Новая запись',
  filters: [{ name: 'status', label: 'Статус', options: BOOK_STATUS }],
  titleOf: (r) => fmtDate(r.booking_date),
  cols: [
    { key: 'booking_date', label: 'Дата', render: (r) => esc(fmtDate(r.booking_date)) },
    { key: 'session', sort: '', label: 'Занятие', render: (r) => r.class_sessions ? esc(`${time(r.class_sessions.start_time)} · ${r.class_sessions.programs?.title}`) : '—' },
    { key: 'who', sort: '', label: 'Кто', render: (r) => `<b>${esc(r.members?.full_name || r.guest_name || '—')}</b>${r.guest_phone ? `<br><small class="muted">${esc(r.guest_phone)}</small>` : ''}` },
    { key: 'status', label: 'Статус', render: (r) => badge(label(BOOK_STATUS, r.status), r.status === 'attended' ? 'ok' : r.status === 'booked' ? 'info' : 'mute') },
  ],
  fields: [
    { name: 'session_id', label: 'Занятие', type: 'select', required: true, ref: sessionRef },
    { name: 'booking_date', label: 'Дата', type: 'date', required: true, default: todayISO },
    { name: 'member_id', label: 'Клиент', type: 'select', ref: memberRef, help: 'Или укажите гостя ниже' },
    { name: 'guest_name', label: 'Имя гостя', type: 'text' },
    { name: 'guest_phone', label: 'Телефон гостя', type: 'tel' },
    { name: 'status', label: 'Статус', type: 'select', required: true, default: 'booked', options: BOOK_STATUS },
  ],
};

// ------------------------------------------------------------------ knowledge base
const KB_CAT: [string, string][] = [['company', 'О компании'], ['faq', 'Вопрос-ответ'], ['service', 'Услуги'], ['pricing', 'Цены'], ['policy', 'Правила'], ['other', 'Другое']];

async function kbSearchDialog() {
  const m = openModal('Проверка поиска по базе знаний');
  m.body.innerHTML = `<p class="muted">Так AI-помощник ищет информацию. Введите вопрос посетителя.</p>
    <form class="inline-form"><input type="search" placeholder="Например: можно ли заморозить абонемент?" required /><button class="btn primary">Найти</button></form><div id="kb-res"></div>`;
  const out = $('#kb-res', m.body)!;
  $('form', m.body)!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = ($('input', m.body) as HTMLInputElement).value;
    loading(out);
    const { data, error } = await sb.rpc('kb_search', { p_query: q, p_limit: 5 });
    if (error) { out.innerHTML = `<div class="empty err">${esc(errMsg(error))}</div>`; return; }
    out.innerHTML = (data || []).length
      ? (data as any[]).map((r) => `<div class="hit"><b>${esc(r.title)}</b> ${badge(label(KB_CAT, r.category))}<p>${esc(r.content)}</p></div>`).join('')
      : '<div class="empty">Ничего не найдено. На такой вопрос AI ответит, что подтверждённой информации нет.</div>';
  });
}

const kb: Resource = {
  key: 'kb', title: 'База знаний', singular: 'Документ', table: 'kb_documents',
  select: '*, kb_chunks(count)',
  hint: 'Тексты, из которых AI-помощник берёт ответы. После сохранения поисковый индекс обновляется автоматически.',
  search: ['title', 'content'], order: { col: 'updated_at', asc: false }, newLabel: 'Новый документ',
  filters: [{ name: 'category', label: 'Раздел', options: KB_CAT }],
  titleOf: (r) => r.title,
  cols: [
    { key: 'title', label: 'Название', render: (r) => `<b>${esc(r.title)}</b>` },
    { key: 'category', label: 'Раздел', render: (r) => badge(label(KB_CAT, r.category)) },
    { key: 'chunks', sort: '', label: 'Фрагментов', render: (r) => String(r.kb_chunks?.[0]?.count ?? 0) },
    { key: 'is_published', label: 'Для AI', render: (r) => badge(r.is_published ? 'Опубликован' : 'Черновик', r.is_published ? 'ok' : 'mute') },
    { key: 'updated_at', label: 'Обновлён', render: (r) => esc(fmtDateTime(r.updated_at)) },
  ],
  fields: [
    { name: 'title', label: 'Заголовок / вопрос', type: 'text', required: true, full: true },
    { name: 'category', label: 'Раздел', type: 'select', required: true, options: KB_CAT, default: 'faq' },
    { name: 'is_published', label: 'Доступен AI-помощнику', type: 'bool', default: true },
    { name: 'content', label: 'Текст / ответ', type: 'textarea', required: true, rows: 10, help: 'Абзацы разделяйте пустой строкой — так текст делится на фрагменты для поиска.' },
  ],
  toolbar(bar, reload) {
    const test = document.createElement('button');
    test.className = 'btn ghost';
    test.textContent = 'Проверить поиск';
    test.addEventListener('click', kbSearchDialog);
    const up = document.createElement('label');
    up.className = 'btn ghost';
    up.innerHTML = 'Загрузить .txt / .md <input type="file" accept=".txt,.md,text/plain,text/markdown" hidden />';
    up.querySelector('input')!.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      if (f.size > 500_000) { toast('Файл больше 500 КБ', 'err'); return; }
      const text = (await f.text()).trim();
      if (!text) { toast('Файл пустой', 'err'); return; }
      const { error } = await sb.from('kb_documents').insert({
        title: f.name.replace(/\.[^.]+$/, ''), category: 'other', content: text, source_name: f.name,
      });
      if (error) { toast(errMsg(error), 'err'); return; }
      toast('Документ загружен и проиндексирован');
      reload();
    });
    bar.prepend(test, up);
  },
  async detail(row, body) {
    const { data } = await sb.from('kb_chunks').select('chunk_index,content').eq('document_id', row.id).order('chunk_index');
    body.innerHTML = `<h4>Фрагменты в поисковом индексе (${(data || []).length})</h4>` +
      ((data || []).length
        ? (data as any[]).map((c) => `<div class="hit"><small class="muted">#${c.chunk_index + 1}</small><p>${esc(c.content)}</p></div>`).join('')
        : '<p class="muted">Документ не опубликован — в индексе его нет.</p>');
  },
};

export const R: Record<string, Resource> = {
  leads, chats, members, memberships, payments, plans, programs, trainers, sessions, bookings, kb,
};
