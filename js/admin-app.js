// ===== Админ-приложение DROPZONE: AUTO (admin.html, открывается из админ-бота) =====
// Все действия — через админ-раздел сервера (/admin/*). Пускает только ADMIN_IDS (проверяет сервер).
'use strict';

const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const params = new URLSearchParams(location.search);
const DEV_API = params.get('api');                 // проверка с локальным сервером: admin.html?api=http://127.0.0.1:8787
const API = DEV_API || API_URL;
const headers = () => DEV_API ? { 'X-Dev-User': String(ADMIN_IDS[0]) } : { 'X-Init-Data': tg?.initData || '' };
const $ = s => document.querySelector(s);
const { CAR_BY_ID } = Rules;

// тема — как в Telegram
(() => {
  const dark = tg?.initData ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
  try { const bg = dark ? '#000000' : '#f2f2f7'; tg?.setHeaderColor(bg); tg?.setBackgroundColor(bg); } catch {}
})();

// ---------- мелочи ----------
const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
function money(n) {
  n = Math.floor(n || 0);
  const fmt = (v, u) => (Math.round(v * 10) / 10).toString().replace('.', ',') + ' ' + u;
  if (Math.abs(n) >= 999.95e9) return fmt(n / 1e12, 'трлн ₽');
  if (Math.abs(n) >= 999.95e6) return fmt(n / 1e9, 'млрд ₽');
  if (Math.abs(n) >= 999.95e3) return fmt(n / 1e6, 'млн ₽');
  return n.toLocaleString('ru-RU').replace(/[\s,]/g, ' ') + ' ₽';
}
const ago = t => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 1440) return `${Math.floor(m / 60)} ч назад`;
  return `${Math.floor(m / 1440)} дн назад`;
};
const date = t => new Date(t).toLocaleDateString('ru-RU');
const haptic = { tap: () => tg?.HapticFeedback?.impactOccurred('light'), ok: () => tg?.HapticFeedback?.notificationOccurred('success'), err: () => tg?.HapticFeedback?.notificationOccurred('error') };
let toastT = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
}
const plate = key => { const p = Rules.plateParse(key); return p ? `<span class="aa-plate">${p.l1} ${p.d} ${p.l23}<i>${p.reg}</i></span>` : esc(key); };
const rc = r => (RARITIES[r] || { color: '#ffd60a' }).color;
const btn = (act, label, extra = '') => `<button class="pill${extra.includes('danger') ? ' danger' : ''}" data-act="${act}" ${extra.replace('danger', '')}>${label}</button>`;
const section = (title, body) => `<div class="section-h">${title}</div><div class="card admin-card">${body}</div>`;
const row = (act, icon, title, sub, attrs = '') => `<button class="list-row" data-act="${act}" ${attrs}>
  <div class="ic" style="font-size:24px">${icon}</div><div class="info"><div class="t">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
  <div class="r">›</div></button>`;

// ---------- запросы ----------
// quiet — фоновый запрос: ошибки молча (без тоста и вибрации)
async function req(path, body, quiet) {
  try {
    const res = await fetch(API + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(body) }
      : { headers: headers() });
    const data = await res.json();
    if (data.error) { if (!quiet) { haptic.err(); toast(data.error); } return null; }
    return data;
  } catch { if (!quiet) { haptic.err(); toast('Нет связи с сервером'); } return null; }
}

// ---------- навигация: стек страниц ----------
const stack = [];
function go(page, arg, replace) {
  if (replace) stack.pop();
  stack.push({ page, arg });
  show();
}
function back() { if (stack.length > 1) { stack.pop(); show(); } }
async function show() {
  const { page, arg } = stack[stack.length - 1];
  $('#aa-back').hidden = stack.length < 2;
  $('#aa-back').textContent = '‹ Назад';
  tg?.BackButton?.[stack.length > 1 ? 'show' : 'hide']();
  const html = await PAGES[page](arg);
  if (html == null) return;
  const scr = $('#aa-screen');
  scr.innerHTML = html;
  scr.style.animation = 'none'; void scr.offsetWidth; scr.style.animation = '';
  window.scrollTo(0, 0);
}
const title = t => { $('#aa-title').textContent = t; };
tg?.BackButton?.onClick(back);

