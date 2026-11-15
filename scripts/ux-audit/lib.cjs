// Общие помощники обхода экранов.
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4';
async function open(nick, out, opts = {}) {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const W = opts.w || 390, H = opts.h || 844;
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: opts.dsf || 2, isMobile: W < 800, hasTouch: W < 800, locale: 'ru-RU' });
  if (nick) { const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: nick, password: 'secret123' } }); if (!r.ok()) throw new Error('вход ' + nick + ' ' + r.status()); }
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const log = [];
  const shot = async (name, note) => { await p.waitForTimeout(350); await p.screenshot({ path: `${out}/${name}.png` }); log.push(name + ' — ' + (note || '')); console.log('кадр', name, note || ''); };
  const full = async (name, note) => { await p.waitForTimeout(350); await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }); log.push(name + ' — ' + (note || '') + ' (страница целиком)'); console.log('кадр', name, note || ''); };
  const go = async (path, wait = 2500) => { await p.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(wait); };
  const api = (path) => ctx.request.get(BASE + path).then((r) => r.json());
  const texts = (sel) => p.locator(sel).evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean));
  const done = async () => { fs.writeFileSync(`${out}/_list.txt`, log.join('\n') + '\n'); await b.close(); };
  return { b, ctx, p, shot, full, go, api, texts, done, BASE, GAME, team: '/games/' + GAME + '/team' };
}
module.exports = { open, BASE, GAME };
