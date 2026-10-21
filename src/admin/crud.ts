import { sb, esc, $, toast, errMsg, openModal, confirmDialog, loading, debounce, toLocalInput, fromLocalInput } from './lib';

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'time' | 'datetime' | 'select' | 'bool' | 'email' | 'tel';

export interface RefDef {
  table: string;
  select: string;
  label: (r: any) => string;
  order?: string;
  filter?: (q: any) => any;
}

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: [string, string][];
  ref?: RefDef;
  default?: any;
  help?: string;
  full?: boolean;
  rows?: number;
  min?: number;
  step?: string;
}

export interface Col {
  key: string;
  label: string;
  sort?: string;
  render?: (r: any) => string;
  cls?: string;
}

export interface Resource {
  key: string;
  title: string;
  singular: string;
  table: string;
  select: string;
  cols: Col[];
  fields: Field[];
  search: string[];
  order: { col: string; asc: boolean };
  filters?: { name: string; label: string; options: [string, string][] }[];
  canCreate?: boolean;
  canDelete?: boolean;
  newLabel?: string;
  hint?: string;
  emptyText?: string;
  detail?: (row: any, body: HTMLElement, ctx: { reload: () => void; close: () => void }) => Promise<void> | void;
  toolbar?: (bar: HTMLElement, reload: () => void) => void;
  afterRender?: (tbody: HTMLElement, rows: any[], reload: () => void) => void;
  titleOf?: (row: any) => string;
  onSaved?: () => void;
}

const PAGE = 20;
const refCache = new Map<string, [string, string][]>();

export function clearRefCache(): void { refCache.clear(); }

async function loadRef(ref: RefDef): Promise<[string, string][]> {
  const k = `${ref.table}|${ref.select}`;
  if (refCache.has(k)) return refCache.get(k)!;
  let q = sb.from(ref.table).select(ref.select).limit(1000);
  if (ref.order) q = q.order(ref.order);
  if (ref.filter) q = ref.filter(q);
  const { data, error } = await q;
  if (error) throw error;
  const opts = ((data as any[]) || []).map((r) => [r.id, ref.label(r)] as [string, string]);
  opts.sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  refCache.set(k, opts);
  return opts;
}

