// ===== DROPZONE: AUTO — сервер (Cloudflare Worker + база D1) =====
// Всё, что влияет на прогресс, считается здесь — по тем же правилам, что и в игре (js/rules.js).
//
//   GET  /state   — прогресс игрока (новый игрок создаётся автоматически); без подписки на канал — { subscribe }
//   POST /action  — действие игрока { name, params } → { state, result } или { error, state }
//   GET  /health  — проверка, что сервер жив
//   POST /promo   — активировать промокод { code }
//   GET  /friends — приглашённые друзья и заработанное
//   GET  /plate-check?key= — свободен ли номер
//   GET  /top?type=week|all — рейтинг (топ-100 + моё место), GET /top-player?id= — карточка игрока
//
//   Только для админов (ADMIN_IDS):
//   GET  /admin/players?q=     — список игроков (поиск по имени, @username, ID) + общая статистика
//   GET  /admin/player?id=     — прогресс игрока
//   POST /admin/player-action  — админ-команда над игроком { id, op, ... } (те же, что в админ-панели)
//   POST /admin/maintenance    — техработы { on, text }
//   GET  /admin/promos         — промокоды со статистикой
//   POST /admin/promo-create   — новый промокод { code, maxUses, hours, reward }
//   POST /admin/promo-toggle   — включить/выключить { code, active }
//   POST /admin/promo-delete   — удалить { code }
//   GET  /admin/referrals      — кто сколько пригласил и кого
//   POST /admin/bot-setup      — настроить бота (вебхук, описания, кнопка «Играть»)
//
//   POST /tg-webhook — сообщения боту от Telegram (проверяется секрет вебхука)
//   POST /tg-admin-webhook — сообщения админ-боту (кнопка «Открыть админку»)
//   Админ-приложение (admin.html) открывается из админ-бота: подпись проверяется токеном ADMIN_BOT_TOKEN
//
// Игрок определяется по подписи Telegram (initData) — подделать чужой аккаунт нельзя.
import '../../js/data.js';
import '../../js/rules.js';
import { handleWebhook, setupBot, isSubscribed, CHANNEL_URL, notifyReferral, subStatus, notifyWeekPrize,
  handleAdminWebhook, setupAdminBot, sendBroadcast, notifySeasonPrize, postSeasonTop, tg, notifyPurchase, CHANNEL, notifyReferralPaid } from './bot.js';

const Rules = globalThis.Rules;
const ALLOWED_ORIGINS = ['https://xuia-car.pozzistory666.workers.dev/', 'http://localhost:5173'];
const INIT_DATA_TTL = 48 * 3600;   // подпись Telegram действительна 48 часов

export default {
  // по расписанию (wrangler.toml → triggers): недельные призы рейтинга
  async scheduled(event, env, ctx) {
    await loadEcases(env);
    // раз в час — проверка нагрузки (предупреждение владельцу), раз в неделю — призы рейтинга
    if (event.cron === USAGE_CRON) ctx.waitUntil(Promise.all([usageAlerts(env), seasonPrizes(env),
      env.DB.prepare('DELETE FROM duels WHERE at < ?').bind(Date.now() - 2 * 86400e3).run().catch(() => {}),
      mkFinalizeDue(env, 50).catch(e => console.error(e)),
      contFinalizeDue(env).catch(e => console.error(e)),
      env.DB.prepare("DELETE FROM market WHERE status != 'open' AND until < ?").bind(Date.now() - 7 * 86400e3).run().catch(() => {})]));
    else ctx.waitUntil(weeklyPrizes(env));
  },

  async fetch(request, env, ectx) {
    // только локальная проверка (npm run dev с --var NEXT:1): сервер работает как после релиза
    if (env.DEV === '1' && env.NEXT === '1') globalThis.NEXT_LOCAL_ON = true;
    await loadEcases(env);
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Init-Data, X-Dev-User',
      // браузер запоминает разрешение и не шлёт служебный OPTIONS перед каждым действием (было ~40% всех запросов)
      'Access-Control-Max-Age': '7200',
      'Vary': 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') {
        await ensureAdminBot(env, url.origin);
        return json({ ok: true, now: Date.now() });
      }
      if (url.pathname === '/tg-webhook' && request.method === 'POST') return handleWebhook(request, env, payHandlers(env));
      if (url.pathname === '/tg-admin-webhook' && request.method === 'POST') { await loadTeam(env); return handleAdminWebhook(request, env, isAdminId, { ecase: (id, ok, from) => ecaseDecide(env, id, ok, from) }); }

      const user = await authUser(request, env);
      if (!user) return json({ error: 'Открой игру через Telegram' }, 401);

      if (url.pathname.startsWith('/admin/')) await loadTeam(env);
      const admin = isAdminId(user.id);
      // онлайн: действия и так обновляют updated_at, поэтому «был на связи» отмечаем только при опросе /state
      // (игра открыта, но игрок ничего не делает) и не чаще раза в 2,5 минуты — меньше записей в базу
      if (url.pathname === '/state') {
        if (!slimDone) { const s = slimIndexes(env); if (ectx?.waitUntil) ectx.waitUntil(s); }
        const t = Date.now();
        const touch = env.DB.prepare('UPDATE players SET last_seen = ?1 WHERE id = ?2 AND last_seen < ?3').bind(t, user.id, t - 150e3).run().catch(() => {});
        if (ectx?.waitUntil) ectx.waitUntil(touch); else await touch;
      }
      // техработы: обычные игроки видят экран-заглушку, админы играют как обычно (настройка кэшируется на 15 с)
      const maintenance = await getSettingCached(env, 'maintenance');
      const blocked = maintenance?.on && !admin;

      if (url.pathname === '/state' && request.method === 'GET') {
        if (blocked) return json({ maintenance, now: Date.now() });
        // вход только с подпиской на канал (проверяем при каждом запуске; админы — без проверки)
        if (!admin && !await subOk(env, user)) {
          await rememberRef(env, user);   // пришёл по ссылке, но ещё не подписан — запомним, кто пригласил
          return json({ subscribe: { url: CHANNEL_URL }, now: Date.now() });
        }
        const p = await loadPlayer(env, user);
        const cont = await contCurrent(env, ectx);
        return json({ state: p.state, now: Date.now(), admin, maintenance: admin ? maintenance : null, refFrom: p.refFrom, cont,
          ecases: Rules.nextActive() ? globalThis.EVENT_CASES : undefined });
      }

      if (url.pathname === '/action' && request.method === 'POST') {
        if (blocked) return json({ maintenance, error: 'Идут технические работы', now: Date.now() });
        if (!admin && !await subOk(env, user)) return json({ subscribe: { url: CHANNEL_URL }, error: 'Подпишись на канал игры', now: Date.now() });
        const body = await request.json().catch(() => ({}));
        if (typeof body.name !== 'string') return json({ error: 'Неверный запрос' }, 400);
        if (PLATE_ACTIONS.includes(body.name)) return json(await runPlateAction(env, user, body.name, body.params || {}));
        if (DUEL_ACTIONS.includes(body.name)) return json(await runDuelAction(env, user, body.name, body.params || {}));
        if (MARKET_ACTIONS.includes(body.name)) return json(await runMarketAction(env, user, body.name, body.params || {}));
        if (body.name === 'contBid') return json(await contBid(env, user, body.params || {}));
        return json(await runAction(env, user, body.name, body.params || {}));
      }

      if (url.pathname === '/containers' && request.method === 'GET') return json(await contList(env, user));
      if (url.pathname === '/market' && request.method === 'GET') return json(await marketLots(env, user, url.searchParams));
      if (url.pathname === '/duel/friends' && request.method === 'GET') return json(await duelFriends(env, user));
      if (url.pathname === '/duel/add' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return json(await duelAddFriend(env, user, String(body.code || '')));
      }

      if (url.pathname === '/top' && request.method === 'GET') return json(await topList(env, user, url.searchParams.get('type')));
      if (url.pathname === '/top-player' && request.method === 'GET') return json(await topPlayer(env, Number(url.searchParams.get('id'))));

      if (url.pathname === '/plate-check' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT owner FROM plates WHERE key = ?').bind(url.searchParams.get('key') || '').first();
        return json({ taken: !!row, mine: row?.owner === user.id });
      }

      if (url.pathname === '/friends' && request.method === 'GET') return json(await friendsInfo(env, user));

      if (url.pathname === '/invoice' && request.method === 'POST') {
        if (blocked) return json({ maintenance, error: 'Идут технические работы', now: Date.now() });
        const body = await request.json().catch(() => ({}));
        return json(await createInvoice(env, user, String(body.item || ''), url.origin));
      }

      if (url.pathname === '/promo' && request.method === 'POST') {
        if (blocked) return json({ maintenance, error: 'Идут технические работы', now: Date.now() });
        if (!admin && !await subOk(env, user)) return json({ subscribe: { url: CHANNEL_URL }, error: 'Подпишись на канал игры', now: Date.now() });
        const body = await request.json().catch(() => ({}));
        return json(await redeemPromo(env, user, body.code));
      }

      if (url.pathname.startsWith('/admin/')) {
        if (!admin) return json({ error: 'Нет доступа' }, 403);
        return json(await adminRoute(env, url, request, user));
      }

      return json({ error: 'Не найдено' }, 404);
    } catch (e) {
      console.error(e);
      // закончился суточный лимит записей в базу (бесплатный тариф Cloudflare) — понятное сообщение вместо «нет связи»
      if (/exceeded D1|row write limit/i.test(String(e?.message))) {
        return json({ error: 'Сервер перегружен — прогресс сейчас не сохраняется. Попробуй позже', overloaded: true, now: Date.now() }, 503);
      }
      return json({ error: 'Ошибка сервера' }, 500);
    }
  },
};

// Лишние индексы в players удваивали-утраивали число записей в базу на каждое действие (при ~150 игроках они не нужны:
// рейтинг считается полным проходом мгновенно). Убираем один раз на «экземпляр» сервера; DROP IF EXISTS — безопасно повторять.
let slimDone = false;
async function slimIndexes(env) {
  if (slimDone) return;
  slimDone = true;
  try {
    await env.DB.batch(['players_last_seen', 'players_worth', 'players_week'].map(n => env.DB.prepare(`DROP INDEX IF EXISTS ${n}`)));
  } catch { slimDone = false; }   // база пока не даёт писать — попробуем позже
}

