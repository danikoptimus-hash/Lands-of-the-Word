import { useEffect, useRef, useState } from "react";
import { Sheet } from "./Sheet";
import { t } from "../lib/i18n";

/**
 * Кадрирование аватарки (решение владельца 24.10: «центрировать фото в круге и увеличить, как на Ютубе»): фото
 * двигают пальцем или мышью, приближают ползунком или щипком; круг показывает, что останется. Наружу уходит
 * квадрат 512×512 JPEG — сервер сожмёт до 256 WebP.
 */
const VIEW = 280; // сторона окна кадрирования в CSS-пикселях
const OUT = 512;

export function AvatarCropper({ file, onDone, onCancel }: { file: File; onDone: (blob: Blob) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1); // 1 — фото ровно накрывает круг
  const [pos, setPos] = useState({ x: 0, y: 0 }); // смещение центра фото от центра круга, в пикселях окна
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const bmp = await createImageBitmap(file); if (alive) setImg(bmp); }
      catch {
        const el = new Image(); el.onload = () => { if (alive) setImg(el); }; el.src = URL.createObjectURL(file);
      }
    })();
    return () => { alive = false; };
  }, [file]);

  const base = img ? VIEW / Math.min(img.width, img.height) : 1; // масштаб, при котором меньшая сторона равна окну
  const scale = base * zoom;
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    if (!img) return p;
    const s = base * z;
    const maxX = Math.max(0, (img.width * s - VIEW) / 2), maxY = Math.max(0, (img.height * s - VIEW) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  };

  useEffect(() => {
    const c = canvas.current; if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = VIEW * dpr; c.height = VIEW * dpr;
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, VIEW, VIEW);
    const w = img.width * scale, h = img.height * scale;
    g.drawImage(img, VIEW / 2 - w / 2 + pos.x, VIEW / 2 - h / 2 + pos.y, w, h);
    // Затемнение вне круга.
    g.save(); g.beginPath(); g.rect(0, 0, VIEW, VIEW); g.arc(VIEW / 2, VIEW / 2, VIEW / 2, 0, Math.PI * 2, true); g.fillStyle = "rgba(0,0,0,0.45)"; g.fill(); g.restore();
    g.beginPath(); g.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 1, 0, Math.PI * 2); g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 2; g.stroke();
  }, [img, scale, pos]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    else if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom }; drag.current = null; }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const z = Math.min(3, Math.max(1, pinch.current.zoom * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.d)));
      setZoom(z); setPos((p) => clamp(p, z));
    } else if (drag.current) {
      setPos(clamp({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) }));
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  }
  function setZoomKeepCenter(z: number) { setZoom(z); setPos((p) => clamp({ x: (p.x * z) / zoom, y: (p.y * z) / zoom }, z)); }

  async function done() {
    if (!img) return;
    const out = document.createElement("canvas"); out.width = OUT; out.height = OUT;
    const g = out.getContext("2d")!;
    const k = OUT / VIEW; const w = img.width * scale * k, h = img.height * scale * k;
    g.drawImage(img, OUT / 2 - w / 2 + pos.x * k, OUT / 2 - h / 2 + pos.y * k, w, h);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", 0.9));
    if (blob) onDone(blob);
  }

  return (
    <Sheet title={t("Фото")} onClose={onCancel} size="sm" foot={<div className="actions"><button type="button" className="ghost" onClick={onCancel}>{t("Отмена")}</button><button type="button" className="primary" disabled={!img} onClick={() => void done()}>{t("Готово")}</button></div>}>
      <div className="avatar-crop">
        <canvas ref={canvas} style={{ width: VIEW, height: VIEW }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
        <label className="zoom"><span className="sr-only">{t("Масштаб")}</span><input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoomKeepCenter(Number(e.target.value))} aria-label={t("Масштаб")} /></label>
        <p className="hint">{t("Передвиньте фото и приблизьте: в круге то, что увидят другие.")}</p>
      </div>
    </Sheet>
  );
}