// ------------------------------------------------------------------ list
export async function mountResource(res: Resource, root: HTMLElement): Promise<void> {
  const state = { q: '', page: 0, sort: { ...res.order }, filters: {} as Record<string, string> };

  root.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(res.title)}</h1>${res.hint ? `<p class="muted">${esc(res.hint)}</p>` : ''}</div>
      <div class="head-actions" id="head-actions"></div>
    </div>
    <div class="toolbar">
      <input type="search" class="search" placeholder="Поиск…" aria-label="Поиск" ${res.search.length ? '' : 'hidden'} />
      ${(res.filters || []).map((f) => `<select data-filter="${f.name}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: все</option>${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`).join('')}
      <span class="spacer"></span>
      <span class="muted" id="total"></span>
    </div>
    <div class="card table-card"><div class="table-scroll" id="table"></div><div class="pager" id="pager"></div></div>`;

  if (res.canCreate !== false && res.fields.length) {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = `+ ${res.newLabel || 'Добавить'}`;
    b.addEventListener('click', () => openForm(res, null, {}, load));
    $('#head-actions', root)!.appendChild(b);
  }
  res.toolbar?.($('#head-actions', root)!, () => load());

  const tableEl = $('#table', root)!;

  async function load() {
    loading(tableEl);
    let q = sb.from(res.table).select(res.select, { count: 'exact' });
    for (const [k, v] of Object.entries(state.filters)) if (v) q = q.eq(k, v);
    const term = state.q.replace(/[,()%*]/g, ' ').trim();
    if (term && res.search.length) q = q.or(res.search.map((c) => `${c}.ilike.%${term}%`).join(','));
    q = q.order(state.sort.col, { ascending: state.sort.asc }).range(state.page * PAGE, state.page * PAGE + PAGE - 1);
    const { data, error, count } = await q;
    if (error) {
      tableEl.innerHTML = `<div class="empty err">Не удалось загрузить: ${esc(errMsg(error))}<br><button class="btn ghost" id="retry">Повторить</button></div>`;
      $('#retry', tableEl)?.addEventListener('click', load);
      return;
    }
    const rows = (data as any[]) || [];
    $('#total', root)!.textContent = `Всего: ${count ?? rows.length}`;
    if (!rows.length) {
      tableEl.innerHTML = `<div class="empty">${esc(state.q || Object.values(state.filters).some(Boolean) ? 'Ничего не найдено.' : res.emptyText || 'Записей пока нет.')}</div>`;
    } else {
      tableEl.innerHTML = `<table><thead><tr>${res.cols.map((c) => {
        const s = c.sort !== undefined ? c.sort : c.key;
        const active = s && s === state.sort.col;
        return `<th ${s ? `data-sort="${s}" class="sortable"` : ''} ${active ? `aria-sort="${state.sort.asc ? 'ascending' : 'descending'}"` : ''}>${esc(c.label)}${active ? (state.sort.asc ? ' ↑' : ' ↓') : ''}</th>`;
      }).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr data-i="${i}" tabindex="0">${res.cols.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.label)}">${c.render ? c.render(r) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const tbody = $('tbody', tableEl)!;
      tbody.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('select,button,a,input')) return;
        const tr = (e.target as HTMLElement).closest('tr');
        if (tr) openForm(res, rows[Number(tr.dataset.i)], {}, load);
      });
      tbody.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          const tr = (e.target as HTMLElement).closest('tr');
          if (tr) openForm(res, rows[Number(tr.dataset.i)], {}, load);
        }
      });
      tableEl.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) =>
        th.addEventListener('click', () => {
          const col = th.dataset.sort!;
          state.sort = state.sort.col === col ? { col, asc: !state.sort.asc } : { col, asc: true };
          state.page = 0;
          load();
        }));
      res.afterRender?.(tbody, rows, load);
    }
    const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
    $('#pager', root)!.innerHTML = pages > 1
      ? `<button class="btn ghost" data-p="-1" ${state.page === 0 ? 'disabled' : ''}>←</button><span>${state.page + 1} / ${pages}</span><button class="btn ghost" data-p="1" ${state.page + 1 >= pages ? 'disabled' : ''}>→</button>`
      : '';
  }

  $('#pager', root)!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-p]') as HTMLElement | null;
    if (!b) return;
    state.page = Math.max(0, state.page + Number(b.dataset.p));
    load();
  });
  $('.search', root)!.addEventListener('input', debounce((e: Event) => {
    state.q = (e.target as HTMLInputElement).value;
    state.page = 0;
    load();
  }, 300));
  root.querySelectorAll<HTMLSelectElement>('select[data-filter]').forEach((s) =>
    s.addEventListener('change', () => { state.filters[s.dataset.filter!] = s.value; state.page = 0; load(); }));

  await load();
}

