// ===== Бот @cardrop_robot (ранее @dropezone_bot): ответ на /start и оформление =====
// Токен нового бота — секрет BOT_TOKEN: npx wrangler secret put BOT_TOKEN (значение 8911052980:AAENZ… от @cardrop_robot)
// Telegram присылает сообщения боту на POST /tg-webhook (подключается кнопкой «Настроить бота» в админ-панели).

const GAME_URL = 'https://aimerge3-oss.github.io/xuia_car/';
export const GAME_BOT_USERNAME = 'cardrop_robot';       // игровой бот
export const CHANNEL = '@ASQ_CAR_DROP';                 // канал игры (id -1004468309293, первый бот @cardrop_robot добавлен админом)
export const CHANNEL_ID = -1004468309293;
// вход в канал — прямая ссылка (бот-проверка channel_guardian относилась к старому каналу @dropezone_game)
export const CHANNEL_URL = 'https://t.me/ASQ_CAR_DROP';

const TEXTS = {
  // «Что умеет этот бот?» — видно до нажатия «Старт» (до 512 символов)
  description:
    '🏁 DROPZONE: AUTO — гараж твоей мечты прямо в Telegram!\n\n' +
    '🎰 Открывай кейсы и выбивай реальные тачки — от «копейки» до Koenigsegg\n' +
    '🔧 Ставь детали, сливай их в более крутые и прокачивай мощность\n' +
    '🚦 Разноси соперников на дрэге 402 м\n' +
    '🏆 Собери всю коллекцию и открой секретные машины\n\n' +
    'Жми «Старт» — бесплатный кейс уже ждёт 👇',
  // в профиле бота и при пересылке ссылки (до 120 символов)
  short: '🏎 Кейсы с реальными тачками, тюнинг и дрэг-гонки. Собери гараж мечты!',
  start: name =>
    `🔥 Здорово, <b>${name}</b>!\n\n` +
    'Добро пожаловать в <b>DROPZONE: AUTO</b> — здесь ты собираешь гараж из реальных тачек.\n\n' +
    '🎁 Тебя уже ждёт бесплатный стартовый кейс\n' +
    '🎰 Открывай кейсы → 🔧 тюнингуй → 🏁 разноси всех на дрэге\n\n' +
    'Погнали? 👇',
  other: '🏁 Вся движуха — в игре. Жми кнопку и залетай 👇',
  // по правилам Telegram у бота с оплатой должна быть команда /paysupport
  paysupport: '💬 Вопросы по оплате звёздами (не пришла покупка, возврат) — пиши в поддержку: @dropezone_help\n\nУкажи дату покупки и что покупал — разберёмся.',
};

const playButton = { inline_keyboard: [[{ text: '🏁 Играть', web_app: { url: GAME_URL } }]] };

const escHtml = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

export async function tg(env, method, body, token = env.BOT_TOKEN) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// секрет вебхука выводится из токена — отдельный секрет заводить не нужно
async function webhookSecret(env, token = env.BOT_TOKEN) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dropzone-webhook:' + token));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

// входящее сообщение от Telegram; pay — обработчики оплаты из index.js ({ check, paid })
export async function handleWebhook(request, env, pay) {
  if (!env.BOT_TOKEN) return new Response('no token', { status: 503 });
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await webhookSecret(env)) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await request.json().catch(() => null);
  // оплата звёздами: перед списанием Telegram спрашивает «можно?» — отвечать нужно за 10 секунд
  const pcq = update?.pre_checkout_query;
  if (pcq) {
    const err = pay ? await pay.check(pcq).catch(() => 'Ошибка, попробуй позже') : 'Оплата недоступна';
    await tg(env, 'answerPreCheckoutQuery', err ? { pre_checkout_query_id: pcq.id, ok: false, error_message: err } : { pre_checkout_query_id: pcq.id, ok: true });
    return new Response('ok');
  }
  const msg = update?.message;
  if (msg?.successful_payment) {
    if (pay) await pay.paid(msg.from, msg.successful_payment);
    return new Response('ok');
  }
  if (msg?.chat?.type === 'private' && typeof msg.text === 'string' && msg.text.startsWith('/paysupport')) {
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: TEXTS.paysupport });
    return new Response('ok');
  }
  if (msg?.chat?.type === 'private' && typeof msg.text === 'string') {
    const isStart = msg.text.startsWith('/start');
    await tg(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: isStart ? TEXTS.start(escHtml(msg.from?.first_name || 'гонщик')) : TEXTS.other,
      parse_mode: 'HTML',
      reply_markup: playButton,
    });
  }
  return new Response('ok');
}

