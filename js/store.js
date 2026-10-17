// ===== Магазин: Меню → «Магазин» (Telegram Stars) =====
// Пока только в браузерной тестовой версии (NEXT_LOCAL_ONLY): оплата звёздами имитируется.

const nextOn = () => Rules.nextActive();
// в Telegram до релиза продаётся только то, что в SHOP_LIVE (за настоящие звёзды)
const storeLive = () => MODE === 'server' && SHOP_LIVE.length > 0;
let storeFx = '';   // показ купленного над витриной

const star = (n, size = 15) => `${emo('⭐', size)}<b>${n}</b>`;
const vipOn = () => Rules.vipOn(state, now());
const dateRu = ts => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const baseRate = () => Rules.packMoney(SHOP.packs[0]) / SHOP.packs[0].stars;   // ₽ за звезду в самом маленьком пакете

// магазин в Telegram до релиза: только товары из SHOP_LIVE
function renderStoreLive() {
  const packs = SHOP.packs.filter(p => SHOP_LIVE.includes(p.id)).map((p, i) => `<button class="st-pack st-live" data-act="store-buy" data-item="${p.id}" style="--i:${i}">
      <span class="st-pack-ic">${emo('💵', 44)}</span>
      <span class="st-pack-m">${money(Rules.packMoney(p))}</span>
      <span class="st-price">${star(p.stars, 17)}</span>
    </button>`).join('');
  return `<div id="store-fx">${storeFx}</div>
    <div class="section-h"><span>Рубли</span><span>оплата звёздами Telegram</span></div>
    <div class="st-live-wrap">${packs}</div>
    <div class="muted small" style="margin:14px 6px;text-align:center">Деньги придут сразу после оплаты. Вопросы по оплате — /paysupport в боте или ${esc(SUPPORT.url.replace('https://t.me/', '@'))}</div>`;
}

