// ===== DROPZONE: AUTO — админ-панель =====
// Открывается 7 быстрыми нажатиями на заголовок экрана.
// Действия применяются к себе или к выбранному игроку (через сервер, права проверяет сервер).
// Разделы «Игроки» и «Техработы» работают только с сервером.
'use strict';

// tgUser, isAdmin, esc — в game.js. В игре в Telegram админки нет (она в админ-боте, admin.html);
// этот файл подгружается только в браузере (тестовый режим) по 7 нажатиям на заголовок.



// ---------- запросы к админ-разделу сервера ----------
async function adminFetch(path, body) {
  if (MODE !== 'server') { toast('Доступно только с сервером'); return null; }
  try {
    const res = await fetch(API + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) }
      : { headers: authHeaders() });
    const data = await res.json();
    if (data.error) { haptic.err(); toast(data.error); return null; }
    return data;
  } catch {
    haptic.err();
    toast('Нет связи с сервером');
    return null;
  }
}

// чей прогресс сейчас в панели: null — свой, иначе { id, name, username, state }
let admTarget = null;
const admState = () => admTarget ? admTarget.state : state;

const adminSection = (title, body) => `<div class="section-h">${title}</div><div class="card admin-card">${body}</div>`;
const abtn = (act, label, extra = '') => `<button class="pill${extra.includes('danger') ? ' danger' : ''}" data-act="${act}" ${extra.replace('danger', '')}>${label}</button>`;
// подписка игрока на канал — как её видит Telegram
const SUB_NAMES = { creator: 'владелец', administrator: 'админ', member: 'подписан ✓', restricted: 'ограничен', left: 'НЕ подписан', kicked: 'заблокирован' };
const subLabel = s => !s ? '—' : s.error ? `<span style="color:var(--bad)">ошибка проверки: ${esc(s.error)}</span>`
  : `<b style="color:${['member', 'creator', 'administrator'].includes(s.status) || s.isMember ? 'var(--ok)' : 'var(--bad)'}">${SUB_NAMES[s.status] || s.status}</b>`;

const ago = t => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 1440) return `${Math.floor(m / 60)} ч назад`;
  return `${Math.floor(m / 1440)} дн назад`;
};

