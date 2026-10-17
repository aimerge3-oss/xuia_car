// Ролик 2: «Открыл кейс за 500 000 ₽ — Lamborghini?!»
import React from 'react';
import { AbsoluteFill, interpolate, spring, Easing, random } from 'remotion';
import { timeline, Voice, Bg, Captions, Brand, Car, Price, Coins, Flash, shake, Cta, FPS, RARITY, MONT , useF, BASE, Emoji, withEmoji } from './common';

export const caseTL = timeline('case', [0, 4, 6, 4, 8, 6]);

// лента рулетки: машины из Городского кейса, в конце — Huracán
const POOL = ['priora', 'niva', 'volga24', 'w124', 'corolla', 'e36', 'golf2', 'priora', 'niva', 'volga24'];
const RAR: Record<string, string> = { priora: 'D', niva: 'D', volga24: 'C', w124: 'D', corolla: 'D', e36: 'D', golf2: 'D', huracan: 'A', supra: 'B' };
const ITEM = 300, GAP = 24, WIN = 34;
const strip = Array.from({ length: WIN + 4 }, (_, i) => i === WIN ? 'huracan' : i === WIN - 3 ? 'supra' : POOL[Math.floor(random('c' + i) * POOL.length)]);

export const Case: React.FC = () => {
  const f = useF();
  const { segs } = caseTL;
  const spinFrom = segs[1].from - 6, revealAt = segs[3].from - 2;
  const spinning = f >= spinFrom && f < revealAt + 10;
  // лента: быстро, потом всё медленнее к «Подожди…», останавливается на Huracán
  const p = interpolate(f, [spinFrom, revealAt], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.1, 0.7, 0.2, 1) });
  const target = WIN * (ITEM + GAP) + ITEM / 2 - 540;
  const x = -p * target;
  const zoom = f >= segs[2].from - 4 && f < revealAt ? interpolate(f, [segs[2].from - 4, revealAt], [1, 1.12]) : 1;
  const revealed = f >= revealAt;
  const rs = spring({ frame: f - revealAt, fps: BASE, config: { damping: 11, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ transform: shake(f, revealAt, 26) }}>
      <Bg color={revealed ? RARITY.A : '#0a84ff'} pulse={revealed} />
      <Brand />
      {f < spinFrom && <CaseCard from={0} />}
      {spinning && !revealed && (
        <AbsoluteFill style={{ justifyContent: 'center', paddingBottom: 380, transform: `scale(${zoom})` }}>
          <div style={{ position: 'relative', height: 300, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 540, top: 0, bottom: 0, width: 8, marginLeft: -4, background: '#ffd60a', zIndex: 2, boxShadow: '0 0 30px #ffd60a' }} />
            <div style={{ position: 'absolute', top: 10, left: 0, display: 'flex', gap: GAP, transform: `translateX(${x}px)` }}>
              {strip.map((id, i) => (
                <div key={i} style={{ width: ITEM, height: 280, borderRadius: 36, background: 'rgba(255,255,255,.08)', border: `5px solid ${(RARITY as any)[RAR[id]]}`,
                  boxShadow: `inset 0 -60px 80px -60px ${(RARITY as any)[RAR[id]]}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Car id={id} width={270} />
                </div>
              ))}
            </div>
          </div>
        </AbsoluteFill>
      )}
      {revealed && f < segs[4].from && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 380, gap: 40 }}>
          <div style={{ transform: `scale(${0.5 + 0.55 * rs})`, filter: `drop-shadow(0 0 60px ${RARITY.A})` }}><Car id="huracan" width={1000} /></div>
          <div style={{ fontFamily: MONT, fontWeight: 900, fontSize: 46, padding: '10px 30px', borderRadius: 16, background: RARITY.A, color: '#fff', opacity: rs }}>A · ЛЕГЕНДАРНАЯ</div>
          <Price text="32 000 000 ₽" color="#ffd60a" at={revealAt + 10} size={120} />
        </AbsoluteFill>
      )}
      <Flash at={revealAt} color="#ff9f0a" />
      <Coins at={revealAt + 6} n={16} emoji="✨" />
      {f >= segs[4].from && f < segs[5].from && <Cases from={segs[4].from} />}
      <Captions segs={segs} />
      <Cta at={segs[5].from - 2} />
      <Voice segs={segs} />
    </AbsoluteFill>
  );
};

// кейс в начале: нажимается кнопка «Открыть»
const CaseCard: React.FC<{ from: number }> = () => {
  const f = useF();
  const press = f > 34 && f < 44 ? 0.92 : 1;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 380, gap: 50 }}>
      <div style={{ transform: `rotate(${Math.sin(f / 4) * 6}deg)` }}><Emoji e="🏙️" size={260} /></div>
      <div style={{ fontFamily: MONT, fontWeight: 900, fontSize: 70, color: '#fff' }}>Городской кейс</div>
      <div style={{ fontFamily: MONT, fontWeight: 900, fontSize: 56, color: '#fff', padding: '34px 80px', borderRadius: 36, background: '#0a84ff',
        transform: `scale(${press})`, boxShadow: '0 0 40px rgba(10,132,255,.7)' }}>Открыть · 500 000 ₽</div>
    </AbsoluteFill>
  );
};

// «а что выпадет тебе?»: кейсы прыгают
const Cases: React.FC<{ from: number }> = ({ from }) => {
  const f = useF();
  const list = ['🧰', '🏙️', '🏁', '👑'];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 380, flexDirection: 'row', gap: 50 }}>
      {list.map((e, i) => {
        const s = spring({ frame: f - from - i * 4, fps: BASE, config: { damping: 9, stiffness: 180 } });
        return <div key={i} style={{ transform: `translateY(${(1 - s) * 200 + Math.sin((f + i * 8) / 5) * 14}px)`, opacity: s }}><Emoji e={e} size={170} /></div>;
      })}
    </AbsoluteFill>
  );
};
