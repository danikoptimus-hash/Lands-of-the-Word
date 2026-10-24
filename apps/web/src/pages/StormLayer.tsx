import { useEffect, useRef } from "react";

/**
 * Буря над картой (решение владельца 24.10): тучи и мгла — CSS-слои (плывут по компоновщику, дёшево), ливень и молнии —
 * один canvas 2D в разрешении 1 пиксель на CSS-пиксель, 30 кадров в секунду. Капли — одна ломаная на кадр одним штрихом;
 * порывы меняют плотность и наклон. Молния: раз в несколько секунд вспышка во весь экран (двойное мерцание) и ломаная
 * с ветвями, сияние — три штриха разной толщины, без shadowBlur. При `prefers-reduced-motion` дождь и молнии не рисуются,
 * остаются тучи и мгла. Доля `t` 0..1 ведёт прозрачность всего: буря приходит и уходит плавно.
 */
export function StormLayer({ t }: { t: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(t); tRef.current = t;
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, raf = 0, last = 0, prev = 0;
    type Drop = { x: number; y: number; len: number; v: number };
    const drops: Drop[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const resize = () => { W = host.clientWidth; H = host.clientHeight; if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } };
    const spawn = (d: Drop, top: boolean) => { d.x = rnd(-0.35 * W, 1.05 * W); d.y = top ? -rnd(10, H * 0.5) : rnd(-20, H); d.len = rnd(12, 26); d.v = rnd(780, 1240); };
    // Молния: ломаная сверху к точке в нижней половине экрана, две–три ветви в стороны.
    type Bolt = { born: number; main: number[]; branches: number[][]; second: boolean };
    let bolt: Bolt | null = null, nextStrike = 0;
    const makeBolt = (now: number, second: boolean): Bolt => {
      const main: number[] = [];
      let x = rnd(0.15 * W, 0.85 * W), y = -10;
      const yEnd = rnd(0.4 * H, 0.78 * H), drift = rnd(-0.35, 0.35);
      main.push(x, y);
      while (y < yEnd) { y += rnd(10, 24); x += rnd(-16, 16) + drift * 8; main.push(x, y); }
      const branches: number[][] = [];
      const nb = 2 + Math.floor(Math.random() * 2);
      for (let b = 0; b < nb; b++) {
        const at = 2 * Math.floor(rnd(main.length / 8, main.length / 2.4));
        let bx = main[at] ?? x, by = main[at + 1] ?? y;
        const dir = Math.random() < 0.5 ? -1 : 1, br: number[] = [bx, by];
        const n = 4 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) { bx += dir * rnd(6, 18); by += rnd(6, 16); br.push(bx, by); }
        branches.push(br);
      }
      return { born: now, main, branches, second };
    };
    const poly = (pts: number[]) => { ctx.moveTo(pts[0]!, pts[1]!); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!); };
    const draw = (now: number) => {
      const tt = tRef.current;
      ctx.clearRect(0, 0, W, H);
      if (tt <= 0.001) return;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0; prev = now;
      if (still) return;
      // Порывы: плотность и наклон дождя дышат медленно, с мелкой дрожью.
      const gust = 0.72 + 0.22 * Math.sin(now / 2300) + 0.12 * Math.sin(now / 710);
      const slant = 0.3 + 0.12 * Math.sin(now / 4100);
      const want = Math.round(Math.min(420, Math.max(110, (W * H) / 2300)) * tt * gust);
      while (drops.length < want) { const d = { x: 0, y: 0, len: 0, v: 0 }; spawn(d, false); drops.push(d); }
      if (drops.length > want + 40) drops.length = want;
      ctx.lineWidth = 1.1; ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(206, 220, 234, ${(0.34 * tt).toFixed(3)})`;
      ctx.beginPath();
      for (const d of drops) {
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - slant * d.len, d.y - d.len);
        d.y += d.v * dt; d.x += slant * d.v * dt;
        if (d.y > H + d.len) spawn(d, true);
      }
      ctx.stroke();
      // Дальняя пелена дождя: лёгкая серая вуаль.
      ctx.fillStyle = `rgba(150, 165, 180, ${(0.06 * tt).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
      // Молнии.
      if (!nextStrike) nextStrike = now + rnd(2500, 7000);
      if (now >= nextStrike) {
        const second = bolt !== null && !bolt.second && now - bolt.born < 1200;
        bolt = makeBolt(now, second);
        nextStrike = now + (Math.random() < 0.22 && !second ? rnd(350, 700) : rnd(4500, 14000));
      }
      if (bolt) {
        const age = now - bolt.born;
        // Вспышка: яркая, провал, вторая слабее, затухание.
        const env = age < 60 ? 0.7 : age < 120 ? 0.22 : age < 190 ? 0.55 : age < 460 ? 0.4 * (1 - (age - 190) / 270) : 0;
        if (env > 0) { ctx.fillStyle = `rgba(232, 238, 255, ${(env * 0.5 * tt).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
        if (age < 300) {
          const k = (age < 130 ? 1 : 1 - (age - 130) / 170) * tt;
          ctx.lineJoin = "round";
          for (const [w, a] of [[9, 0.16], [4, 0.38], [1.6, 0.95]] as const) {
            ctx.lineWidth = w; ctx.strokeStyle = `rgba(${w > 2 ? "190, 205, 255" : "245, 248, 255"}, ${(a * k).toFixed(3)})`;
            ctx.beginPath(); poly(bolt.main); ctx.stroke();
            ctx.lineWidth = w * 0.6; ctx.strokeStyle = `rgba(200, 212, 255, ${(a * k * 0.7).toFixed(3)})`;
            ctx.beginPath(); for (const br of bolt.branches) poly(br); ctx.stroke();
          }
        } else if (age > 600) bolt = null;
      }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (now - last < 33) return;
      last = now; draw(now);
    };
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return (
    <>
      <div className="fx-layer storm-sky" style={{ opacity: t }} aria-hidden="true">
        <div className="dim" />
        <div className="clouds a" />
        <div className="clouds b" />
      </div>
      <canvas ref={ref} className="fx-layer storm" style={{ opacity: Math.min(1, t * 1.2) }} aria-hidden="true" />
    </>
  );
}