// ---------- игрок ----------
async function loadPlayer(env, user) {
  const row = await env.DB.prepare('SELECT state, ver FROM players WHERE id = ?').bind(user.id).first();
  if (row) return { state: Rules.migrate(JSON.parse(row.state)), ver: row.ver };
  const now = Date.now();
  const state = Rules.newState(now);
  const ref = await findRef(env, user);
  if (ref) { state.money += REFERRAL.friend; state.refPending = true; }   // подарок новичку; пригласившему — когда дойдёт до minLevel
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO players (id, name, username, state, ver, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .bind(user.id, user.first_name || '', user.username || '', JSON.stringify(state), now, now).run();
  const p = await loadPlayer(env, user);
  if (ins.meta.changes === 1 && ref) {
    await creditReferral(env, user, ref, now);
    p.refFrom = ref.name || 'друг';
  }
  return p;
}

// ---------- приглашения ----------
// кто пригласил: из ссылки (start_param = r<ID>) или запомненный раньше
async function findRef(env, user) {
  let refId = refFromParam(user);
  if (!refId) {
    const row = await env.DB.prepare('SELECT ref_id FROM pending_refs WHERE id = ?').bind(user.id).first();
    refId = row?.ref_id;
  }
  if (!refId || refId === user.id) return null;
  return await env.DB.prepare('SELECT id, name FROM players WHERE id = ?').bind(refId).first();
}

const refFromParam = user => {
  const m = /^r(\d{1,15})$/.exec(user.start_param || '');
  return m ? Number(m[1]) : null;
};

async function rememberRef(env, user) {
  const refId = refFromParam(user);
  if (!refId || refId === user.id) return;
  await env.DB.prepare('INSERT OR IGNORE INTO pending_refs (id, ref_id, at) VALUES (?, ?, ?)').bind(user.id, refId, Date.now()).run();
}

async function creditReferral(env, user, ref, now) {
  // друг пришёл: запоминаем приглашение, а деньги пригласившему — когда друг дойдёт до REFERRAL.minLevel (payReferral)
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO referrals (player_id, ref_id, at, paid) VALUES (?, ?, ?, 0)').bind(user.id, ref.id, now).run();
  if (ins.meta.changes !== 1) return;
  await env.DB.prepare('DELETE FROM pending_refs WHERE id = ?').bind(user.id).run();
  await notifyReferral(env, ref.id, user.first_name, REFERRAL.inviter, REFERRAL.minLevel);
}
// друг дошёл до нужного уровня: деньги пригласившему (одной транзакцией с отметкой paid — ровно один раз)
async function payReferral(env, user) {
  const r = await env.DB.prepare('SELECT ref_id FROM referrals WHERE player_id = ? AND paid = 0').bind(user.id).first();
  if (!r) return;
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE players SET state = json_set(state, '$.money', json_extract(state, '$.money') + ?1), ver = ver + 1
      WHERE id = ?2 AND EXISTS (SELECT 1 FROM referrals WHERE player_id = ?3 AND paid = 0)`).bind(REFERRAL.inviter, r.ref_id, user.id),
    env.DB.prepare('UPDATE referrals SET paid = 1 WHERE player_id = ? AND paid = 0').bind(user.id),
  ]);
  if (res[1].meta.changes === 1) await notifyReferralPaid(env, r.ref_id, user.first_name, REFERRAL.inviter, REFERRAL.minLevel);
}

async function friendsInfo(env, user) {
  const list = await env.DB.prepare(
    `SELECT p.name, p.username, r.at, r.paid, json_extract(p.state, '$.level') AS level
     FROM referrals r JOIN players p ON p.id = r.player_id WHERE r.ref_id = ? ORDER BY r.at DESC LIMIT 100`).bind(user.id).all();
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(paid) AS paid FROM referrals WHERE ref_id = ?').bind(user.id).first();
  return { count: cnt.n, earned: (cnt.paid || 0) * REFERRAL.inviter, friends: list.results, link: REFERRAL.link + user.id, minLevel: REFERRAL.minLevel };
}

// выполняем действие; если параллельный запрос успел изменить прогресс — повторяем с новыми данными
async function runAction(env, user, name, params, extra = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = await loadPlayer(env, user);
    const now = Date.now();
    const ctx = { now, rnd: secureRandom, uid: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12), admin: isOwnerId(user.id), ...extra };
    let out;
    try {
      out = Rules.run(p.state, name, params, ctx);
    } catch (e) {
      if (e instanceof Rules.GameError) return { error: e.message, state: p.state, now };
      throw e;
    }
    // приглашённый дошёл до нужного уровня — после сохранения платим пригласившему (отметку снимаем в этом же сохранении)
    const payRef = out.state.refPending && out.state.level >= REFERRAL.minLevel;
    if (payRef) delete out.state.refPending;
    const res = await env.DB.prepare(`UPDATE players SET state = ?, ver = ver + 1, updated_at = ?, name = ?, username = ?, ${STAT_SET} WHERE id = ? AND ver = ?`)
      .bind(JSON.stringify(out.state), now, user.first_name || '', user.username || '', ...statCols(out.state), user.id, p.ver).run();
    if (res.meta.changes === 1) {
      if (payRef) await payReferral(env, user).catch(e => console.error(e));
      return { state: out.state, result: out.result, now };
    }
  }
  return { error: 'Попробуй ещё раз' };
}

// ---------- админ-бот: настроить один раз, когда задан ADMIN_BOT_TOKEN ----------
async function ensureAdminBot(env, origin) {
  if (!env.ADMIN_BOT_TOKEN) return;
  const tag = (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.ADMIN_BOT_TOKEN)));
  const id = [...new Uint8Array(tag)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  const done = await getSetting(env, 'admin_bot');
  if (done?.id === id && done.ok && done.v === 2) return;   // v2 — бот принимает нажатия кнопок (подтверждение кейсов)
  const r = await setupAdminBot(env, origin);
  await setSetting(env, 'admin_bot', { id, ok: r.ok, error: r.error || null, at: Date.now(), v: 2 });
}

// ---------- рейтинг ----------
// колонки для быстрой сортировки: стоимость гаража и прирост за неделю (считаются из прогресса при сохранении)
const STAT_SET = 'worth = ?, week_key = ?, week_gain = ?';
const statCols = st => [Rules.garageWorth(st), st.week?.key || '', Rules.weekGain(st)];
const notAdmins = () => `id NOT IN (${(globalThis.ADMIN_IDS || []).map(Number).join(',') || 0})`;

async function topList(env, user, type) {
  const now = Date.now();
  const week = type === 'week', season = type === 'season';
  const wk = Rules.weekKey(now);
  const col = week ? 'week_gain' : 'worth';
  // сезон: стоимость гаража тех, кто уже в текущем сезоне
  const where = `${notAdmins()} AND ${col} > 0${week ? ' AND week_key = ?1' : season ? ' AND json_extract(state, \'$.season\') = ?1' : ''}`;
  const binds = week ? [wk] : season ? [Rules.seasonId(now)] : [];
  const list = await env.DB.prepare(`SELECT id, name, ${col} AS value FROM players WHERE ${where} ORDER BY ${col} DESC, id LIMIT 100`).bind(...binds).all();
  const meRow = await env.DB.prepare(`SELECT ${col} AS value, week_key FROM players WHERE id = ?`).bind(user.id).first();
  let me = null;
  if (isAdminId(user.id)) me = { admin: true };
  else if (meRow) {
    const value = week && meRow.week_key !== wk ? 0 : meRow.value || 0;
    const above = value > 0
      ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${where} AND ${col} > ${week ? '?2' : '?1'}`).bind(...binds, value).first()
      : null;
    me = { value, place: above ? above.n + 1 : null };
  }
  const winners = (await getSetting(env, 'week_winners'))?.ids || [];
  return { list: list.results.map(r => ({ ...r, medal: winners.indexOf(r.id) })), me, weekKey: wk,
    msLeft: season ? Rules.msToSeasonEnd(now) : Rules.msToWeekEnd(now), season: season ? Rules.seasonId(now) : undefined, now };
}

async function topPlayer(env, id) {
  const row = await env.DB.prepare('SELECT name, worth, state FROM players WHERE id = ?').bind(id).first();
  if (!row) return { error: 'Игрок не найден' };
  const st = Rules.migrate(JSON.parse(row.state));
  const cars = [...st.cars, ...st.museum].sort((a, b) => Rules.carValue(b) - Rules.carValue(a));
  const best = cars[0] ? { id: cars[0].id, plate: cars[0].plate || null, value: Rules.carValue(cars[0]) } : null;
  const showcase = st.museum.map(c => ({ id: c.id, plate: c.plate || null, hp: Rules.carHp(c), value: Rules.carValue(c) }));
  const hall = (st.hall || []).map(c => ({ id: c.id, season: c.season, paint: c.paint || null }));   // Витрина славы
  return { name: row.name, worth: row.worth, cars: st.cars.length + st.museum.length, collection: st.discovered.length, best, showcase, slots: st.museumSlots, hall };
}

// недельные призы: в ночь на понедельник (Москва) топ-10 прошлой недели получают деньги и сообщение от бота
async function weeklyPrizes(env) {
  if (!globalThis.RATING_LIVE) return;
  const prevKey = Rules.weekKey(Date.now() - 86400e3);
  if ((await getSetting(env, 'week_paid'))?.key === prevKey) return;   // уже выдавали
  const top = await env.DB.prepare(`SELECT id, name, week_gain FROM players WHERE ${notAdmins()} AND week_key = ? AND week_gain > 0
    ORDER BY week_gain DESC, id LIMIT ?`).bind(prevKey, WEEK_PRIZES.length).all();
  await setSetting(env, 'week_paid', { key: prevKey, at: Date.now() });
  for (const [i, p] of top.results.entries()) {
    const prize = WEEK_PRIZES[i];
    await env.DB.prepare(`UPDATE players SET state = json_set(state, '$.money', json_extract(state, '$.money') + ?), ver = ver + 1 WHERE id = ?`)
      .bind(prize, p.id).run();
    await notifyWeekPrize(env, p.id, i + 1, prize);
  }
  await setSetting(env, 'week_winners', { key: prevKey, ids: top.results.slice(0, 3).map(p => p.id) });
}

// ---------- оплата Telegram Stars ----------
// Игра просит ссылку (/invoice) → окно оплаты Telegram → бот получает pre_checkout_query (проверяем) и successful_payment
// (начисляем ровно один раз: payments.charge_id). Сам товар выдаёт Rules.shopBuy с ctx.paid — подделать из игры нельзя.
const shopItemOk = item => SHOP_LIVE.includes(item) || (Rules.nextActive() && Rules.shopStars(item) > 0);
const shopTitle = item => {
  const pk = SHOP.packs.find(x => x.id === item);
  const mln = pk && String(Rules.packMoney(pk) / 1e6).replace('.', ',');
  if (pk) return [`${mln} млн ₽`, `${mln} млн игровых рублей в DROPZONE: AUTO`];
  return [{ refuel: 'Заправить все баки', cool: 'Охладить детали', slot: '+1 место в гараже', plateSlot: '+1 место для номера',
    vip: `VIP на ${SHOP.vip.days} дней`, starter: 'Стартовый набор', pass: 'Сезонный пропуск' }[item]
    || (item.startsWith('ev:') && `Кейс «${Rules.caseById(item.slice(3))?.name || 'временный'}»`) || item, 'Покупка в DROPZONE: AUTO'];
};
// пробная покупка на копии прогресса: если товар не выдастся (набор уже куплен, гараж полный…) — не берём звёзды
function shopDryRun(stateJson, item) {
  try {
    Rules.run(Rules.migrate(JSON.parse(stateJson)), 'shopBuy', { item }, { now: Date.now(), rnd: secureRandom, uid: () => 'dry', paid: true });
    return null;
  } catch (e) { return e instanceof Rules.GameError ? e.message : 'Покупка сейчас недоступна'; }
}
async function createInvoice(env, user, item, origin) {
  if (!shopItemOk(item)) return { error: 'Этот товар пока недоступен' };
  const row = await env.DB.prepare('SELECT state FROM players WHERE id = ?').bind(user.id).first();
  if (!row) return { error: 'Сначала зайди в игру' };
  const why = shopDryRun(row.state, item);
  if (why) return { error: why };
  // вебхук бота должен принимать оплату — один раз перенастраиваем бота
  if (!(await getSettingCached(env, 'pay_hook', 60e3))?.v) {
    const r = await setupBot(env, origin);
    if (r.report?.[0]?.ok) await setSetting(env, 'pay_hook', { v: 1, at: Date.now() });
  }
  const [title, description] = shopTitle(item);
  const r = await tg(env, 'createInvoiceLink', {
    title, description, payload: JSON.stringify({ u: user.id, i: item }), currency: 'XTR',
    prices: [{ label: title, amount: Rules.shopStars(item) }],
  });
  if (!r.ok) { console.error(r); return { error: 'Не удалось создать оплату' }; }
  return { link: r.result };
}
function payHandlers(env) {
  const parse = s => { try { return JSON.parse(s); } catch { return null; } };
  return {
    // перед списанием: товар есть, цена та же, платит тот же игрок
    async check(q) {
      const pl = parse(q.invoice_payload);
      if (!pl || pl.u !== q.from.id || !shopItemOk(pl.i)) return 'Товар недоступен';
      if (q.currency !== 'XTR' || q.total_amount !== Rules.shopStars(pl.i)) return 'Цена изменилась — открой магазин заново';
      const row = await env.DB.prepare('SELECT state FROM players WHERE id = ?').bind(q.from.id).first();
      if (!row) return 'Сначала зайди в игру';
      return shopDryRun(row.state, pl.i);
    },
    async paid(from, sp) {
      const pl = parse(sp.invoice_payload) || {};
      const uid = from?.id;
      const ins = await env.DB.prepare('INSERT OR IGNORE INTO payments (charge_id, user_id, item, stars, at) VALUES (?, ?, ?, ?, ?)')
        .bind(sp.telegram_payment_charge_id, uid, String(pl.i), sp.total_amount, Date.now()).run();
      if (ins.meta.changes !== 1) return;   // этот платёж уже засчитан
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await env.DB.prepare('SELECT state, ver FROM players WHERE id = ?').bind(uid).first();
        if (!row) break;
        const now = Date.now();
        const ctx = { now, rnd: secureRandom, uid: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12), paid: true };
        let out;
        try { out = Rules.run(Rules.migrate(JSON.parse(row.state)), 'shopBuy', { item: pl.i }, ctx); }
        catch (e) { console.error('pay grant', uid, pl.i, e?.message); break; }
        // уведомление в игре (островок сверху)
        const pk = SHOP.packs.find(x => x.id === pl.i);
        out.state.notices = [...(out.state.notices || []), pk
          ? { id: ctx.uid(), kind: 'money', amount: Rules.packMoney(pk), title: `Покупка: +${shopTitle(pl.i)[0]}`, at: now }
          : { id: ctx.uid(), kind: 'buy', title: `Покупка: ${shopTitle(pl.i)[0]}`, at: now }];
        const res = await env.DB.prepare(`UPDATE players SET state = ?, ver = ver + 1, ${STAT_SET} WHERE id = ? AND ver = ?`)
          .bind(JSON.stringify(out.state), ...statCols(out.state), uid, row.ver).run();
        if (res.meta.changes === 1) {
          await env.DB.prepare('UPDATE payments SET done = 1 WHERE charge_id = ?').bind(sp.telegram_payment_charge_id).run();
          await notifyPurchase(env, uid, `⭐ Спасибо за покупку!\n\n<b>${shopTitle(pl.i)[0]}</b> уже в игре 👇`);
          return;
        }
      }
      console.error('pay not granted', sp.telegram_payment_charge_id);   // done = 0 — видно в базе, можно вернуть звёзды
    },
  };
}