// настройка бота одной кнопкой: вебхук, команды, описания, кнопка «Играть» у поля ввода
export async function setupBot(env, origin) {
  // ожидаемое имя бота — из GAME_BOT (js/data.js): @cardrop_robot
  const bot = globalThis.GAME_BOT?.username || 'cardrop_robot';
  const steps = [
    ['Вебхук', 'setWebhook', {
      url: origin + '/tg-webhook', secret_token: await webhookSecret(env),
      allowed_updates: ['message', 'pre_checkout_query'], drop_pending_updates: true,
    }],
    ['Команды', 'setMyCommands', { commands: [{ command: 'start', description: '🏁 Запустить игру' }, { command: 'paysupport', description: '💬 Помощь с оплатой' }] }],
    ['Описание', 'setMyDescription', { description: TEXTS.description }],
    ['Короткое описание', 'setMyShortDescription', { short_description: TEXTS.short }],
    ['Кнопка «Играть»', 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: GAME_URL } } }],
  ];
  const report = [];
  for (const [name, method, body] of steps) {
    const r = await tg(env, method, body);
    report.push({ name, ok: !!r.ok, error: r.ok ? undefined : r.description });
  }
  // проверка: секрет BOT_TOKEN должен принадлежать нужному боту (@cardrop_robot)
  const me = await tg(env, 'getMe', {});
  if (me.ok && me.result?.username && me.result.username.toLowerCase() !== bot) {
    report.push({ name: 'Бот', ok: false, error: `токен от @${me.result.username}, а ожидается @${bot} — обнови секрет BOT_TOKEN` });
  } else if (me.ok) {
    report.push({ name: 'Бот', ok: true });
  }
  // для проверки подписки бот должен быть админом канала
  const chMember = await tg(env, 'getChatMember', { chat_id: CHANNEL, user_id: Number(env.BOT_TOKEN.split(':')[0]) });
  const isAdm = chMember.ok && ['administrator', 'creator'].includes(chMember.result.status);
  report.push({ name: 'Канал', ok: isAdm, error: isAdm ? undefined : 'добавь бота админом в канал ' + CHANNEL });
  return { report };
}

// ---------- покупка: спасибо игроку ----------
export async function notifyPurchase(env, userId, text) {
  try { await tg(env, 'sendMessage', { chat_id: userId, text, parse_mode: 'HTML', reply_markup: playButton }); } catch (e) { console.error(e); }
}

// ---------- приглашения: сообщаем пригласившему ----------
export async function notifyReferral(env, inviterId, friendName, amount, minLevel) {
  if (!env.BOT_TOKEN) return;
  try {
    await tg(env, 'sendMessage', {
      chat_id: inviterId,
      text: `🎉 По твоей ссылке в игру пришёл <b>${escHtml(friendName || 'новый гонщик')}</b>!\n\n💰 ${amount.toLocaleString('ru-RU')} ₽ придут тебе, когда друг дойдёт до ${minLevel} уровня. Зови ещё 👇`,
      parse_mode: 'HTML',
      reply_markup: playButton,
    });
  } catch (e) { console.error(e); }   // игрок мог не запускать бота — это не ошибка
}