function showAdmin() {
  const S = admState();
  const u = tgUser();
  const st = S.stats || {};
  const base = Rules.baseCars();
  const raw = JSON.stringify(S);
  const carOpts = RARITY_ORDER.concat('X', 'E').map(r => `<optgroup label="${RARITIES[r].name}">${
    CARS.filter(c => c.r === r).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</optgroup>`).join('');
  const t = admTarget;

  const head = t
    ? `<div class="card adm-target">
        <div class="row"><b>${esc(t.name) || 'Без имени'}${t.username ? ` <span class="muted">@${esc(t.username)}</span>` : ''}</b>
          <button class="pill gray" data-act="adm-me">← к себе</button></div>
        <div class="muted small">ID ${t.id} · уровень ${S.level} · в игре с ${new Date(t.created_at).toLocaleDateString('ru-RU')} · был ${ago(t.updated_at)}</div>
        <div class="small">Канал: ${subLabel(t.sub)}</div>
        ${t.refs ? `<div class="small">Пришёл от: ${t.refs.invitedBy ? `<button class="link" data-act="adm-open" data-id="${t.refs.invitedBy.id}">${esc(t.refs.invitedBy.name) || t.refs.invitedBy.id}</button>` : '—'}
          · пригласил: <b>${t.refs.invited.length}</b></div>
          ${t.refs.invited.length ? `<div class="adm-cars">${t.refs.invited.map(f => `<button class="chip" data-act="adm-open" data-id="${f.id}">${esc(f.name) || f.id}</button>`).join('')}</div>` : ''}` : ''}
      </div>`
    : `<div class="muted small admin-note">${MODE === 'server' ? 'Действия ниже — с твоим прогрессом. Чужой прогресс — через «Игроки».' : 'Локальный режим: меняет прогресс на этом устройстве.'}</div>
      ${typeof showAucAdmin === 'function' && nextOn() ? `<div class="list" style="margin-bottom:12px"><button class="list-row" data-act="auc-admin">
        <div class="ic">${emo('🚢', 24)}</div><div class="info"><div class="t">Контейнеры</div><div class="sub">Запустить аукцион (ивент)</div></div>
        <div class="r">${CHEVRON_R}</div></button>
        ${typeof showEvAdmin === 'function' ? `<button class="list-row" data-act="ev-admin">
        <div class="ic">${emo('⏳', 24)}</div><div class="info"><div class="t">Временные кейсы</div><div class="sub">Создать кейс со своими машинами на время</div></div>
        <div class="r">${CHEVRON_R}</div></button>` : ''}</div>` : ''}
      ${MODE === 'server' ? `<div class="list"><button class="list-row" data-act="adm-players">
        <div class="ic">${emo('👥', 24)}</div><div class="info"><div class="t">Игроки</div><div class="sub">Список, поиск, действия с игроком</div></div>
        <div class="r">${CHEVRON_R}</div></button>
      <button class="list-row" data-act="adm-refs">
        <div class="ic">${emo('🤝', 24)}</div><div class="info"><div class="t">Приглашения</div><div class="sub">Кто сколько привёл и кого</div></div>
        <div class="r">${CHEVRON_R}</div></button>
      <button class="list-row" data-act="adm-promos">
        <div class="ic">${emo('🎟️', 24)}</div><div class="info"><div class="t">Промокоды</div><div class="sub">Создать, список, статистика</div></div>
        <div class="r">${CHEVRON_R}</div></button></div>
      ${adminSection('Технические работы', `
        <div class="row"><span>${serverMaint?.on ? '<b style="color:var(--bad)">Включены</b> — игроки видят заглушку' : 'Выключены'}</span>
          <button class="switch${serverMaint?.on ? ' on' : ''}" data-act="adm-maint-toggle" aria-label="Техработы"></button></div>
        <input id="adm-maint-text" class="admin-input" maxlength="300" placeholder="Текст для игроков, например: Вернёмся в 18:00" value="${esc(serverMaint?.text || '')}">
        ${abtn('adm-maint-save', 'Сохранить текст')}`)}
      ${adminSection('Бот', `
        <div class="muted small">Ответ на /start с кнопкой «Играть», описание, команды, кнопка у поля ввода</div>
        ${abtn('adm-bot-setup', 'Настроить бота')}`)}` : ''}`;

  const html = `${sheetNav(t ? 'Игрок' : 'Админ-панель', t ? { act: 'adm-players', label: 'Игроки' } : null)}${head}

    ${adminSection('Деньги', `
      <div class="row"><span class="muted">Баланс</span><b>${money(S.money)}</b></div>
      <div class="pills wrap">${abtn('adm-money', '+100 тыс', 'data-v="1e5"')}${abtn('adm-money', '+10 млн', 'data-v="1e7"')}${abtn('adm-money', '+1 млрд', 'data-v="1e9"')}${abtn('adm-money-zero', 'Обнулить', 'danger data-confirm="Ещё раз"')}</div>
      <div class="admin-row"><input id="adm-sum" class="admin-input" type="number" inputmode="numeric" placeholder="Своя сумма, ₽">${abtn('adm-money-set', 'Установить')}</div>`)}

    ${adminSection('Машины', `
      <div class="admin-row"><select id="adm-car" class="admin-input">${carOpts}</select>${abtn('adm-car', 'Выдать')}</div>
      <div class="muted small">Гараж ${S.cars.length}/${S.slots} · витрина ${S.museum.length}/${S.museumSlots}</div>
      ${t && S.cars.length ? `<div class="adm-cars">${S.cars.map(c => `<span class="chip">${esc(CAR_BY_ID[c.id].name)} · ${carHp(c)} л.с.</span>`).join('')}</div>` : ''}
      <div class="pills wrap">${abtn('adm-collection', 'Открыть всю коллекцию')}${abtn('adm-slots', '+5 мест в гараже')}</div>`)}

    ${typeof platesOn === 'function' && platesOn() ? adminSection('Номера', `
      ${(S.plates || []).length ? `<div class="adm-plates">${[...S.plates].sort((a, b) => Rules.plateInfo(b).value - Rules.plateInfo(a).value).map(k => {
        const car = [...S.cars, ...S.museum].find(c => c.plate === k);
        return `<div class="adm-plate">${plateHTML(k, 'mini')}<div class="info"><b style="color:${rc(Rules.plateInfo(k).rarity)}">${money(Rules.plateInfo(k).value)}</b>
          <span class="muted small">${car ? CAR_BY_ID[car.id].name : 'не на машине'}</span></div>
          ${abtn('adm-plate-take', 'Забрать', `danger data-confirm="Ещё раз" data-plate="${k}"`)}</div>`;
      }).join('')}</div>` : '<div class="muted small">Номеров нет</div>'}
      <div class="admin-row"><input id="adm-plate" class="admin-input" placeholder="Номер, например А777АА 77" autocapitalize="characters" autocomplete="off">${abtn('adm-plate-give', 'Выдать')}</div>
      <div class="admin-row"><select id="adm-plate-r" class="admin-input">${['D', 'C', 'B', 'A', 'S'].map(r => `<option value="${r}">${r} · ${RARITIES[r].name}</option>`).join('')}</select>${abtn('adm-plate-rand', 'Случайный')}</div>`) : ''}

    ${adminSection('Детали', `
      <div class="admin-row">
        <select id="adm-slot" class="admin-input">${[...SLOTS, ...EV_SLOTS].map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <select id="adm-tier" class="admin-input short">${RARITY_ORDER.map(t => `<option value="${t}">${t} · ${PART_TIERS[t].name}</option>`).join('')}</select>
      </div>
      <div class="pills wrap">${abtn('adm-part', '+1', 'data-n="1"')}${abtn('adm-part', '+3', 'data-n="3"')}${abtn('adm-part', '+10', 'data-n="10"')}${abtn('adm-parts-all', 'Комплект S на все слоты')}</div>
      <div class="muted small">На складе: ${Rules.invTotal(S)} шт.</div>`)}

    ${adminSection('Таймеры и опыт', `
      <div class="pills wrap">
        ${abtn('adm-fuel', 'Полный бак')}
        ${abtn('adm-cd', 'Сбросить перерывы деталей')}
        ${abtn('adm-rcase', 'Кейс наград — сейчас')}
        ${abtn('adm-daily', 'Бонус дня — снова')}
        ${abtn('adm-income', 'Доход гаража — полный')}
        ${abtn('adm-xp', '+500 опыта')}
        ${t ? '' : abtn('adm-stories', 'Показать истории')}
        ${t ? '' : abtn('adm-whatsnew', 'Показать «Что нового»')}
      </div>
      <div class="admin-row"><span class="muted">День серии</span>
        <select id="adm-day" class="admin-input short">${DAILY.map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>${abtn('adm-day', 'Сделать следующим')}</div>`)}

    ${adminSection('Статистика', `
      <div class="admin-stats">
        <div><b>${S.level}</b><span>уровень</span></div>
        <div><b>${st.opened || 0}</b><span>кейсов</span></div>
        <div><b>${st.wins || 0}/${st.races || 0}</b><span>побед / гонок</span></div>
        <div><b>${st.merged || 0}</b><span>слияний</span></div>
        <div><b>${S.discovered.filter(id => !CAR_BY_ID[id]?.secret).length}/${base.length}</b><span>коллекция</span></div>
        <div><b>${(raw.length / 1024).toFixed(1)} КБ</b><span>сохранение</span></div>
      </div>
      ${t ? '' : `<div class="muted small">${u ? `Telegram: ${esc(u.first_name)} · ID ${u.id}` : 'Открыто в браузере, не в Telegram'} · ${tg?.platform || 'web'}</div>`}`)}

    ${adminSection('Сохранение', `
      <div class="pills wrap">${abtn('adm-export', 'Скопировать')}${abtn('adm-import', 'Вставить из буфера')}</div>
      <textarea id="adm-json" class="admin-input area" placeholder="Сюда можно вставить сохранение вручную"></textarea>
      <div class="pills wrap">${abtn('adm-import-text', 'Загрузить из поля')}${abtn('adm-reset', 'Сбросить прогресс', 'danger data-confirm="Точно? Ещё раз"')}</div>`)}
  `;
  const body = $('#sheet-body');
  if (document.body.classList.contains('sheet-open') && body.querySelector('.admin-card')) {
    const top = body.scrollTop; body.innerHTML = html; body.scrollTop = top;
  } else openSheet(html);
}

// ---------- игроки ----------
let playersQuery = '';
let playersTimer = null;

async function showPlayers(update) {
  const data = await adminFetch('/admin/players' + (playersQuery ? `?q=${encodeURIComponent(playersQuery)}` : ''));
  if (!data) return;
  const rows = data.players.map(p => `<button class="list-row" data-act="adm-open" data-id="${p.id}">
      <div class="info"><div class="t">${esc(p.name) || 'Без имени'}${p.username ? ` <span class="muted">@${esc(p.username)}</span>` : ''}</div>
        <div class="sub">ID ${p.id} · ур. ${p.level ?? 1} · ${money(p.money ?? 0)} · машин ${p.cars ?? 0}</div></div>
      <div class="r"><span class="small">${ago(p.updated_at)}</span>${CHEVRON_R}</div>
    </button>`).join('');
  const list = rows ? `<div class="list">${rows}</div>` : `<div class="card" style="text-align:center"><span class="muted">Никого не нашлось</span></div>`;
  if (update && $('#adm-players-list')) { $('#adm-players-list').innerHTML = list; return; }
  openSheet(`${sheetNav('Игроки', { act: 'adm-back', label: 'Админка' })}
    <div class="admin-stats" style="margin-bottom:12px">
      <div><b>${data.total}</b><span>всего игроков</span></div>
      <div><b>${data.active}</b><span>за сутки</span></div>
      <div><b>${data.players.length}</b><span>показано</span></div>
    </div>
    <input id="adm-search" class="admin-input" placeholder="Поиск: имя, @username или ID" value="${esc(playersQuery)}" autocomplete="off">
    <div class="muted small" style="margin:8px 4px">Сначала те, кто заходил недавно (до 50)</div>
    <div id="adm-players-list">${list}</div>`);
}

async function openPlayer(id) {
  const data = await adminFetch(`/admin/player?id=${id}`);
  if (!data) return;
  admTarget = { ...data.player, state: data.state, sub: data.sub, refs: data.refs };
  haptic.tap();
  showAdmin();
}

// «А777АА 77», «а777аа77», латиница A/B/E/K/M/H/O/P/C/T/Y/X — в ключ номера 'А777АА|77'
function parsePlateInput(raw) {
  const lat = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  const t = String(raw || '').toUpperCase().replace(/[ABEKMHOPCTYX]/g, c => lat[c]).replace(/[\s|]/g, '');
  const m = /^([АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2})(\d{2,3})$/.exec(t);
  const key = m && `${m[1]}|${m[2]}`;
  return key && Rules.plateParse(key) ? key : null;
}

// ---------- приглашения ----------
async function showReferrals() {
  const data = await adminFetch('/admin/referrals');
  if (!data) return;
  const top = data.top.map((r, i) => `<button class="list-row" data-act="adm-open" data-id="${r.id}">
      <div class="rt-place">${i + 1}</div>
      <div class="info"><div class="t">${esc(r.name) || 'ID ' + r.id}</div><div class="sub">ID ${r.id}</div></div>
      <div class="r"><b>${r.n}</b>${CHEVRON_R}</div></button>`).join('');
  const recent = data.recent.map(r => `<button class="list-row" data-act="adm-open" data-id="${r.friend_id}">
      <div class="info"><div class="t">${esc(r.friend) || r.friend_id}</div><div class="sub">от ${esc(r.inviter) || r.ref_id} · ${ago(r.at)}</div></div>
      <div class="r">${CHEVRON_R}</div></button>`).join('');
  openSheet(`${sheetNav('Приглашения', { act: 'adm-back', label: 'Админка' })}
    <div class="admin-stats" style="margin-bottom:12px"><div><b>${data.total}</b><span>всего приглашено</span></div><div><b>${data.top.length}</b><span>пригласивших</span></div></div>
    <div class="section-h">Кто больше всех привёл</div>
    ${top ? `<div class="list">${top}</div>` : '<div class="card" style="text-align:center"><span class="muted">Пока никто никого не пригласил</span></div>'}
    <div class="section-h">Последние приглашённые</div>
    ${recent ? `<div class="list">${recent}</div>` : ''}`);
}

// ---------- техработы ----------
let serverMaint = null;   // что сервер сказал о техработах (приходит админу при загрузке)
async function saveMaint(on) {
  const text = $('#adm-maint-text')?.value ?? serverMaint?.text ?? '';
  const data = await adminFetch('/admin/maintenance', { on, text });
  if (!data) return;
  serverMaint = data.maintenance;
  haptic.ok();
  toast(on ? 'Техработы включены — игроки видят заглушку' : 'Техработы выключены');
  showAdmin();
}

// ---------- админ-команда: себе — через api(), игроку — через админ-раздел сервера ----------
async function adm(op, params, msg) {
  if (op.startsWith('plate') && MODE === 'server' && !admTarget) {
    const data = await adminFetch('/admin/player-action', { id: tgUser()?.id || ADMIN_IDS[0], op, ...params });
    if (!data) return false;
    state = Rules.migrate(data.state);
    haptic.ok();
    if (msg) toast(typeof msg === 'function' ? msg(data.result) : msg);
    return true;
  }
  if (admTarget) {
    const data = await adminFetch('/admin/player-action', { id: admTarget.id, op, ...params });
    if (!data) return false;
    admTarget.state = Rules.migrate(data.state);
    if (typeof msg === 'function') msg = msg(data.result);
  } else {
    const r = await api('admin', { op, ...params });
    if (!r) return false;
    updateBalance(true);
    if (typeof msg === 'function') msg = msg(r);
  }
  haptic.ok();
  if (msg) toast(msg);
  return true;
}

document.addEventListener('input', e => {
  if (e.target.id !== 'adm-search') return;
  playersQuery = e.target.value.trim();
  clearTimeout(playersTimer);
  playersTimer = setTimeout(() => showPlayers(true), 350);
});

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act^="adm-"]');
  if (!el || el.disabled || !isAdmin()) return;
  const act = el.dataset.act;
  const val = id => document.getElementById(id)?.value;
  let ok = false;

  if (act === 'adm-players') { haptic.tap(); admTarget = null; showPlayers(); return; }
  if (act === 'adm-refs') { haptic.tap(); admTarget = null; showReferrals(); return; }
  if (act === 'adm-open') { openPlayer(el.dataset.id); return; }
  if (act === 'adm-me' || act === 'adm-back') { admTarget = null; showAdmin(); return; }
  if (act === 'adm-maint-toggle') { saveMaint(!serverMaint?.on); return; }
  if (act === 'adm-maint-save') { saveMaint(!!serverMaint?.on); return; }
  if (act === 'adm-stories') { closeSheet(); setTimeout(() => showStories(), 350); return; }
  if (act === 'adm-whatsnew') {
    closeSheet();
    setTimeout(async () => { const a = await showStories(WHATSNEW_NEW, WHATSNEW_KEY); if (a === 'friends') { switchTab('menu', 'friends'); loadFriends(); } if (a === 'plates') switchTab('menu', 'plates'); }, 350);
    return;
  }
  if (act === 'adm-bot-setup') {
    const data = await adminFetch('/admin/bot-setup', {});
    if (!data) return;
    const bad = data.report.filter(r => !r.ok);
    if (bad.length) { haptic.err(); toast(bad.map(r => `${r.name}: ${r.error}`).join(' · ')); }
    else { haptic.ok(); toast('Бот настроен ✓'); }
    return;
  }

  if (act === 'adm-money') ok = await adm('money', { add: +el.dataset.v }, `+${money(+el.dataset.v)}`);
  else if (act === 'adm-money-zero') ok = await adm('money', { set: 0 }, 'Баланс обнулён');
  else if (act === 'adm-money-set') {
    const v = Math.max(0, Math.floor(+val('adm-sum') || 0));
    ok = await adm('money', { set: v }, `Баланс: ${money(v)}`);
  }
  else if (act === 'adm-car') ok = await adm('car', { carId: val('adm-car') }, `Выдано: ${CAR_BY_ID[val('adm-car')].name}`);
  else if (act === 'adm-collection') ok = await adm('collection', {}, 'Коллекция открыта');
  else if (act === 'adm-slots') ok = await adm('slots', {}, 'Мест в гараже +5');
  else if (act === 'adm-part') ok = await adm('part', { slot: val('adm-slot'), t: val('adm-tier'), n: +el.dataset.n }, `+${el.dataset.n} · ${partName(val('adm-slot'), val('adm-tier'))}`);
  else if (act === 'adm-parts-all') ok = await adm('partsAll', {}, 'Комплект Elite на склад');
  else if (act === 'adm-fuel') ok = await adm('fuel', {}, 'Бак заправлен');
  else if (act === 'adm-cd') ok = await adm('cooldowns', {}, 'Перерывы деталей и кейсов сброшены');
  else if (act === 'adm-rcase') ok = await adm('rewardCase', {}, 'Кейс наград доступен');
  else if (act === 'adm-daily') ok = await adm('daily', {}, 'Бонус дня снова доступен');
  else if (act === 'adm-day') ok = await adm('day', { d: +val('adm-day') }, `Следующий бонус — день ${val('adm-day')}`);
  else if (act === 'adm-income') ok = await adm('income', {}, 'Доход гаража накоплен');
  else if (act === 'adm-xp') ok = await adm('xp', { n: 500 }, '+500 опыта');
  else if (act === 'adm-plate-give') {
    const key = parsePlateInput(val('adm-plate'));
    if (!key) { haptic.err(); toast('Формат: А777АА 77 (буквы АВЕКМНОРСТУХ, регион из списка)'); return; }
    ok = await adm('plateGive', { plate: key }, `Выдан номер ${key.replace('|', ' ')}`);
  }
  else if (act === 'adm-plate-rand') ok = await adm('plateRandom', { r: val('adm-plate-r') }, r => `Выдан номер ${r.plate.replace('|', ' ')}`);
  else if (act === 'adm-plate-take') ok = await adm('plateTake', { plate: el.dataset.plate }, 'Номер забран');
  else if (act === 'adm-export') {
    const text = JSON.stringify(admState());
    try { await navigator.clipboard.writeText(text); toast('Сохранение скопировано'); }
    catch { $('#adm-json').value = text; toast('Скопируй текст из поля'); }
    haptic.ok();
  }
  else if (act === 'adm-import') {
    try { ok = await loadSave(await navigator.clipboard.readText()); }
    catch { haptic.err(); toast('Нет доступа к буферу — вставь в поле'); }
  }
  else if (act === 'adm-import-text') ok = await loadSave(val('adm-json'));
  else if (act === 'adm-reset') {
    if (await adm('reset', {}, 'Прогресс сброшен')) {
      if (admTarget) { showAdmin(); return; }
      caseView.car = { phase: 'idle' }; caseView.part = { phase: 'idle' };
      closeSheet();
      tab = 'cases';
      render(true);
    }
    return;
  }
  if (ok) showAdmin();
});

async function loadSave(text) {
  let data;
  try {
    data = JSON.parse(text);
    if (!data || typeof data.money !== 'number' || !Array.isArray(data.cars)) throw 0;
  } catch {
    haptic.err();
    toast('Не похоже на сохранение игры');
    return false;
  }
  const ok = await adm('load', { state: data }, 'Сохранение загружено');
  if (ok && !admTarget) render();
  return ok;
}