// ---------- сезоны: итоги прошлого сезона (проверка раз в час) ----------
// Места — по стоимости гаража на конец сезона: у тех, кто ещё не заходил — worth, у зашедших — state.lastSeason.worth.
// Приз кладётся в state.prizeQueue и выдаётся игроку при первом действии (Rules.run). Номера в новом сезоне — заново.
async function seasonPrizes(env) {
  if (!Rules.nextActive()) return;
  const now = Date.now();
  const prev = Rules.seasonId(now) - 1;
  if (prev < 1) return;
  if (((await getSetting(env, 'season_paid'))?.id || 0) >= prev) return;
  await setSetting(env, 'season_paid', { id: prev, at: now });
  const top = await env.DB.prepare(`SELECT id, name, v FROM (SELECT id, name, CASE
      WHEN json_extract(state, '$.season') = ?1 THEN worth
      WHEN json_extract(state, '$.lastSeason.id') = ?1 THEN json_extract(state, '$.lastSeason.worth')
      ELSE 0 END AS v FROM players WHERE ${notAdmins()}) WHERE v > 0 ORDER BY v DESC, id LIMIT 100`).bind(prev).all();
  await env.DB.prepare('DELETE FROM plates').run();
  for (const [i, p] of top.results.entries()) {
    const place = i + 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await env.DB.prepare('SELECT state, ver FROM players WHERE id = ?').bind(p.id).first();
      if (!row) break;
      const st = JSON.parse(row.state);
      st.prizeQueue = [...(st.prizeQueue || []), { season: prev, place }];
      const r = await env.DB.prepare('UPDATE players SET state = ?, ver = ver + 1 WHERE id = ? AND ver = ?').bind(JSON.stringify(st), p.id, row.ver).run();
      if (r.meta.changes === 1) break;
    }
    await notifySeasonPrize(env, p.id, prev, place, Rules.seasonPrize(place));
  }
  await postSeasonTop(env, prev, top.results.slice(0, 10));
}

