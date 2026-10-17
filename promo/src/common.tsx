// Общие детали роликов: фон, субтитры в такт речи, номер, машины, монеты, призыв в конце
import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing, Sequence, random } from 'remotion';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadRoboto } from '@remotion/google-fonts/Roboto';
import voice from './voice.json';
import scripts from '../scripts.json';

export const { fontFamily: MONT } = loadMontserrat('normal', { weights: ['700', '900'], subsets: ['cyrillic', 'latin'] });
export const { fontFamily: ROBOTO } = loadRoboto('normal', { weights: ['500'], subsets: ['cyrillic', 'latin'] });

// ролик рендерится в 60 кадров/с (плавнее), а все тайминги сцен записаны в «кадрах 30 fps»:
// useF() отдаёт текущее время в этих единицах (дробное — поэтому движение плавное)
export const BASE = 30;
export const FPS = 60;
export const K = FPS / BASE;
export const useF = () => useCurrentFrame() / K;
export const RARITY = { D: '#8e8e93', C: '#0a84ff', B: '#bf5af2', A: '#ff9f0a', S: '#ff375f' } as const;

type Name = keyof typeof voice;
export type Seg = { from: number; dur: number; file: string; show: string; words: { t: number; d: number; w: string }[] };

// раскладка фраз по кадрам: gaps[i] — пауза перед фразой i (в кадрах)
export function timeline(name: Name, gaps: number[] = []): { segs: Seg[]; total: number } {
  let f = 4;
  const segs = voice[name].map((v, i) => {
    f += gaps[i] ?? 5;
    const seg = { from: f, dur: Math.ceil(v.dur * BASE), file: v.file, show: (scripts as any)[name][i].show, words: v.words };
    f += seg.dur;
    return seg;
  });
  return { segs, total: f + 40 };
}

// озвучка всех фраз
export const Voice: React.FC<{ segs: Seg[] }> = ({ segs }) => (
  <>{segs.map((s, i) => <Sequence key={i} from={Math.round(s.from * K)} durationInFrames={Math.round((s.dur + 2) * K)}><Audio src={staticFile(s.file)} /></Sequence>)}</>
);

// эмодзи как на iPhone: картинка public/emoji/<код>.png
export const emojiCode = (e: string) => [...e].map(c => c.codePointAt(0)!.toString(16)).join('-');
export const Emoji: React.FC<{ e: string; size?: number; style?: React.CSSProperties }> = ({ e, size = 80, style }) => (
  <Img src={staticFile(`emoji/${emojiCode(e)}.png`)} style={{ width: size, height: size, display: 'inline-block', verticalAlign: '-0.15em', ...style }} />
);
// текст, где эмодзи заменены картинками iPhone
const EMOJI_RE = /(\p{Extended_Pictographic}️?)/u;
export const withEmoji = (text: string, size: number) => text.split(EMOJI_RE).map((part, i) =>
  i % 2 ? <Emoji key={i} e={part} size={size} /> : part);

// фон: почти чёрный + неоновое свечение цвета сцены
export const Bg: React.FC<{ color: string; pulse?: boolean }> = ({ color, pulse }) => {
  const f = useF();
  const k = pulse ? 0.85 + 0.15 * Math.sin(f / 6) : 1;
  return <AbsoluteFill style={{ background: `radial-gradient(90% 55% at 50% 38%, ${color}${Math.round(0x66 * k).toString(16).padStart(2, '0')}, transparent 72%), #07080b` }} />;
};

// субтитры: вся фраза, текущее слово подсвечено и чуть увеличено (как в TikTok)
export const Captions: React.FC<{ segs: Seg[]; y?: number }> = ({ segs, y = 1230 }) => {
  const f = useF();
  const idx = segs.findIndex((s, i) => f >= (i === 0 ? 0 : s.from - 2) && f < (segs[i + 1]?.from ?? 1e9) - 2);
  if (idx < 0) return null;
  const s = segs[idx];
  // числа и «₽», «—» не отрываем от соседних слов
  const words = s.show.replace(/(\d) (?=\d)/g, '$1 ').replace(/ ₽/g, ' ₽').replace(/ —/g, ' —').split(' ');
  const p = Math.max(0, Math.min(0.999, (f - s.from) / s.dur));
  const active = f < s.from ? -1 : Math.floor(p * words.length);
  const enter = spring({ frame: f - (idx === 0 ? 0 : s.from - 2), fps: BASE, config: { damping: 14, stiffness: 180 } });
  return (
    <div style={{ position: 'absolute', left: 110, right: 110, top: y, textAlign: 'center', fontFamily: MONT, fontWeight: 900,
      fontSize: 54, lineHeight: 1.18, letterSpacing: -0.5, transform: `scale(${0.85 + 0.15 * enter})`, opacity: enter }}>
      {words.map((w, i) => (
        <span key={i} style={{ display: 'inline-block', margin: '0 10px', color: i === active ? '#ffd60a' : '#fff',
          transform: i === active ? 'scale(1.06)' : 'none', transition: 'none',
          textShadow: '0 4px 0 rgba(0,0,0,.5), 0 0 22px rgba(0,0,0,.7)' }}>{withEmoji(w, 50)}</span>
      ))}
    </div>
  );
};

