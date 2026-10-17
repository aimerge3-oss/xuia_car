// Ролик 1: «Сколько стоит твой номер?»
import React from 'react';
import { AbsoluteFill, interpolate, spring } from 'remotion';
import { timeline, Voice, Bg, Captions, Brand, Plate, Price, Coins, Flash, shake, Cta, FPS, RARITY, MONT , useF, BASE, Emoji, withEmoji } from './common';

export const platesTL = timeline('plates', [0, 4, 4, 4, 6, 8, 6]);

// какая табличка в какой фразе: номер, цена, цвет редкости
const STEPS = [
  null,
  { k: 'Х384КМ|42', price: '2 000 ₽', color: RARITY.D },
  { k: 'К777НМ|50', price: '100 000 ₽', color: RARITY.B },
  { k: 'Е777КХ|77', price: '13 000 000 ₽', color: RARITY.A },
  { k: 'А001АА|77', price: '20 000 000 ₽', color: RARITY.S },
];

export const Plates: React.FC = () => {
  const f = useF();
  const { segs } = platesTL;
  const cur = Math.max(0, segs.findIndex((s, i) => f < (segs[i + 1]?.from ?? 1e9)));
  const step = STEPS[Math.min(cur, 4)];
  const big = cur >= 4;
  const s = segs[Math.min(cur, 4)];
  const color = step?.color || '#64d2ff';
  const rollStart = s.from - 2;
  const priceAt = rollStart + (big ? 34 : 18);
  // вход таблички каждой новой фразы
  const enter = spring({ frame: f - (s.from - 4), fps: BASE, config: { damping: 13, stiffness: 170 } });
  const sway = Math.sin(f / 14) * 6;
  return (
    <AbsoluteFill style={{ transform: big ? shake(f, priceAt) : 'none' }}>
      <Bg color={color} pulse={big} />
      <Brand />
      {cur <= 4 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 380, gap: 70 }}>
          <div style={{ transform: `scale(${(big ? 1.08 : 0.92) * (0.7 + 0.3 * enter)})` }}>
            <Plate k={step?.k || null} size={big ? 175 : 150} tilt={sway}
              roll={step ? { start: rollStart, step: big ? 4 : 2, dur: big ? 22 : 12 } : undefined}
              glow={step && f > priceAt - 4 ? color : undefined} />
          </div>
          {step && <Price text={step.price} color={big ? '#ffd60a' : color} at={priceAt} size={big ? 130 : 100} />}
          {cur === 0 && <div style={{ opacity: interpolate(Math.sin(f / 5), [-1, 1], [0.6, 1]), transform: `scale(${1 + Math.sin(f / 5) * 0.05})` }}><Emoji e="❓" size={200} /></div>}
        </AbsoluteFill>
      )}
      {big && cur === 4 && <><Flash at={priceAt} /><Coins at={priceAt + 2} /></>}
      {cur === 5 && <Comments from={segs[5].from} />}
      <Captions segs={segs} />
      <Cta at={segs[6].from - 2} />
      <Voice segs={segs} />
    </AbsoluteFill>
  );
};

// «пиши свой номер в комменты»: всплывают комментарии с номерами
const Comments: React.FC<{ from: number }> = ({ from }) => {
  const f = useF();
  const list = ['А777МР 777 сколько? 😳', 'у меня О555ОО 99 🔥', 'оцени Е001КХ 77', 'а Х228ХХ 50? 😂'];
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 380, gap: 26, display: 'flex', flexDirection: 'column' }}>
      {list.map((t, i) => {
        const s = spring({ frame: f - from - i * 6, fps: BASE, config: { damping: 12, stiffness: 160 } });
        return <div key={i} style={{ transform: `translateX(${(1 - s) * (i % 2 ? 400 : -400)}px)`, opacity: s, alignSelf: i % 2 ? 'flex-end' : 'flex-start',
          margin: '0 90px', padding: '26px 40px', borderRadius: 40, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 50, fontWeight: 700,
          fontFamily: MONT }}><Emoji e="💬" size={46} /> {withEmoji(t, 46)}</div>;
      })}
    </AbsoluteFill>
  );
};