// ---------- гонки с друзьями ----------
// Гонка живёт в прогрессе обоих (S.duel у каждого, S.duelIn — входящий вызов), а заезды — ещё и в таблице duels:
// сопернику чужой заезд попадает в прогресс только после его собственного (время соперника скрыто).
// Друзья: пригласил / пригласили (referrals) + добавленные по коду DZ-… (friends, обе стороны). «В сети» — был на связи 4 мин.
const DUEL_ACTIONS = ['duelCreate', 'duelTake', 'duelRun', 'duelCancel', 'duelDecline'];
const DUEL_ONLINE_MS = 4 * 60e3;
const friendCode = id => 'DZ-' + Number(id).toString(36).toUpperCase();
const duelCtx = now => ({ now, rnd: secureRandom, uid: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12) });
const money = n => n >= 1e6 ? `${+(n / 1e6).toFixed(2)} млн ₽`.replace('.', ',') : `${Math.round(n / 1e3)} тыс ₽`;
// лучшая машина игрока — так его видят в списке друзей
function bestCar(st) {
  const c = [...(st.cars || [])].sort((x, y) => Rules.carHp(y) - Rules.carHp(x))[0];
  return c ? { carId: c.id, hp: Rules.carHp(c), paint: c.paint || null } : null;
}
// изменить прогресс другого игрока (с повтором при одновременном сохранении); fn вернула false — ничего не меняем
async function mutatePlayer(env, id, fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await env.DB.prepare('SELECT state, ver FROM players WHERE id = ?').bind(id).first();
    if (!row) return false;
    const st = Rules.migrate(JSON.parse(row.state));
    const r = fn(st);
    if (r === false) return false;
    const res = await env.DB.prepare(`UPDATE players SET state = ?, ver = ver + 1, ${STAT_SET} WHERE id = ? AND ver = ?`)
      .bind(JSON.stringify(st), ...statCols(st), id, row.ver).run();
    if (res.meta.changes === 1) return r ?? true;
  }
  return false;
}
async function friendIds(env, me) {
  const r = await env.DB.prepare(`SELECT b AS id, 'code' AS how FROM friends WHERE a = ?1
    UNION SELECT player_id, 'invited' FROM referrals WHERE ref_id = ?1
    UNION SELECT ref_id, 'inviter' FROM referrals WHERE player_id = ?1 LIMIT 200`).bind(me).all();
  const m = new Map();
  for (const x of r.results) if (!m.has(x.id) || x.how !== 'code') m.set(x.id, x.how);
  return m;
}
async function duelFriends(env, user) {
  if (!Rules.nextActive()) return { error: 'Недоступно' };
  const ids = await friendIds(env, user.id);
  const now = Date.now();
  const list = [];
  const all = [...ids.keys()];
  for (let i = 0; i < all.length; i += 50) {
    const part = all.slice(i, i + 50);
    const rows = await env.DB.prepare(`SELECT id, name, state, updated_at, last_seen FROM players WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const r of rows.results) {
      const st = JSON.parse(r.state);
      const car = bestCar(st);
      if (!car) continue;
      list.push({ id: String(r.id), name: r.name || 'Гонщик', how: ids.get(r.id), ...car,
        online: Math.max(r.updated_at || 0, r.last_seen || 0) > now - DUEL_ONLINE_MS,
        busy: !!st.duel || !!(st.duelIn && now - st.duelIn.at < DUEL.acceptMs) });
    }
  }
  list.sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
  return { friends: list, code: friendCode(user.id) };
}
async function duelAddFriend(env, user, code) {
  if (!Rules.nextActive()) return { error: 'Недоступно' };
  const m = /^DZ-([0-9A-Z]{1,12})$/.exec(code.trim().toUpperCase());
  const id = m && parseInt(m[1], 36);
  if (!id || !Number.isSafeInteger(id)) return { error: 'Код вида DZ-XXXXX' };
  if (id === user.id) return { error: 'Это твой код' };
  const row = await env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(id).first();
  if (!row) return { error: 'Игрок с таким кодом не найден' };
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, at) VALUES (?, ?, ?)').bind(user.id, id, now),
    env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, at) VALUES (?, ?, ?)').bind(id, user.id, now),
  ]);
  return { ok: true, name: row.name || 'Гонщик' };
}
// итог гонки — сообщение от бота тому, кто ждал
async function duelNotifyRes(env, id, res) {
  if (!res || res.refund) return;
  const text = res.draw ? `🤝 Гонка с <b>${escHtml(res.opp.name)}</b>: оба фальстарт — ничья, ставка вернулась`
    : res.win ? `🏆 Ты обогнал <b>${escHtml(res.opp.name)}</b>!\n\n💰 +${money(res.bet)} — забираешь обе ставки 👇`
    : `💨 <b>${escHtml(res.opp.name)}</b> оказался быстрее — ставка ${money(res.bet)} ушла ему. Реванш? 👇`;
  await notifyPurchase(env, id, text);
}
const escHtml = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
// оба проехали — подставить каждому заезд другого и посчитать итог (повторно безопасно: после итога S.duel = null)
async function duelSync(env, id, exceptId) {
  const row = await env.DB.prepare('SELECT a, b, a_run, b_run FROM duels WHERE id = ?').bind(id).first();
  if (!row?.a_run || !row?.b_run) return;
  for (const [me, other] of [[row.a, row.b_run], [row.b, row.a_run]]) {
    let res = null;
    await mutatePlayer(env, me, S => {
      if (S.duel?.id !== id || !S.duel.my) return false;
      S.duel.oppRun = JSON.parse(other);
      Rules.duelSettle(S, duelCtx(Date.now()));
      res = S.duelRes;
    });
    if (res && me !== exceptId) await duelNotifyRes(env, me, res);
  }
}
async function runDuelAction(env, user, name, params) {
  if (!Rules.nextActive()) return { error: 'Недоступно' };
  const now = Date.now();
  const me = await loadPlayer(env, user);
  const myName = (user.first_name || 'Гонщик').slice(0, 32);

  if (name === 'duelCreate') {
    const to = Number(params.opp?.id);
    if (!to || to === user.id) return { error: 'Соперник не найден' };
    if (!(await friendIds(env, user.id)).has(to)) return { error: 'Вызвать можно только друга' };
    const row = await env.DB.prepare('SELECT name, state, updated_at, last_seen FROM players WHERE id = ?').bind(to).first();
    if (!row) return { error: 'Соперник не найден' };
    if (Math.max(row.updated_at || 0, row.last_seen || 0) < now - DUEL_ONLINE_MS) return { error: 'Друг сейчас не в игре' };
    const car = bestCar(JSON.parse(row.state));
    if (!car) return { error: 'У друга нет машины' };
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const r = await runAction(env, user, 'duelCreate', params, { duelOpp: { id: String(to), name: (row.name || 'Гонщик').slice(0, 32), ...car }, duelId: id });
    if (r.error) return r;
    const d = r.state.duel, mine = r.state.cars.find(c => c.uid === d.uid);
    const inv = { id, opp: { id: String(user.id), name: myName, carId: mine.id, hp: Rules.carHp(mine), paint: mine.paint || null }, bet: d.bet, at: now };
    const ok = await mutatePlayer(env, to, S => {
      if (S.duel || (S.duelIn && now - S.duelIn.at < DUEL.acceptMs)) return false;
      S.duelIn = inv;
    });
    if (!ok) {
      const c = await runAction(env, user, 'duelCancel', {});
      return { error: 'Друг сейчас в другой гонке', state: c.state || r.state, now };
    }
    await env.DB.prepare('INSERT INTO duels (id, a, b, bet, status, at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user.id, to, d.bet, 'wait', now).run();
    await notifyPurchase(env, to, `⚔️ <b>${escHtml(myName)}</b> вызывает тебя на гонку!\n\n${escHtml(Rules.CAR_BY_ID[mine.id]?.name || '')} · ${inv.opp.hp} л.с. · ставка <b>${money(d.bet)}</b>\nОтветить — за ${DUEL.acceptMs / 60e3} минуты 👇`);
    return r;
  }

  if (name === 'duelTake') {
    const inv = me.state.duelIn;
    if (!inv) return { error: 'Вызов уже не актуален', state: me.state, now };
    // сначала пробуем у себя (хватит ли денег, есть ли машина), потом переводим гонку у вызвавшего в «едем»
    try { Rules.run(Rules.migrate(JSON.parse(JSON.stringify(me.state))), 'duelTake', params, duelCtx(now)); }
    catch (e) { if (e instanceof Rules.GameError) return { error: e.message, state: me.state, now }; throw e; }
    const car = me.state.cars.find(c => c.uid === params.uid);
    const from = Number(inv.opp.id);
    const ok = await mutatePlayer(env, from, S => {
      if (S.duel?.id !== inv.id || S.duel.status !== 'wait') return false;
      S.duel.status = 'go'; S.duel.goAt = now;
      if (car) Object.assign(S.duel.opp, { carId: car.id, hp: Rules.carHp(car), paint: car.paint || null });
    });
    if (!ok) {
      const c = await runAction(env, user, 'duelDecline', {});
      return { error: 'Вызов уже не актуален', state: c.state || me.state, now };
    }
    const r = await runAction(env, user, 'duelTake', params);
    if (r.error) {   // не вышло у себя — вызов срывается, вызвавшему ставка назад
      await mutatePlayer(env, from, S => { if (S.duel?.id !== inv.id) return false; S.duel.status = 'wait'; return R_refund(S, inv.id, 'declined'); });
      return r;
    }
    await env.DB.prepare("UPDATE duels SET status = 'go' WHERE id = ?").bind(inv.id).run();
    await notifyPurchase(env, from, `🏁 <b>${escHtml(myName)}</b> принял вызов! Ставка ${money(inv.bet)} — езжай, у тебя ${DUEL.runMs / 60e3} минут 👇`);
    return r;
  }

  if (name === 'duelDecline' || name === 'duelCancel') {
    const id = name === 'duelDecline' ? me.state.duelIn?.id : me.state.duel?.id;
    const oppId = Number(name === 'duelDecline' ? me.state.duelIn?.opp.id : me.state.duel?.opp.id);
    const r = await runAction(env, user, name, params);
    if (r.error || !id) return r;
    if (name === 'duelDecline') await mutatePlayer(env, oppId, S => R_refund(S, id, 'declined'));
    else await mutatePlayer(env, oppId, S => { if (S.duelIn?.id !== id) return false; S.duelIn = null; });
    await env.DB.prepare("UPDATE duels SET status = 'cancel' WHERE id = ?").bind(id).run();
    return r;
  }

  // duelRun: если соперник уже проехал — его заезд подставляем сразу (итог в ответе), иначе — когда проедет он
  const d = me.state.duel;
  if (!d) return runAction(env, user, name, params);
  const row = await env.DB.prepare('SELECT a, a_run, b_run FROM duels WHERE id = ?').bind(d.id).first();
  if (!row) return runAction(env, user, name, params);
  const isA = row.a === user.id;
  const other = isA ? row.b_run : row.a_run;
  const r = await runAction(env, user, name, params, other ? { duelOppRun: JSON.parse(other) } : {});
  if (r.error) return r;
  const run = r.result.my;
  await env.DB.prepare(`UPDATE duels SET ${isA ? 'a_run' : 'b_run'} = ? WHERE id = ?`).bind(JSON.stringify(run), d.id).run();
  await duelSync(env, d.id, user.id);
  return r;
}
const R_refund = (S, id, why) => Rules.duelRefundFrom(S, id, Date.now(), why) || false;

// ---------- торговая площадка ----------
// Вещь лежит в лоте продавца (S.lots), а сам лот — ещё и в общей таблице market (её видят все).
// Покупка: сначала «забираем» лот (open → sold одним UPDATE — дважды не купить), потом выдаём покупателю (ctx.mkLot),
// продавцу — деньги (R.lotSold через mutatePlayer). Аукцион: ставка замораживается (marketBidHold → S.mkBids),
// перебили — деньги назад; итог — mkFinalize (по окончании: при запросе рынка и раз в час). Только игроки, без ботов.
const MARKET_ACTIONS = ['marketList', 'marketCancel', 'marketBuy', 'marketBid'];
const mkName = l => l.kind === 'car' ? Rules.CAR_BY_ID[l.car?.id]?.name || 'Машина'
  : l.kind === 'part' ? `${Rules.SLOT_BY_ID[l.slot]?.name || 'Деталь'} ${PART_TIERS[l.t]?.name || ''}${l.n > 1 ? ` ×${l.n}` : ''}`
  : `номер ${String(l.plate).replace('|', ' ')}`;
const mkSearch = l => `${mkName(l)} ${l.kind === 'part' ? l.t : ''} ${l.plate || l.car?.plate || ''}`.toLowerCase().replace(/\|/g, ' ');
const mkNotice = (S, icon, title, sub) => { S.notices = [...(S.notices || []), { id: crypto.randomUUID().replace(/-/g, '').slice(0, 12), kind: 'mk', icon, title, sub, at: Date.now() }]; };
// лот для игры: как в S.lots + продавец и торги
function mkClientLot(r, me) {
  const l = JSON.parse(r.lot);
  if (l.car) delete l.car.uid;
  return { ...l, id: r.id, seller: r.seller_name || 'Игрок', mine: r.seller === me, price: r.price, value: r.value, at: r.at, until: r.until,
    auc: r.auc ? { start: r.start, buyout: r.buyout, bid: r.bid, bids: r.bids, bidder: r.bidder_name, leader: r.bidder === me, hours: l.auc?.hours } : undefined };
}
async function marketLots(env, user, q) {
  if (!Rules.nextActive()) return { error: 'Недоступно' };
  await mkFinalizeDue(env, 10);
  const now = Date.now();
  const kind = q.get('kind') || 'all', sort = q.get('sort') || 'new', text = (q.get('q') || '').trim().toLowerCase().slice(0, 40);
  const where = ["status = 'open'", 'until > ?1', 'seller != ?2'], binds = [now, user.id];
  if (kind === 'auc') where.push('auc = 1');
  else if (['car', 'part', 'plate'].includes(kind)) { binds.push(kind); where.push(`kind = ?${binds.length}`); }
  if (text) { binds.push(`%${text.replace(/[%_]/g, '')}%`); where.push(`search LIKE ?${binds.length}`); }
  const order = { cheap: 'price ASC', dear: 'price DESC', deal: 'price * 1.0 / value ASC' }[sort] || 'at DESC';
  const rows = await env.DB.prepare(`SELECT * FROM market WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 100`).bind(...binds).all();
  return { lots: rows.results.map(r => mkClientLot(r, user.id)), now };
}
// итог аукциона: победителю — вещь, продавцу — деньги; без ставок — вещь ждёт продавца («Забрать»)
async function mkFinalizeDue(env, limit) {
  const due = await env.DB.prepare("SELECT id FROM market WHERE status = 'open' AND auc = 1 AND until <= ? LIMIT ?").bind(Date.now(), limit).all();
  for (const r of due.results) await mkFinalize(env, r.id, false);
}
async function mkFinalize(env, id, force) {
  const r = await env.DB.prepare('SELECT * FROM market WHERE id = ?').bind(id).first();
  const now = Date.now();
  if (!r || r.status !== 'open' || (!force && r.until > now)) return;
  if (!r.bids) { await env.DB.prepare("UPDATE market SET status = 'expired' WHERE id = ? AND status = 'open' AND bids = 0").bind(id).run(); return; }
  const claim = await env.DB.prepare("UPDATE market SET status = 'sold', buyer = bidder WHERE id = ? AND status = 'open' AND bids = ?").bind(id, r.bids).run();
  if (claim.meta.changes !== 1) return;
  const lot = JSON.parse(r.lot);
  let fault = null;
  const got = await mutatePlayer(env, r.bidder, S => {
    try {
      const out = Rules.run(S, 'marketBuyLocal', {}, { ...duelCtx(now), mkLot: { ...lot, id }, mkPrice: r.bid, mkPrepaid: true });
      Object.assign(S, out.state);
      mkNotice(S, '🔨', `Аукцион выигран: ${mkName(lot)}`, `за ${money(r.bid)}${out.result?.waiting ? ' · ждёт в 🎁' : ''}`);
    } catch (e) { if (e instanceof Rules.GameError) { fault = e.message; return false; } throw e; }
  });
  if (!got) {   // победитель не может забрать (например, лимит номеров) — ставка назад, вещь ждёт продавца
    await mutatePlayer(env, r.bidder, S => { if (!Rules.mkBidRelease(S, id)) return false; mkNotice(S, '🔨', `Аукцион: ${mkName(lot)}`, `не получилось забрать${fault ? ` (${fault})` : ''} — ставка вернулась`); });
    await env.DB.prepare("UPDATE market SET status = 'expired' WHERE id = ?").bind(id).run();
    await mutatePlayer(env, r.seller, S => { const l = S.lots.find(x => x.id === id); if (!l) return false; l.auc.bids = 0; l.until = Math.min(l.until, now); });
    return;
  }
  await mkPlateMove(env, lot, r.bidder);
  const sold = await mutatePlayer(env, r.seller, S => {
    const l = S.lots.find(x => x.id === id);
    if (!l) return false;
    l.price = r.bid;
    const res = Rules.lotSold(S, l, r.bidder_name || 'игрок', now);
    mkNotice(S, '🔨', `Аукцион: ${mkName(lot)} продан`, `+${money(res.got)} на баланс`);
    return res;
  });
  await notifyPurchase(env, r.bidder, `🔨 Ты выиграл аукцион: <b>${escHtml(mkName(lot))}</b> за ${money(r.bid)}! Уже у тебя 👇`);
  if (sold) await notifyPurchase(env, r.seller, `🔨 Аукцион завершён: <b>${escHtml(mkName(lot))}</b> ушёл за ${money(r.bid)}\n\n💰 +${money(sold.got)} (комиссия ${MARKET.feeK * 100}%) 👇`);
}
// номер переходит к покупателю и в общем реестре номеров
async function mkPlateMove(env, lot, to) {
  const key = lot.kind === 'plate' ? lot.plate : lot.car?.plate;
  if (key) await env.DB.prepare('UPDATE plates SET owner = ? WHERE key = ?').bind(to, key).run();
}
async function runMarketAction(env, user, name, params) {
  if (!Rules.nextActive()) return { error: 'Недоступно' };
  const now = Date.now();
  const myName = (user.first_name || 'Игрок').slice(0, 32);

  if (name === 'marketList') {
    const r = await runAction(env, user, 'marketList', params);
    if (r.error) return r;
    const l = r.result.lot;
    await env.DB.prepare(`INSERT INTO market (id, seller, seller_name, kind, lot, search, value, price, at, until, status, auc, start, buyout)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`).bind(l.id, user.id, myName, l.kind, JSON.stringify(l), mkSearch(l), l.value, l.price,
      l.at, l.until, l.auc ? 1 : 0, l.auc ? l.auc.start : null, l.auc?.buyout ?? null).run();
    return r;
  }

  if (name === 'marketCancel') {
    const row = await env.DB.prepare('SELECT status, auc, bids, until FROM market WHERE id = ? AND seller = ?').bind(String(params.id), user.id).first();
    if (row?.status === 'open') {
      if (row.auc && row.bids) {
        if (row.until > now) return { error: 'На лот уже есть ставки — снять нельзя', state: (await loadPlayer(env, user)).state, now };
        await mkFinalize(env, params.id, false);
        return { error: 'Аукцион завершён — лот продан', state: (await loadPlayer(env, user)).state, now };
      }
      const c = await env.DB.prepare("UPDATE market SET status = 'cancel' WHERE id = ? AND status = 'open' AND bids = 0").bind(String(params.id)).run();
      if (c.meta.changes !== 1) return { error: 'Лот уже купили', state: (await loadPlayer(env, user)).state, now };
    }
    return runAction(env, user, 'marketCancel', params);
  }

  if (name === 'marketBuy') {
    const row = await env.DB.prepare('SELECT * FROM market WHERE id = ?').bind(String(params.id)).first();
    const me = await loadPlayer(env, user);
    const no = msg => ({ error: msg, state: me.state, now });
    if (!row || row.status !== 'open' || row.until <= now) return no('Лот уже купили');
    if (row.seller === user.id) return no('Это твой лот');
    if (row.auc) return no('Это аукцион — делай ставку');
    const lot = { ...JSON.parse(row.lot), id: row.id };
    const ctx = { mkLot: lot, mkPrice: row.price };
    try { Rules.run(Rules.migrate(JSON.parse(JSON.stringify(me.state))), 'marketBuyLocal', {}, { ...duelCtx(now), ...ctx }); }
    catch (e) { if (e instanceof Rules.GameError) return no(e.message); throw e; }
    const claim = await env.DB.prepare("UPDATE market SET status = 'sold', buyer = ? WHERE id = ? AND status = 'open' AND until > ?").bind(user.id, row.id, now).run();
    if (claim.meta.changes !== 1) return no('Лот уже купили');
    const r = await runAction(env, user, 'marketBuyLocal', {}, ctx);
    if (r.error) { await env.DB.prepare("UPDATE market SET status = 'open', buyer = NULL WHERE id = ?").bind(row.id).run(); return r; }
    await mkPlateMove(env, lot, user.id);
    const sold = await mutatePlayer(env, row.seller, S => {
      const l = S.lots.find(x => x.id === row.id);
      if (!l) return false;
      const res = Rules.lotSold(S, l, myName, now);
      mkNotice(S, '🤝', `Купили: ${mkName(lot)}`, `+${money(res.got)} на баланс`);
      return res;
    });
    if (sold) await notifyPurchase(env, row.seller, `🤝 <b>${escHtml(myName)}</b> купил твой лот: <b>${escHtml(mkName(lot))}</b>\n\n💰 +${money(sold.got)} (цена ${money(row.price)}, комиссия ${MARKET.feeK * 100}%) 👇`);
    return r;
  }

  // marketBid: ставка на аукцион; не меньше следующего шага, «купить сразу» — если дошла до выкупа
  const row = await env.DB.prepare('SELECT * FROM market WHERE id = ?').bind(String(params.id)).first();
  const me = await loadPlayer(env, user);
  const no = msg => ({ error: msg, state: me.state, now });
  if (!row || !row.auc || row.status !== 'open' || row.until <= now) return no('Торги окончены');
  if (row.seller === user.id) return no('Это твой аукцион');
  if (row.bidder === user.id) return no('Ты уже лидер торгов');
  const next = row.bids ? Math.ceil(row.bid * (1 + MARKET_AUC.stepK) / 1000) * 1000 : row.start;
  let amount = Math.round(+params.amount);
  if (row.buyout && amount >= row.buyout) amount = row.buyout;
  if (!(amount >= next) && amount !== row.buyout) return no(`Ставка — от ${money(next)}`);
  const lot = JSON.parse(row.lot);
  if (lot.kind === 'plate' && Rules.plateRoom(me.state, now).full) return no(Rules.plateRoom(me.state, now).msg);
  const h = await runAction(env, user, 'marketBidHold', {}, { mkBid: { id: row.id, amount } });
  if (h.error) return h;
  const until = row.until - now < MARKET_AUC.extendMs ? now + MARKET_AUC.extendMs : row.until;
  const up = await env.DB.prepare(`UPDATE market SET bid = ?, bids = bids + 1, bidder = ?, bidder_name = ?, price = ?, until = ?
    WHERE id = ? AND status = 'open' AND bids = ? AND until > ?`).bind(amount, user.id, myName, amount, until, row.id, row.bids, now).run();
  if (up.meta.changes !== 1) {   // кто-то успел раньше — ставку назад
    await mutatePlayer(env, user.id, S => Rules.mkBidRelease(S, row.id) ? true : false);
    return { error: 'Кто-то успел раньше — посмотри новую ставку', state: (await loadPlayer(env, user)).state, now };
  }
  if (row.bidder) {   // прошлому лидеру — деньги назад
    const back = await mutatePlayer(env, row.bidder, S => {
      const v = Rules.mkBidRelease(S, row.id);
      if (!v) return false;
      mkNotice(S, '😬', `Тебя перебили: ${mkName(lot)}`, `ставка ${money(v)} вернулась`);
      return v;
    });
    if (back) await notifyPurchase(env, row.bidder, `😬 Твою ставку на <b>${escHtml(mkName(lot))}</b> перебили — ${money(amount)}.\nТвои ${money(back)} вернулись. Ещё не поздно перебить 👇`);
  }
  await mutatePlayer(env, row.seller, S => {
    const l = S.lots.find(x => x.id === row.id);
    if (!l?.auc) return false;
    Object.assign(l.auc, { bid: amount, bids: row.bids + 1, bidder: myName });
    l.until = until;
  });
  const won = row.buyout && amount >= row.buyout;
  if (won) await mkFinalize(env, row.id, true);
  return { state: (await loadPlayer(env, user)).state, result: { bid: amount, won: !!won }, now };
}

// ---------- контейнеры ----------
// Один контейнер за раз; запускает команда из админ-бота (/admin/cont-*). Ставка замораживается (contBidHold → S.contBids),
// перебили — деньги назад (R.contBidRelease). Конец торгов — contFinalize: победителю S.contWon (открывает сам — contOpen),
// без ставок — просто закрыт. Сообщения бота (перебили, выиграл) — только тем, кого сейчас нет в игре.
// Идущий контейнер лежит ещё и в настройке cont_open — /state отдаёт его всем из кэша (плашка, островок).
const CONT_COLORS = ['#c0392b', '#1f6fb2', '#2e8b57', '#d9822b', '#7d3c98', '#5d6d7e'];
const contNext = c => c.bids ? Math.ceil(c.price * (1 + AUCTION.stepK) / AUCTION.round) * AUCTION.round : c.start;
async function offline(env, id) {
  const r = await env.DB.prepare('SELECT updated_at, last_seen FROM players WHERE id = ?').bind(id).first();
  return !r || Math.max(r.updated_at || 0, r.last_seen || 0) < Date.now() - DUEL_ONLINE_MS;
}
async function contCurrent(env, ectx) {
  if (!Rules.nextActive()) return null;
  const c = await getSettingCached(env, 'cont_open', 10e3);
  if (!c?.id) return null;
  if (c.endsAt <= Date.now()) { const f = contFinalize(env, c.id); if (ectx?.waitUntil) ectx.waitUntil(f); else await f; return null; }
  return c;
}
const contPublic = (c, me, st) => {
  const done = c.status !== 'open';
  return { id: c.id, n: c.n, color: c.color, start: c.start, price: c.price, bids: c.bids, next: contNext(c),
    leader: c.leader === me ? 'me' : c.leader_name, endsAt: c.ends_at, done, status: c.status,
    carId: done ? c.car_id : undefined, myBid: st?.contBids?.[c.id] || 0,
    log: JSON.parse(c.log || '[]').map(l => ({ who: l.id === me ? 'me' : l.name, amount: l.amount, at: l.at })) };
};
async function contList(env, user) {
  if (!Rules.nextActive()) return { error: 'Недоступно' };
  await contFinalizeDue(env);
  const rows = await env.DB.prepare(`SELECT * FROM containers WHERE status = 'open' OR (status = 'done' AND ends_at > ?) ORDER BY at DESC LIMIT 5`).bind(Date.now() - 6 * 3600e3).all();
  const me = await loadPlayer(env, user);
  return { list: rows.results.map(c => contPublic(c, user.id, me.state)), now: Date.now() };
}
async function contFinalizeDue(env) {
  const due = await env.DB.prepare("SELECT id FROM containers WHERE status = 'open' AND ends_at <= ? LIMIT 5").bind(Date.now()).all();
  for (const r of due.results) await contFinalize(env, r.id);
}
async function contFinalize(env, id, force) {
  const c = await env.DB.prepare('SELECT * FROM containers WHERE id = ?').bind(id).first();
  if (!c || c.status !== 'open' || (!force && c.ends_at > Date.now())) return;
  const up = await env.DB.prepare("UPDATE containers SET status = 'done', ends_at = MIN(ends_at, ?) WHERE id = ? AND status = 'open' AND bids = ?").bind(Date.now(), id, c.bids).run();
  if (up.meta.changes !== 1) return;
  await setSetting(env, 'cont_open', null);
  if (!c.leader) return;
  await mutatePlayer(env, c.leader, S => {
    if (S.contBids) delete S.contBids[id];   // ставка ушла в оплату контейнера
    S.contWon = [...(S.contWon || []), { id, n: c.n, carId: c.car_id, price: c.price, color: c.color, at: Date.now() }];
    mkNotice(S, '🚢', `Ты выиграл контейнер №${c.n}!`, `за ${money(c.price)} · открой его`);
  });
  if (await offline(env, c.leader)) await notifyPurchase(env, c.leader, `🚢 Ты выиграл <b>контейнер №${c.n}</b> за ${money(c.price)}!\n\nЧто внутри — узнаешь, когда откроешь 👇`);
}
async function contBid(env, user, params) {
  if (!Rules.nextActive()) return { error: 'Недоступно' };
  const now = Date.now();
  const c = await env.DB.prepare('SELECT * FROM containers WHERE id = ?').bind(String(params.id)).first();
  const me = await loadPlayer(env, user);
  const no = msg => ({ error: msg, state: me.state, now });
  if (!c || c.status !== 'open' || c.ends_at <= now) return no('Торги окончены');
  if (c.leader === user.id) return no('Ты уже лидер торгов');
  const need = contNext(c);
  const amount = Math.round(+params.amount / AUCTION.round) * AUCTION.round;
  if (!(amount >= need)) return no(`Цена уже выросла — ставка от ${money(need)}`);
  const h = await runAction(env, user, 'contBidHold', {}, { contBid: { id: c.id, amount } });
  if (h.error) return h;
  const name = (user.first_name || 'Игрок').slice(0, 32);
  const endsAt = c.ends_at - now < AUCTION.extendMs ? now + AUCTION.extendMs : c.ends_at;
  const log = [{ id: user.id, name, amount, at: now }, ...JSON.parse(c.log || '[]')].slice(0, 20);
  const up = await env.DB.prepare(`UPDATE containers SET price = ?, bids = bids + 1, leader = ?, leader_name = ?, ends_at = ?, log = ?
    WHERE id = ? AND status = 'open' AND bids = ? AND ends_at > ?`).bind(amount, user.id, name, endsAt, JSON.stringify(log), c.id, c.bids, now).run();
  if (up.meta.changes !== 1) {
    await mutatePlayer(env, user.id, S => Rules.contBidRelease(S, c.id) ? true : false);
    return { error: 'Кто-то успел раньше — посмотри новую ставку', state: (await loadPlayer(env, user)).state, now };
  }
  await setSetting(env, 'cont_open', { id: c.id, n: c.n, color: c.color, endsAt, price: amount, start: c.start });
  if (c.leader) {
    const back = await mutatePlayer(env, c.leader, S => {
      const v = Rules.contBidRelease(S, c.id);
      if (!v) return false;
      mkNotice(S, '😬', `Тебя перебили · контейнер №${c.n}`, `ставка ${money(v)} вернулась`);
      return v;
    });
    if (back && await offline(env, c.leader)) await notifyPurchase(env, c.leader, `😬 Твою ставку на <b>контейнер №${c.n}</b> перебили — ${money(amount)}.\nТвои ${money(back)} вернулись. Ещё не поздно перебить 👇`);
  }
  return { state: (await loadPlayer(env, user)).state, result: { bid: amount }, now };
}
// админ-бот: запустить / завершить / отменить
async function contAdmin(env, url, body, user) {
  if (!Rules.nextActive()) return { error: 'Контейнеры включатся вместе с обновлением' };
  const now = Date.now();
  if (url.pathname === '/admin/conts') {
    const rows = await env.DB.prepare('SELECT * FROM containers ORDER BY at DESC LIMIT 10').all();
    return { list: rows.results.map(c => ({ ...contPublic(c, 0, null), carId: c.car_id, leaderId: c.leader, leader: c.leader_name })),
      cars: [...EXCL_CARS, ...SECRET_CARS].map(c => ({ id: c.id, name: c.name, price: c.price, excl: !!c.excl })), def: { start: AUCTION.defStart, ms: AUCTION.defMs } };
  }
  if (url.pathname === '/admin/cont-create') {
    const d = Rules.CAR_BY_ID[body.carId];
    if (!d?.secret) return { error: 'Выбери эксклюзивную или секретную машину' };
    const open = await env.DB.prepare("SELECT id FROM containers WHERE status = 'open' LIMIT 1").first();
    if (open) return { error: 'Уже идёт контейнер — дождись конца или заверши его' };
    const start = Math.max(AUCTION.round, Math.round(+body.start / AUCTION.round) * AUCTION.round);
    const ms = Math.min(7 * 86400e3, Math.max(60e3, Math.round(+body.minutes || 0) * 60e3));
    const n = ((await env.DB.prepare('SELECT MAX(n) AS n FROM containers').first())?.n || 0) + 1;
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const color = CONT_COLORS[Math.floor(secureRandom() * CONT_COLORS.length)];
    await env.DB.prepare(`INSERT INTO containers (id, n, car_id, color, start, price, at, ends_at, status, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
      .bind(id, n, d.id, color, start, start, now, now + ms, user.id).run();
    await setSetting(env, 'cont_open', { id, n, color, endsAt: now + ms, price: start, start });
    return { ok: true, id, n };
  }
  const c = await env.DB.prepare('SELECT * FROM containers WHERE id = ?').bind(String(body.id)).first();
  if (!c || c.status !== 'open') return { error: 'Контейнер уже завершён' };
  if (url.pathname === '/admin/cont-end') { await contFinalize(env, c.id, true); return { ok: true }; }
  if (url.pathname === '/admin/cont-cancel') {   // отменить: лидеру ставка назад
    const up = await env.DB.prepare("UPDATE containers SET status = 'cancel' WHERE id = ? AND status = 'open'").bind(c.id).run();
    if (up.meta.changes !== 1) return { error: 'Контейнер уже завершён' };
    await setSetting(env, 'cont_open', null);
    if (c.leader) await mutatePlayer(env, c.leader, S => {
      const v = Rules.contBidRelease(S, c.id);
      if (!v) return false;
      mkNotice(S, '🚢', `Контейнер №${c.n} отменён`, `ставка ${money(v)} вернулась`);
    });
    return { ok: true };
  }
  return { error: 'Неизвестная команда' };
}

// ---------- временные кейсы ----------
// Создаёт команда в админ-боте (/admin/ecase-create). Кейс владельца — сразу в игре, кейс админа команды ждёт:
// владельцу приходит сообщение в админ-бот с кнопками «Подтвердить / Отклонить» (ecaseDecide). Одновременно — до EC_MAX.
// Идущие и недавно закончившиеся (неделю — чтобы не пропали оплаченные подарки) — в настройке ecases → globalThis.EVENT_CASES.
const EC_MAX = 3, EC_HOURS = [1, 6, 24, 72, 168];
async function loadEcases(env) {
  if (!Rules.nextActive()) { globalThis.EVENT_CASES = []; return; }
  globalThis.EVENT_CASES = (await getSettingCached(env, 'ecases', 10e3).catch(() => null)) || [];
}
async function ecasesRefresh(env) {
  const now = Date.now();
  await env.DB.prepare("UPDATE ecases SET status = 'ended' WHERE status = 'live' AND json_extract(data, '$.until') <= ?").bind(now).run();
  const rows = await env.DB.prepare("SELECT data FROM ecases WHERE status IN ('live', 'ended') AND json_extract(data, '$.until') > ? ORDER BY at").bind(now - 7 * 86400e3).all();
  const list = rows.results.map(r => JSON.parse(r.data));
  await setSetting(env, 'ecases', list);
  globalThis.EVENT_CASES = list;
}
const ecLiveCount = async env => (await env.DB.prepare("SELECT COUNT(*) AS n FROM ecases WHERE status = 'live' AND json_extract(data, '$.until') > ?").bind(Date.now()).first()).n;
const ecText = d => `${d.icon} «${d.name}» · ${d.cars.length} машин · ${d.hours >= 24 ? `${d.hours / 24} дн` : `${d.hours} ч`}\n` +
  (d.pay === 'stars' ? `только ⭐ ${d.stars}` : d.pay === 'both' ? `${money(d.price)} или ⭐ ${d.stars}` : money(d.price));
// подтвердить / отклонить (владелец: кнопкой в админ-боте или в админке)
async function ecaseDecide(env, id, ok, fromId) {
  if (!isOwnerId(fromId)) return 'Подтверждает только владелец';
  const row = await env.DB.prepare('SELECT data, status FROM ecases WHERE id = ?').bind(id).first();
  if (!row) return 'Кейс не найден';
  if (row.status !== 'pending') return `Уже решено: ${row.status === 'live' ? 'в игре' : row.status === 'rejected' ? 'отклонён' : 'закончился'}`;
  const d = JSON.parse(row.data);
  if (!ok) { await env.DB.prepare("UPDATE ecases SET status = 'rejected' WHERE id = ? AND status = 'pending'").bind(id).run(); return `❌ Отклонён: «${d.name}»`; }
  if (await ecLiveCount(env) >= EC_MAX) return `Уже ${EC_MAX} временных кейса в игре — заверши один и подтверди снова`;
  const now = Date.now();
  Object.assign(d, { from: now, until: now + d.hours * 3600e3 });   // срок — с момента подтверждения
  await env.DB.prepare("UPDATE ecases SET status = 'live', data = ? WHERE id = ? AND status = 'pending'").bind(JSON.stringify(d), id).run();
  await ecasesRefresh(env);
  return `✅ В игре: «${d.name}»`;
}
async function ecaseAdmin(env, url, body, user, owner) {
  if (!Rules.nextActive()) return { error: 'Временные кейсы включатся вместе с обновлением' };
  if (url.pathname === '/admin/ecases') {
    await ecasesRefresh(env);
    const rows = await env.DB.prepare('SELECT id, data, status, admin_id, admin_name, at FROM ecases ORDER BY at DESC LIMIT 20').all();
    return { list: rows.results.map(r => ({ ...JSON.parse(r.data), status: r.status, adminId: r.admin_id, adminName: r.admin_name, at: r.at })), max: EC_MAX, owner };
  }
  if (url.pathname === '/admin/ecase-create') {
    const name = String(body.name || '').trim().slice(0, 28);
    const icon = String(body.icon || '🔥').trim().slice(0, 4) || '🔥';
    const base = new Set(Rules.baseCars().map(c => c.id));
    const cars = [...new Set((Array.isArray(body.cars) ? body.cars : []).map(String))].filter(id => base.has(id));
    const hours = EC_HOURS.includes(+body.hours) ? +body.hours : 24;
    const pay = ['rub', 'stars', 'both'].includes(body.pay) ? body.pay : 'rub';
    const stars = pay === 'rub' ? 0 : Math.floor(+body.stars);
    if (!name) return { error: 'Назови кейс' };
    if (!cars.length) return { error: 'Выбери машины' };
    if (pay !== 'rub' && !(stars >= 1 && stars <= 10000)) return { error: 'Цена в звёздах — от 1 до 10 000' };
    if (owner && await ecLiveCount(env) >= EC_MAX) return { error: `Уже ${EC_MAX} временных кейса — дождись конца или заверши один` };
    const now = Date.now(), id = 'ev_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const d = { id, event: true, kind: 'car', name, icon, cars, price: Rules.eventCasePrice(cars), stars, pay, hours, from: now, until: now + hours * 3600e3 };
    const by = (user.first_name || 'Админ').slice(0, 32);
    await env.DB.prepare('INSERT INTO ecases (id, data, status, admin_id, admin_name, at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, JSON.stringify(d), owner ? 'live' : 'pending', user.id, by, now).run();
    if (owner) { await ecasesRefresh(env); return { ok: true, live: true }; }
    // админ команды — владельцу на подтверждение (кнопки в админ-боте)
    const kb = { inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: 'eca:' + id }, { text: '❌ Отклонить', callback_data: 'ecr:' + id }]] };
    for (const oid of globalThis.ADMIN_IDS || []) {
      await tg(env, 'sendMessage', { chat_id: oid, text: `🆕 <b>${escHtml(by)}</b> создал временный кейс:\n\n${escHtml(ecText(d))}\n\nМашины: ${escHtml(cars.map(c => Rules.CAR_BY_ID[c]?.name).join(', ')).slice(0, 2500)}`,
        parse_mode: 'HTML', reply_markup: kb }, env.ADMIN_BOT_TOKEN).catch(e => console.error(e));
    }
    return { ok: true, pending: true };
  }
  if (url.pathname === '/admin/ecase-decide') return { ok: true, text: await ecaseDecide(env, String(body.id), !!body.ok, user.id) };
  if (url.pathname === '/admin/ecase-end') {   // закончить досрочно
    const row = await env.DB.prepare('SELECT data FROM ecases WHERE id = ? AND status = ?').bind(String(body.id), 'live').first();
    if (!row) return { error: 'Кейс уже не идёт' };
    const d = JSON.parse(row.data); d.until = Date.now();
    await env.DB.prepare("UPDATE ecases SET status = 'ended', data = ? WHERE id = ?").bind(JSON.stringify(d), String(body.id)).run();
    await ecasesRefresh(env);
    return { ok: true };
  }
  return { error: 'Неизвестная команда' };
}