function renderStore() {
  if (!nextOn()) return renderStoreLive();
  const st = SHOP.starter;
  const starter = state.starterPack ? '' : `
    <div class="st-hero">
      <div class="st-hero-tag">Один раз</div>
      <div class="st-hero-t">Стартовый набор</div>
      <div class="st-hero-items">
        <span>${emo('💰', 20)} ${money(st.money)}</span>
        <span>${emo('🏙️', 20)} ${st.cars.n} кейса «${R_CASE_NAME(st.cars.case)}»</span>
        <span>${emo('🅿️', 20)} +${st.slots} места в гараже</span>
        <span>${emo('👑', 20)} VIP на ${st.vipDays} дней</span>
      </div>
      <button class="btn st-buy gold" data-act="store-buy" data-item="starter" data-confirm="Купить за ${st.stars} ⭐?">${star(st.stars, 17)}</button>
    </div>`;

  const on = vipOn();
  const vip = `
    <div class="vip-card${on ? ' on' : ''}">
      <div class="vip-top">${emo('👑', 30)}<div><div class="vip-t">VIP</div>
        <div class="vip-sub">${on ? `активен до ${dateRu(state.vipUntil)}` : `${SHOP.vip.days} дней`}</div></div></div>
      <div class="vip-perks">
        <div>${emo('⛽', 18)} Топливо восстанавливается в ${VIP.fuelK} раза быстрее</div>
        <div>${emo('❄️', 18)} Детали остывают в ${Math.round(1 / VIP.cdK)} раза быстрее, кейсы деталей — чаще</div>
        <div>${emo('🎁', 18)} Подарок каждый день — ${money(VIP.daily)}</div>
        <div>${emo('🚘', 18)} +${VIP.plates} номеров в запасе</div>
        <div>${emo('💰', 18)} Доход гаража копится ${VIP.offlineH} ч вместо ${OFFLINE_MAX_MS / 3600e3}</div>
        <div>${emo('👑', 18)} Золотой значок в профиле</div>
      </div>
      ${on && Rules.vipDailyReady(state, now()) ? `<button class="btn gold" data-act="vip-daily">Забрать подарок · ${money(VIP.daily)}</button>` : ''}
      ${on && !Rules.vipDailyReady(state, now()) ? `<div class="vip-note">Подарок получен — следующий завтра</div>` : ''}
      <button class="btn ${on ? 'gray' : 'gold'}" data-act="store-buy" data-item="vip" data-confirm="Купить VIP за ${SHOP.vip.stars} ⭐?">
        ${on ? 'Продлить на ' + SHOP.vip.days + ' дней · ' : ''}${star(SHOP.vip.stars, 17)}</button>
    </div>`;

  const packs = SHOP.packs.map((p, i) => {
    const bonus = Math.round((Rules.packMoney(p) / p.stars / baseRate() - 1) * 100);
    return `<button class="st-pack" data-act="store-buy" data-item="${p.id}" data-confirm="Купить за ${p.stars} ⭐?" style="--i:${i}">
      ${bonus > 0 ? `<span class="st-bonus">+${bonus}%</span>` : ''}
      <span class="st-pack-ic">${emo(i < 2 ? '💵' : i < 4 ? '💰' : '🏦', 34)}</span>
      <span class="st-pack-m">${money(Rules.packMoney(p))}</span>
      <span class="st-price">${star(p.stars)}</span>
    </button>`;
  }).join('');

  const fullGarage = state.slots >= GARAGE.maxSlots;
  const fullPlates = (state.plateSlots || 0) >= PLATE_STORE.max;
  const extra = [
    ['refuel', '⛽', 'Заправить все баки', 'Общий бак и баки всех машин', SHOP.refuel],
    ['cool', '❄️', 'Охладить детали', 'Снятые детали и слоты — сразу готовы', SHOP.cool],
    ['slot', '🅿️', '+1 место в гараже', fullGarage ? 'Гараж максимального размера' : `Сейчас мест: ${state.slots}`, SHOP.slot],
    ['plateSlot', '🚘', '+1 место для номера', fullPlates ? 'Мест для номеров максимум' : `В запасе: ${Rules.plateStoreCap(state, now())} мест · остаются навсегда`, SHOP.plateSlot],
  ].map(([id, ic, t, sub, stars]) => `<div class="list-row static">
      <div class="ic">${emo(ic, 26)}</div>
      <div class="info"><div class="t">${t}</div><div class="sub">${sub}</div></div>
      <button class="pill st-pill" data-act="store-buy" data-item="${id}" data-confirm="За ${stars} ⭐?" ${(id === 'slot' && fullGarage) || (id === 'plateSlot' && fullPlates) ? 'disabled' : ''}>${star(stars, 14)}</button>
    </div>`).join('');

  const passCard = Rules.passOn() ? `<button class="list-row st-pass" data-act="pass-open">
      <div class="ic">${emo('🎟️', 26)}</div>
      <div class="info"><div class="t">Сезонный пропуск</div><div class="sub">${Rules.passPremOn(state, now()) ? 'Премиум активен' : `Премиум — ${PASS.stars} ⭐ · награды за уровни, секретная машина`}</div></div>
      <div class="r">${CHEVRON_R}</div></button>` : '';
  const bal = state.stars || 0;
  return `<div class="st-balance">${emo('⭐', 20)} <span>Звёзды на счету</span><b>${bal}</b></div>
    ${bal ? '<div class="muted small" style="margin:-6px 4px 12px">Хватает на покупку — оплатится звёздами со счёта (призы сезона)</div>' : ''}
    <div id="store-fx">${storeFx}</div>
    ${starter}
    ${passCard ? `<div class="list" style="margin-bottom:14px">${passCard}</div>` : ''}
    ${vip}
    <div class="section-h"><span>Рубли</span><span>чем больше — тем выгоднее</span></div>
    <div class="st-packs">${packs}</div>
    <div class="section-h"><span>Удобства</span></div>
    <div class="list">${extra}</div>
    <div class="muted small" style="margin:14px 16px">${MODE === 'local' ? 'Тестовая версия: звёзды не списываются, покупка выдаётся сразу.'
      : `Покупка придёт сразу после оплаты. Вопросы по оплате — /paysupport в боте или ${esc(SUPPORT.url.replace('https://t.me/', '@'))}`}</div>`;
}
const R_CASE_NAME = id => (CASES.find(c => c.id === id) || {}).name || id;

