// Сцены: как дойти до экрана. Используются и для разбора устройства экрана, и для макетов «до / после».
const closeAll = async (p) => { for (let i = 0; i < 4; i++) { const c = p.locator('button[aria-label="Закрыть"]:visible').last(); if (await c.count()) { await c.click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(400); } else break; } };
const dock = async (s, name) => { await s.go(s.team, 3000); await s.p.locator('.dock-btn', { hasText: name }).first().click(); await s.p.waitForTimeout(1400); };
const bring = async (p, loc) => { for (let pass = 0; pass < 5; pass++) { const bb = await loc.boundingBox(); if (!bb) return null; const dx = 195 - (bb.x + bb.width / 2), dy = 380 - (bb.y + bb.height / 2); if (Math.abs(dx) < 6 && Math.abs(dy) < 6) break; const k = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 250)); for (let j = 0; j < k; j++) { await p.mouse.move(195, 420); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(195 + dx / k * i / 6, 420 + dy / k * i / 6); await p.mouse.up(); await p.waitForTimeout(350); } } return loc.boundingBox(); };
const city = async (s, name) => { const p = s.p; await s.go(s.team, 3200); const bb = await bring(p, p.locator('.m-label', { hasText: name }).first()); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2 - 26); await p.waitForTimeout(1600); if (!(await p.locator('.city-sheet:visible').count())) { await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(1600); } };
const task = async (s, pick) => { const map = await s.api('/api/games/' + s.GAME + '/my-map'); const t = map.tasks.find(pick); await s.go(s.team + '?task=' + t.id, 2600); return t; };
const admin = async (s, name) => { await s.go('/games/' + s.GAME, 3800); if (name === 'Настройки') await s.p.locator('button[aria-label="Настройки"]').first().click(); else await s.p.locator('.dock-btn', { hasText: name }).first().click(); await s.p.waitForTimeout(2000); };
const S = {
  karta: { who: 'p1', note: 'Главный экран — карта команды', reach: async (s) => { await s.go(s.team, 3500); }, root: 'body' },
  sluzhenieUchastnik: { who: 'p4', note: 'Служение — рейтинг игроков (участник)', reach: (s) => dock(s, 'Служение'), root: '.side-menu' },
  delaUchastnik: { who: 'p4', note: 'Дела у участника со взятым делом', reach: async (s) => { const map = await s.api('/api/games/' + s.GAME + '/my-map'); const t = map.tasks.find((x) => x.status === 'OPEN' && !x.sea && !x.deed.secret && x.deed.proofType === 'REPORT'); s.taken = t.id; await s.ctx.request.post(s.BASE + '/api/games/' + s.GAME + '/edge-tasks/' + t.id + '/take', { data: {} }); await dock(s, 'Дела'); }, after: async (s) => { if (s.taken) await s.ctx.request.post(s.BASE + '/api/games/' + s.GAME + '/edge-tasks/' + s.taken + '/release', { data: {} }); s.taken = null; }, root: '.side-menu' },
  ispytaniya: { who: 'p1', note: 'Испытания', reach: (s) => dock(s, 'Испытания'), root: '.side-menu' },
  sluzhenie: { who: 'p1', note: 'Служение — рейтинг игроков', reach: (s) => dock(s, 'Служение'), root: '.side-menu' },
  nagrady: { who: 'p1', note: 'Служение → Награды', reach: async (s) => { await dock(s, 'Служение'); await s.p.locator('.side-menu button', { hasText: 'Награды' }).first().click(); await s.p.waitForTimeout(1000); }, root: '.side-menu' },
  komandy: { who: 'p1', note: 'Команды', reach: (s) => dock(s, 'Команды'), root: '.side-menu' },
  rol: { who: 'p1', note: 'Команды → выбор роли', reach: async (s) => { await dock(s, 'Команды'); await s.p.locator('.side-menu button[aria-label="Воин"]').first().click(); await s.p.waitForTimeout(800); }, root: '.side-menu' },
  letopis: { who: 'p1', note: 'Летопись', reach: (s) => dock(s, 'Летопись'), root: '.side-menu' },
  dela: { who: 'p1', note: 'Дела', reach: (s) => dock(s, 'Дела'), root: '.side-menu' },
  deloSvob: { who: 'p1', note: 'Карточка свободного дела (капитан)', reach: (s) => task(s, (t) => t.status === 'OPEN' && !t.sea && !t.deed.secret && t.deed.description && t.deed.description.length > 150), root: '.deed-sheet' },
  deloSdacha: { who: 'p4', note: 'Взятое дело: форма сдачи', reach: async (s) => { const map = await s.api('/api/games/' + s.GAME + '/my-map'); const t = map.tasks.find((x) => x.status === 'OPEN' && !x.sea && !x.deed.secret && x.deed.proofType === 'PHOTO_LINK'); s.taken = t.id; await s.ctx.request.post(s.BASE + '/api/games/' + s.GAME + '/edge-tasks/' + t.id + '/take', { data: {} }); await s.go(s.team + '?task=' + t.id, 2600); }, after: async (s) => { if (s.taken) await s.ctx.request.post(s.BASE + '/api/games/' + s.GAME + '/edge-tasks/' + s.taken + '/release', { data: {} }); }, root: '.deed-sheet' },
  deloProverka: { who: 'p4', note: 'Моё дело на проверке', reach: async (s) => { const me = (await s.api('/api/auth/me')).user; await task(s, (t) => t.takenById === me.id && t.status === 'SUBMITTED'); }, root: '.deed-sheet' },
  gorodSvoj: { who: 'p1', note: 'Свой город', reach: (s) => city(s, 'Песнь Песней'), root: '.city-sheet' },
  gorodRajony: { who: 'p1', note: 'Чужой город — районы', reach: (s) => city(s, 'Иов'), root: '.city-sheet' },
  gorodPoryadok: { who: 'p1', note: 'Чужой город — порядок', reach: (s) => city(s, 'От Иоанна'), root: '.city-sheet' },
  gorodKonvert: { who: 'p1', note: 'Свободный город — конверт', reach: (s) => city(s, 'Иона'), root: '.city-sheet' },
  zadanie: { who: 'p1', note: 'Задание района', reach: async (s) => { await city(s, 'Иов'); await s.p.locator('.city-sheet button', { hasText: 'Приход трёх друзей' }).first().click(); await s.p.waitForTimeout(1500); }, root: '.city-sheet' },
  kamen: { who: 'p1', note: 'Каменоломня', reach: async (s) => { const p = s.p; await s.go(s.team, 3200); const bb = await bring(p, p.locator('.m-quarry').first()); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(1600); }, root: '.overlay' },
  vhod: { who: null, note: 'Вход', reach: async (s) => { await s.go('/login', 1800); await closeAll(s.p); await s.p.waitForTimeout(600); }, root: 'main, #root' },
  vhodAvto: { who: null, note: 'Вход: при первом заходе поверх формы открывается «Об игре»', reach: async (s) => { await s.go('/login', 2200); }, root: 'body' },
  profil: { who: 'p4', note: 'Профиль', reach: (s) => s.go('/account', 2000), root: 'main, #root' },
  novoe: { who: 'p4', note: 'Что нового', reach: (s) => s.go('/whats-new', 1800), root: 'main, #root' },
  spisok: { who: 'admin1', note: 'Мои игры', reach: (s) => s.go('/', 2500), root: 'main, #root' },
  aLetopis: { who: 'admin1', note: 'Администратор — летопись', reach: (s) => admin(s, 'Летопись'), root: '.overlay, .popup' },
  aKomandy: { who: 'admin1', note: 'Администратор — команды', reach: (s) => admin(s, 'Команды'), root: '.overlay, .popup' },
  aDela: { who: 'admin1', note: 'Администратор — дела', reach: (s) => admin(s, 'Дела'), root: '.overlay, .popup' },
  aProverka: { who: 'admin1', note: 'Администратор — проверка', reach: (s) => admin(s, 'Проверка'), root: '.overlay, .popup' },
  aNastrojki: { who: 'admin1', note: 'Администратор — настройки', reach: (s) => admin(s, 'Настройки'), root: '.overlay, .popup' },
};
module.exports = { S, closeAll };