// ---------- номера: каждый номер в одном экземпляре на всю игру (таблица plates) ----------
const PLATE_ACTIONS = ['openPlateCase', 'sellPlate', 'giftOpen'];   // giftOpen — подарок может оказаться генерацией номера

async function runPlateAction(env, user, name, params) {
  const conflicts = new Set();   // номера, которые оказались заняты другими — генерация их обойдёт
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await loadPlayer(env, user);
    const now = Date.now();
    const ctx = { now, rnd: secureRandom, uid: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12), admin: isOwnerId(user.id),
      isPlateTaken: k => conflicts.has(k) };
    let out;
    try {
      out = Rules.run(p.state, name, params, ctx);
    } catch (e) {
      if (e instanceof Rules.GameError) return { error: e.message, state: p.state, now };
      throw e;
    }
    const key = name === 'sellPlate' ? params.plate : out.result.plate;
    if (name !== 'sellPlate' && key) {
      // занимаем номер; если кто-то успел раньше — пробуем ещё раз (генерация выберет другой)
      const ins = await env.DB.prepare('INSERT OR IGNORE INTO plates (key, owner, at) VALUES (?, ?, ?)').bind(key, user.id, now).run();
      if (ins.meta.changes !== 1) {
        conflicts.add(key);
        continue;
      }
    }
    const res = await env.DB.prepare(`UPDATE players SET state = ?, ver = ver + 1, updated_at = ?, name = ?, username = ?, ${STAT_SET} WHERE id = ? AND ver = ?`)
      .bind(JSON.stringify(out.state), now, user.first_name || '', user.username || '', ...statCols(out.state), user.id, p.ver).run();
    if (res.meta.changes === 1) {
      if (name === 'sellPlate') await env.DB.prepare('DELETE FROM plates WHERE key = ? AND owner = ?').bind(key, user.id).run();
      return { state: out.state, result: out.result, now };
    }
    // прогресс поменялся параллельно — отпускаем занятый номер и повторяем
    if (name !== 'sellPlate' && key) await env.DB.prepare('DELETE FROM plates WHERE key = ? AND owner = ?').bind(key, user.id).run();
  }
  return { error: 'Попробуй ещё раз' };
}

