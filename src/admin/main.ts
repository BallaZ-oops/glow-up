import { sb, esc, $, toast, errMsg } from './lib';
import { mountResource } from './crud';
import { R } from './resources';
import { dashboard, analytics, settings } from './views';

const app = document.getElementById('app')!;

interface Route { key: string; label: string; group: string; icon: string; render: (el: HTMLElement) => Promise<void> | void }

const routes: Route[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'Обзор', icon: '◧', render: dashboard },
  { key: 'analytics', label: 'Аналитика', group: 'Обзор', icon: '◔', render: analytics },
  { key: 'leads', label: 'Заявки', group: 'Продажи', icon: '✉', render: (el) => mountResource(R.leads, el) },
  { key: 'chats', label: 'Диалоги AI', group: 'Продажи', icon: '✦', render: (el) => mountResource(R.chats, el) },
  { key: 'members', label: 'Клиенты', group: 'Клуб', icon: '☺', render: (el) => mountResource(R.members, el) },
  { key: 'memberships', label: 'Абонементы', group: 'Клуб', icon: '▣', render: (el) => mountResource(R.memberships, el) },
  { key: 'payments', label: 'Платежи', group: 'Клуб', icon: '₸', render: (el) => mountResource(R.payments, el) },
  { key: 'bookings', label: 'Записи', group: 'Клуб', icon: '✓', render: (el) => mountResource(R.bookings, el) },
  { key: 'sessions', label: 'Расписание', group: 'Каталог', icon: '◷', render: (el) => mountResource(R.sessions, el) },
  { key: 'plans', label: 'Тарифы', group: 'Каталог', icon: '◈', render: (el) => mountResource(R.plans, el) },
  { key: 'programs', label: 'Направления', group: 'Каталог', icon: '◉', render: (el) => mountResource(R.programs, el) },
  { key: 'trainers', label: 'Тренеры', group: 'Каталог', icon: '♞', render: (el) => mountResource(R.trainers, el) },
  { key: 'kb', label: 'База знаний', group: 'AI', icon: '❖', render: (el) => mountResource(R.kb, el) },
  { key: 'settings', label: 'Настройки', group: 'AI', icon: '⚙', render: settings },
];

// ---------------------------------------------------------------- auth screens
function screen(html: string) {
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">${html}</div></div>`;
}

function showLogin(msg = '') {
  screen(`<div class="brand">GlowUP <small>admin</small></div>
    <h1>Вход для администратора</h1>
    ${msg ? `<div class="note bad">${esc(msg)}</div>` : ''}
    <form id="login" class="stack">
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required /></div>
      <div class="field"><label for="pw">Пароль</label><input id="pw" type="password" autocomplete="current-password" required /></div>
      <button class="btn primary" type="submit">Войти</button>
    </form>
    <p class="muted">Доступ выдаётся только администраторам. Публичной регистрации нет.</p>`);
  $('#login')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target as HTMLElement) as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Входим…';
    const { error } = await sb.auth.signInWithPassword({
      email: ($('#em') as HTMLInputElement).value.trim(),
      password: ($('#pw') as HTMLInputElement).value,
    });
    if (error) { showLogin(error.message === 'Invalid login credentials' ? 'Неверный email или пароль.' : error.message); return; }
    boot();
  });
}

function showNoAccess(user: { id: string; email?: string }, setupMissing: boolean) {
  screen(`<div class="brand">GlowUP <small>admin</small></div>
    <h1>${setupMissing ? 'База данных не подготовлена' : 'Нет прав администратора'}</h1>
    ${setupMissing
      ? `<p>Выполните SQL-миграцию <code>supabase/migrations/0001_crm.sql</code> в Supabase (SQL Editor), затем обновите страницу.</p>`
      : `<p>Вы вошли как <b>${esc(user.email)}</b>, но этот аккаунт не добавлен в список администраторов. Выполните в Supabase → SQL Editor:</p>
         <pre>insert into public.admins (user_id)
values ('${esc(user.id)}');</pre>`}
    <div class="actions"><button class="btn ghost" id="out">Выйти</button><button class="btn primary" id="again">Проверить снова</button></div>`);
  $('#out')!.addEventListener('click', async () => { await sb.auth.signOut(); showLogin(); });
  $('#again')!.addEventListener('click', () => boot());
}

// ---------------------------------------------------------------- shell
function renderShell(email: string) {
  const groups = [...new Set(routes.map((r) => r.group))];
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">GlowUP <small>admin</small></div>
        <nav>${groups.map((g) => `<div class="nav-group"><span>${g}</span>${routes.filter((r) => r.group === g).map((r) => `<a href="#/${r.key}" data-route="${r.key}"><i>${r.icon}</i>${r.label}</a>`).join('')}</div>`).join('')}</nav>
        <div class="side-foot"><a href="/" target="_blank" rel="noopener">Открыть сайт ↗</a><div class="muted">${esc(email)}</div><button class="btn ghost sm" id="logout">Выйти</button></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main">
        <header class="topbar"><button class="icon-btn" id="burger" aria-label="Меню">☰</button><span id="crumb"></span></header>
        <main id="view" tabindex="-1"></main>
      </div>
    </div>`;
  $('#logout')!.addEventListener('click', async () => { await sb.auth.signOut(); showLogin(); });
  const side = $('#sidebar')!;
  $('#burger')!.addEventListener('click', () => side.classList.toggle('open'));
  $('#scrim')!.addEventListener('click', () => side.classList.remove('open'));
}

let navToken = 0;
async function navigate() {
  const key = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const route = routes.find((r) => r.key === key) || routes[0];
  const token = ++navToken;
  document.querySelectorAll<HTMLElement>('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route.key));
  $('#sidebar')?.classList.remove('open');
  const view = $('#view')!;
  $('#crumb')!.textContent = route.label;
  document.title = `${route.label} — GlowUP admin`;
  try {
    await route.render(view);
  } catch (e) {
    if (token === navToken) view.innerHTML = `<div class="card empty err">Ошибка: ${esc(errMsg(e))}</div>`;
  }
}

let started = false;
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showLogin(); return; }
  const user = session.user;
  const { data, error } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (error) { showNoAccess(user, true); return; }
  if (!data) { showNoAccess(user, false); return; }
  renderShell(user.email || '');
  if (!started) { window.addEventListener('hashchange', navigate); started = true; }
  navigate();
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') showLogin(); });
boot().catch((e) => { screen(`<h1>Ошибка запуска</h1><p>${esc(errMsg(e))}</p>`); toast(errMsg(e), 'err'); });
