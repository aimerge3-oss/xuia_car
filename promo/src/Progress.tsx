// Ролик 3: «От копейки до Koenigsegg»
import React from 'react';
import { AbsoluteFill, interpolate, spring, Img, staticFile } from 'remotion';
import { timeline, Voice, Bg, Captions, Brand, Car, Coins, Flash, Cta, FPS, RARITY, MONT , useF, BASE, Emoji, withEmoji } from './common';

export const progressTL = timeline('progress', [0, 3, 3, 3, 3, 4, 6, 6]);

// машина и стоимость гаража в каждой фразе
const STAGES = [
  { car: 'vaz2101', worth: 60e3, hp: 64, color: RARITY.D },
  { car: 'vaz2101', worth: 2.1e6, hp: 118, color: '#bf5af2', parts: true },
  { car: 'vaz2101', worth: 2.1e6, hp: 118, color: '#30d158', race: true },
  { car: 'supra', worth: 8e6, hp: 330, color: RARITY.B },
  { car: 'huracan', worth: 32e6, hp: 640, color: RARITY.A },
  { car: 'jesko', worth: 330e6, hp: 1600, color: '#ffd60a' },
  { car: 'vaz2101', worth: 60e3, hp: 64, color: RARITY.D },
];
const fmt = (n: number) => n >= 1e6 ? (Math.round(n / 1e5) / 10).toString().replace('.', ',') + ' млн ₽' : Math.round(n).toLocaleString('ru-RU') + ' ₽';

export const Progress: React.FC = () => {
  const f = useF();
  const { segs } = progressTL;
  const cur = Math.max(0, Math.min(STAGES.length - 1, segs.findIndex((s, i) => f < (segs[i + 1]?.from ?? 1e9))));
  const st = STAGES[cur];
  const s = segs[cur];
  const prev = STAGES[Math.max(0, cur - 1)];
  // стоимость гаража плавно растёт к новой
  const worth = interpolate(f, [s.from - 4, s.from + 14], [cur ? prev.worth : st.worth, st.worth], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const swap = st.car !== prev.car && cur > 0;
  const enter = swap ? spring({ frame: f - (s.from - 4), fps: BASE, config: { damping: 14, stiffness: 120 } }) : 1;
  const jesko = cur === 5;
  return (
    <AbsoluteFill>
      <Bg color={st.color} pulse={jesko} />
      <Brand />
      {/* стоимость гаража */}
      <div style={{ position: 'absolute', top: 230, left: 0, right: 0, textAlign: 'center', fontFamily: MONT }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: 'rgba(255,255,255,.6)' }}>Стоимость гаража</div>
        <div style={{ fontSize: 92, fontWeight: 900, color: jesko ? '#ffd60a' : '#fff', textShadow: jesko ? '0 0 30px #ffd60a' : 'none' }}>{fmt(worth)}</div>
      </div>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 300 }}>
        <div style={{ transform: `translateX(${(1 - enter) * 1100}px) scale(${jesko ? 1.08 : 1})`, filter: jesko ? 'drop-shadow(0 0 60px #ffd60a)' : 'none' }}>
          <Car id={st.car} width={980} />
        </div>
        <div style={{ marginTop: 20, fontFamily: MONT, fontWeight: 900, fontSize: 56, color: '#fff', opacity: 0.9 }}>{st.hp} л.с.</div>
        {st.parts && <Parts from={s.from - 4} />}
        {st.race && <Race from={s.from - 4} />}
      </AbsoluteFill>
      {jesko && <><Flash at={s.from - 2} color="#ffd60a" /><Coins at={s.from + 2} n={16} /></>}
      {cur === 6 && <div style={{ position: 'absolute', top: 400, left: 0, right: 0, textAlign: 'center' }}><Emoji e="😅" size={170} /></div>}
      <Captions segs={segs} />
      <Cta at={segs[7].from - 2} />
      <Voice segs={segs} />
    </AbsoluteFill>
  );
};

// детали прилетают к машине
const Parts: React.FC<{ from: number }> = ({ from }) => {
  const f = useF();
  return <>{['turbo', 'engine', 'exhaust', 'wheels'].map((p, i) => {
    const t = interpolate(f, [from + i * 4, from + i * 4 + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const x = interpolate(t, [0, 1], [i % 2 ? 700 : -700, (i - 1.5) * 160]);
    return <Img key={p} src={staticFile(`parts/${p}.webp`)} style={{ position: 'absolute', top: 640 + (i % 2) * 40, left: 540 - 70 + x, width: 140, opacity: t < 1 ? 1 : 1 - (f - from - i * 4 - 12) / 10,
      filter: 'drop-shadow(0 0 20px #bf5af2)' }} />;
  })}</>;
};

// мини-табло гонки: ты обгоняешь соперника
const Race: React.FC<{ from: number }> = ({ from }) => {
  const f = useF();
  const me = interpolate(f, [from, from + 30], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const bot = interpolate(f, [from, from + 30], [0, 82], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const bar = (w: number, c: string, label: string) => (
    <div style={{ width: 800, marginTop: 18 }}>
      <div style={{ fontFamily: MONT, fontSize: 34, fontWeight: 700, color: 'rgba(255,255,255,.8)' }}>{label}</div>
      <div style={{ height: 30, borderRadius: 15, background: 'rgba(255,255,255,.12)', marginTop: 8 }}><div style={{ width: `${w}%`, height: '100%', borderRadius: 15, background: c }} /></div>
    </div>
  );
  return <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    {bar(me, 'linear-gradient(90deg,#0a84ff,#64d2ff)', 'Ты')}{bar(bot, 'linear-gradient(90deg,#ff453a,#ff9f0a)', 'Соперник')}
    {me >= 100 && <div style={{ marginTop: 24, fontFamily: MONT, fontWeight: 900, fontSize: 64, color: '#30d158', textShadow: '0 0 24px #30d158' }}><Emoji e="🏆" size={64} /> ПОБЕДА</div>}
  </div>;
};