// ---------- промокоды ----------
const promoCode = s => String(s || '').trim().toUpperCase().slice(0, 32);

async function redeemPromo(env, user, raw) {
  const code = promoCode(raw);
  const now = Date.now();
  if (!code) return { error: 'Введи промокод' };
  const promo = await env.DB.prepare('SELECT * FROM promos WHERE code = ?').bind(code).first();
  if (!promo || !promo.active) return { error: 'Такого промокода нет' };
  if (promo.expires_at && now > promo.expires_at) return { error: 'Срок промокода истёк' };
  if (promo.max_uses && promo.uses >= promo.max_uses) return { error: 'Промокод закончился' };
  const used = await env.DB.prepare('SELECT 1 FROM promo_uses WHERE code = ? AND player_id = ?').bind(code, user.id).first();
  if (used) return { error: 'Ты уже активировал этот промокод' };
  const reward = JSON.parse(promo.reward);

  // пробуем выдать на копии — например, гараж может быть полон
  const p = await loadPlayer(env, user);
  try {
    Rules.run(structuredClone(p.state), 'promo', {}, { now, rnd: secureRandom, uid: () => 'x', promo: reward });
  } catch (e) {
    if (e instanceof Rules.GameError) return { error: e.message };
    throw e;
  }

  // занимаем использование (защита от двойной активации и перебора лимита)
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO promo_uses (code, player_id, at) VALUES (?, ?, ?)').bind(code, user.id, now).run();
  if (ins.meta.changes !== 1) return { error: 'Ты уже активировал этот промокод' };
  const upd = await env.DB.prepare('UPDATE promos SET uses = uses + 1 WHERE code = ? AND active = 1 AND (max_uses = 0 OR uses < max_uses)').bind(code).run();
  const rollback = async () => {
    await env.DB.prepare('DELETE FROM promo_uses WHERE code = ? AND player_id = ?').bind(code, user.id).run();
    if (upd.meta.changes === 1) await env.DB.prepare('UPDATE promos SET uses = uses - 1 WHERE code = ?').bind(code).run();
  };
  if (upd.meta.changes !== 1) { await rollback(); return { error: 'Промокод закончился' }; }

  const out = await runAction(env, user, 'promo', {}, { promo: reward });
  if (out.error) await rollback();
  else out.result.code = code;
  return out;
}

// ---------- админка ----------
// Владелец — ADMIN_IDS (data.js). Команда — админы, которых владелец назначил в админ-боте (settings 'team').
// Админ команды может почти всё, кроме: назначать админов, сбрасывать/подменять прогресс, ставить баланс,
// выдавать больше ADMIN_MONEY_CAP за раз. Все действия команды пишутся в журнал (admin_log).
const isOwnerId = id => (globalThis.ADMIN_IDS || []).includes(id);
let team = { ids: new Map(), t: 0 };
async function loadTeam(env) {
  if (Date.now() - team.t < 30e3) return;
  try {
    const list = (await getSetting(env, 'team')) || [];
    team = { ids: new Map(list.map(a => [a.id, a])), t: Date.now() };
  } catch { team.t = Date.now(); }
}
const isAdminId = id => isOwnerId(id) || team.ids.has(id);
const ADMIN_MONEY_CAP = 100e6;
const OWNER_ONLY_OPS = ['reset', 'load'];

