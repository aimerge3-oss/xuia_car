// Ролик «Шанс 0,38%»: кейс «Спорткар» — рулетка тормозит в шаге от LaFerrari… и доползает. Без озвучки, ~14 с.
import React from 'react';
import { AbsoluteFill, interpolate, spring, Easing, random } from 'remotion';
import { Bg, Brand, Car, Price, Coins, Flash, shake, Cta, RARITY, MONT, useF, BASE, Emoji } from './common';

// тайминги — в «кадрах 30 fps»
const SPIN_FROM = 46;      // нажали «Открыть»
const STOP = 250;          // лента встала… на соседней машине
const CREEP_FROM = 268;    // пауза — и лента доползает
const REVEAL = 294;        // LaFerrari!
const CTA = 372;
export const DROP_TOTAL = 420;

const POOL = ['civictyper', 'wrxsti', 'golfgti', 'camaro', 'ae86', 'evo9', 's15', 'm3e46', 'supra', 'mustang67', 'giuliaqv', 'hellcat'];
const RAR: Record<string, keyof typeof RARITY> = { civictyper: 'C', wrxsti: 'C', golfgti: 'C', camaro: 'C', ae86: 'C', evo9: 'B', s15: 'B', m3e46: 'B',
  supra: 'B', mustang67: 'B', giuliaqv: 'B', hellcat: 'B', huracan: 'A', p911ts: 'A', laferrari: 'S', svj: 'S' };
const ITEM = 300, GAP = 24, STEP = ITEM + GAP, WIN = 44;
// лента: в конце — Huracán (почти!), потом обычная машина, на которой «встанет», и LaFerrari
const strip = Array.from({ length: WIN + 5 }, (_, i) =>
  i === WIN ? 'laferrari' : i === WIN - 1 ? 'm3e46' : i === WIN - 4 ? 'huracan' : i === WIN - 9 ? 'svj' : i === WIN + 1 ? 'p911ts'
    : POOL[Math.floor(random('d' + i) * POOL.length)]);
const centerX = (i: number) => -(i * STEP + ITEM / 2 - 540);