// онлайн на главном экране обновляется сам раз в 20 с (пока открыт главный экран)
setInterval(async () => {
  const el = document.getElementById('aa-online');
  if (!el || document.hidden) return;
  const d = await req('/admin/online', undefined, true);
  if (d && String(d.online) !== el.textContent) { el.textContent = d.online; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}, 20e3);

// ---------- страницы ----------
const PAGES = {};

// владелец (может всё) или админ команды (без назначения админов, сброса прогресса, установки баланса, >100 млн за раз)
let isOwner = false, teamIds = new Set();
async function loadTeamIds() {
  const d = await req('/admin/team', undefined, true);
  if (d) teamIds = new Set(d.team.map(a => a.id));
}

// нагрузка на сервер за месяц: прогноз к концу месяца против включённого в тариф Workers Paid
const fmtN = n => n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' млрд' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс' : String(n);
async function fillUsage() {
  const el = document.getElementById('aa-usage');
  if (!el) return;
  const u = await req('/admin/usage', undefined, true);
  if (!u || u.error) {
    el.innerHTML = `<div class="aa-row-sub">Нагрузка: ${u?.error?.includes('CF_API_TOKEN') ? 'не подключён ключ Cloudflare' : 'нет данных' + (u?.error ? ' — ' + esc(u.error) : '')}</div>`;
    return;
  }
  const NAMES = { requests: 'Запросы к серверу', writes: 'Записи в базу', reads: 'Чтения из базы' };
  el.innerHTML = `<div class="row" style="margin-bottom:6px"><b>Нагрузка</b><span class="aa-row-sub">прогноз на месяц · включено в тариф</span></div>` +
    ['requests', 'writes', 'reads'].map(k => {
      const pct = Math.round(u.forecast[k] / u.included[k] * 100);
      const color = pct >= 90 ? 'var(--bad)' : pct >= 70 ? '#ff9f0a' : '#34c759';
      return `<div class="aa-use"><div class="row"><span>${NAMES[k]}</span><span><b style="color:${color}">${pct}%</b></span></div>
        <div class="aa-progress"><i style="width:${Math.min(100, pct)}%;background:${color}"></i></div>
        <div class="aa-row-sub">сегодня ${fmtN(u.today[k])} · за месяц ${fmtN(u.month[k])} → прогноз ${fmtN(u.forecast[k])} из ${fmtN(u.included[k])}</div></div>`;
    }).join('');
}

PAGES.home = async () => {
  title('Админка');
  const s = await req('/admin/stats');
  if (!s) return `<div class="aa-empty">Не удалось загрузить. Админка открывается только из админ-бота.</div>`;
  isOwner = !!s.owner;
  if (isOwner) loadTeamIds();
  setTimeout(fillUsage, 0);   // нагрузка грузится отдельно — главная не ждёт Cloudflare
  const tile = (v, l) => `<div class="aa-tile"><b>${v}</b><span>${l}</span></div>`;
  const m = s.maintenance;
  return `<div class="aa-online"><i class="aa-dot"></i><span>Сейчас в игре</span><b id="aa-online">${s.online || 0}</b></div>
    <div class="card aa-usage" id="aa-usage"><div class="aa-row-sub">Нагрузка: загружаю…</div></div>
    <div class="aa-tiles">
      ${tile(s.total || 0, 'игроков')}${tile(s.d1 || 0, 'за сутки')}${tile(s.d7 || 0, 'за неделю')}
      ${tile(s.newToday || 0, 'новых сегодня')}${tile(s.new7 || 0, 'новых за 7 дн')}${tile(s.referrals || 0, 'приглашено')}
      ${tile(money(s.money).replace(' ₽', ''), 'денег у игроков')}${tile(money(s.worth).replace(' ₽', ''), 'стоимость гаражей')}${tile(s.plates || 0, 'номеров')}
    </div>
    ${m?.on ? `<div class="card" style="margin-bottom:12px;border:1px solid var(--bad)"><b style="color:var(--bad)">Идут техработы</b><div class="aa-row-sub">${esc(m.text)}</div></div>` : ''}
    <div class="list">
      ${row('nav', '👥', 'Игроки', 'Весь список, сортировка, поиск, действия', 'data-page="players"')}
      ${row('nav', '🎟️', 'Промокоды', 'Создать, список, статистика', 'data-page="promos"')}
      ${row('nav', '🤝', 'Приглашения', 'Кто сколько привёл и кого', 'data-page="refs"')}
      ${row('nav', '🚘', 'Проверить номер', 'Свободен ли номер и у кого он', 'data-page="plate"')}
      ${row('nav', '🧹', 'Подозрительные', 'Подписались ради входа и не играли — убрать из канала', 'data-page="suspects"')}
      ${row('nav', '🚢', 'Контейнеры', 'Аукцион закрытого контейнера с секретной машиной', 'data-page="conts"')}
      ${row('nav', '🔥', 'Временные кейсы', isOwner ? 'Создать кейс на время, подтвердить кейсы команды' : 'Создать кейс на время (подтверждает владелец)', 'data-page="ecases"')}
      ${row('nav', '📣', 'Рассылка', 'Сообщение всем игрокам через игрового бота', 'data-page="broadcast"')}
      ${row('nav', '🛠️', 'Техработы', m?.on ? 'Включены' : 'Выключены', 'data-page="maint"')}
      ${row('nav', '🤖', 'Боты', 'Настройка игрового и админ-бота', 'data-page="bots"')}
      ${isOwner ? row('nav', '🛡️', 'Команда', 'Админы и журнал их действий', 'data-page="team"') : ''}
    </div>
    <div class="section-h">Самые богатые (деньги + гараж)</div>
    <div class="list">${s.rich.map((p, i) => `<button class="list-row" data-act="player" data-id="${p.id}">
      <div class="info"><div class="t">${i + 1}. ${esc(p.name) || p.id}</div><div class="sub">ур. ${p.level} · ${money(p.money)} + гараж ${money(p.worth)} · с ${date(p.created_at)}</div></div>
      <div class="r">›</div></button>`).join('')}</div>`;
};

// --- игроки ---
let pq = '', psort = 'recent', plist = [], pTotal = 0, pFound = null;
const SORT_NAMES = { recent: 'Недавние', money: 'Деньги', worth: 'Гараж', level: 'Уровень', created: 'Новые' };
async function loadPlayers(more) {
  const offset = more ? plist.length : 0;
  const d = await req(`/admin/players?sort=${psort}&offset=${offset}&limit=50${pq ? '&q=' + encodeURIComponent(pq) : ''}`);
  if (!d) return false;
  plist = more ? plist.concat(d.players) : d.players;
  pTotal = d.total; pFound = d.found;
  return d.players.length;
}
const playerRows = () => plist.map(p => `<button class="list-row" data-act="player" data-id="${p.id}">
    <div class="info"><div class="t">${esc(p.name) || 'Без имени'}${p.username ? ` <span class="muted">@${esc(p.username)}</span>` : ''}</div>
      <div class="sub">ID ${p.id} · ур. ${p.level ?? 1} · ${money(p.money)} · гараж ${money(p.worth)} · машин ${p.cars ?? 0}</div></div>
    <div class="r"><span class="small">${ago(p.updated_at)}</span></div></button>`).join('');
PAGES.players = async () => {
  title('Игроки');
  if (!await loadPlayers()) return '';
  return `<input id="aa-search" class="admin-input" placeholder="Поиск: имя, @username или ID" value="${esc(pq)}" autocomplete="off">
    <div class="aa-sort">${Object.entries(SORT_NAMES).map(([k, n]) => `<button class="${k === psort ? 'on' : ''}" data-act="psort" data-s="${k}">${n}</button>`).join('')}</div>
    <div class="aa-note">${pFound != null ? `Найдено: ${pFound}` : `Всего игроков: ${pTotal}`}</div>
    <div class="list" id="aa-plist">${playerRows() || '<div class="aa-empty">Никого</div>'}</div>
    ${plist.length < (pFound ?? pTotal) ? `<button class="btn gray" style="margin-top:12px" data-act="pmore">Показать ещё</button>` : ''}`;
};
let searchT = null;
document.addEventListener('input', e => {
  if (e.target.id !== 'aa-search') return;
  clearTimeout(searchT);
  searchT = setTimeout(async () => { pq = e.target.value.trim(); await loadPlayers(); refreshPlayerList(); }, 350);
});
function refreshPlayerList() {
  $('#aa-plist').innerHTML = playerRows() || '<div class="aa-empty">Никого</div>';
  const note = document.querySelector('.aa-note');
  if (note) note.textContent = pFound != null ? `Найдено: ${pFound}` : `Всего игроков: ${pTotal}`;
  const more = document.querySelector('[data-act="pmore"]');
  const need = plist.length < (pFound ?? pTotal);
  if (more && !need) more.remove();
  if (!more && need) $('#aa-plist').insertAdjacentHTML('afterend', `<button class="btn gray" style="margin-top:12px" data-act="pmore">Показать ещё</button>`);
}

// --- карточка игрока: все действия ---
let target = null;   // { player, state, sub, refs }
const SUBS = { creator: 'владелец', administrator: 'админ', member: 'подписан ✓', restricted: 'ограничен', left: 'НЕ подписан', kicked: 'заблокирован' };
PAGES.player = async id => {
  const d = await req(`/admin/player?id=${id}`);
  if (!d) return null;
  target = { ...d, state: Rules.migrate(d.state) };
  return playerHTML();
};
// история игрока: что открывал, что выпало, деньги (последние 100 действий; ведётся с 16.10.2026)
const HIST_NAMES = {
  openCase: 'Кейс машин', giftOpen: 'Подарочный кейс', sellCar: 'Продал машину', sellCars: 'Продал машины', sellParts: 'Продал детали',
  collect: 'Доход гаража', daily: 'Бонус дня', rewardCase: 'Кейс наград', questClaim: 'Задание', goalClaim: 'Награда коллекции',
  raceStart: 'Взнос за гонку', raceFinish: 'Гонка', merge: 'Слияние деталей', install: 'Поставил деталь', uninstall: 'Снял деталь',
  buySlot: 'Купил место', claimGoal: 'Награда коллекции', uninstallAll: 'Снял все детали', aucBid: 'Ставка на контейнер', aucRefund: 'Возврат ставки', aucWin: 'Выиграл контейнер',
  duelCreate: 'Вызов на гонку', duelTake: 'Принял вызов', duelCancel: 'Отменил вызов', museumIn: 'На витрину', museumOut: 'С витрины', museumBuy: 'Место на витрине', paint: 'Покраска',
  openPlateCase: 'Генерация номера', sellPlate: 'Продал номер', shopBuy: 'Покупка за звёзды', promo: 'Промокод', redeemPromo: 'Промокод',
  marketList: 'Выставил на площадку', marketCancel: 'Снял с площадки', marketBuyLocal: 'Купил на площадке', waitTake: 'Забрал машину', waitSell: 'Продал ждущую',
  upgrade: 'Апгрейд', duelRun: 'Гонка с другом', duelTick: 'Гонка с другом', duelResSeen: 'Гонка с другом', passClaim: 'Награда пропуска', vipDaily: 'Подарок VIP', noticeAck: 'Уведомление',
};
function histHTML(S) {
  const h = S.hist || [];
  const caseName = id => (Rules.CASE_BY_ID[id] || PART_CASES.find(c => c.id === id) || PLATE_CASES.find(c => c.id === id))?.name || id;
  const carN = ids => ids.map(id => CAR_BY_ID[id]?.name || id).join(', ');
  const name = (a, c) => a.startsWith('admin:') ? `Админ: ${a.slice(6)}` : a === 'openCase' && PART_CASES.some(x => x.id === c) ? 'Кейс деталей' : HIST_NAMES[a] || a;
  const rows = h.map(e => `<div class="list-row static hist-row"><div class="info">
      <div class="t">${esc(name(e.a, e.c))}${e.c ? ` · ${esc(caseName(e.c))}` : ''}</div>
      <div class="sub">${new Date(e.t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        ${e.ad ? `<br><span class="hist-plus">+ ${esc(carN(e.ad))}</span>` : ''}${e.rm ? `<br><span class="hist-minus">− ${esc(carN(e.rm))}</span>` : ''}
        ${e.p ? `<br>детали ${e.p > 0 ? '+' : ''}${e.p}` : ''}${e.n ? ` · номера ${e.n > 0 ? '+' : ''}${e.n}` : ''}</div></div>
      ${e.m ? `<div class="r"><b class="${e.m > 0 ? 'hist-plus' : 'hist-minus'}">${e.m > 0 ? '+' : '−'}${money(Math.abs(e.m))}</b></div>` : ''}
    </div>`).join('');
  return section(`История · ${h.length}`, h.length ? `<div class="aa-row-sub" style="margin-bottom:8px">Последние ${h.length} действий: кейсы и что выпало, продажи, награды, деньги</div><div class="list hist-list">${rows}</div>`
    : '<div class="aa-row-sub">История пока пустая — записывается с 16 октября, после следующих действий игрока</div>');
}

// приглашения игрока: кто засчитан (деньги начислены), кто ждёт подписки, кто уже играл раньше
function refsHTML(r, p) {
  if (!r) return '';
  const link = (id, name) => `<button class="link" data-act="player" data-id="${id}">${esc(name) || id}</button>`;
  const from = r.invitedBy
    ? `<div class="ref-line ok">✓ Пришёл по ссылке ${link(r.invitedBy.id, r.invitedBy.name)} · ${date(r.invitedBy.at)}<br>
        <span class="aa-row-sub">ему начислено +${money(r.friend)}; пригласившему ${money(r.inviter)} — ${r.invitedBy.paid ? 'начислено' : `когда этот игрок дойдёт до ${r.minLevel} уровня`}</span></div>`
    : r.pendingIn
      ? `<div class="ref-line warn">⏳ Переходил по ссылке ${link(r.pendingIn.ref_id, r.pendingIn.name)} · ${date(r.pendingIn.at)}<br>
          <span class="aa-row-sub">не засчитано: аккаунт уже был в игре до перехода по ссылке</span></div>`
      : `<div class="aa-row-sub">Пришёл сам (не по ссылке)</div>`;
  const waiting = r.pending.filter(x => !x.created_at), old = r.pending.filter(x => x.created_at);
  return section(`Приглашения · ${r.invitedN}`, `
    ${from}
    <div class="ref-line ${r.invitedN ? 'ok' : ''}" style="margin-top:10px">${r.invitedN ? '✓' : '—'} Пришло друзей: <b>${r.invitedN}</b> · дошли до ${r.minLevel} ур. и оплачено: <b>${r.invitedPaid}</b> → начислено <b>${money(r.invitedPaid * r.inviter)}</b></div>
    ${r.invited.length ? `<div class="aa-chips" style="margin-top:6px">${r.invited.map(f => `<button class="chip${f.paid ? ' ok' : ''}" data-act="player" data-id="${f.id}">${f.paid ? '✓' : '⏳'} ${esc(f.name) || f.id} · ур. ${f.level ?? 1}</button>`).join('')}</div>` : ''}
    ${waiting.length ? `<div class="ref-line warn" style="margin-top:10px">⏳ Ждут подписки: <b>${waiting.length}</b><br><span class="aa-row-sub">перешли по ссылке, но ещё не вошли в игру (не подписались на канал). Деньги придут, когда войдут</span></div>
      <div class="aa-chips" style="margin-top:6px">${waiting.slice(0, 30).map(x => `<span class="chip">ID ${x.id} · ${ago(x.at)}</span>`).join('')}</div>` : ''}
    ${old.length ? `<div class="ref-line bad" style="margin-top:10px">✕ Не засчитаны: <b>${old.length}</b><br><span class="aa-row-sub">уже играли раньше — за старых игроков деньги не дают</span></div>
      <div class="aa-chips" style="margin-top:6px">${old.slice(0, 30).map(x => `<button class="chip" data-act="player" data-id="${x.id}">${esc(x.name) || x.id}</button>`).join('')}</div>` : ''}
  `);
}

function playerHTML() {
  const { player: p, sub, refs } = target;
  const S = target.state;
  title(p.name || 'Игрок');
  const st = S.stats || {};
  const base = Rules.baseCars();
  const carOpts = RARITY_ORDER.concat('X', 'E').map(r => `<optgroup label="${RARITIES[r]?.name || 'Секретные'}">${
    CARS.filter(c => c.r === r).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</optgroup>`).join('');
  const subText = !sub ? '—' : sub.error ? `ошибка: ${esc(sub.error)}` : (SUBS[sub.status] || sub.status);
  const caseOpts = [
    `<optgroup label="Машины">${CASES.filter(c => !c.starter && Rules.caseOn(c)).map(c => `<option value="car|${c.id}">${c.name}</option>`).join('')}</optgroup>`,
    `<optgroup label="Детали">${PART_CASES.map(c => `<option value="part|${c.id}">${c.name}</option>`).join('')}</optgroup>`,
    `<optgroup label="Номера">${PLATE_CASES.map(c => `<option value="plate|${c.id}">Генерация «${c.name}»</option>`).join('')}</optgroup>`,
  ].join('');
  const plates = [...S.plates].sort((a, b) => Rules.plateInfo(b).value - Rules.plateInfo(a).value);
  return `<div class="card adm-target">
      <div><b>${esc(p.name) || 'Без имени'}</b>${p.username ? ` <span class="muted">@${esc(p.username)}</span>` : ''}</div>
      <div class="aa-row-sub">ID ${p.id} · уровень ${S.level} · в игре с ${date(p.created_at)} · был ${ago(p.updated_at)}</div>
      <div class="aa-row-sub">Канал: ${subText}</div>
    </div>
    ${refsHTML(refs, p)}
    ${histHTML(S)}

    <label class="card aa-check aa-notify"><input type="checkbox" id="f-notify" ${notifyOn ? 'checked' : ''}>
      <span>🔔 Уведомлять игрока о выдаче<br><span class="aa-row-sub">Деньги, машины, детали, номера… — придёт уведомление в игре. Подаренные кейсы приходят всегда.</span></span></label>

    ${section('Деньги', `
      <div class="row"><span class="muted">Баланс</span><b>${money(S.money)}</b></div>
      <div class="pills wrap">${btn('op-money', '+100 тыс', 'data-v="1e5"')}${btn('op-money', '+10 млн', 'data-v="1e7"')}${isOwner ? btn('op-money', '+1 млрд', 'data-v="1e9"') + btn('op-money-zero', 'Обнулить', 'danger data-confirm="Ещё раз"') : btn('op-money', '+100 млн', 'data-v="1e8"')}</div>
      ${isOwner ? `<div class="admin-row"><input id="f-sum" class="admin-input" type="number" inputmode="numeric" placeholder="Своя сумма, ₽">${btn('op-money-set', 'Установить')}</div>`
        : '<div class="aa-note">За раз — не больше 100 млн ₽. Ставить баланс может только владелец.</div>'}`)}

    ${section('Выдать кейс', `
      <select id="f-case" class="admin-input">${caseOpts}</select>
      <div class="admin-row" style="margin-top:8px"><input id="f-case-n" class="admin-input" type="number" inputmode="numeric" value="1" min="1" max="20" style="max-width:80px">
        <input id="f-case-note" class="admin-input" maxlength="80" placeholder="Подпись (необязательно)">${btn('op-case', 'Подарить')}</div>
      <div class="aa-note">У игрока появится плашка «У тебя подарок» — он сам откроет кейс${(S.gifts || []).length ? ` · сейчас не открыто: <b>${S.gifts.length}</b>` : ''}</div>`)}

    ${section('Машины', `
      <div class="admin-row"><select id="f-car" class="admin-input">${carOpts}</select>${btn('op-car', 'Выдать')}</div>
      <div class="aa-row-sub">Гараж ${S.cars.length}/${S.slots} · витрина ${S.museum.length}/${S.museumSlots}</div>
      ${S.cars.length ? `<div class="aa-chips">${S.cars.map(c => `<span class="chip">${esc(CAR_BY_ID[c.id].name)} · ${Rules.carHp(c)} л.с.${c.plate ? ' · ' + plate(c.plate) : ''}</span>`).join('')}</div>` : ''}
      <div class="pills wrap">${btn('op-simple', 'Открыть всю коллекцию', 'data-op="collection"')}${btn('op-simple', '+5 мест в гараже', 'data-op="slots"')}</div>`)}

    ${section(`Номера · ${plates.length} · лимит ${Rules.plateRoom(S).used}/${Rules.plateRoom(S).cap}`, `
      ${plates.length ? plates.map(k => {
        const car = [...S.cars, ...S.museum].find(c => c.plate === k);
        return `<div class="row">${plate(k)}<span class="small" style="color:${rc(Rules.plateInfo(k).rarity)}">${money(Rules.plateInfo(k).value)}</span>
          <span class="muted small">${car ? CAR_BY_ID[car.id].name : '—'}</span>${btn('op-plate-take', 'Забрать', `danger data-confirm="Ещё раз" data-plate="${k}"`)}</div>`;
      }).join('') : '<div class="muted small">Номеров нет</div>'}
      <div class="admin-row"><input id="f-plate" class="admin-input" placeholder="А777АА 77" autocapitalize="characters" autocomplete="off">${btn('op-plate-give', 'Выдать')}</div>
      <div class="admin-row"><select id="f-plate-r" class="admin-input">${['D', 'C', 'B', 'A', 'S'].map(r => `<option value="${r}">${r} · ${RARITIES[r].name}</option>`).join('')}</select>${btn('op-plate-rand', 'Случайный')}</div>`)}

    ${section('Детали', `
      <div class="admin-row">
        <select id="f-slot" class="admin-input">${[...SLOTS, ...EV_SLOTS].map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <select id="f-tier" class="admin-input short">${RARITY_ORDER.map(t => `<option value="${t}">${t} · ${PART_TIERS[t].name}</option>`).join('')}</select>
      </div>
      <div class="pills wrap">${btn('op-part', '+1', 'data-n="1"')}${btn('op-part', '+3', 'data-n="3"')}${btn('op-part', '+10', 'data-n="10"')}${btn('op-simple', 'Комплект S на все слоты', 'data-op="partsAll"')}</div>
      <div class="aa-row-sub">На складе: ${Rules.invTotal(S)} шт.</div>`)}

    ${section('Таймеры и опыт', `
      <div class="pills wrap">
        ${btn('op-simple', 'Полный бак', 'data-op="fuel"')}${btn('op-simple', 'Сбросить перерывы деталей', 'data-op="cooldowns"')}
        ${btn('op-simple', 'Кейс наград — сейчас', 'data-op="rewardCase"')}${btn('op-simple', 'Бонус дня — снова', 'data-op="daily"')}
        ${btn('op-simple', 'Доход гаража — полный', 'data-op="income"')}${btn('op-xp', '+500 опыта')}
      </div>`)}

    ${section('Статистика', `
      <div class="admin-stats">
        <div><b>${S.level}</b><span>уровень</span></div><div><b>${st.opened || 0}</b><span>кейсов</span></div>
        <div><b>${st.wins || 0}/${st.races || 0}</b><span>побед / гонок</span></div><div><b>${st.merged || 0}</b><span>слияний</span></div>
        <div><b>${S.discovered.filter(id => !CAR_BY_ID[id]?.secret).length}/${base.length}</b><span>коллекция</span></div>
        <div><b>${money(Rules.garageWorth(S)).replace(' ₽', '')}</b><span>гараж, ₽</span></div>
      </div>`)}

    ${section('Сохранение', `
      <div class="pills wrap">${btn('op-export', 'Скопировать сохранение')}${isOwner ? btn('op-reset', 'Сбросить прогресс', 'danger data-confirm="Точно? Ещё раз"') : ''}</div>`)}
    ${isOwner ? section('Права', teamIds.has(p.id)
      ? `<div class="row"><span>🛡️ <b>Админ</b> команды</span>${btn('team-remove', 'Убрать из админов', `danger data-confirm="Ещё раз" data-id="${p.id}"`)}</div>`
      : `<div class="pills wrap">${btn('team-add', 'Сделать админом', `data-confirm="Дать права админа?" data-id="${p.id}"`)}</div>
         <div class="aa-note">Админ сможет почти всё, кроме назначения админов, сброса прогресса и установки баланса; деньги — не больше 100 млн за раз. Все его действия попадут в журнал.</div>`) : ''}`;
}

// «Уведомить игрока»: что выдал админ — игроку приходит уведомление сверху (пока игра открыта — сразу)
let notifyOn = (() => { try { return localStorage.getItem('aa_notify') !== '0'; } catch { return true; } })();
async function op(opName, extra = {}, msg) {
  const d = await req('/admin/player-action', { id: target.player.id, op: opName, notify: notifyOn, ...extra });
  if (!d) return;
  target.state = Rules.migrate(d.state);
  haptic.ok();
  toast(typeof msg === 'function' ? msg(d.result || {}) : msg);
  const y = window.scrollY;
  $('#aa-screen').innerHTML = playerHTML();
  window.scrollTo(0, y);
}

// «А777АА 77», «a777aa77», латиница — в ключ номера
function parsePlate(raw) {
  const lat = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  const t = String(raw || '').toUpperCase().replace(/[ABEKMHOPCTYX]/g, c => lat[c]).replace(/[\s|]/g, '');
  const m = /^([АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2})(\d{2,3})$/.exec(t);
  const key = m && `${m[1]}|${m[2]}`;
  return key && Rules.plateParse(key) ? key : null;
}

// --- проверка номера ---
let plateRes = null, plR = 'S', plKind = 'taken', plList = null;
PAGES.plate = async () => {
  title('Проверить номер');
  if (!plList) setTimeout(plLoad, 0);
  const r = plateRes;
  const i = r?.info;
  return `<div class="card admin-card">
      <div class="aa-row-sub">Введи номер, например <b>А777АА 77</b> (можно латиницей, пробелы не важны)</div>
      <div class="admin-row" style="margin-top:8px"><input id="pc-key" class="admin-input" placeholder="А777АА 77" value="${esc(r?.raw || '')}" autocomplete="off">${btn('pc-check', 'Проверить')}</div>
    </div>
    ${r?.error ? `<div class="card"><b style="color:var(--bad)">${esc(r.error)}</b></div>` : ''}
    ${i ? `<div class="card admin-card">
      <div class="row"><b style="font-size:20px">${esc(r.key.replace('|', ' '))}</b>${r.owner ? '<b style="color:var(--bad)">Занят</b>' : '<b style="color:#30d158">Свободен</b>'}</div>
      <div class="aa-row-sub" style="margin-top:6px">Редкость ${i.rarity} · цена в игре ${money(i.value)}${i.tags.length ? ' · ' + esc(i.tags.join(', ')) : ''}</div>
      ${r.owner ? `<div style="margin-top:10px">Владелец: <button class="link" data-act="player" data-id="${r.owner.id}">${esc(r.owner.name) || r.owner.id}</button>${r.owner.username ? ` <span class="aa-row-sub">@${esc(r.owner.username)}</span>` : ''}
        <div class="aa-row-sub">ID ${r.owner.id} · с ${date(r.owner.at)}</div></div>`
        : '<div class="aa-row-sub" style="margin-top:10px">Ни у кого нет — можно выдать игроку в его карточке (раздел «Номера»)</div>'}
    </div>` : ''}
    <div class="section-h">Номера по редкости</div>
    <div class="aa-chips">${['S', 'A', 'B', 'C', 'D'].map(r => `<button class="chip${plR === r ? ' on' : ''}" data-act="pl-r" data-v="${r}">${r} · ${RARITIES[r].name}</button>`).join('')}</div>
    <div class="aa-chips" style="margin-top:6px">${[['taken', 'Занятые'], ['free', 'Свободные']].map(([k, n]) => `<button class="chip${plKind === k ? ' on' : ''}" data-act="pl-k" data-v="${k}">${n}</button>`).join('')}
      ${plKind === 'free' ? btn('pl-more', 'Ещё подборка') : ''}</div>
    <div id="pl-list" style="margin-top:8px">${plListHTML()}</div>`;
};
function plListHTML() {
  const d = plList;
  if (!d) return '<div class="aa-empty">Загрузка…</div>';
  if (plKind === 'free') return `<div class="aa-row-sub" style="margin-bottom:6px">Случайные свободные номера редкости ${plR} (всего занято номеров: ${d.total}). Нажми — проверится и подставится для выдачи</div>
    <div class="list">${(d.free || []).map(x => `<button class="list-row" data-act="pl-pick" data-key="${esc(x.key)}"><div class="info"><div class="t">${esc(x.key.replace('|', ' '))}</div></div><div class="r">${money(x.value)}</div></button>`).join('') || '<div class="aa-empty">Не нашлось</div>'}</div>`;
  return `<div class="aa-row-sub" style="margin-bottom:6px">Занято номеров редкости ${plR}: <b>${d.count}</b>${d.count > 300 ? ' (первые 300, самые дорогие)' : ''}</div>
    <div class="list">${(d.taken || []).map(x => `<button class="list-row" data-act="player" data-id="${x.owner}"><div class="info"><div class="t">${esc(x.key.replace('|', ' '))}</div><div class="sub">${esc(x.name) || x.owner}</div></div><div class="r">${money(x.value)}</div></button>`).join('') || '<div class="aa-empty">Пока нет</div>'}</div>`;
}
async function plLoad() {
  plList = null;
  const el = $('#pl-list'); if (el) el.innerHTML = plListHTML();
  plList = await req(`/admin/plates?rarity=${plR}&kind=${plKind}`, undefined, true) || { taken: [], free: [], count: 0, total: 0 };
  const el2 = $('#pl-list'); if (el2) el2.innerHTML = plListHTML();
}
async function plateCheck() {
  const raw = $('#pc-key')?.value || '';
  const key = parsePlate(raw);
  if (!key) { plateRes = { raw, error: 'Номер не распознан: нужен формат А777АА 77, регион из списка игры' }; return show(); }
  const d = await req('/admin/plate?key=' + encodeURIComponent(key));
  plateRes = d ? { raw, ...d } : { raw, error: 'Не удалось проверить' };
  show();
}

// --- промокоды ---
let draft = null;
const newDraft = () => ({ code: '', maxUses: '', hours: 0, money: '', xp: '', carId: '', slots: 0, fuel: false, rcase: false, parts: [] });
const HOURS = [[0, 'Бессрочно'], [1, '1 час'], [24, '24 часа'], [72, '3 дня'], [168, '7 дней'], [720, '30 дней']];
const rewardText = r => [r.money && money(r.money), r.carId && (CAR_BY_ID[r.carId]?.name || r.carId),
  ...(r.parts || []).map(x => `${[...SLOTS, ...EV_SLOTS].find(s => s.id === x.slot)?.name} ${PART_TIERS[x.t].name} ×${x.n}`),
  r.xp && `${r.xp} опыта`, r.fuel && 'полный бак', r.rcase && 'кейс наград', r.slots && `+${r.slots} мест`].filter(Boolean).join(' · ');
function readDraft() {
  if (!$('#d-code')) return;
  const v = id => $('#' + id).value;
  Object.assign(draft, { code: v('d-code'), maxUses: v('d-uses'), hours: +v('d-hours'), money: v('d-money'), xp: v('d-xp'), carId: v('d-car'), slots: +v('d-slots') });
}
PAGES.team = async () => {
  title('Команда');
  const [t, l] = await Promise.all([req('/admin/team'), req('/admin/log')]);
  if (!t) return null;
  teamIds = new Set(t.team.map(a => a.id));
  const ACT = { 'player-action': 'игрок', 'promo-create': 'создал промокод', 'promo-toggle': 'промокод вкл/выкл', 'promo-delete': 'удалил промокод',
    maintenance: 'техработы', broadcast: 'рассылка', 'team-add': 'назначил админа', 'team-remove': 'снял админа', 'bot-setup': 'настроил бота', 'admin-bot-setup': 'настроил админ-бота' };
  const detail = r => { try { const d = JSON.parse(r.details || '{}'); return r.action === 'player-action' ? [d.op, d.add && money(d.add), d.carId && CAR_BY_ID[d.carId]?.name, d.caseId, d.plate].filter(Boolean).join(' · ') : (d.code || d.text || '').slice(0, 60); } catch { return ''; } };
  const team = t.team.map(a => `<div class="list-row static"><div class="info"><div class="t">🛡️ ${esc(a.name) || a.id}${a.username ? ` <span class="muted">@${esc(a.username)}</span>` : ''}</div>
      <div class="sub">ID ${a.id} · с ${date(a.at)}</div></div>${btn('team-remove', 'Убрать', `danger data-confirm="Ещё раз" data-id="${a.id}"`)}</div>`).join('');
  const log = (l?.log || []).map(r => `<div class="list-row static"><div class="info"><div class="t">${esc(r.admin) || r.admin_id} — ${ACT[r.action] || r.action}${r.target ? ` <button class="link" data-act="player" data-id="${r.target}">${esc(r.target_name) || r.target}</button>` : ''}</div>
      <div class="sub">${new Date(r.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${detail(r) ? ' · ' + esc(detail(r)) : ''}</div></div></div>`).join('');
  return `<div class="aa-note">Назначить админа: «Игроки» → открой игрока → «Сделать админом». Админ откроет админку через этого же админ-бота.</div>
    <div class="section-h">Админы · ${t.team.length}</div>
    <div class="list">${team || '<div class="aa-empty">Пока только ты</div>'}</div>
    <div class="section-h">Журнал действий</div>
    <div class="list">${log || '<div class="aa-empty">Пусто</div>'}</div>`;
};

PAGES.promos = async () => {
  title('Промокоды');
  draft = draft || newDraft();
  const data = await req('/admin/promos');
  if (!data) return '';
  const d = draft;
  const carOpts = '<option value="">— без машины —</option>' + CARS.map(c => `<option value="${c.id}"${d.carId === c.id ? ' selected' : ''}>${c.name}</option>`).join('');
  const tg2 = (k, l) => `<button class="pill${d[k] ? '' : ' gray'}" data-act="d-toggle" data-k="${k}">${d[k] ? '✓ ' : ''}${l}</button>`;
  const list = data.promos.map(p => {
    const expired = p.expires_at && data.now > p.expires_at, ended = p.max_uses && p.uses >= p.max_uses;
    const status = !p.active ? 'выключен' : expired ? 'срок истёк' : ended ? 'закончился' : 'активен';
    return `<div class="card promo-row${status === 'активен' ? '' : ' off'}" style="margin-bottom:10px">
      <div class="row"><b style="font-family:monospace;font-size:17px">${esc(p.code)}</b><span class="small">${status}</span></div>
      <div class="small">${esc(rewardText(p.reward))}</div>
      <div class="muted small">Использован ${p.uses}${p.max_uses ? ` из ${p.max_uses}` : ' · без лимита'}${p.expires_at && !expired ? ` · до ${new Date(p.expires_at).toLocaleString('ru-RU')}` : ''}</div>
      <div class="pills wrap">${btn('promo-active', p.active ? 'Выключить' : 'Включить', `data-code="${esc(p.code)}" data-on="${p.active ? 0 : 1}"`)}${btn('promo-delete', 'Удалить', `danger data-confirm="Удалить?" data-code="${esc(p.code)}"`)}</div></div>`;
  }).join('') || '<div class="aa-empty">Промокодов пока нет</div>';
  return `<div class="section-h">Новый промокод</div>
    <div class="card admin-card">
      <div class="admin-row"><input id="d-code" class="admin-input" placeholder="Код, например SUMMER25" value="${esc(d.code)}" autocapitalize="characters">${btn('d-random', '🎲')}</div>
      <div class="admin-row"><input id="d-uses" class="admin-input" type="number" placeholder="Активаций (пусто — без лимита)" value="${esc(d.maxUses)}">
        <select id="d-hours" class="admin-input short">${HOURS.map(([h, l]) => `<option value="${h}"${d.hours === h ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="admin-row"><input id="d-money" class="admin-input" type="number" placeholder="Деньги, ₽" value="${esc(d.money)}"><input id="d-xp" class="admin-input" type="number" placeholder="Опыт" value="${esc(d.xp)}"></div>
      <select id="d-car" class="admin-input">${carOpts}</select>
      <div class="admin-row"><select id="d-slot" class="admin-input">${[...SLOTS, ...EV_SLOTS].map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <select id="d-tier" class="admin-input short">${RARITY_ORDER.map(t => `<option value="${t}">${PART_TIERS[t].name}</option>`).join('')}</select>
        <input id="d-n" class="admin-input tiny" type="number" value="1">${btn('d-part', '+')}</div>
      ${d.parts.length ? `<div class="aa-chips">${d.parts.map((x, i) => `<button class="chip" data-act="d-part-del" data-i="${i}">${[...SLOTS, ...EV_SLOTS].find(s => s.id === x.slot).name} ${PART_TIERS[x.t].name} ×${x.n} ✕</button>`).join('')}</div>` : ''}
      <select id="d-slots" class="admin-input">${[0, 1, 2, 3, 5].map(n => `<option value="${n}"${d.slots === n ? ' selected' : ''}>${n ? `+${n} мест в гараже` : 'Без мест в гараже'}</option>`).join('')}</select>
      <div class="pills wrap">${tg2('fuel', 'Полный бак')}${tg2('rcase', 'Кейс наград сейчас')}</div>
      <button class="btn" data-act="d-create">Создать промокод</button>
    </div>
    <div class="section-h">Все промокоды · ${data.promos.length}</div>${list}`;
};

// --- приглашения ---
PAGES.refs = async () => {
  title('Приглашения');
  const d = await req('/admin/referrals');
  if (!d) return '';
  return `<div class="aa-tiles" style="grid-template-columns:1fr 1fr"><div class="aa-tile"><b>${d.total}</b><span>всего приглашено</span></div><div class="aa-tile"><b>${d.top.length}</b><span>пригласивших</span></div></div>
    <div class="section-h">Кто больше всех привёл</div>
    <div class="list">${d.top.map((r, i) => `<button class="list-row" data-act="player" data-id="${r.id}"><div class="info"><div class="t">${i + 1}. ${esc(r.name) || r.id}</div><div class="sub">ID ${r.id}</div></div><div class="r"><b>${r.n}</b></div></button>`).join('') || '<div class="aa-empty">Пока никого</div>'}</div>
    <div class="section-h">Последние приглашённые</div>
    <div class="list">${d.recent.map(r => `<button class="list-row" data-act="player" data-id="${r.friend_id}"><div class="info"><div class="t">${esc(r.friend) || r.friend_id}</div><div class="sub">от ${esc(r.inviter) || r.ref_id} · ${ago(r.at)}</div></div><div class="r">›</div></button>`).join('')}</div>`;
};

// --- рассылка ---
// --- подозрительные аккаунты (накрутка подписчиков / приглашений) ---
let suspects = null;
PAGES.suspects = async () => {
  title('Подозрительные');
  const d = suspects = await req('/admin/suspects');
  if (!d) return '';
  const inv = d.inviters.map(r => `<button class="list-row" data-act="player" data-id="${r.id}"><div class="info"><div class="t">${esc(r.name) || r.id}</div>
      <div class="sub">привёл ${r.total} · пустых <b style="color:var(--bad)">${r.empty}</b></div></div><div class="r">›</div></button>`).join('');
  const list = d.list.map(p => `<button class="list-row" data-act="player" data-id="${p.id}"><div class="info"><div class="t">${esc(p.name) || p.id}${p.username ? ` <span class="aa-row-sub">@${esc(p.username)}</span>` : ''}</div>
      <div class="sub">зашёл ${date(p.created_at)}${p.ref_id ? ` · по приглашению ${p.ref_id}` : ''}</div></div><div class="r">›</div></button>`).join('');
  return `<div class="card"><div class="aa-row-sub">Аккаунты, которые открыли игру больше суток назад, подписались на канал, но поиграли меньше 10 минут (1 уровень, максимум 1 кейс) и не вернулись. Скорее всего — боты или твинки ради приглашений.<br><br>Telegram не даёт боту список всех подписчиков канала, поэтому здесь только те, кто хоть раз открыл игру.</div></div>
    <div class="aa-tiles" style="grid-template-columns:1fr 1fr"><div class="aa-tile"><b>${d.total}</b><span>подозрительных</span></div><div class="aa-tile"><b>${d.inviters.length}</b><span>приводят пустых</span></div></div>
    ${d.total && isOwner ? `<button class="btn danger" data-act="sus-kick" data-confirm="Убрать ${d.list.length} из канала? Нажми ещё раз">Убрать из канала · ${d.list.length}</button>
      <div class="aa-row-sub" style="margin:6px 4px 0">Из канала уберутся, но смогут вернуться сами. Прогресс в игре не трогается — для входа нужно будет снова подписаться.</div>` : ''}
    ${inv ? `<div class="section-h">Кто приводит пустые аккаунты</div><div class="list">${inv}</div>` : ''}
    <div class="section-h">Аккаунты${d.total > d.list.length ? ` (первые ${d.list.length})` : ''}</div>
    <div class="list">${list || '<div class="aa-empty">Никого — всё чисто</div>'}</div>`;
};
async function kickSuspects() {
  const ids = (suspects?.list || []).map(p => p.id);
  let kicked = 0, failed = 0;
  for (let i = 0; i < ids.length; i += 40) {
    toast(`Убираю… ${Math.min(i + 40, ids.length)}/${ids.length}`);
    const r = await req('/admin/suspects-kick', { ids: ids.slice(i, i + 40) });
    if (!r) break;
    kicked += r.kicked; failed += r.failed;
  }
  toast(`Убрано из канала: ${kicked}${failed ? ` · не получилось: ${failed}` : ''}`);
  show();
}

PAGES.broadcast = async () => {
  title('Рассылка');
  return `<div class="card admin-card">
      <textarea id="b-text" class="admin-input area" style="min-height:140px;font-size:16px;font-family:inherit" placeholder="Текст сообщения. Можно <b>жирный</b> и <i>курсив</i>"></textarea>
      <label class="aa-check"><input type="checkbox" id="b-btn" checked> Кнопка «🏁 Играть» под сообщением</label>
      <button class="btn" data-act="b-send" data-confirm="Отправить всем? Нажми ещё раз">Отправить всем игрокам</button>
      <div id="b-progress"></div>
    </div>
    <div class="aa-note">Сообщение придёт от @dropezone_bot всем, кто открывал игру. Кто остановил бота — не получит. Отправка идёт порциями по 40.</div>`;
};
async function broadcast() {
  const text = $('#b-text').value.trim();
  if (!text) { toast('Напиши текст'); return; }
  const box = $('#b-progress');
  let offset = 0, sent = 0, failed = 0;
  for (;;) {
    const r = await req('/admin/broadcast', { text, button: $('#b-btn').checked, offset });
    if (!r) break;
    sent += r.sent; failed += r.failed; offset = r.next;
    box.innerHTML = `<div class="aa-progress"><i style="width:${Math.min(100, offset / r.total * 100)}%"></i></div><div class="aa-note">Отправлено ${sent}, не дошло ${failed} · ${offset}/${r.total}</div>`;
    if (r.done) { haptic.ok(); toast(`Готово: доставлено ${sent}`); break; }
  }
}

// --- контейнеры: запуск (один за раз), завершить, отменить ---
const CONT_DURS = [[10, '10 минут'], [30, '30 минут'], [60, '1 час'], [120, '2 часа'], [360, '6 часов'], [720, '12 часов'], [1440, '24 часа']];
const durName = m => (CONT_DURS.find(x => x[0] === m) || [0, `${m} мин`])[1];
PAGES.conts = async () => {
  title('Контейнеры');
  const d = await req('/admin/conts', undefined, true);
  if (!d) return `<div class="card"><b>Контейнеры включатся вместе с обновлением</b><div class="aa-row-sub" style="margin-top:6px">Сейчас сервер их не принимает — у игроков их нет.</div></div>`;
  const open = d.list.find(c => !c.done);
  const carName = id => d.cars.find(c => c.id === id)?.name || CAR_BY_ID[id]?.name || id;
  const left = ms => { const m = Math.max(0, Math.ceil(ms / 60e3)); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
  const list = d.list.map(c => `<div class="list-row static"><div class="info">
      <div class="t">№${c.n} · ${esc(carName(c.carId))}</div>
      <div class="sub">${c.status === 'open' ? `идут торги · ещё ${left(c.endsAt - Date.now())}` : c.status === 'cancel' ? 'отменён' : 'завершён'}
        · ${c.bids ? `${c.bids} ставок · ${money(c.price)} · ${c.leaderId ? `<button class="link" data-act="player" data-id="${c.leaderId}">${esc(c.leader) || c.leaderId}</button>` : ''}` : `без ставок · старт ${money(c.start)}`}</div></div>
      ${c.status === 'open' ? `<div class="pills">${btn('ct-end', 'Завершить', `data-id="${c.id}" data-confirm="Завершить сейчас? Победит текущий лидер"`)}${btn('ct-cancel', 'Отменить', `danger data-id="${c.id}" data-confirm="Отменить? Лидеру ставка вернётся"`)}</div>` : ''}
    </div>`).join('');
  const opts = `<optgroup label="Эксклюзивные">${d.cars.filter(c => c.excl).map(c => `<option value="${c.id}">${esc(c.name)} · ~${money(c.price)}</option>`).join('')}</optgroup>
    <optgroup label="Секретные">${d.cars.filter(c => !c.excl).map(c => `<option value="${c.id}">${esc(c.name)} · ${money(c.price)}</option>`).join('')}</optgroup>`;
  return `${open ? `<div class="card" style="margin-bottom:12px"><b>Идёт контейнер №${open.n}</b><div class="aa-row-sub">Новый можно запустить, когда этот закончится</div></div>`
    : `<div class="card admin-card">
      <div class="aa-row-sub">Что внутри (игроки не узнают, пока победитель не откроет)</div>
      <select id="ct-car" class="admin-input">${opts}</select>
      <div class="aa-row-sub" style="margin-top:8px">Стартовая цена, ₽</div>
      <input id="ct-start" class="admin-input" type="number" inputmode="numeric" value="${d.def.start}">
      <div class="aa-row-sub" style="margin-top:8px">Сколько идут торги</div>
      <select id="ct-dur" class="admin-input">${CONT_DURS.map(([m, n]) => `<option value="${m}"${m === d.def.ms / 60e3 ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label class="aa-check"><input type="checkbox" id="ct-bc" checked> Разослать всем в бота «Новый контейнер!»</label>
      <button class="btn" data-act="ct-new" data-confirm="Запустить контейнер? Нажми ещё раз">Запустить контейнер</button>
      <div id="ct-progress"></div>
    </div>`}
    <div class="aa-note">Ставки — с ${AUCTION.minLevel} уровня, шаг +${AUCTION.stepK * 100}%, ставка в последние 2 минуты продлевает торги. Игроки увидят островок «Идут торги» и плашку на экране кейсов.</div>
    ${list ? `<div class="section-h">Последние</div><div class="list">${list}</div>` : ''}`;
};
async function contCreate() {
  const carId = $('#ct-car').value, start = +$('#ct-start').value, minutes = +$('#ct-dur').value, bc = $('#ct-bc').checked;
  const r = await req('/admin/cont-create', { carId, start, minutes });
  if (!r) return;
  haptic.ok(); toast(`Контейнер №${r.n} запущен`);
  if (bc) {   // рассылка порциями, как в «Рассылке»
    const text = `🚢 <b>Новый контейнер №${r.n}!</b>\n\nВнутри — секретная машина. Что именно — узнает только победитель.\nСтарт ${money(Math.round(start / AUCTION.round) * AUCTION.round)}, торги идут ${durName(minutes)}. Кто больше даст — тот и заберёт 👇`;
    const box = $('#ct-progress');
    let offset = 0, sent = 0;
    for (;;) {
      const b = await req('/admin/broadcast', { text, button: true, offset });
      if (!b) break;
      sent += b.sent; offset = b.next;
      if (box) box.innerHTML = `<div class="aa-progress"><i style="width:${Math.min(100, offset / b.total * 100)}%"></i></div><div class="aa-note">Рассылка: доставлено ${sent} · ${offset}/${b.total}</div>`;
      if (b.done) { toast(`Рассылка: доставлено ${sent}`); break; }
    }
  }
  go('conts', null, true);
}

// --- временные кейсы: создать (кейс админа команды ждёт подтверждения владельца), закончить досрочно ---
const EC_ICONS = ['🔥', '🎃', '🎄', '❄️', '💎', '⚡', '👑', '🏆', '🎁', '🌸', '🚀', '🍀'];
const EC_HOURS_L = [[1, '1 час'], [6, '6 ч'], [24, '1 день'], [72, '3 дня'], [168, '7 дней']];
const EC_PAY = [['rub', 'Только ₽'], ['stars', 'Только ⭐'], ['both', '₽ или ⭐']];
const ecNew = () => ({ name: '', icon: '🔥', cars: [], hours: 24, pay: 'rub', stars: '', fR: [], fC: 'all', pMin: '', pMax: '', q: '' });
let ecDraft = ecNew(), ecData = null;
const ecPool = d => {
  const q = d.q.trim().toLowerCase(), lo = +d.pMin * 1e6 || 0, hi = +d.pMax * 1e6 || Infinity;
  return Rules.baseCars().filter(c => (!q || c.name.toLowerCase().includes(q)) && (!d.fR.length || d.fR.includes(c.r))
    && (d.fC === 'all' || c.c === d.fC) && c.price >= lo && c.price <= hi);
};
const ecToggle = (a, v) => { const i = a.indexOf(v); i < 0 ? a.push(v) : a.splice(i, 1); };
const ecLeft = ms => { const m = Math.max(0, Math.ceil(ms / 60e3)); return m >= 1440 ? `${Math.floor(m / 1440)} дн ${Math.floor(m % 1440 / 60)} ч` : m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
const ecPrice = c => c.pay === 'stars' ? `⭐ ${c.stars}` : c.pay === 'both' ? `${money(c.price)} или ⭐ ${c.stars}` : money(c.price);
function ecHTML() {
  const d = ecDraft, data = ecData;
  const ST = { live: 'в игре', pending: 'ждёт подтверждения', ended: 'закончился', rejected: 'отклонён' };
  const list = data.list.map(c => `<div class="list-row static"><div class="info">
      <div class="t">${esc(c.icon)} ${esc(c.name)}</div>
      <div class="sub">${ST[c.status] || c.status}${c.status === 'live' ? ` · ещё ${ecLeft(c.until - Date.now())}` : ''} · ${c.cars.length} машин · ${ecPrice(c)} · ${esc(c.adminName || '')}</div></div>
      <div class="pills">${c.status === 'pending' && data.owner ? btn('ec-ok', '✅', `data-id="${c.id}"`) + btn('ec-no', '❌', `danger data-id="${c.id}"`) : ''}
        ${c.status === 'live' ? btn('ec-end', 'Закончить', `danger data-id="${c.id}" data-confirm="Закончить сейчас?"`) : ''}</div></div>`).join('');
  const pool = ecPool(d), shownOn = pool.filter(c => d.cars.includes(c.id)).length;
  const picks = RARITY_ORDER.map(r => {
    const cs = pool.filter(c => c.r === r);
    return cs.length ? `<div class="aa-row-sub" style="margin:8px 0 4px">${r} · ${RARITIES[r].name}</div><div class="aa-chips">${cs.map(c => `<button class="chip${d.cars.includes(c.id) ? ' on' : ''}" data-act="ec-car" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : '';
  }).join('');
  const odds = d.cars.length ? Rules.caseOdds({ event: true, kind: 'car', cars: d.cars }).map(o => `${o.r} ${o.pct.toFixed(1).replace('.', ',')}%`).join(' · ') : '';
  const live = data.list.filter(c => c.status === 'live').length;
  return `${list ? `<div class="section-h">Кейсы</div><div class="list">${list}</div>` : ''}
    <div class="section-h">Новый кейс</div>
    ${live >= data.max ? `<div class="card" style="margin-bottom:10px"><b>В игре уже ${data.max} кейса</b><div class="aa-row-sub">Новый можно будет запустить, когда один закончится</div></div>` : ''}
    <div class="card admin-card">
      <input id="ec-name" class="admin-input" placeholder="Название, например «Хэллоуин»" maxlength="28" value="${esc(d.name)}">
      <div class="aa-row-sub" style="margin-top:10px">Смайлик</div>
      <div class="aa-chips">${EC_ICONS.map(i => `<button class="chip${i === d.icon ? ' on' : ''}" data-act="ec-icon" data-v="${i}">${i}</button>`).join('')}</div>
      <div class="aa-row-sub" style="margin-top:10px">Сколько доступен</div>
      <div class="aa-chips">${EC_HOURS_L.map(([h, l]) => `<button class="chip${d.hours === h ? ' on' : ''}" data-act="ec-hours" data-v="${h}">${l}</button>`).join('')}</div>
      <div class="aa-row-sub" style="margin-top:10px">Оплата</div>
      <div class="aa-chips">${EC_PAY.map(([k, l]) => `<button class="chip${d.pay === k ? ' on' : ''}" data-act="ec-pay" data-v="${k}">${l}</button>`).join('')}</div>
      ${d.pay !== 'rub' ? `<input id="ec-stars" class="admin-input" style="margin-top:8px" type="number" inputmode="numeric" min="1" placeholder="Цена в звёздах" value="${esc(d.stars)}">` : ''}
    </div>
    <div class="section-h">Машины · ${d.cars.length}${d.cars.length ? ` ${btn('ec-clear', 'Сбросить')}` : ''}</div>
    <div class="card admin-card">
      <input id="ec-q" class="admin-input" placeholder="Поиск машины" value="${esc(d.q)}">
      <div class="aa-row-sub" style="margin-top:8px">Редкость</div>
      <div class="aa-chips">${RARITY_ORDER.map(r => `<button class="chip${d.fR.includes(r) ? ' on' : ''}" data-act="ec-fr" data-v="${r}">${r} · ${RARITIES[r].name}</button>`).join('')}</div>
      <div class="aa-row-sub" style="margin-top:8px">Страна</div>
      <div class="aa-chips">${[['all', 'Все'], ...Object.entries(COUNTRIES).map(([k, v]) => [k, `${v.flag} ${v.name}`])].map(([k, l]) => `<button class="chip${d.fC === k ? ' on' : ''}" data-act="ec-fc" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="aa-row-sub" style="margin-top:8px">Цена машины, млн ₽</div>
      <div class="admin-row"><input id="ec-pmin" class="admin-input" type="number" inputmode="decimal" placeholder="от" value="${esc(d.pMin)}"><input id="ec-pmax" class="admin-input" type="number" inputmode="decimal" placeholder="до" value="${esc(d.pMax)}"></div>
      <div class="aa-chips" style="margin-top:8px">${btn('ec-all', `Выбрать показанные · ${pool.length}`, pool.length && shownOn < pool.length ? '' : 'disabled')}${btn('ec-none', `Снять показанные · ${shownOn}`, shownOn ? '' : 'disabled')}</div>
      ${picks || '<div class="aa-empty">Ничего не подходит под фильтры</div>'}
    </div>
    ${d.cars.length ? `<div class="card admin-card"><div class="row"><span>Цена в ₽ (считает игра, окупаемость ~95%)</span><b>${money(Rules.eventCasePrice(d.cars))}</b></div><div class="aa-row-sub">${odds}</div></div>` : ''}
    <button class="btn" data-act="ec-create" ${d.cars.length && live < data.max ? '' : 'disabled'} data-confirm="${data.owner ? 'Запустить кейс в игре?' : 'Отправить владельцу на подтверждение?'}">${data.owner ? 'Создать и запустить' : 'Отправить на подтверждение'}</button>
    <div class="aa-note">${data.owner ? 'Кейсы админов команды приходят тебе в админ-бот с кнопками «Подтвердить / Отклонить».' : 'Кейс появится в игре, когда владелец подтвердит.'} Игроки увидят островок один раз и плашку на экране кейсов. Одновременно — до ${data.max} кейсов.</div>`;
}
const ecRead = () => {
  const v = id => $('#' + id)?.value;
  if ($('#ec-name')) ecDraft.name = v('ec-name').trim();
  if ($('#ec-stars')) ecDraft.stars = v('ec-stars');
  if ($('#ec-q')) { ecDraft.q = v('ec-q'); ecDraft.pMin = v('ec-pmin'); ecDraft.pMax = v('ec-pmax'); }
};
function ecRender(focus) {
  const scr = $('#aa-screen'), y = window.scrollY;
  scr.innerHTML = ecHTML();
  window.scrollTo(0, y);
  if (focus) { const i = $('#' + focus); if (i) { i.focus(); const val = i.value; i.value = ''; i.value = val; } }
}
PAGES.ecases = async () => {
  title('Временные кейсы');
  ecData = await req('/admin/ecases', undefined, true);
  if (!ecData) return `<div class="card"><b>Временные кейсы включатся вместе с обновлением</b><div class="aa-row-sub" style="margin-top:6px">Сейчас сервер их не принимает — у игроков их нет.</div></div>`;
  return ecHTML();
};
async function ecCreate() {
  ecRead();
  const d = ecDraft;
  if (!d.name) { haptic.err(); toast('Назови кейс'); return; }
  const r = await req('/admin/ecase-create', { name: d.name, icon: d.icon, cars: d.cars, hours: d.hours, pay: d.pay, stars: +d.stars || 0 });
  if (!r) return;
  haptic.ok(); toast(r.live ? `Кейс «${d.name}» в игре` : 'Отправлено владельцу на подтверждение');
  ecDraft = ecNew();
  go('ecases', null, true);
}
let ecT = 0;
document.addEventListener('input', e => {
  if (!['ec-q', 'ec-pmin', 'ec-pmax'].includes(e.target.id)) return;
  const id = e.target.id; ecRead(); clearTimeout(ecT); ecT = setTimeout(() => ecRender(id), 350);
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act^="ec-"]');
  if (!el || el.disabled || !ecData) return;
  const { act, v, id } = el.dataset;
  ecRead();
  const d = ecDraft;
  if (act === 'ec-car') ecToggle(d.cars, id);
  else if (act === 'ec-icon') d.icon = v;
  else if (act === 'ec-hours') d.hours = +v;
  else if (act === 'ec-pay') d.pay = v;
  else if (act === 'ec-fr') ecToggle(d.fR, v);
  else if (act === 'ec-fc') d.fC = v;
  else if (act === 'ec-clear') d.cars = [];
  else if (act === 'ec-all') { for (const c of ecPool(d)) if (!d.cars.includes(c.id)) d.cars.push(c.id); }
  else if (act === 'ec-none') { const ids = new Set(ecPool(d).map(c => c.id)); d.cars = d.cars.filter(x => !ids.has(x)); }
  else if (act === 'ec-create') return ecCreate();
  else if (act === 'ec-ok' || act === 'ec-no') {
    return req('/admin/ecase-decide', { id, ok: act === 'ec-ok' }).then(r => { if (r) { haptic.ok(); toast(r.text); go('ecases', null, true); } });
  } else if (act === 'ec-end') {
    return req('/admin/ecase-end', { id }).then(r => { if (r) { haptic.ok(); toast('Кейс закончился'); go('ecases', null, true); } });
  } else return;
  haptic.tick?.();
  ecRender();
});

// --- техработы ---
let maintCache = null;
PAGES.maint = async () => {
  title('Техработы');
  const s = await req('/admin/stats');
  if (!s) return '';
  maintCache = s.maintenance || { on: false, text: '' };
  return `<div class="card admin-card">
      <div class="row"><span>${maintCache.on ? '<b style="color:var(--bad)">Включены</b> — игроки видят заглушку' : 'Выключены'}</span>
        <button class="switch${maintCache.on ? ' on' : ''}" data-act="m-toggle" aria-label="Техработы"></button></div>
      <input id="m-text" class="admin-input" maxlength="300" placeholder="Текст для игроков, например: Вернёмся в 18:00" value="${esc(maintCache.text || '')}">
      ${btn('m-save', 'Сохранить текст')}
    </div>
    <div class="aa-note">Ты и другие админы играете как обычно, даже когда техработы включены.</div>`;
};
async function saveMaint(on) {
  const d = await req('/admin/maintenance', { on, text: $('#m-text')?.value ?? maintCache?.text ?? '' });
  if (!d) return;
  haptic.ok(); toast(on ? 'Техработы включены' : 'Техработы выключены');
  go('maint', null, true);
}

// --- боты ---
PAGES.bots = async () => {
  title('Боты');
  const s = await req('/admin/stats');
  const ab = s?.adminBot;
  return `${section('Игровой бот @dropezone_bot', `
      <div class="aa-row-sub">Ответ на /start с кнопкой «Играть», описание, команды, кнопка у поля ввода, проверка канала</div>
      ${btn('bot-setup', 'Настроить игрового бота')}<div id="bot-report"></div>`)}
    ${section('Админ-бот', `
      <div class="aa-row-sub">${ab ? (ab.ok ? 'Настроен ✓' : `Ошибка: ${esc(ab.error)}`) : 'Ещё не настроен (нужен секрет ADMIN_BOT_TOKEN)'}</div>
      ${btn('admin-bot-setup', 'Перенастроить админ-бота')}`)}`;
};

// ---------- нажатия ----------
let armed = null;
document.addEventListener('change', e => {
  if (e.target.id === 'f-notify') { notifyOn = e.target.checked; try { localStorage.setItem('aa_notify', notifyOn ? '1' : '0'); } catch {} haptic.tap(); }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  // подтверждение повторным нажатием
  if (el.dataset.confirm !== undefined) {
    if (armed !== el) {
      armed?.classList.remove('armed');
      armed = el; el.dataset.label = el.innerHTML; el.textContent = el.dataset.confirm; el.classList.add('armed'); haptic.tap();
      setTimeout(() => { if (armed === el) { el.innerHTML = el.dataset.label; el.classList.remove('armed'); armed = null; } }, 3000);
      return;
    }
    el.classList.remove('armed'); el.innerHTML = el.dataset.label; armed = null;
  }
  const { act } = el.dataset;
  const v = id => document.getElementById(id)?.value;
  switch (act) {
    case 'back': back(); break;
    case 'nav': haptic.tap(); go(el.dataset.page); break;
    case 'player': haptic.tap(); go('player', Number(el.dataset.id)); break;
    case 'psort': psort = el.dataset.s; haptic.tap(); go('players', null, true); break;
    case 'pmore': if (await loadPlayers(true) !== false) refreshPlayerList(); break;
    // действия с игроком
    case 'op-money': op('money', { add: +el.dataset.v }, `+${money(+el.dataset.v)}`); break;
    case 'op-money-zero': op('money', { set: 0 }, 'Баланс обнулён'); break;
    case 'op-money-set': { const s = Math.max(0, Math.floor(+v('f-sum') || 0)); op('money', { set: s }, `Баланс: ${money(s)}`); break; }
    case 'op-car': op('car', { carId: v('f-car') }, `Выдано: ${CAR_BY_ID[v('f-car')].name}`); break;
    case 'op-simple': op(el.dataset.op, {}, 'Готово'); break;
    case 'op-part': op('part', { slot: v('f-slot'), t: v('f-tier'), n: +el.dataset.n }, `+${el.dataset.n} деталей`); break;
    case 'op-xp': op('xp', { n: 500 }, '+500 опыта'); break;
    case 'op-case': {
      const [kind, caseId] = v('f-case').split('|');
      op('giveCase', { kind, caseId, n: +v('f-case-n') || 1, note: v('f-case-note') || '' }, r => `Подарено кейсов: ${r.gifts}`);
      break;
    }
    case 'op-plate-give': {
      const key = parsePlate(v('f-plate'));
      if (!key) { haptic.err(); toast('Формат: А777АА 77'); break; }
      op('plateGive', { plate: key }, `Выдан номер ${key.replace('|', ' ')}`); break;
    }
    case 'op-plate-rand': op('plateRandom', { r: v('f-plate-r') }, r => `Выдан номер ${r.plate.replace('|', ' ')}`); break;
    case 'op-plate-take': op('plateTake', { plate: el.dataset.plate }, 'Номер забран'); break;
    case 'op-export': {
      const text = JSON.stringify(target.state);
      try { await navigator.clipboard.writeText(text); toast('Сохранение скопировано'); } catch { toast('Не удалось скопировать'); }
      break;
    }
    case 'op-reset': op('reset', {}, 'Прогресс сброшен'); break;
    case 'team-add': case 'team-remove': {
      const d = await req('/admin/' + act, { id: Number(el.dataset.id) });
      if (!d) break;
      teamIds = new Set(d.team.map(a => a.id));
      haptic.ok();
      toast(act === 'team-add' ? 'Теперь это админ' : 'Права админа сняты');
      const y = window.scrollY;
      if (stack.at(-1).page === 'team') show(); else { $('#aa-screen').innerHTML = playerHTML(); window.scrollTo(0, y); }
      break;
    }
    // промокоды
    case 'd-random': readDraft(); draft.code = 'DZ' + Math.random().toString(36).slice(2, 8).toUpperCase(); go('promos', null, true); break;
    case 'd-toggle': readDraft(); draft[el.dataset.k] = !draft[el.dataset.k]; go('promos', null, true); break;
    case 'd-part': readDraft(); draft.parts.push({ slot: v('d-slot'), t: v('d-tier'), n: Math.max(1, Math.min(100, +v('d-n') | 0)) }); go('promos', null, true); break;
    case 'd-part-del': readDraft(); draft.parts.splice(+el.dataset.i, 1); go('promos', null, true); break;
    case 'd-create': {
      readDraft();
      const d = draft;
      const r = await req('/admin/promo-create', { code: d.code, maxUses: +d.maxUses || 0, hours: d.hours,
        reward: { money: +d.money || 0, xp: +d.xp || 0, carId: d.carId || undefined, parts: d.parts, fuel: d.fuel, rcase: d.rcase, slots: d.slots } });
      if (!r) break;
      haptic.ok();
      try { await navigator.clipboard.writeText(r.code); } catch {}
      toast(`Промокод ${r.code} создан и скопирован`);
      draft = newDraft(); go('promos', null, true);
      break;
    }
    case 'promo-active': if (await req('/admin/promo-toggle', { code: el.dataset.code, active: el.dataset.on === '1' })) go('promos', null, true); break;
    case 'promo-delete': if (await req('/admin/promo-delete', { code: el.dataset.code })) { toast('Удалён'); go('promos', null, true); } break;
    // рассылка, техработы, боты
    case 'b-send': broadcast(); break;
    case 'ct-new': contCreate(); break;
    case 'ct-end': req('/admin/cont-end', { id: el.dataset.id }).then(r => { if (r) { haptic.ok(); toast('Контейнер завершён'); go('conts', null, true); } }); break;
    case 'ct-cancel': req('/admin/cont-cancel', { id: el.dataset.id }).then(r => { if (r) { haptic.ok(); toast('Отменён, ставка вернулась'); go('conts', null, true); } }); break;
    case 'sus-kick': kickSuspects(); break;
    case 'pc-check': plateCheck(); break;
    case 'pl-r': plR = el.dataset.v; show().then(plLoad); break;
    case 'pl-k': plKind = el.dataset.v; show().then(plLoad); break;
    case 'pl-more': plLoad(); break;
    case 'pl-pick': { const k = el.dataset.key; plateRes = { raw: k.replace('|', ' ') }; show().then(() => { $('#pc-key').value = k.replace('|', ' '); plateCheck(); }); break; }
    case 'm-toggle': saveMaint(!maintCache?.on); break;
    case 'm-save': saveMaint(!!maintCache?.on); break;
    case 'bot-setup': {
      const r = await req('/admin/bot-setup', {});
      if (r) $('#bot-report').innerHTML = r.report.map(x => `<div class="aa-row-sub">${x.ok ? '✓' : '✗'} ${esc(x.name)}${x.ok ? '' : ': ' + esc(x.error)}</div>`).join('');
      break;
    }
    case 'admin-bot-setup': if (await req('/admin/admin-bot-setup', {})) { toast('Готово'); go('bots', null, true); } break;
  }
});

// ---------- старт ----------
if (!DEV_API && !tg?.initData) {
  $('#aa-screen').innerHTML = `<div class="aa-empty">Открой админку из админ-бота в Telegram.</div>`;
} else go('home');