async function adminLog(env, user, action, target, details) {
  try {
    await env.DB.prepare('INSERT INTO admin_log (at, admin_id, admin, action, target, details) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(Date.now(), user.id, user.first_name || user.username || '', action, target ?? null, String(details || '').slice(0, 300)).run();
  } catch (e) { console.error('adminLog', e); }
}

// ---------- нагрузка: статистика Cloudflare (GraphQL) по ключу CF_API_TOKEN (только чтение аналитики) ----------
// Включено в тариф Workers Paid за месяц: записи в базу, чтения, запросы к серверу.
const USAGE_CRON = '0 * * * *';
const CF_ACCOUNT = '9e0761dc19a40ceb9ce8b9386d9170f1';
const INCLUDED = { writes: 50e6, reads: 25e9, requests: 10e6 };
let usageCache = { v: null, t: 0 };
async function cfUsage(env) {
  if (!env.CF_API_TOKEN) return { error: 'нет ключа CF_API_TOKEN' };
  if (usageCache.v && Date.now() - usageCache.t < 5 * 60e3) return usageCache.v;
  const now = new Date();
  const d2 = now.toISOString().slice(0, 10);
  const d1 = d2.slice(0, 8) + '01';
  const query = `query U($acc: string!, $d1: Date!, $d2: Date!) { viewer { accounts(filter: {accountTag: $acc}) {
    d1AnalyticsAdaptiveGroups(limit: 100, filter: {date_geq: $d1, date_leq: $d2}) { sum { rowsRead rowsWritten } dimensions { date } }
    workersInvocationsAdaptive(limit: 100, filter: {date_geq: $d1, date_leq: $d2}) { sum { requests errors } dimensions { date } }
  } } }`;
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { acc: CF_ACCOUNT, d1, d2 } }),
    }).then(x => x.json());
    if (r.errors?.length) return { error: r.errors[0].message };
    const acc = r.data.viewer.accounts[0] || {};
    const sum = (rows, k, day) => (rows || []).filter(x => !day || x.dimensions.date === day).reduce((s, x) => s + (x.sum[k] || 0), 0);
    const d1rows = acc.d1AnalyticsAdaptiveGroups, wr = acc.workersInvocationsAdaptive;
    const dayOfMonth = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const month = { writes: sum(d1rows, 'rowsWritten'), reads: sum(d1rows, 'rowsRead'), requests: sum(wr, 'requests'), errors: sum(wr, 'errors') };
    const v = {
      today: { writes: sum(d1rows, 'rowsWritten', d2), reads: sum(d1rows, 'rowsRead', d2), requests: sum(wr, 'requests', d2), errors: sum(wr, 'errors', d2) },
      month, included: INCLUDED,
      // прогноз на конец месяца по текущему темпу
      forecast: Object.fromEntries(['writes', 'reads', 'requests'].map(k => [k, Math.round(month[k] / Math.max(dayOfMonth, 0.5) * daysInMonth)])),
      at: Date.now(),
    };
    usageCache = { v, t: Date.now() };
    return v;
  } catch (e) { return { error: String(e.message || e) }; }
}