export const Drop: React.FC = () => {
  const f = useF();
  const revealed = f >= REVEAL;
  // 1) крутится и тормозит до правого края соседней машины  2) пауза  3) доползает до LaFerrari
  const stopX = centerX(WIN - 1) - (ITEM / 2 - 22);
  const p1 = interpolate(f, [SPIN_FROM, STOP], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.08, 0.75, 0.16, 1) });
  const p2 = interpolate(f, [CREEP_FROM, REVEAL - 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const x = p1 * stopX + p2 * (centerX(WIN) - stopX);
  const zoom = interpolate(f, [SPIN_FROM, 170, STOP, REVEAL], [1.12, 1.12, 1.26, 1.36], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // «сердцебиение» в паузе
  const beat = f >= STOP && f < REVEAL ? 1 + 0.02 * Math.max(0, Math.sin((f - STOP) / 2.2)) : 1;
  const rs = spring({ frame: f - REVEAL, fps: BASE, config: { damping: 11, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ transform: shake(f, REVEAL, 30) }}>
      <Bg color={revealed ? RARITY.S : f >= STOP ? '#3a0d12' : '#0a84ff'} pulse={revealed || f >= STOP} />
      <Brand />

      {/* заголовок-крючок: весь ролик сверху */}
      <Hook />

      {f < SPIN_FROM && <CaseCard />}

      {f >= SPIN_FROM - 2 && !revealed && (
        <AbsoluteFill style={{ justifyContent: 'center', paddingBottom: 260, transform: `scale(${zoom * beat})` }}>
          <div style={{ position: 'relative', height: 320, overflow: 'hidden', opacity: interpolate(f, [SPIN_FROM - 2, SPIN_FROM + 6], [0, 1], { extrapolateRight: 'clamp' }) }}>
            <div style={{ position: 'absolute', left: 540, top: 0, bottom: 0, width: 8, marginLeft: -4, background: '#ffd60a', zIndex: 2, boxShadow: '0 0 30px #ffd60a' }} />
            <div style={{ position: 'absolute', top: 16, left: 0, display: 'flex', gap: GAP, transform: `translateX(${x}px)` }}>
              {strip.map((id, i) => {
                const c = RARITY[RAR[id]];
                return (
                  <div key={i} style={{ width: ITEM, height: 288, borderRadius: 36, background: 'rgba(255,255,255,.07)', border: `5px solid ${c}`,
                    boxShadow: `inset 0 -70px 90px -60px ${c}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                    <Car id={id} width={270} />
                  </div>
                );
              })}
            </div>
            {/* края ленты уходят в темноту */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,#07080b 0%,transparent 22%,transparent 78%,#07080b 100%)', zIndex: 1 }} />
          </div>
        </AbsoluteFill>
      )}

      {revealed && f < CTA + 6 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 260, gap: 36 }}>
          <div style={{ transform: `scale(${0.45 + 0.6 * rs}) translateY(${(1 - rs) * 60}px)`, filter: `drop-shadow(0 0 70px ${RARITY.S})` }}><Car id="laferrari" width={1000} /></div>
          <div style={{ fontFamily: MONT, fontWeight: 900, fontSize: 50, padding: '12px 34px', borderRadius: 18, background: RARITY.S, color: '#fff',
            opacity: rs, transform: `scale(${0.7 + 0.3 * rs})`, letterSpacing: 2 }}>S · МИФИЧЕСКАЯ</div>
          <Price text="300 000 000 ₽" color="#ffd60a" at={REVEAL + 12} size={118} />
        </AbsoluteFill>
      )}

      <Flash at={REVEAL} color="#ff375f" />
      <Coins at={REVEAL + 6} n={18} emoji="✨" />
      <Coins at={REVEAL + 20} n={12} emoji="💰" />
      <Lines />
      <Cta at={CTA} />
    </AbsoluteFill>
  );
};

// крупная фраза сверху ролика
const Hook: React.FC = () => {
  const f = useF();
  if (f >= CTA) return null;
  const s = spring({ frame: f, fps: BASE, config: { damping: 12, stiffness: 160 } });
  return (
    <div style={{ position: 'absolute', top: 230, left: 60, right: 60, textAlign: 'center', fontFamily: MONT, fontWeight: 900, fontSize: 76, lineHeight: 1.1,
      color: '#fff', transform: `scale(${0.7 + 0.3 * s})`, opacity: s, textShadow: '0 6px 0 rgba(0,0,0,.5), 0 0 30px rgba(0,0,0,.6)' }}>
      Шанс выпадения<br /><span style={{ color: '#ff375f', fontSize: 120 }}>0,38%</span>
    </div>
  );
};

// подписи-реакции по ходу (как субтитры в TikTok)
const LINES: { at: number; to: number; text: string; color?: string; emoji?: string }[] = [
  { at: 4, to: SPIN_FROM, text: 'Открываю кейс «Спорткар»' },
  { at: SPIN_FROM + 4, to: 150, text: 'Крутим…', emoji: '🏁' },
  { at: 150, to: STOP - 6, text: 'Медленнее… медленнее…' },
  { at: STOP, to: CREEP_FROM, text: 'НЕЕЕТ… МИМО', color: '#ff453a', emoji: '😳' },
  { at: CREEP_FROM, to: REVEAL, text: 'ПОДОЖДИ…', color: '#ffd60a' },
  { at: REVEAL + 4, to: CTA, text: 'Я НЕ ВЕРЮ', color: '#ffd60a', emoji: '🔥' },
];
const Lines: React.FC = () => {
  const f = useF();
  const l = LINES.find(x => f >= x.at && f < x.to);
  if (!l) return null;
  const s = spring({ frame: f - l.at, fps: BASE, config: { damping: 10, stiffness: 200 } });
  return (
    <div style={{ position: 'absolute', top: 1330, left: 60, right: 60, textAlign: 'center', fontFamily: MONT, fontWeight: 900, fontSize: 70, color: l.color || '#fff',
      transform: `scale(${0.6 + 0.4 * s})`, opacity: s, textShadow: '0 6px 0 rgba(0,0,0,.55), 0 0 26px rgba(0,0,0,.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      {l.text}{l.emoji && <Emoji e={l.emoji} size={84} />}
    </div>
  );
};

// кейс в начале: кнопка нажимается
const CaseCard: React.FC = () => {
  const f = useF();
  const press = f > 32 && f < 42 ? 0.92 : 1;
  const s = spring({ frame: f, fps: BASE, config: { damping: 12, stiffness: 140 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 200, gap: 50, opacity: interpolate(f, [SPIN_FROM - 6, SPIN_FROM], [1, 0], { extrapolateLeft: 'clamp' }) }}>
      <div style={{ transform: `scale(${s}) rotate(${Math.sin(f / 4) * 6}deg)` }}><Emoji e="🏁" size={260} /></div>
      <div style={{ fontFamily: MONT, fontWeight: 900, fontSize: 56, color: '#fff', padding: '34px 80px', borderRadius: 36, background: '#0a84ff',
        transform: `scale(${press})`, boxShadow: '0 0 40px rgba(10,132,255,.7)' }}>Открыть · 2 500 000 ₽</div>
    </AbsoluteFill>
  );
};