// ------------------------------------------------------------------ form
export async function openForm(res: Resource, row: any | null, preset: Record<string, any>, done: () => void): Promise<void> {
  const editing = !!row;
  const label = row && res.titleOf ? res.titleOf(row) : '';
  const m = openModal(editing ? `${res.singular}${label ? `: ${label}` : ''}` : `Новая запись: ${res.singular.toLowerCase()}`, { wide: !!res.detail });
  loading(m.body);

  let refs: Record<string, [string, string][]> = {};
  try {
    await Promise.all(res.fields.filter((f) => f.ref).map(async (f) => { refs[f.name] = await loadRef(f.ref!); }));
  } catch (e) {
    m.body.innerHTML = `<div class="empty err">Не удалось загрузить справочники: ${esc(errMsg(e))}</div>`;
    return;
  }

  const val = (f: Field) => {
    if (row && row[f.name] !== undefined) return row[f.name];
    if (preset[f.name] !== undefined) return preset[f.name];
    return typeof f.default === 'function' ? f.default() : f.default;
  };

  const input = (f: Field) => {
    const v = val(f);
    const id = `f_${f.name}`;
    const req = f.required ? 'required' : '';
    const label = `<label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>`;
    const help = f.help ? `<small class="muted">${esc(f.help)}</small>` : '';
    let ctl = '';
    switch (f.type) {
      case 'textarea':
        ctl = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" ${req}>${esc(v ?? '')}</textarea>`; break;
      case 'select': {
        const opts = f.ref ? refs[f.name] : f.options || [];
        ctl = `<select id="${id}" name="${f.name}" ${req}>${f.required ? '' : '<option value="">—</option>'}${opts.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(v ?? '') === ov ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
        break;
      }
      case 'bool':
        return `<div class="field check ${f.full ? 'full' : ''}"><label><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}/> ${esc(f.label)}</label>${help}</div>`;
      case 'datetime':
        ctl = `<input type="datetime-local" id="${id}" name="${f.name}" value="${esc(toLocalInput(v))}" ${req}/>`; break;
      case 'number':
        ctl = `<input type="number" id="${id}" name="${f.name}" value="${esc(v ?? '')}" step="${f.step || 'any'}" ${f.min != null ? `min="${f.min}"` : ''} ${req}/>`; break;
      default:
        ctl = `<input type="${f.type}" id="${id}" name="${f.name}" value="${esc(v ?? '')}" ${req}/>`;
    }
    return `<div class="field ${f.full || f.type === 'textarea' ? 'full' : ''}">${label}${ctl}${help}</div>`;
  };

  m.body.innerHTML = `
    ${res.fields.length ? `<form class="form-grid" novalidate>${res.fields.map(input).join('')}
      <div class="actions full">
        ${editing && res.canDelete !== false ? '<button type="button" class="btn danger" data-del>Удалить</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-cancel>Отмена</button>
        <button type="submit" class="btn primary">${editing ? 'Сохранить' : 'Создать'}</button>
      </div></form>` : ''}
    <div class="detail" id="detail"></div>`;

  const form = $('form', m.body) as HTMLFormElement | null;
  const reloadAll = () => { done(); };

  if (form) {
    $('[data-cancel]', form)?.addEventListener('click', m.close);
    $('[data-del]', form)?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Удалить запись («${label || res.singular}»)? Действие необратимо.`))) return;
      const { error } = await sb.from(res.table).delete().eq('id', row.id);
      if (error) { toast(errMsg(error), 'err'); return; }
      toast('Удалено');
      m.close();
      clearRefCache();
      reloadAll();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload: Record<string, any> = {};
      for (const f of res.fields) {
        const el = form.elements.namedItem(f.name) as HTMLInputElement | null;
        if (!el) continue;
        if (f.type === 'bool') payload[f.name] = el.checked;
        else if (f.type === 'number') payload[f.name] = el.value === '' ? null : Number(el.value);
        else if (f.type === 'datetime') payload[f.name] = el.value ? fromLocalInput(el.value) : null;
        else payload[f.name] = el.value.trim() === '' ? null : el.value.trim();
        if (f.required && payload[f.name] == null) { toast(`Заполните поле «${f.label}»`, 'err'); el.focus(); return; }
      }
      if (!editing) Object.assign(payload, Object.fromEntries(Object.entries(preset).filter(([k]) => !res.fields.some((f) => f.name === k))));
      const btn = $('button[type=submit]', form) as HTMLButtonElement;
      btn.disabled = true;
      const { error } = editing
        ? await sb.from(res.table).update(payload).eq('id', row.id)
        : await sb.from(res.table).insert(payload);
      btn.disabled = false;
      if (error) { toast(errMsg(error), 'err'); return; }
      toast(editing ? 'Сохранено' : 'Создано');
      m.close();
      clearRefCache();
      reloadAll();
      res.onSaved?.();
    });
  }

  if (editing && res.detail) {
    const slot = $('#detail', m.body)!;
    try { await res.detail(row, slot, { reload: reloadAll, close: m.close }); }
    catch (e) { slot.innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; }
  }
  $('input,select,textarea', m.body)?.focus();
}