// раз в час: если прогноз на месяц перевалит за 70% / 90% / 100% включённого в тариф — сообщение владельцу в админ-бота
async function usageAlerts(env) {
  const u = await cfUsage(env);
  if (u.error || !env.ADMIN_BOT_TOKEN) return;
  const key = new Date().toISOString().slice(0, 7);
  let st = (await getSetting(env, 'usage_alerts')) || {};
  if (st.month !== key) st = { month: key, sent: {} };
  const NAMES = { writes: 'записи в базу', requests: 'запросы к серверу', reads: 'чтения из базы' };
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн' : Math.round(n / 1e3) + ' тыс';
  const lines = [];
  for (const k of ['writes', 'requests', 'reads']) {
    const pct = u.forecast[k] / INCLUDED[k] * 100;
    const level = [100, 90, 70].find(p => pct >= p);
    if (level && !(st.sent[k] || []).includes(level)) {
      st.sent[k] = [...(st.sent[k] || []), level];
      lines.push(`• ${NAMES[k]}: прогноз ${fmt(u.forecast[k])} из ${fmt(INCLUDED[k])} в тарифе (${Math.round(pct)}%)`);
    }
  }
  if (!lines.length) return;
  await setSetting(env, 'usage_alerts', st);
  const text = `⚠️ Нагрузка на сервер DROPZONE растёт\n\n${lines.join('\n')}\n\nСверх тарифа Cloudflare берёт доплату. Подробности — в админке, «Нагрузка».`;
  for (const id of globalThis.ADMIN_IDS || []) {
    await fetch(`https://api.telegram.org/bot${env.ADMIN_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: id, text }),
    }).catch(() => {});
  }
}

// настройка с коротким кэшем в памяти (техработы проверяются на каждом запросе — незачем каждый раз ходить в базу)
const settingCache = new Map();
async function getSettingCached(env, key, ms = 15e3) {
  const c = settingCache.get(key);
  if (c && Date.now() - c.t < ms) return c.v;
  const v = await getSetting(env, key);
  settingCache.set(key, { v, t: Date.now() });
  return v;
}

// подписка на канал: спрашиваем Telegram не чаще раза в 6 ч на игрока (отметка sub_at в базе) —
// при тысячах игроков Telegram иначе начинает тормозить. Неподписанных проверяем каждый раз.
const SUB_TTL = 6 * 3600e3;
async function subOk(env, user) {
  const row = await env.DB.prepare('SELECT sub_at FROM players WHERE id = ?').bind(user.id).first();
  if (row && Date.now() - (row.sub_at || 0) < SUB_TTL) return true;
  const ok = await isSubscribed(env, user.id, true);
  if (ok && row) await env.DB.prepare('UPDATE players SET sub_at = ? WHERE id = ?').bind(Date.now(), user.id).run().catch(() => {});
  return ok;
}

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();
  settingCache.set(key, { v: value, t: Date.now() });   // этот экземпляр сервера сразу видит новое значение
}

async function adminRoute(env, url, request, user) {
  const now = Date.now();
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const owner = isOwnerId(user.id);
  const res = await adminRouteInner(env, url, request, user, body, now, owner);
  // журнал: все изменения, сделанные админами команды (и владельцем — для полноты)
  if (request.method === 'POST' && res && !res.error && !(url.pathname === '/admin/broadcast' && body.offset)) {
    const { id, ...rest } = body;
    await adminLog(env, user, url.pathname.replace('/admin/', ''), Number(id) || null, JSON.stringify(rest));
  }
  return res;
}

async function adminRouteInner(env, url, request, user, body, now, owner) {
  // ----- команда админов (только владелец) -----
  if (url.pathname === '/admin/team') {
    const list = (await getSetting(env, 'team')) || [];
    return { team: list, owner, me: user.id };
  }
  if (url.pathname === '/admin/team-add' || url.pathname === '/admin/team-remove') {
    if (!owner) return { error: 'Назначать админов может только владелец' };
    const id = Number(body.id);
    if (!id || isOwnerId(id)) return { error: 'Неверный игрок' };
    let list = (await getSetting(env, 'team')) || [];
    if (url.pathname === '/admin/team-add') {
      const p = await env.DB.prepare('SELECT name, username FROM players WHERE id = ?').bind(id).first();
      if (!p) return { error: 'Игрок не найден — пусть сначала зайдёт в игру' };
      if (!list.some(a => a.id === id)) list.push({ id, name: p.name || '', username: p.username || '', at: now });
    } else list = list.filter(a => a.id !== id);
    await setSetting(env, 'team', list);
    team.t = 0;   // сразу перечитать
    return { team: list };
  }
  if (url.pathname === '/admin/log') {
    if (!owner) return { error: 'Журнал видит только владелец' };
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const rows = await env.DB.prepare(`SELECT l.*, p.name AS target_name FROM admin_log l LEFT JOIN players p ON p.id = l.target
      ORDER BY l.id DESC LIMIT 50 OFFSET ?`).bind(offset).all();
    return { log: rows.results };
  }
  // ----- ограничения для админов команды -----
  if (!owner && url.pathname === '/admin/player-action') {
    if (OWNER_ONLY_OPS.includes(body.op)) return { error: 'Это может только владелец' };
    if (body.op === 'money' && body.set !== undefined) return { error: 'Ставить баланс может только владелец' };
    if (body.op === 'money' && Number(body.add) > ADMIN_MONEY_CAP) return { error: `За раз — не больше ${ADMIN_MONEY_CAP / 1e6} млн ₽` };
  }
  if (!owner && url.pathname === '/admin/promo-create' && Number(body.reward?.money) > ADMIN_MONEY_CAP) return { error: `В промокоде — не больше ${ADMIN_MONEY_CAP / 1e6} млн ₽` };

  if (url.pathname === '/admin/players') {
    const q = (url.searchParams.get('q') || '').trim().replace(/^@/, '');
    const like = `%${q}%`;
    const where = q ? 'WHERE name LIKE ?1 OR username LIKE ?1 OR CAST(id AS TEXT) LIKE ?1' : '';
    const SORTS = { recent: 'updated_at DESC', money: 'money DESC', worth: 'worth DESC', level: 'level DESC, xp DESC', created: 'created_at DESC' };
    const order = SORTS[url.searchParams.get('sort')] || SORTS.recent;
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const list = await env.DB.prepare(
      `SELECT id, name, username, created_at, updated_at, worth,
              json_extract(state, '$.money') AS money, json_extract(state, '$.level') AS level, json_extract(state, '$.xp') AS xp,
              json_array_length(json_extract(state, '$.cars')) AS cars
       FROM players ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`)
      .bind(...(q ? [like] : [])).all();
    const found = q ? (await env.DB.prepare(`SELECT COUNT(*) AS n FROM players ${where}`).bind(like).first()).n : null;
    const stats = await env.DB.prepare(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) AS active FROM players').bind(now - 86400e3).first();
    return { players: list.results, total: stats.total, active: stats.active || 0, found, offset, limit, now };
  }

  if (url.pathname === '/admin/player') {
    const id = Number(url.searchParams.get('id'));
    const row = await env.DB.prepare('SELECT id, name, username, created_at, updated_at, state FROM players WHERE id = ?').bind(id).first();
    if (!row) return { error: 'Игрок не найден' };
    const { state, ...info } = row;
    const invitedBy = await env.DB.prepare('SELECT p.id, p.name, r.at, r.paid FROM referrals r JOIN players p ON p.id = r.ref_id WHERE r.player_id = ?').bind(id).first();
    const invited = await env.DB.prepare(`SELECT p.id, p.name, r.at, r.paid, json_extract(p.state, '$.level') AS level FROM referrals r JOIN players p ON p.id = r.player_id
      WHERE r.ref_id = ? ORDER BY r.at DESC LIMIT 100`).bind(id).all();
    const invitedN = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(paid) AS paid FROM referrals WHERE ref_id = ?').bind(id).first();
    // перешли по его ссылке, но не засчитаны: ещё не вошли (нет подписки) или уже играли раньше
    const pending = await env.DB.prepare(`SELECT pr.id, pr.at, p.name, p.created_at FROM pending_refs pr LEFT JOIN players p ON p.id = pr.id
      WHERE pr.ref_id = ? ORDER BY pr.at DESC LIMIT 100`).bind(id).all();
    // сам перешёл по чужой ссылке, но не засчитан
    const pendingIn = await env.DB.prepare('SELECT pr.ref_id, pr.at, p.name FROM pending_refs pr LEFT JOIN players p ON p.id = pr.ref_id WHERE pr.id = ?').bind(id).first();
    return { player: info, state: Rules.migrate(JSON.parse(state)), sub: await subStatus(env, id),
      refs: { invitedBy, invited: invited.results, invitedN: invitedN.n, invitedPaid: invitedN.paid || 0, minLevel: REFERRAL.minLevel, pending: pending.results, pendingIn, inviter: REFERRAL.inviter, friend: REFERRAL.friend }, now };
  }

  if (url.pathname === '/admin/player-action') {
    const id = Number(body.id);
    const plateOp = ['plateGive', 'plateRandom', 'plateTake', 'giveCase'].includes(body.op);
    const conflicts = new Set();
    if (body.op === 'plateGive') {
      const owner = await env.DB.prepare('SELECT owner FROM plates WHERE key = ?').bind(String(body.plate || '')).first();
      if (owner && owner.owner !== id) return { error: `Номер занят у игрока ${owner.owner}` };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await env.DB.prepare('SELECT state, ver FROM players WHERE id = ?').bind(id).first();
      if (!row) return { error: 'Игрок не найден' };
      const ctx = { now: Date.now(), rnd: secureRandom, uid: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12), admin: true,
        isPlateTaken: k => conflicts.has(k) };
      let out;
      try {
        const { id: _, ...params } = body;
        out = Rules.run(Rules.migrate(JSON.parse(row.state)), 'admin', params, ctx);
      } catch (e) {
        if (e instanceof Rules.GameError) return { error: e.message };
        throw e;
      }
      const key = out.result?.plate;
      if (plateOp && body.op !== 'plateTake' && key) {
        const ins = await env.DB.prepare('INSERT OR IGNORE INTO plates (key, owner, at) VALUES (?, ?, ?)').bind(key, id, ctx.now).run();
        if (ins.meta.changes !== 1) {
          const owner = await env.DB.prepare('SELECT owner FROM plates WHERE key = ?').bind(key).first();
          if (owner?.owner !== id) {
            if (body.op === 'plateGive') return { error: `Номер занят у игрока ${owner?.owner}` };
            conflicts.add(key);
            continue;
          }
        }
      }
      const res = await env.DB.prepare(`UPDATE players SET state = ?, ver = ver + 1, ${STAT_SET} WHERE id = ? AND ver = ?`)
        .bind(JSON.stringify(out.state), ...statCols(out.state), id, row.ver).run();
      if (res.meta.changes === 1) {
        if (body.op === 'plateTake') await env.DB.prepare('DELETE FROM plates WHERE key = ? AND owner = ?').bind(key, id).run();
        return { state: out.state, result: out.result, now: ctx.now };
      }
      if (plateOp && body.op !== 'plateTake' && key) await env.DB.prepare('DELETE FROM plates WHERE key = ? AND owner = ?').bind(key, id).run();
    }
    return { error: 'Попробуй ещё раз' };
  }

  if (url.pathname === '/admin/bot-setup') return setupBot(env, url.origin);

  if (url.pathname === '/admin/usage') return await cfUsage(env);

  // онлайн: чья игра была на связи за последние 2 минуты (пока игра открыта, она опрашивает сервер раз в 30 с)
  // номера по редкости: занятые (все, с владельцами) или подборка свободных
  if (url.pathname === '/admin/plates') {
    const rarity = url.searchParams.get('rarity') || 'S';
    const rows = await env.DB.prepare('SELECT p.key, p.owner, pl.name FROM plates p LEFT JOIN players pl ON pl.id = p.owner').all();
    if (url.searchParams.get('kind') === 'free') {
      const taken = new Set(rows.results.map(r => r.key)), out = new Set();
      for (let i = 0; i < 60 && out.size < 30; i++) {
        try { const k = Rules.genPlate(secureRandom, rarity, k => taken.has(k) || out.has(k)); out.add(k); } catch {}
      }
      return { free: [...out].map(key => ({ key, value: Rules.plateInfo(key).value })).sort((a, b) => b.value - a.value), total: rows.results.length };
    }
    const list = rows.results.map(r => ({ ...r, info: Rules.plateInfo(r.key) })).filter(r => r.info?.rarity === rarity)
      .sort((a, b) => b.info.value - a.info.value);
    return { taken: list.slice(0, 300).map(r => ({ key: r.key, owner: r.owner, name: r.name, value: r.info.value })), count: list.length, total: rows.results.length };
  }

  // занят ли номер и у кого
  if (url.pathname === '/admin/plate') {
    const key = url.searchParams.get('key') || '';
    if (!Rules.plateParse(key)) return { error: 'Неверный номер' };
    const row = await env.DB.prepare('SELECT p.owner, p.at, pl.name, pl.username FROM plates p LEFT JOIN players pl ON pl.id = p.owner WHERE p.key = ?').bind(key).first();
    return { key, info: Rules.plateInfo(key), owner: row ? { id: row.owner, name: row.name, username: row.username, at: row.at } : null };
  }

  if (url.pathname === '/admin/online') {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE (updated_at > ?1 OR last_seen > ?2) AND ${notAdmins()}`).bind(now - 120e3, now - 180e3).first();
    return { online: r.n, now };
  }

  if (url.pathname === '/admin/stats') {
    const day = 86400e3, msk = 3 * 3600e3, today = now - ((now + msk) % day);
    const s = await env.DB.prepare(`SELECT COUNT(*) AS total,
        SUM(updated_at > ?1) AS d1, SUM(updated_at > ?2) AS d7, SUM(created_at > ?3) AS newToday, SUM(created_at > ?2) AS new7,
        SUM(json_extract(state, '$.money')) AS money, SUM(worth) AS worth
      FROM players WHERE ${notAdmins()}`).bind(now - day, now - 7 * day, today).first();
    const rich = await env.DB.prepare(`SELECT id, name, json_extract(state, '$.money') AS money, worth, json_extract(state, '$.level') AS level, created_at
      FROM players WHERE ${notAdmins()} ORDER BY money + worth DESC LIMIT 10`).all();
    const plates = await env.DB.prepare('SELECT COUNT(*) AS n FROM plates').first();
    const refs = await env.DB.prepare('SELECT COUNT(*) AS n FROM referrals').first();
    const promo = await env.DB.prepare('SELECT COUNT(*) AS n FROM promo_uses').first();
    const online = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE (updated_at > ?1 OR last_seen > ?2) AND ${notAdmins()}`).bind(now - 120e3, now - 180e3).first();
    return { ...s, owner, online: online.n, plates: plates.n, referrals: refs.n, promoUses: promo.n, rich: rich.results, adminBot: await getSetting(env, 'admin_bot'),
      maintenance: await getSetting(env, 'maintenance'), now };
  }

  // рассылка: порциями по 40 (offset), чтобы уложиться в лимиты Cloudflare и Telegram
  if (url.pathname.startsWith('/admin/cont')) return contAdmin(env, url, body, user);
  if (url.pathname.startsWith('/admin/ecase')) return ecaseAdmin(env, url, body, user, owner);

  if (url.pathname === '/admin/broadcast') {
    const text = String(body.text || '').trim().slice(0, 3500);
    if (!text) return { error: 'Пустой текст' };
    const offset = Math.max(0, Number(body.offset) || 0);
    const rows = await env.DB.prepare('SELECT id FROM players ORDER BY id LIMIT 40 OFFSET ?').bind(offset).all();
    const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first()).n;
    const r = await sendBroadcast(env, rows.results.map(x => x.id), text, !!body.button);
    return { ...r, next: offset + rows.results.length, total, done: offset + rows.results.length >= total };
  }

  if (url.pathname === '/admin/admin-bot-setup') {
    await setSetting(env, 'admin_bot', null);
    await ensureAdminBot(env, url.origin);
    return { adminBot: await getSetting(env, 'admin_bot') };
  }

  // подозрительные аккаунты: зашли (обычно по приглашению), подписались на канал ради входа — и не играли.
  // Telegram не даёт боту список всех подписчиков, поэтому видны только те, кто хоть раз открыл игру.
  if (url.pathname === '/admin/suspects') {
    const where = `created_at < ?1 AND updated_at - created_at < 600000 AND sub_at > 0
      AND COALESCE(json_extract(state, '$.level'), 1) <= 1 AND COALESCE(json_extract(state, '$.stats.opened'), 0) <= 1 AND ${notAdmins()}`;
    const since = now - 86400e3;
    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${where}`).bind(since).first();
    const list = await env.DB.prepare(`SELECT p.id, p.name, p.username, p.created_at, r.ref_id FROM players p LEFT JOIN referrals r ON r.player_id = p.id
      WHERE ${where.replace(/\b(created_at|updated_at|sub_at|state)\b/g, 'p.$1')} ORDER BY p.created_at DESC LIMIT 300`).bind(since).all();
    // кто приводит больше всего пустых аккаунтов — так видна накрутка приглашений
    const inviters = await env.DB.prepare(`SELECT r.ref_id AS id, b.name, COUNT(*) AS total,
        SUM(CASE WHEN p.created_at < ?1 AND p.updated_at - p.created_at < 600000 AND COALESCE(json_extract(p.state, '$.level'), 1) <= 1 THEN 1 ELSE 0 END) AS empty
      FROM referrals r JOIN players p ON p.id = r.player_id LEFT JOIN players b ON b.id = r.ref_id
      GROUP BY r.ref_id HAVING empty >= 3 ORDER BY empty DESC LIMIT 30`).bind(since).all();
    return { total: total.n, list: list.results, inviters: inviters.results };
  }
  // убрать из канала (бан + сразу разбан: человек может вернуться сам, но статистика очищается)
  if (url.pathname === '/admin/suspects-kick') {
    if (!owner) return { error: 'Только владелец' };
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean).slice(0, 40);
    let kicked = 0, failed = 0;
    for (const id of ids) {
      const r = await tg(env, 'banChatMember', { chat_id: CHANNEL, user_id: id, until_date: Math.floor(now / 1000) + 60 });
      if (r.ok) { kicked++; await tg(env, 'unbanChatMember', { chat_id: CHANNEL, user_id: id, only_if_banned: true }); }
      else failed++;
    }
    // подписку проверим заново при следующем входе в игру
    if (ids.length) await env.DB.prepare(`UPDATE players SET sub_at = 0 WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
    return { kicked, failed };
  }

  if (url.pathname === '/admin/referrals') {
    const top = await env.DB.prepare(`SELECT r.ref_id AS id, p.name, COUNT(*) AS n FROM referrals r LEFT JOIN players p ON p.id = r.ref_id
      GROUP BY r.ref_id ORDER BY n DESC LIMIT 50`).all();
    const recent = await env.DB.prepare(`SELECT r.at, a.id AS friend_id, a.name AS friend, b.id AS ref_id, b.name AS inviter FROM referrals r
      JOIN players a ON a.id = r.player_id LEFT JOIN players b ON b.id = r.ref_id ORDER BY r.at DESC LIMIT 50`).all();
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM referrals').first();
    return { top: top.results, recent: recent.results, total: total.n };
  }

  if (url.pathname === '/admin/promos') {
    const list = await env.DB.prepare('SELECT code, reward, max_uses, uses, expires_at, active, created_at FROM promos ORDER BY created_at DESC LIMIT 100').all();
    return { promos: list.results.map(r => ({ ...r, reward: JSON.parse(r.reward) })), now };
  }

  if (url.pathname === '/admin/promo-create') {
    const code = promoCode(body.code);
    if (!/^[A-Z0-9А-ЯЁ_-]{3,32}$/.test(code)) return { error: 'Код: 3–32 символа, буквы, цифры, - и _' };
    let reward;
    try { reward = Rules.checkPromoReward(body.reward); } catch (e) { return { error: e.message }; }
    const maxUses = Math.max(0, Math.min(1e6, body.maxUses | 0));
    const hours = Math.max(0, Math.min(24 * 365, +body.hours || 0));
    const res = await env.DB.prepare('INSERT OR IGNORE INTO promos (code, reward, max_uses, uses, expires_at, active, created_at) VALUES (?, ?, ?, 0, ?, 1, ?)')
      .bind(code, JSON.stringify(reward), maxUses, hours ? now + hours * 3600e3 : 0, now).run();
    if (res.meta.changes !== 1) return { error: 'Такой промокод уже есть' };
    return { ok: true, code };
  }

  if (url.pathname === '/admin/promo-toggle') {
    await env.DB.prepare('UPDATE promos SET active = ? WHERE code = ?').bind(body.active ? 1 : 0, promoCode(body.code)).run();
    return { ok: true };
  }

  if (url.pathname === '/admin/promo-delete') {
    const code = promoCode(body.code);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM promos WHERE code = ?').bind(code),
      env.DB.prepare('DELETE FROM promo_uses WHERE code = ?').bind(code),
    ]);
    return { ok: true };
  }

  if (url.pathname === '/admin/maintenance') {
    const value = { on: !!body.on, text: String(body.text || '').slice(0, 300), at: now };
    await setSetting(env, 'maintenance', value);
    return { maintenance: value };
  }

  return { error: 'Не найдено' };
}

// криптографически стойкий генератор случайных чисел от 0 до 1
function secureRandom() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
}

// ---------- проверка подписи Telegram ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function authUser(request, env) {
  if (env.DEV === '1') {
    const dev = request.headers.get('X-Dev-User');
    if (dev) return { id: Number(dev), first_name: 'Dev' + dev, start_param: request.headers.get('X-Dev-Start') || '' };
  }
  const initData = request.headers.get('X-Init-Data');
  if (!initData) return null;
  // игра открыта из игрового бота, админ-приложение — из админ-бота: проверяем подпись обоими токенами
  for (const token of [env.BOT_TOKEN, env.ADMIN_BOT_TOKEN].filter(Boolean)) {
    const u = await checkInitData(initData, token);
    if (u) return u;
  }
  return null;
}

async function checkInitData(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const enc = new TextEncoder();
  const hmac = async (key, data) => {
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, typeof data === 'string' ? enc.encode(data) : data));
  };
  const secret = await hmac(enc.encode('WebAppData'), token);
  const sign = [...await hmac(secret, check)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (sign !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > INIT_DATA_TTL) return null;
  try { return { ...JSON.parse(params.get('user')), start_param: params.get('start_param') || '' }; } catch { return null; }
}