export async function notifyReferralPaid(env, inviterId, friendName, amount, minLevel) {
  if (!env.BOT_TOKEN) return;
  try {
    await tg(env, 'sendMessage', {
      chat_id: inviterId,
      text: `🚀 Твой друг <b>${escHtml(friendName || 'гонщик')}</b> дошёл до ${minLevel} уровня!\n\n💰 +${amount.toLocaleString('ru-RU')} ₽ уже на балансе 👇`,
      parse_mode: 'HTML',
      reply_markup: playButton,
    });
  } catch (e) { console.error(e); }
}

// ---------- рейтинг: сообщение победителю недели ----------
export async function notifyWeekPrize(env, userId, place, amount) {
  if (!env.BOT_TOKEN) return;
  const medal = ['🥇', '🥈', '🥉'][place - 1] || '🏆';
  try {
    await tg(env, 'sendMessage', {
      chat_id: userId,
      text: `${medal} Неделя закончилась — ты на <b>${place} месте</b> в рейтинге!\n\n💰 Приз <b>+${amount.toLocaleString('ru-RU')} ₽</b> уже на балансе. Новая неделя — новая гонка 👇`,
      parse_mode: 'HTML',
      reply_markup: playButton,
    });
  } catch (e) { console.error(e); }
}

// ---------- сезоны: сообщение призёру и пост в канал с топ-10 ----------
export async function notifySeasonPrize(env, userId, season, place, prize) {
  if (!env.BOT_TOKEN || !prize) return;
  const medal = ['🥇', '🥈', '🥉'][place - 1] || '🏅';
  const gift = [prize.stars && `⭐ <b>${prize.stars} звёзд</b> на покупки в магазине`, `🏅 значок «${escHtml(prize.title)}» в профиле`].filter(Boolean).join('\n');
  try {
    await tg(env, 'sendMessage', {
      chat_id: userId,
      text: `${medal} Сезон ${season} завершён — ты на <b>${place} месте</b>!\n\n${gift}\n\nНаграда придёт, как только зайдёшь в игру. Новый сезон уже начался 👇`,
      parse_mode: 'HTML', reply_markup: playButton,
    });
  } catch (e) { console.error(e); }
}
export async function postSeasonTop(env, season, top) {
  if (!env.BOT_TOKEN || !top.length) return;
  const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(2).replace('.', ',') + ' млрд' : (n / 1e6).toFixed(1).replace('.', ',') + ' млн';
  const lines = top.map((p, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${escHtml(p.name || 'Гонщик')} — ${fmt(p.v)} ₽`).join('\n');
  try {
    await tg(env, 'sendMessage', {
      chat_id: CHANNEL,
      text: `🏁 <b>Сезон ${season} завершён!</b>\n\nЛучшие гаражи сезона:\n${lines}\n\nПоздравляем победителей 🎉 Новый сезон уже стартовал — все начинают с нуля, у каждого есть шанс 👇`,
      parse_mode: 'HTML', reply_markup: playButton,
    });
  } catch (e) { console.error(e); }
}

// ---------- подписка на канал ----------
const subCache = new Map();   // id → { ok, t } — чтобы не спрашивать Telegram на каждое действие
const SUB_CACHE_MS = 2 * 60e3;

// Telegram так отвечает про людей, которых нет среди участников канала (никогда не были или давно ушли) — это «не подписан»
const NOT_MEMBER_ERRORS = ['PARTICIPANT_ID_INVALID', 'USER_NOT_PARTICIPANT', 'user not found', 'member not found'];
const isNotMemberError = d => NOT_MEMBER_ERRORS.some(x => String(d || '').includes(x));

// для админки: что Telegram говорит о подписке игрока
export async function subStatus(env, userId) {
  if (!env.BOT_TOKEN) return { error: 'нет токена' };
  const r = await tg(env, 'getChatMember', { chat_id: CHANNEL, user_id: userId });
  if (r.ok) return { status: r.result.status, isMember: r.result.is_member };
  return isNotMemberError(r.description) ? { status: 'left' } : { error: r.description };
}

// fresh — проверить заново (при запуске игры); если Telegram не ответил — пускаем, чтобы игра не сломалась
export async function isSubscribed(env, userId, fresh) {
  if (!env.BOT_TOKEN) return true;
  const c = subCache.get(userId);
  if (!fresh && c && Date.now() - c.t < SUB_CACHE_MS) return c.ok;
  let ok = true;
  try {
    const r = await tg(env, 'getChatMember', { chat_id: CHANNEL, user_id: userId });
    if (r.ok) {
      const m = r.result;
      ok = ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member);
    } else if (isNotMemberError(r.description)) ok = false;
    else console.error('getChatMember', r.description);   // другие ошибки (бот не админ и т.п.) — пускаем
  } catch (e) { console.error(e); }
  subCache.set(userId, { ok, t: Date.now() });
  return ok;
}

// ===== Админ-бот: только кнопка «Открыть админку» (админ-приложение admin.html) =====
// Токен — секрет ADMIN_BOT_TOKEN (владелец вводит сам: npx wrangler secret put ADMIN_BOT_TOKEN)
export const ADMIN_APP_URL = 'https://f1rst11.github.io/dropzone-auto/admin.html';
const adminButton = { inline_keyboard: [[{ text: '🛠 Открыть админку', web_app: { url: ADMIN_APP_URL } }]] };

export async function handleAdminWebhook(request, env, isAdminId, handlers = {}) {
  if (!env.ADMIN_BOT_TOKEN) return new Response('no token', { status: 503 });
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await webhookSecret(env, env.ADMIN_BOT_TOKEN)) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await request.json().catch(() => null);
  // нажатие кнопки под сообщением: подтвердить / отклонить временный кейс
  const cq = update?.callback_query;
  if (cq) {
    const [, act, id] = /^(eca|ecr):(.+)$/.exec(cq.data || '') || [];
    const text = act && handlers.ecase ? await handlers.ecase(id, act === 'eca', cq.from?.id) : 'Неизвестная кнопка';
    await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190) }, env.ADMIN_BOT_TOKEN);
    if (cq.message && /^(✅|❌)/.test(text)) {
      await tg(env, 'editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id,
        text: `${cq.message.text}\n\n${text}` }, env.ADMIN_BOT_TOKEN);
    }
    return new Response('ok');
  }
  const msg = update?.message;
  if (msg?.chat?.type === 'private') {
    const ok = isAdminId(msg.from?.id);
    await tg(env, 'sendMessage', ok
      ? { chat_id: msg.chat.id, text: '🛠 Админка DROPZONE: AUTO', reply_markup: adminButton }
      : { chat_id: msg.chat.id, text: `Это служебный бот. Игра — @${GAME_BOT_USERNAME} 🏁` }, env.ADMIN_BOT_TOKEN);
  }
  return new Response('ok');
}

// настройка админ-бота: вебхук + кнопка «Админка» у поля ввода (вызывается сама, когда появляется токен)
export async function setupAdminBot(env, origin) {
  if (!env.ADMIN_BOT_TOKEN) return { ok: false, error: 'нет ADMIN_BOT_TOKEN' };
  const t = env.ADMIN_BOT_TOKEN;
  const a = await tg(env, 'setWebhook', { url: origin + '/tg-admin-webhook', secret_token: await webhookSecret(env, t),
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }, t);
  const b = await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Админка', web_app: { url: ADMIN_APP_URL } } }, t);
  await tg(env, 'setMyShortDescription', { short_description: 'Служебный бот DROPZONE: AUTO' }, t);
  return { ok: !!(a.ok && b.ok), error: a.ok ? b.description : a.description };
}

// рассылка игрокам через игрового бота: одна порция (лимит запросов на вызов у Cloudflare)
export async function sendBroadcast(env, ids, text, withButton) {
  let sent = 0, failed = 0;
  for (const id of ids) {
    try {
      const r = await tg(env, 'sendMessage', { chat_id: id, text, parse_mode: 'HTML', ...(withButton ? { reply_markup: playButton } : {}) });
      if (r.ok) sent++; else failed++;
    } catch { failed++; }
  }
  return { sent, failed };
}