// логотип сверху — весь ролик
export const Brand: React.FC = () => (
  <div style={{ position: 'absolute', top: 120, left: 0, right: 0, textAlign: 'center', fontFamily: MONT, fontWeight: 900, fontSize: 40,
    letterSpacing: 6, color: 'rgba(255,255,255,.85)' }}>DROPZONE<span style={{ color: '#64d2ff', marginLeft: 14 }}>AUTO</span></div>
);

// машина: фото сбоку
export const Car: React.FC<{ id: string; width?: number; style?: React.CSSProperties }> = ({ id, width = 900, style }) => (
  <Img src={staticFile(`cars/${id}.webp`)} style={{ width, height: 'auto', filter: 'drop-shadow(0 30px 30px rgba(0,0,0,.6))', ...style }} />
);

// ---------- номер ----------
const LETTERS = 'АВЕКМНОРСТУХ';
type Roll = { start: number; step: number; dur: number };
// символ номера; roll — прокрутка барабаном (символ «впечатывается» в конце)
const PlateChar: React.FC<{ ch: string; kind: 'l' | 'd' | 'r'; i: number; roll?: Roll; seed: string }> = ({ ch, kind, i, roll, seed }) => {
  const f = useF();
  const size = kind === 'l' ? 0.78 : kind === 'r' ? 0.66 : 1;
  const width = kind === 'l' ? 0.74 : 0.66;
  const box: React.CSSProperties = { display: 'inline-block', position: 'relative', height: '1em', width: `${width}em`, fontSize: `${size}em`, lineHeight: '1em', textAlign: 'center', overflow: 'hidden' };
  const glyph: React.CSSProperties = { color: '#2f2e29', textShadow: '0.01em 0.014em 0 rgba(255,255,255,.3)' };
  if (!roll) return <span style={box}><span style={glyph}>{ch}</span></span>;
  const s0 = roll.start + i * roll.step;
  if (f < s0) return <span style={box} />;
  const N = 10;
  const p = interpolate(f, [s0, s0 + roll.dur], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const pos = p * N;
  if (p >= 1) {
    const st = spring({ frame: f - s0 - roll.dur, fps: BASE, config: { damping: 10, stiffness: 200 } });
    return <span style={box}><span style={{ ...glyph, display: 'inline-block', transform: `scale(${1.35 - 0.35 * st})`, filter: `blur(${(1 - st) * 3}px)` }}>{ch}</span></span>;
  }
  const items = Array.from({ length: N + 1 }, (_, j) => j === N ? ch
    : kind === 'l' ? LETTERS[Math.floor(random(seed + i + j) * LETTERS.length)] : String(Math.floor(random(seed + i + j) * 10)));
  return (
    <span style={box}>
      {items.map((c, j) => {
        const off = j - pos;
        // виден только символ у центра; соседний въезжает сверху, сжимаясь, как на барабане
        if (Math.abs(off) > 0.6) return null;
        return <span key={j} style={{ ...glyph, position: 'absolute', left: 0, right: 0, top: 0, fontFamily: 'Segoe UI, Arial', fontWeight: 600,
          transform: `translateY(${off * 0.8}em) scaleY(${1 - Math.abs(off) * 0.6})`, opacity: Math.pow(1 - Math.abs(off) / 0.6, 1.5) }}>{c}</span>;
      })}
    </span>
  );
};

// номер «А 123 ВС | 77 RUS»: key вида 'А123ВС|77', null — пустая табличка
export const Plate: React.FC<{ k: string | null; size?: number; roll?: Roll; glow?: string; tilt?: number }> = ({ k, size = 120, roll, glow, tilt = 0 }) => {
  const m = k ? /^(.)(\d{3})(..)\|(\d+)$/.exec(k)! : null;
  const l1 = m ? m[1] : ' ', d = m ? m[2] : '   ', l23 = m ? m[3] : '  ', reg = m ? m[4] : '  ';
  const chars: { c: string; kind: 'l' | 'd' | 'r' }[] = [{ c: l1, kind: 'l' }, ...[...d].map(c => ({ c, kind: 'd' as const })),
    ...[...l23].map(c => ({ c, kind: 'l' as const }))];
  const regChars = [...reg].map(c => ({ c, kind: 'r' as const }));
  const empty = !k;
  return (
    <div style={{ display: 'inline-flex', fontSize: size, fontFamily: ROBOTO, fontWeight: 500, lineHeight: 1, background: 'linear-gradient(180deg,#fff,#f1f1ee 60%,#e2e3e0)',
      border: '0.06em solid #3d3c36', borderRadius: '0.13em', padding: '0.045em', transform: `perspective(1400px) rotateY(${tilt}deg)`,
      boxShadow: `inset 0 0 0 .035em #f6f6f3, inset 0 0 0 .06em #8d8b82, 0 .05em .15em rgba(0,0,0,.5)${glow ? `, 0 0 .25em ${glow}, 0 0 .7em ${glow}99` : ''}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', padding: '.07em .1em .05em', borderRight: '.055em solid #57554d' }}>
        {empty ? <span style={{ width: '4.4em', height: '1em', display: 'inline-block' }} />
          : chars.map((x, i) => <PlateChar key={i} ch={x.c} kind={x.kind} i={i} roll={roll} seed={k!} />)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '.06em .12em .04em' }}>
        <div style={{ display: 'flex' }}>{empty ? <span style={{ width: '1em', height: '.66em', display: 'inline-block' }} />
          : regChars.map((x, i) => <PlateChar key={i} ch={x.c} kind="r" i={chars.length + i} roll={roll} seed={k!} />)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.25em', fontSize: '.2em', color: '#2f2e29' }}>RUS
          <i style={{ width: '1.7em', height: '1.1em', border: '.06em solid #999', background: 'linear-gradient(#fff 33.3%, #0039a6 33.3% 66.6%, #d52b1e 66.6%)' }} /></div>
      </div>
    </div>
  );
};

// цена: выскакивает пружинкой
export const Price: React.FC<{ text: string; color: string; at: number; size?: number }> = ({ text, color, at, size = 96 }) => {
  const f = useF();
  if (f < at) return null;
  const s = spring({ frame: f - at, fps: BASE, config: { damping: 9, stiffness: 160 } });
  return <div style={{ fontFamily: MONT, fontWeight: 900, fontSize: size, color, transform: `scale(${0.4 + 0.6 * s})`, opacity: Math.min(1, s * 1.5),
    textShadow: `0 0 30px ${color}, 0 8px 0 rgba(0,0,0,.4)` }}>{text}</div>;
};

// дождь из монет / мешков с деньгами
export const Coins: React.FC<{ at: number; n?: number; emoji?: string }> = ({ at, n = 14, emoji = '💰' }) => {
  const f = useF();
  if (f < at) return null;
  return <>{Array.from({ length: n }, (_, i) => {
    const t = f - at - i * 2;
    if (t < 0) return null;
    const x = random('cx' + i) * 1000 + 40, rot = (random('cr' + i) - 0.5) * 80, sp = 26 + random('cs' + i) * 20;
    return <div key={i} style={{ position: 'absolute', left: x, top: -120 + t * sp, transform: `rotate(${rot + t * 3}deg)`, opacity: t > 50 ? 0 : 1 }}><Emoji e={emoji} size={100} /></div>;
  })}</>;
};

// вспышка экрана
export const Flash: React.FC<{ at: number; color?: string }> = ({ at, color = '#fff' }) => {
  const f = useF();
  const o = interpolate(f, [at, at + 2, at + 14], [0, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return o > 0 ? <AbsoluteFill style={{ background: color, opacity: o }} /> : null;
};

// тряска (смещение) около кадра at
export const shake = (f: number, at: number, power = 18) => {
  const t = f - at;
  if (t < 0 || t > 18) return 'none';
  const k = Math.pow(1 - t / 18, 2) * power * 0.6;
  return `translate(${Math.sin(t * 1.9) * k}px, ${Math.cos(t * 2.3) * k}px)`;
};

// призыв в конце: «Игра в Telegram — @dropezone_bot»
export const Cta: React.FC<{ at: number }> = ({ at }) => {
  const f = useF();
  if (f < at) return null;
  const s = spring({ frame: f - at, fps: BASE, config: { damping: 12, stiffness: 140 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: `rgba(7,8,11,${0.85 * s})` }}>
      <div style={{ transform: `scale(${0.6 + 0.4 * s})`, opacity: s, textAlign: 'center', fontFamily: MONT }}>
        <div style={{ fontSize: 66, fontWeight: 900, color: '#fff', letterSpacing: 4 }}>DROPZONE<span style={{ color: '#64d2ff', marginLeft: 16 }}>AUTO</span></div>
        <div style={{ marginTop: 40, display: 'inline-flex', alignItems: 'center', gap: 22, padding: '28px 48px', borderRadius: 999,
          background: 'linear-gradient(90deg,#2aabee,#229ed9)', boxShadow: '0 0 50px rgba(42,171,238,.7)', fontSize: 58, fontWeight: 900, color: '#fff' }}>
          <TgIcon />@dropezone_bot</div>
        <div style={{ marginTop: 30, fontSize: 42, fontWeight: 700, color: 'rgba(255,255,255,.75)' }}>Бесплатно в Telegram</div>
      </div>
    </AbsoluteFill>
  );
};

const TgIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#fff" />
    <path d="M5.5 11.8l11-4.3c.5-.2 1 .1.8.9l-1.9 8.9c-.1.6-.5.8-1 .5l-2.8-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.3-4.8c.2-.2 0-.3-.3-.1l-6.6 4.1-2.8-.9c-.6-.2-.6-.6.1-.9z" fill="#229ed9" /></svg>
);