// оплата настоящими звёздами: ссылка от сервера → окно оплаты Telegram → начисляет сервер (бот получает платёж)
async function payStars(item) {
  if (busy) return;
  if (!tg?.openInvoice) { toast('Обнови Telegram, чтобы платить звёздами'); return; }
  busy = true;
  let link;
  try {
    const res = await fetch(API + '/invoice', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ item }) });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    link = d.link;
  } catch (e) { busy = false; haptic.err(); toast(e.message || 'Нет связи с сервером'); return; }
  busy = false;
  haptic.tap();
  tg.openInvoice(link, status => {
    if (status === 'paid') { haptic.ok(); toast('Оплата прошла — начисляем…'); waitPurchase(); }
    else if (status === 'failed') { haptic.err(); toast('Оплата не прошла'); }
  });
}
// ждём, пока бот получит платёж и сервер начислит покупку (обычно 1–3 секунды)
async function waitPurchase() {
  const before = (state.notices || []).length;
  for (let i = 0; i < 10; i++) {
    await wait(1500);
    try {
      const data = await (await fetch(API + '/state', { headers: authHeaders() })).json();
      if (!data.state) continue;
      if ((data.state.notices || []).length > before) {
        if (busy || spinning) return;
        state = Rules.migrate(data.state);
        updateBalance(true);
        updateIsland();
        rerenderStore();
        if (tab === 'cases' && !spinning) render();   // оплатил временный кейс — появилась «Прокрутить бесплатно»
        return;
      }
    } catch {}
  }
  toast('Покупка придёт через минуту — если нет, напиши в поддержку');
}

// звёзд на счету хватает — спрашиваем: списать со счёта или оплатить в Telegram (иначе — сразу оплата)
let starChoiceCb = null;
function starChoice(stars, title, onBalance, onPay) {
  if ((state.stars || 0) < stars) return onPay();
  starChoiceCb = { onBalance, onPay };
  haptic.tap();
  openSheet(`${sheetNav(title)}
    <div class="st-balance" style="margin-top:4px">${emo('⭐', 20)} <span>Звёзды на счету</span><b>${state.stars}</b></div>
    <button class="btn gold" data-act="sc-bal">Списать со счёта · ${emo('⭐', 16)} ${stars}</button>
    <button class="btn gray" style="margin-top:10px" data-act="sc-pay">${MODE === 'server' ? 'Оплатить в Telegram' : 'Оплатить (тест)'} · ${emo('⭐', 16)} ${stars}</button>`);
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act="sc-bal"], [data-act="sc-pay"]');
  if (!el || !starChoiceCb) return;
  const cb = starChoiceCb; starChoiceCb = null;
  closeSheet();
  el.dataset.act === 'sc-bal' ? cb.onBalance() : cb.onPay();
});
const shopName = item => ({ refuel: 'Заправить все баки', cool: 'Охладить детали', slot: '+1 место в гараже', plateSlot: '+1 место для номера',
  vip: 'VIP', starter: 'Стартовый набор', pass: 'Сезонный пропуск' })[item] || (SHOP.packs.find(p => p.id === item) ? money(Rules.packMoney(SHOP.packs.find(p => p.id === item))) : 'Покупка');

function storeBuy(item) {
  starChoice(Rules.shopStars(item), shopName(item), () => storeBuyDo(item, true), () => MODE === 'server' ? payStars(item) : storeBuyDo(item, false));
}
async function storeBuyDo(item, useStars) {
  if (busy) return;
  busy = true;
  const r = await api('shopBuy', { item, useStars });
  busy = false;
  if (!r) return;
  haptic.ok();
  updateBalance(true);
  if (r.items) storeFx = rewardFx(withDefs(r.items), item === 'starter' ? 'Стартовый набор' : 'Покупка');
  else storeFx = '';
  if (r.vip) toast(`VIP активен до ${dateRu(state.vipUntil)}`);
  if (r.cool) toast('Все детали остыли');
  if (r.plateSlot) toast(`+1 место для номера · в запасе теперь ${Rules.plateStoreCap(state, now())}`);
  rerenderStore(true);
}

function rerenderStore(top) {
  if (tab !== 'menu' || menuView !== 'store') return;
  $('#menu-body').innerHTML = renderStore();
  if (top) window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act="store-buy"], [data-act="vip-daily"]');
  if (!el || el.disabled) return;
  if (el.dataset.act === 'store-buy') return storeBuy(el.dataset.item);
  if (busy) return;
  busy = true;
  const r = await api('vipDaily');
  busy = false;
  if (!r) return;
  haptic.tap();
  updateBalance(true);
  storeFx = rewardFx(r.items, 'Подарок VIP');
  rerenderStore(true);
});
