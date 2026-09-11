# Аудит визуальной системы веб‑клиента «Земли Слова»

Дата: 2026‑09‑11. Режим: только чтение, ни один файл не менялся.

Объём проверки: `apps/web/src/styles.css` (419 строк, 172 класса), `apps/web/src/components/Icon.tsx`, `apps/web/index.html`, `apps/web/public` (бренд‑ассеты, манифест), `apps/web/src/lib/ui.tsx`, все `apps/web/src/pages/*.tsx` (28 файлов), `lib/hexmap.ts`, `lib/useViewport.ts`, `vite.config.ts`, `docs/ART_BRIEF.md` (эталонная палитра иллюстраций).

Цель редизайна, поставленная владельцем: «максимально интуитивный и минималистичный интерфейс, единый стиль на телефоне и компьютере, проработать каждую деталь». Аудит отвечает на вопрос «что именно сейчас мешает этому и что должно стать единым источником правды».

Краткий итог (подробности в разделах ниже):

- Токенов мало и они не покрывают систему: 23 переменных, при этом в CSS 22 разных размера шрифта, 21 значение отступов, 16 вариантов радиусов, 13 вариантов теней, 40+ литералов цвета; в TSX 149 inline‑стилей в 27 файлах.
- Один и тот же элемент существует в 3–6 вариантах: 5 высот полей ввода (44/40/38/36/34), 4 «горизонтальных ряда» (`.row`, `.actions`, `.inline-form`, `.capture .row`), 3 оверлея с разными радиусами/анимациями (`.modal`, `.sheet`, `.city-popup`), 6 чипов (`.badge`, `.pill`, `.stat`, `.tabbar .n`, `.edge-handle .count`, `.district .num`), 3 размера подсказки `.hint`.
- Ключевые контрасты не проходят WCAG AA: белый текст на кнопке акцента 3.52:1, ссылки цветом акцента 3.21:1, белый на двух из шести командных цветов 2.98 и 3.70.
- Мобильные дефекты: поля ввода 15px → iOS увеличивает страницу при фокусе; HUD карты и шапка не учитывают `safe-area-inset-top` в standalone‑PWA; вкладки страницы игры выходят за экран без индикатора прокрутки; тосты `white-space: nowrap` обрезаются на 360px; кнопки стрелок сортировки 22px высотой.
- Эмодзи (🌊 🏆 🔒 🔭 🔮 🏰) и типографские глифы (→ ← ✓ ✕ ★ ▲ ▼ ⤢ ⋮⋮ › ‹) используются вместо иконок в 14 файлах, притом что нужные иконки уже есть в `Icon.tsx` (`telescope`, `star`, `expand`, `x`, `chevron`, `back`) и не используются.
- Рабочее правило `:focus-visible { border-radius: 6px }` меняет форму любого элемента при фокусе (круглый аватар становится скруглённым квадратом).

---

## 1. Токены

### 1.1. Все CSS custom properties

Определены в `styles.css`, причём `:root` объявлен трижды (строки 1, 33, 135) — токены разбросаны по файлу.

| Токен | Значение | Где определён | Замечание |
|---|---|---|---|
| `--bg` | `#F6F4EF` | :root, стр. 2 | фон страницы (пергамент) |
| `--surface` | `#FFFFFF` | стр. 2 | карточки |
| `--surface-2` | `#FBFAF7` | стр. 2 | вложенные плитки |
| `--border` | `#E6E1D6` | стр. 2 | |
| `--border-strong` | `#CFC7B8` | стр. 2 | рамки полей |
| `--text` | `#1F1B16` | стр. 3 | |
| `--muted` | `#6B645A` | стр. 3 | |
| `--accent` | `#C7742A` | стр. 3 | бренд |
| `--accent-hover` | `#B0651F` | стр. 3 | используется и как hover, и как цвет текста (`.avatar`, `.badge.accent`, `.tabbar .active`) — две роли в одном токене |
| `--accent-soft` | `#FBEEDF` | стр. 3 | |
| `--danger` / `--danger-soft` | `#B3402F` / `#FBE9E5` | стр. 4 | |
| `--success` / `--success-soft` | `#3E7A4E` / `#E6F2E9` | стр. 4 | |
| `--warn` / `--warn-soft` | `#8A6A12` / `#FBF3DD` | стр. 4 | |
| `--radius` | `12px` | стр. 5 | |
| `--radius-sm` | `8px` | стр. 5 | |
| `--shadow` | `0 1px 2px rgba(31,27,22,.05), 0 4px 16px rgba(31,27,22,.06)` | стр. 5 | единственная тень‑токен, остальные 12 — литералы |
| `--font` | `"Inter", system-ui, …` | стр. 6 | |
| `--topbar-h` | `57px` | второй :root, стр. 33 | магическое число (1px рамка + 56) |
| `--spring` | `cubic-bezier(.2,.9,.3,1.15)` | третий :root, стр. 135 | объявлен после первого использования (`.modal`, стр. 118) — работает только потому, что custom properties резолвятся лениво |
| `--ease` | `cubic-bezier(.2,.7,.2,1)` | стр. 135 | |

Локальные («передаваемые») переменные, которые задаются inline из TSX: `--tone` (`.card[data-tone]`, `.game-card`), `--team` (`.side-menu`, `.standing`), `--city-img` (`.city-head`), `--c` (`.legend span`), `--p` (`.reading i`), `--ok` (`.reading.ok` — **нигде не определён**, срабатывает fallback `#2F6B3A`, который не совпадает с `--success #3E7A4E`).

Чего нет среди токенов: размеров шрифта, межстрочных, весов, отступов/сетки, высот контролов, z‑index, длительностей анимаций, цвета ссылок, цвета плейсхолдера, цвета фокус‑кольца, командных цветов (живут в `lib/hexmap.ts`), цветов местности, семантических «blue» и «plum».

### 1.2. Литералы цвета в `styles.css` (вне `:root`)

| Литерал | Кол‑во | Где | Вердикт |
|---|---|---|---|
| `#fff` / `#FFFFFF` | 22 | текст на кнопках, счётчиках, шапке города, `.toast` | нужен токен `--on-accent` / `--surface` |
| `rgba(31,27,22,.25)` | 5 | тени `.modal`, `.sheet`, `.drawer`, `.side-menu`, `.toast` | тень «поверх страницы» без токена |
| `#6B645A` | 4 | `.label` (печать) | равен `--muted`, но продублирован литералом |
| `#8a8378` | 3 | пунктир ярлыков | **вне палитры** (ни `--border-strong`, ни `--muted`) |
| `#2F6FB3` / `#E4EEF9` | 3 / 1 | `data-tone="blue"`, `.battle.att` | **вне палитры**, «синий» без токена |
| `#7B4E8A` / `#F0E6F3` | 2 / 1 | `data-tone="plum"` | **вне палитры** |
| `#2F6B3A` | 2 | `.reading.ok` | **вне палитры** (второй зелёный) |
| `#F5D9D3` | 1 | `button.danger:hover` | **вне палитры** (третий красный) |
| `#1F1B16` | 3 | `.label`, `.side-head` gradient | равен `--text` |
| `rgba(255,255,255,.7/.82/.8/.9/.92/.15/.22/.3/.6)` | 13 | HUD, шапка города, стат‑чипы, стеклянная шапка | 9 разных альф белого — нужен 2–3 уровня |
| `rgba(246,244,239,.92/.96/.55/.15)` | 4 | `.tabbar`, `.login-page::after` | это `--bg` с альфой; при смене `--bg` не обновится |
| `rgba(255,253,249,.9)` | 1 | `.topbar` | **отдельный кремовый**, не равен ни `--bg`, ни `--surface` |
| `rgba(199,116,42,.14)` | 1 | `body::before` свечение | это `--accent` с альфой |
| `rgba(60,40,10,.18)` | 1 | тень карточки входа | **четвёртый оттенок тени** |
| `rgba(0,0,0,.4)` | 1 | `drop-shadow` картинки города | |
| `rgba(31,27,22,.05/.06/.12/.18/.35/.45/.5/.55/.85)` | 11 | тени, бэкдропы, градиенты | 9 альф одного «чернильного» |

### 1.3. Литералы цвета в TSX (SVG‑карты и inline)

`TeamMap.tsx`: `#2B2724` (фон экрана карты), `#F3EAD3` (подпись города и активная сторона), `#B9B1A5` (дальний узел), `#1F1B16`, `#fff`, `#C7742A`/`#3E7A4E`/`#B3402F` (статусы дела — дубли токенов), `#2F6FB3`/`#B3402F` (🌊), `rgba(255,255,255,.25)`. `AdminMap.tsx`: `#C7742A`, `#F3EAD3`, `#1F1B16`, `#fff`, `#B3402F`, `rgba(31,27,22,.25/.4)`. `MapLayers.tsx`: `#C9B27A` (fallback местности, вне палитры), `#2B2724`, `rgba(31,27,22,.28)`. `lib/hexmap.ts`: `TERRAIN_COLOR` (6), `FOG_COLOR #3F3A34`, `TEAM_COLORS` (6). Итого в SVG ~35 литералов, из которых 4 (`#2B2724`, `#F3EAD3`, `#B9B1A5`, `#C9B27A`) нигде больше не встречаются. SVG внутри React может читать `var(--…)` (в `AdminDashboard` это уже сделано: `stroke="var(--border-strong)"`), так что причин держать литералы нет.

### 1.4. Размеры шрифта, радиусы, тени, отступы (литералы)

Шрифт: 22 различных rem‑значения + `15px` (body), `18px` (`.edge-handle`), `.85em` (`code`) + 7 pt‑значений для печати. Полный список в разделе 2.

Радиусы: `var(--radius-sm)` ×18, `999px` ×14, `var(--radius)` ×5, `6px` ×4, `10px` ×2, `18px 18px 0 0` ×2, `16px 16px 0 0` ×2, `50%` ×2, `8px`, `5px`, `3px`, `2px`, `16px`, `14px`, `0 10px 10px 0`, `0 0 12px 12px`. Итого 16 записей, 9 уникальных величин. Особенно заметно: у трёх оверлеев три радиуса (`.modal` 12, `.sheet` 16/14, `.city-popup` 18/16), у чипов `.verses .box` 5px и `code` 6px, у `:focus-visible` принудительные 6px.

Тени: 13 вариантов (см. 1.2), при одном токене.

Отступы: значения `padding`/`gap`/`margin` — .1 .15 .2 .25 .3 .35 .4 .45 .5 .55 .6 .7 .75 .8 .9 1 1.1 1.25 1.4 1.5 2 rem, плюс `4px 5px 6px 10px 12px 14px`. Это 27 «ступеней» вместо 6–8. Примеры одной и той же роли с разным отступом: внутренняя плитка `.tile` `.7 .8`, `.war` `.7 .8`, `.battle` `.6 .8`, `.cipher` `.6 .8`, `.admin-city` `.8 1`, `.district` `.5 .6`, `.choices li` `.55 .7`, `.readiness .item` `.45 .7`, `.note` `.55 .8`, `.hint-box` `.5 .7`.

Высоты контролов (`min-height`): 44 (input), 42 (button), 40 (`.tabbar button`, `.inline-form`), 36 (`.ghost`, `.tabs button`), 34 (`.sm`, `.btn.sm`), 22 (`.sortable .arrows button`), плюс inline 38, 36, 34 в TSX.

z‑index: -1, 1, 5, 6, 9, 10, 20, 30, 31, 40, 100, 110 — без шкалы; `.toasts` (110) выше `.modal-backdrop` (100), а `.city-backdrop` (40) внутри `.map-screen` ниже модалки — при открытом попапе города подтверждение всплывает поверх, тост — поверх всего. Это верно, но держится на числах, а не на слоях.

### 1.5. Inline‑стили в TSX: 149 вхождений `style={{` в 27 файлах

| Файл | Кол‑во | Что там |
|---|---|---|
| `pages/AdminMap.tsx` | 23 | `cursor`, `pointerEvents` на SVG (8), копия `.map-controls` inline (`position:absolute; right:10; top:10; flex-direction:column; gap:6`), `width:40; padding:0` на кнопке, `height:min(70vh,640px); minHeight:360; overflow:hidden; touchAction:none` на `.mapwrap` (переопределяет `overflow:auto` из CSS), `--c` для легенды (3), `marginTop` (5), `fontSize:.85rem`, `letterSpacing`, `borderColor: tm.color` (2), аватар цветом команды |
| `pages/TeamPage.tsx` | 16 | `margin` (5), `fontSize` (2), аватары цветом команды (2), `borderTop: 4px solid team.color`, `--team` (2), `cursor:pointer` на `li`/`div` (2), `paddingRight:2rem`, `minWidth:0`, `width:%` прогресс |
| `pages/BattlePanel.tsx` | 16 | `margin` (9), `fontSize` (3), `width:110`/`100` на number‑инпутах, `alignItems:baseline`, `flexWrap/gap`, `marginRight` ссылок «видео» |
| `pages/TeamMap.tsx` | 10 | `cursor`/`pointerEvents` на SVG (8), контейнер карты (`position/inset/touchAction/cursor/userSelect/overflow/background:#2B2724`), `display:block` на svg |
| `pages/CityPopup.tsx` | 9 | `margin` (4), `fontSize` (2), `--city-img`, `--p`, бейдж владельца цветом команды, `alignItems/gap` |
| `pages/AccountPage.tsx` | 8 | `margin: … auto` на карточках (4), `fontSize:1.3rem` на `h1`, `marginTop` (2), `flex/minHeight:38` на readonly‑поле |
| `pages/TeamsBlock.tsx` | 7 | `marginBottom/Top` (3), `flex:1 1 200px`, `borderLeftColor`, `flex/minHeight:38`, `select width:auto; minHeight:34` |
| `pages/Diplomacy.tsx` | 7 | `margin:.3rem 0` (4), `marginTop:.8rem`, `alignItems:baseline`, `fontSize`, бейджи цветом команды (2) |
| `pages/RecipientsBlock.tsx` | 6 | `textDecoration:none` на `<a class="btn">` (2), `marginTop:0`, `flexWrap`, `flex:1 1 220px`, `select width:auto; minHeight:40` |
| `pages/FinishBlock.tsx` | 6 | `fontSize:1rem`, `overflowX:auto`, аватар цветом, `marginLeft`, `borderLeftColor`, `marginRight`, ряд с `alignItems:flex-end` |
| `pages/DisputesBlock.tsx` | 5 | `alignItems:flex-start` на `li`, бейдж цветом, `margin` (2), `marginTop/minHeight:36` |
| `pages/SubmissionsBlock.tsx` | 4 | то же, что Disputes |
| `pages/GamesPage.tsx` | 4 | аватар цветом, `minWidth:0`, `--tone`, форма с `marginTop; borderTop; paddingTop` |
| `pages/BattlesBlock.tsx` | 4 | бейджи цветом (2), `fontSize`, `alignItems`, `minHeight:36` |
| `pages/LoginPage.tsx` | 3 | `marginBottom`, `width:100%` на кнопке, `marginTop; textAlign:center` |
| `pages/LabelsPage.tsx` | 2 | `fontSize:1rem` внутри h1, `textDecoration:none` |
| `pages/JoinPage.tsx` | 2 | `color: team.color` на тексте, `width:100%` |
| `pages/ForgotPage.tsx` | 2 | `width:100%`, `marginTop:1rem` |
| `pages/DeedsBlock.tsx` | 2 | `marginBottom:1rem` на форме, `marginTop:0` |
| `pages/Timeline.tsx` | 1 | `fontSize:.8rem` |
| `pages/ResetPage.tsx` | 1 | `width:100%` |
| `pages/Layout.tsx` | 1 | `textDecoration:none; color:inherit` на `<Link class="userchip">` |
| `pages/GamePage.tsx` | 1 | `marginTop:0` |
| `pages/AdminsBlock.tsx` | 1 | `marginTop:.6rem` |
| `pages/AdminDashboard.tsx` | 1 | `overflowX:auto` |
| `lib/ui.tsx` | 1 | `justifyContent:flex-end` в подтверждении |
| `components/PushToggle.tsx` | 1 | `margin:1rem auto 0` |

По видам (примерно): вертикальные отступы — 56; цвет команды из данных (`background`/`borderColor`/`color`) — 19 + 8 custom‑properties; размеры/`flex`/`minHeight` полей — 19; `cursor`/`pointerEvents` в SVG — 18; выравнивание рядов — 12; `fontSize` — 14; `textDecoration: none` на ссылках‑кнопках — 4; прочее — ~10.

Выводы: (1) 56 «маргин‑костылей» означают, что у компонентов нет собственного вертикального ритма — нужны утилиты `.stack` с токенами; (2) командный цвет надо передавать одним способом (`style={{"--team": color}}`) и раскрашивать в CSS через `var(--team)`; (3) `cursor`/`pointerEvents` в SVG — это классы (`.hit`, `.no-hit`); (4) `textDecoration:none` — признак того, что `.btn` не самодостаточен как класс для `<a>`.

---

## 2. Типографика

### 2.1. Что реально используется

Шрифт: Inter 400/500/600/700 с Google Fonts (`index.html`, `display=swap`), кешируется service‑worker'ом по факту первого запроса (`vite.config.ts`, `StaleWhileRevalidate`). При первом офлайн‑запуске PWA шрифта не будет → `system-ui`, т.е. телефон и компьютер покажут разное. Cyrillic‑подмножество Google подставляет сам.

Базовый размер `body` — **15px**, line‑height 1.5. Это ниже порога 16px, при котором iOS Safari не увеличивает страницу при фокусе на поле: `input, select, textarea { font: inherit }` → 15px → на iPhone каждое поле формы вызывает зум. Это самый частый «мобильный» дефект в проекте.

Размеры (rem, кроме указанных), с количеством вхождений в CSS:

| Размер | px при 15 | Вхождений | Где |
|---|---|---|---|
| .7 | 10.5 | 2 | `.edge-handle .count`, `.sortable .arrows button` |
| .72 | 10.8 | 1 | `.tabbar .n` |
| .75 | 11.25 | 4 | `.badge`, `.pill`, `.tile .hint`, `.spark-label` |
| .78 | 11.7 | 3 | `.card .hint`, `.side-menu .menu-links a`, `.standing .nums` |
| .8 | 12 | 4 | `.hint`, `.district .num`, `.verses .box`, `.tile .delta` |
| .82 | 12.3 | 3 | `.legend`, `.d-sum`, `.stat` |
| .85 | 12.75 | 7 | `.avatar`, `.crumb`, `.standings th`, `.tile .label`, `button.sm`, `.btn.sm`, `.standing .rank` |
| .875 | 13.1 | 1 | `label` |
| .88 | 13.2 | 1 | `.reading` |
| .9 | 13.5 | 10 | `.muted`, `.note`, `.error`, `.toast`, `.userchip .name`, `.ghost-link`, `.push-prompt`, `.team-card .go`, `.readiness .item`, `.auth-logo .muted` |
| .92 | 13.8 | 3 | `.battle .passage .text`, `.verses li`, `.hint-box` |
| .925 | 13.9 | 1 | `button` |
| .95 | 14.25 | 1 | `.side-menu .section h2` |
| 1 | 15 | 1 | `button.icon` |
| 1.02 | 15.3 | 1 | `.task-view .prompt` |
| 1.05 | 15.75 | 1 | `.game-card .name` |
| 1.1 | 16.5 | 6 | `h2`, `.city-head strong` (перекрыто), `.admin-city .key`, `.sortable .grip`, `.team-card .avatar`, `.side-head .avatar` |
| 1.2 | 18 | 1 | `.city-head .title strong` |
| 1.25 | 18.75 | 1 | `.auth-logo strong` |
| 1.35 | 20.25 | 1 | `.page-head h1` |
| 1.5 | 22.5 | 1 | `.tile .value` |
| 1.6 | 24 | 1 | `h1` |

Плюс inline в TSX: `1.3rem` (h1 аккаунта), `1.1rem` (имя команды в меню), `1rem` (счётчик в h1 ярлыков, `.note` итогов), `.9rem` ×4, `.85rem` ×5, `.8rem`, `.78rem`. Итого около 30 размеров, которые не образуют шкалы: .85/.875/.88/.9/.92/.925 — шесть значений в диапазоне 12.75–13.9px, которые глаз не различает, а код различает.

Межстрочные: 1.5 (body, `.prompt`), 1.4 (`.verses li`), 1.35 (`.d-sum`, `.card .hint`), 1.1 (`.tile .value`), 1 (`.arrows button`). Заголовки наследуют 1.5 — для h1 24px это 36px строки, слишком рыхло.

Веса: 600 ×14, 700 ×13, 500 ×6, 400 ×1. 700 и 600 конкурируют за одну роль (h1 700 / h2 600; `.badge` 600 / `.pill` 700; `.d-title` 600 / `.district .num` 700; `.game-card .name` 700 / `.team-card strong` 700‑по‑умолчанию).

Буквенные интервалы: `-.01em` (h1), `.02em` (`.pill`), `.1em` (`.capture input`), `.12em` (`.admin-city .key`), `.14em` (ярлык), `.08em` inline, `-2px` (`.grip`) — ещё одна ось без шкалы.

### 2.2. Заголовки по страницам

| Страница | h1 | h2 | Замечание |
|---|---|---|---|
| Login | — | — | заголовок сделан `<strong>` в `.auth-logo` (1.25rem); скринридер не видит заголовка |
| Forgot / Reset / Join | 1 | — | h1 1.6rem в карточке 420px — визуально крупнее, чем h1 страницы игры (1.35) |
| Games (главная) | — | 2 | нет h1; страница начинается с h2 |
| Game (админ) | 1 (`.page-head`, 1.35) | 1–6 в карточках | иерархия верная; `h2 .ico` |
| Team (карта) | — (в состоянии карты) / 1 (до старта) | 4 в `.side-menu .section` (.95rem) | на карте нет h1 вообще; h2 в меню меньше body‑текста |
| Account | 1 (inline 1.3rem) | 3 | h1 размер задан inline |
| Labels | 1 (1.6) | — | внутри h1 `<span class="muted" style="font-size:1rem">` |
| AdminDashboard | 1 (1.6, в `.card-head`) | 6 | |
| CityPopup (диалог) | — | — | заголовок диалога — `<strong>`; нет `aria-labelledby` |
| Confirm (ui.tsx) | — | 1 (опционально) | |

Итого: три разных визуальных размера h1 (1.6 / 1.35 / 1.3), h2 в трёх размерах (1.1 / .95 / inline 1.1 на `strong`), два экрана без h1, два диалога без заголовка как такового.

### 2.3. Предложение: шкала из 6 ступеней

База 16px (устраняет iOS‑зум, повышает читаемость заданий на телефоне). Шаг ≈ 1.2 с округлением до целых пикселей:

| Токен | px | rem | Роль | line‑height | Вес |
|---|---|---|---|---|---|
| `--fs-xs` | 12 | .75 | счётчики, `.pill`, `.badge`, подписи осей, `.legend` | 1.3 | 600 |
| `--fs-sm` | 14 | .875 | `label`, `.hint`, `.muted`‑пояснения, `.stat`, `button.sm`, `.crumb`, th | 1.4 | 400/500 |
| `--fs-md` | 16 | 1 | body, поля, кнопки, `.note`, `.toast`, `.verses`, `.choices` | 1.5 | 400 |
| `--fs-lg` | 18 | 1.125 | h3/заголовки секций меню и диалогов, `.prompt` задания, имя команды | 1.35 | 600 |
| `--fs-xl` | 22 | 1.375 | h2 карточек, заголовок диалога, `.tile .value` | 1.25 | 600 |
| `--fs-2xl` | 28 | 1.75 | h1 страницы (один размер для всех страниц) | 1.15 | 700 |

Правила: три веса (400 текст, 500 подписи/лейблы, 600 заголовки и кнопки; 700 только h1 и большие числа); `letter-spacing` только два значения: `-.01em` для ≥22px и `.08em` для «кодов» (ключ, шифр); все `font-size` в компонентах — только через токены; inline `fontSize` запрещён (ESLint‑правило `react/forbid-dom-props` или простой grep в CI).

Плюсы: два экрана (телефон/десктоп) читаются одинаково, `.85/.875/.88/.9/.92/.925` схлопываются в одну ступень, исчезает iOS‑зум. Минусы: база 16 вместо 15 «раздвинет» плотные админские списки на ~7% — компенсируется уменьшением вертикальных отступов (раздел 9); придётся пересмотреть ~60 селекторов.

Про гарнитуру: Inter — верный выбор для «минимализма» и для кириллицы. Для «пергаментного» характера достаточно одного акцента: либо оставить всё на Inter (плюс: единство, скорость, минус: бренд читается только через цвет и иллюстрации), либо взять одну дисплейную гарнитуру с засечками только для h1/бренда/названий городов (плюс: атмосфера карты, минус: +1 сетевой ресурс, риск «двух продуктов», если применять шире). Рекомендация: остаться на Inter, самостоятельно захостить вариативный woff2 с кириллическим подмножеством (~100 КБ) и положить его в precache PWA — тогда телефон офлайн и компьютер показывают один и тот же шрифт.

---

## 3. Компоненты

### 3.1. Кнопки

Определение: `button, .btn` (стр. 68) — primary по умолчанию; `.secondary`, `.ghost`, `.danger`, `.sm`, `.icon`; `.btn.secondary`, `.btn.sm` (стр. 380–381, в секции «Ярлыки»); контекстные переопределения: `.tabs button`, `.tabbar button`, `.map-controls button`, `.sortable .arrows button`, `.city-head .close`, `.side-head .close`, `.inline-form button`.

Использование: primary — все submit; `secondary sm` — 34 вхождения (самая частая комбинация: «Капитан», «Участники», «Стандартный набор», «Только активные», сравнения периодов, «Открыть для «…»», главы книги в `PassagePicker` — до 150 штук на Псалтирь); `ghost sm icon` — удаление/правка в списках; `ghost sm` — закрытие, стрелки сортировки, «▴ Свернуть»; `danger` — «Испытать город», «Завершить игру», ОК в опасном подтверждении; `sm` (primary small) — «Одобрить», «Новая игра», «Скопировать»; `.btn` на `<a>` — «Скачать ярлыки (PDF)» ×2; `btn ghost sm` — «Предпросмотр».

Несогласованности:
- **`.btn.ghost` не определён** (есть только `button.ghost`) → ссылка «Предпросмотр» (`RecipientsBlock.tsx:40`) рендерится как оранжевая primary‑кнопка, хотя по смыслу это третичное действие. Также у `.btn` нет `:hover`/`:active` (они написаны для `button`), поэтому «Скачать PDF» не реагирует на наведение.
- Высоты: primary 42, ghost 36, sm 34, `.inline-form button` 40, `.tabbar button` 40, `.tabs button` 36, `.map-controls button` 42×34 (ширина 42, высота от `.sm`), `AdminMap` inline 40×34, `.sortable .arrows button` **22px**. Восемь высот для одной роли.
- `button:disabled` не отменяет `button:hover { background: var(--accent-hover) }` → неактивная primary‑кнопка темнеет при наведении, как активная.
- `button:not(.ghost):not(:disabled):hover { box-shadow }` (специфичность 0,3,1) применяется и к `.tabs button`, и к `.tabbar button`, и к `.secondary` — тень на hover появляется у вкладок входа, хотя фон у них не меняется (`.tabs button { background: transparent }` объявлен позже `button:hover` при равной специфичности и «съедает» hover‑фон).
- `.danger` — мягкий фон (`--danger-soft`) и красный текст, то есть визуально это бейдж, а не кнопка; при этом в подтверждении «Удалить команду?» опасная кнопка (мягкая) слабее отмены (`secondary` с рамкой) — иерархия перевёрнута.
- Нет состояния загрузки: `busy` только дизейблит; текст «Проверяем…» подменяется в одном месте (`AccountPage`), в остальных кнопка просто гаснет.
- `button.icon` — `min-width: 36px`, с `.sm` высота 34: цель 36×34 при рекомендуемых 44×44 (Apple) / 48×48 (Material) / 24px минимум WCAG 2.2 (2.5.8) — проходит только минимум WCAG.
- Glyph‑кнопки: `⤢`, `★`, `✕`, `▲`, `▼`, `‹ К районам`, `▴ Свернуть` — символы из шрифта, а не иконки (см. раздел 6).
- `button:active { transform: translateY(1px) scale(.98) }` при `.district.open:active scale(.985)`, `.choices li:active scale(.985)`, `.city-hit:active scale(.92)`, `.edge-handle:active scale(.94)` — четыре разных «нажатия».

Целевой вариант (один класс `.btn` для `<button>` и `<a>`, `button` без класса — не стилизуется, чтобы `<button>` внутри чужих компонентов не ломался):

```
.btn { min-height: var(--control-h, 44px); padding: 0 var(--sp-4); font: 500 var(--fs-md)/1 var(--font); border-radius: var(--r-sm); gap: var(--sp-2) }
.btn--primary   фон --accent, текст --ink (4.86:1) или фон --accent-strong (#9B5A21) + белый (5.41:1)
.btn--secondary фон --surface, рамка --border-strong, текст --text
.btn--ghost     прозрачный, текст --muted → --text на hover
.btn--danger    фон --danger, белый текст (5.69:1) — сплошной, а не мягкий
.btn--sm        min-height 36, font --fs-sm, padding 0 var(--sp-3)
.btn--icon      width = height = 44 (36 при --sm), padding 0, aria-label обязателен
состояния: :hover, :active (одно scale .98), :focus-visible (кольцо), [disabled]/[aria-disabled] (opacity .5 + pointer-events none), [aria-busy] (спиннер 16px слева, текст не меняется)
```

Плюсы: один источник для всех восьми высот, ссылки‑кнопки перестают требовать `textDecoration:none`, «Предпросмотр» становится ghost. Минусы: замена `className="secondary sm"` на `"btn btn--secondary btn--sm"` — ~120 правок в TSX (механические, можно sed'ом).

### 3.2. Поля ввода, select, textarea

Определение: `input, select, textarea` (стр. 62): 44px, `.55rem .8rem`, `--border-strong`, `--radius-sm`, focus: рамка `--accent` + кольцо 3px `--accent-soft`. `label` (стр. 59): блочный, `.75rem 0 .3rem`, .875rem/500. `label.check` — флажок в строку. `.hint`, `.error`. `select { appearance: auto }` — нативный вид. `.inline-form input` 40px. `.lock-note textarea` — переписывает рамку/радиус/паддинг заново (дубликат базового правила). `.capture input` — uppercase + letter‑spacing. `.timeline input[type=range]` — только `accent-color`.

Использование: формы входа/регистрации/аккаунта, создание игры, настройки, дела (input вместо textarea для описания до 2000 символов — `DeedsBlock.tsx:79`), команды, админы, адресаты, комментарии ревьюера (inline `minHeight:36`), ставки (`width:110`/`100`), ключ конверта, ответ на задание (`number`/`text`), спор (textarea), сдача дела (2 textarea), дата окончания (`datetime-local`), диапазон (range), 4 селекта ролей (`width:auto; minHeight:34`).

Несогласованности:
- Высоты 44 / 40 / 38 / 36 / 34 (см. 1.4). Поле «ссылка приглашения» — 38, комментарий — 36, select роли — 34, всё в одной колонке админского списка.
- `font: inherit` = 15px → iOS‑зум (см. 2.1).
- Нативный `select` на iOS, Android и десктопе выглядит по‑разному (высота, стрелка, шрифт попапа) — прямое нарушение «единого стиля»; в `TeamsBlock`/`TeamPage` select ещё и ужат до 34px и стоит рядом с кнопкой 34px и аватаром 30px — три разных ритма в одной строке.
- Нет стилей: `:disabled`, `[readonly]` (ссылка‑приглашение выглядит редактируемой), `:invalid`/`aria-invalid` (ошибки показываются отдельным `.error` под формой, без связи с полем), `::placeholder` (цвет браузера — серый холодный на тёплом пергаменте), `:autofill` (жёлтый/синий фон Chrome/Safari на белой карточке), `input[type=number]` спиннеры (Chrome показывает, Safari iOS нет).
- `label` без `for` в `DeedsBlock` («Направление», «Что сдать», «Тематическая книга», «Тяжесть») — клик по подписи не фокусирует поле.
- `label.check input { width: auto; height: auto }` — нативный чекбокс 13–16px, строка ~22px: цель касания ниже 24px.
- `.capture input { text-transform: uppercase }` + `onChange(toUpperCase)` — дублирование логики в CSS и JS.

Целевой вариант: компонент `.field` (label + control + hint/error) с токенами `--control-h 44`, `--control-h-sm 36`, `--fs-md 16px` внутри контролов; `select` с `appearance: none` и единой стрелкой (inline‑SVG data‑URI цветом `--muted`), одинаковый на всех платформах; `::placeholder { color: var(--muted); opacity: .7 }`; `:autofill` через `box-shadow: 0 0 0 1000px var(--surface) inset`; `[readonly]` — фон `--surface-2`, курсор `text`, без кольца; `[aria-invalid=true]` — рамка `--danger`, кольцо `--danger-soft`, `.field__error` под полем с `id`, привязанным через `aria-describedby`; чекбокс/радио — кастомные 20px с той же рамкой и кольцом, строка‑цель ≥ 44px; числовые поля — `inputMode="numeric"` и скрытые спиннеры; `input[type=range]` — кастомный трек 4px / ползунок 20px (иначе на Android он серый, на iOS белый).

Плюсы: одинаковые формы на всех ОС, нет iOS‑зума, ошибки читаются скринридером. Минусы: кастомный select/чекбокс — ~40 строк CSS и риск регрессий в старых Android WebView (проверить на `appearance: none` для select — поддержка полная с 2020).

### 3.3. Карточки

`.card` (стр. 47 и дубликат стр. 374 с `transition: box-shadow .2s`, у которого нет hover‑эффекта — бесполезный transition): 1.1rem → 1.4rem на ≥720, `margin-bottom: 1rem`, тень‑токен. `.card[data-tone]` — верхняя цветная кромка 3px в 6 тонах (accent, green, blue, warn, danger, plum); `h2 .ico` перекрашивается по тону.

Использование тонов: `warn` — «Подготовка», «Споры», «Итоги»; `green` — «Адресаты», «Сдачи»; `blue` — «Команды», «Дипломатия (админ)»; `accent` — «Дела», «Мои команды», «Аккаунт»; `plum` — «Настройки», «Администраторы», «Мои игры»; `danger` — «Испытания». Тон не несёт семантики (green для «сдач» и «адресатов», warn для «подготовки» и «итогов») и не запоминается — это чистая декорация, которая противоречит минимализму и добавляет два цвета вне палитры.

Родственные «карточки» с собственными паддингами: `.card.auth` (420px), `.card.map-card` (.6/.8), `.game-card` (1 1.1, hover‑подъём, левая полоса тона), `.team-card` (.9 1; .8 .9 на ≤480), `.tile` (.7 .8, фон surface‑2), `.war`, `.battle` (левая полоса 4px, 6 модификаторов), `.cipher`, `.admin-city`, `.district`/`.sortable li` (.5 .6), `.choices li` (.55 .7), `.hint-box`, `.readiness .item`, `.team-stripe` (левая полоса 4px, `.9rem` отступ, в `.path-list` другой). Итого 14 «поверхностей второго уровня» с 9 разными паддингами и 3 схемами «цветная полоса» (сверху 3px, слева 4px у `.game-card::before`, слева 4px у `.battle`/`.team-stripe` через border).

Состояния: у `.card` нет интерактивных состояний и не нужно; у `.game-card`/`.team-card` есть hover, нет `:focus-visible` (они `<a>`, глобальное кольцо сработает, но с принудительным `border-radius: 6px` вместо 12); `.district.open` — hover сдвиг на 3px, active scale, нет focus (это `li` с `onClick`, недоступен с клавиатуры).

Целевой вариант: `.card` (surface, `--r-md`, тень‑1, паддинг `--sp-5` на всех экранах — единый отступ вместо 1.1/1.4) и `.card--flat` (surface‑2 без тени) для вложенных плиток (`.tile`, `.war`, `.battle`, `.cipher`, `.admin-city`, `.hint-box`) с одним паддингом `--sp-4`; строки‑элементы списков (`.district`, `.sortable li`, `.choices li`, `.readiness .item`, `.verses li`) — `.item` с паддингом `--sp-3 --sp-4` и минимальной высотой 44. Цветовая кромка — один способ (`.card[data-tone]` сверху) и только для семантики (`ok`/`warn`/`danger`), а не для навигационных секций; `blue`/`plum` убрать. Командный цвет — только через `--team` и один модификатор `.is-team` (левая полоса 4px).

Плюсы: одна поверхность вместо 14, минус 2 цвета, карточка на телефоне и десктопе одинакова. Минусы: админ теряет «цветовую навигацию» по карточкам — заменить её иконкой в заголовке (уже есть) и порядком вкладок.

### 3.4. Бейджи, чипы, счётчики

Шесть компонентов одной роли:

| Класс | Паддинг | Размер | Вес | Форма | Где |
|---|---|---|---|---|---|
| `.badge` (+`.accent/.ok/.bad`) | .1 .5rem | .75 | 600 | pill, рамка | роли, статусы, команды (inline фон) |
| `.pill` (+`.draft/.live/.done`) | .15 .6rem | .75 | 700, uppercase, `.02em` | pill | статус игры |
| `.stat` | .2 .6rem | .82 | 400/600 | pill, белый .7 | счётчики в шапке игры и `.game-card` |
| `.tabbar .n` (+`.hot`) | 0 6px, 20px | .72 | — | pill | счётчик на вкладке |
| `.edge-handle .count` | 0 4px, 18px | .7 | 700 | круг, accent | счётчик на язычке |
| `.district .num` | 26px | .8 | 700 | круг, accent | номер района |
| `.standing .rank` | 22px | .85 | 700 | текст | место в таблице |
| `.tabbar .n.hot` / `.badge.accent` / `.pill.live` | | | | | три разных «активных» чипа: заливка accent+белый / accent‑soft+accent‑hover / success‑soft+точка |

Командный бейдж рисуется inline (`background: team.color; color: #fff; borderColor: transparent`) в 8 местах; в `CityPopup` — наоборот, рамка и текст цветом команды на белом. Белый текст на `#C48A3F` даёт 2.98:1, на `#7D8B4E` — 3.70:1 (раздел 5).

Целевой вариант: `.chip` (pill, `--fs-xs`, 600, высота 22, паддинг 0 `--sp-2`) с модификаторами `--neutral | --accent | --ok | --warn | --bad | --team` (для `--team`: фон — тон команды 16% на белом, текст — затемнённый командный цвет через `color-mix(in srgb, var(--team) 80%, black)`, контраст ≥4.5 для всех шести цветов) и `.chip--count` (min‑width 20, круглый). `.pill` статуса игры — тот же `.chip` с точкой‑индикатором через `::before`. `.stat` — `.chip--neutral` с иконкой. Uppercase убрать (кириллица в капителях читается хуже и шире).

### 3.5. Сообщения: `.note`, `.error`, `.hint`, `.hint-box`, `.readiness .item`

`.error` (danger‑soft, `.55 .8`, `margin .5rem 0`) фактически равен `.note.bad` (`margin .4rem 0`) — дубликат с другим маргином. `.hint` .8rem / `.card .hint` .78rem / `.tile .hint` .75rem — три размера одной подсказки, причём почти все подсказки внутри карточек, так что базовый `.hint` практически мёртв. `.hint-box` — четвёртый тип (accent‑soft, .92rem). `.readiness .item` — единственный с иконкой. `.lock-note` — `.note.bad` с колонкой и textarea.

Используются и как `<p>`, и как `<div>`, где `<p>` получает ещё `p { margin: .4rem 0 }` (совпадает с `.note`, но не с `.error`). Нет `role="alert"`/`aria-live` ни у ошибок форм, ни у тостов. В `.note` иконки добавляются вручную (`<Icon name="mail" />` в тексте, `<Icon name="edit" />` — с пробелом после), выравнивание — по базовой линии текста, не по центру строки.

Целевой вариант: один `.note` с модификаторами `--info | --ok | --warn | --bad`, обязательный слот иконки (`display: grid; grid-template-columns: 20px 1fr; gap`), `role="status"` для ok/info и `role="alert"` для bad; `.error` = `.note--bad`; `.hint` — один размер `--fs-sm`, `--muted`; `.hint-box` = `.note--info` с фоном `--accent-soft`.

### 3.6. Списки

`.list li` определён дважды (`.7rem 0` стр. 91 → `.55rem 0` стр. 373): первое — мёртвый код. `.side-menu .list li` — `.5rem 0`. Четыре места добавляют inline `alignItems: flex-start`, потому что в `.list li` стоит `align-items: center`, а ревьюерские строки многострочные. Строки с `onClick` (`TeamPage.tsx:233`, `:244`) — `li`/`div` без `tabIndex`/`role`, недоступны с клавиатуры и без hover/focus.

`.districts`/`.sortable` — `gap .4rem`, `.district` .5 .6; `.sortable li` серый (`surface-2`, `--muted` текст 5.6:1 — текст районов до угадывания порядка читается как «выключенный», хотя это основной контент задания); `.grip` — `⋮⋮` с `letter-spacing: -2px`, `role="button"` без `tabIndex`; `.arrows button` 22px — самая маленькая цель в приложении, а это основной способ сортировки для пользователей без drag'а.

`.verses li` — ~31px высоты, `.35rem .6rem`, кликабельный `li` без focus; `.box` 20px. `.choices li` — ~40px, радио 16px. `.standings` таблица — `th` .85rem/500, строки без hover; на телефоне `overflowX: auto` inline (2 места). `.admin-districts` — `ol` с `padding-left: 1.4rem`. `.path-list .team-stripe` — свой паддинг. `.tiles` — grid `minmax(150px,1fr)`, плитка `.tile`.

Целевой вариант: `.list` (разделители `--border`, строка ≥44px, `align-items: flex-start` по умолчанию, `.list__main`/`.list__side`), `.list--interactive` (hover `--surface-2`, `:focus-visible`, `role="button"`/`tabIndex=0` в разметке), `.sortable` наследует `.list--interactive` с ручкой 44×44 (`Icon name="list"` вместо `⋮⋮`) и стрелками 36×36; текст элементов до решения — `--text`, а не `--muted` (состояние «не решено» показывать номером/рамкой, не «выключенностью»).

### 3.7. Вкладки: `.tabs` и `.tabbar`

Два разных компонента: `.tabs` (вход: сегмент‑контрол, 36px, фон surface‑2, активная — белая с тенью) и `.tabbar` (игра: 40px, sticky под шапкой, прозрачные кнопки, активная — белая с тенью, текст `--accent-hover`; на ≥720 превращается в «плавающую» скруглённую снизу панель с тенью). Одна и та же роль «переключить вид» выглядит по‑разному на двух страницах и по‑разному на телефоне/десктопе.

`.tabbar` на телефоне: 5 вкладок с иконками ≈ 520px при ширине 360px, `overflow-x: auto` со скрытым скроллбаром и без градиента‑подсказки — вкладка «Настройки» невидима, пока не догадаешься прокрутить. `role="tablist"`/`role="tab"`/`aria-selected` есть, `aria-controls`/`id` панелей и клавиатурные стрелки — нет. Sticky‑позиция `top: var(--topbar-h)` = 57px: если шапка станет выше (safe‑area), вкладки съедут.

Целевой вариант: один `.tabs` (сегмент, 44px, паддинг 4px, активная — surface + тень‑1, текст `--text`), одинаковый на входе и в игре; на телефоне при >4 вкладках — либо только иконки с подписью 11px под ними (bottom‑tabbar‑паттерн, 5 вкладок помещаются в 360px), либо «Проверка» и «Настройки» под кнопкой «Ещё». Sticky оставить, но без смены внешнего вида на десктопе.

### 3.8. Тосты (`lib/ui.tsx`, `.toasts`/`.toast`)

Фикс внизу без `safe-area-inset-bottom` (на iPhone в standalone тост ложится на индикатор «Домой»); `white-space: nowrap` → «Вашему городу Второзаконие брошен вызов: 12 стихов!» на 360px обрезается; `pointer-events: none` — нельзя закрыть/задержать; 3.5 с фиксировано (для «bad» с длинным текстом мало); нет `aria-live`; вид «ok» — тёмный (`--text`), «bad» — красный, при этом «ok» и «info» не различаются; иконок нет. На десктопе центр‑низ — непривычно (обычно правый‑верх/низ), но допустимо, если одинаково везде.

Целевой вариант: контейнер `role="status" aria-live="polite"`, `max-width: min(92vw, 420px)`, перенос строк, `bottom: calc(var(--sp-4) + env(safe-area-inset-bottom))`, три вида (`ok` с иконкой `check`, `bad` с `alert`, нейтральный), длительность 4 с + 40 мс на символ, пауза при наведении, кнопка закрытия на ≥720.

### 3.9. Подтверждение (`.modal-backdrop`/`.modal`)

440px, паддинг 1.25rem, `zoomIn .26s` с пружиной, Esc и клик по фону закрывают, фокус ставится на ОК. Нет: focus‑trap, возврата фокуса на инициатор, `aria-labelledby`/`aria-describedby`, блокировки прокрутки `body` (на iOS фон прокручивается под модалкой). На телефоне — центр с полями 1rem (нормально), но это третий стиль оверлея после `.sheet` и `.city-popup`: радиус 12 против 16/18, тень `0 12px 40px .25` против `0 -8px 30px .25` и отсутствия тени, бэкдроп `.45 + blur 2` против `.5 + blur 2` против отсутствия бэкдропа у `.sheet`.

### 3.10. Боковое меню (`.side-menu`)

Определено дважды: стр. 163 (`padding 1rem; gap 1rem`) и стр. 340 (`padding 0; gap 0`) — первое перекрыто. `.side-head` — градиент командного цвета через `color-mix` (Safari ≥16.2, Chrome ≥111; для более старых WebView — сплошной цвет без fallback — стоит добавить `background: var(--team)` строкой выше). `.section h2` .95rem (меньше body), `.menu-links` — сетка 3 плиток, `.side-menu .list li` .5rem. Секции: дела, испытания (`BattleCard compact`), положение команд (`.standing`), дипломатия, состав (`Roster flat`), push‑приглашение, ссылки. `width: min(380px, 88%)`, `slideIn .3s`, бэкдроп `.35`. Мёртвое правило `.side-menu .menu-link` (в разметке `.menu-links a`). Закрытие: клик по фону, крестик, свайп влево; Esc — нет; focus‑trap — нет; `role="dialog"` — нет. На десктопе меню выглядит так же — это правильно, но открывается только с «язычка» 26px слева, который на десктопе выглядит как артефакт; кнопки «меню» в HUD нет.

### 3.11. Попап города (`.city-popup`) и лист дела (`.sheet`)

`.city-head` определён дважды (стр. 178: img 56, strong 1.1; стр. 355: отрицательные поля, градиент над картинкой города, img 60, strong 1.2, радиус 18) — второе перекрывает размеры первого. Внутри: `.districts`, `.cipher`, `.capture`, `.war`, `.battle`, `.passage`, `.verses`, `.picker`, `.task-view`, `.choices`, `.reading`, `.hint-box`, `.lock-note`, `.inline-form` с textarea — самый насыщенный экран, ~25 классов. Мобильный: bottom‑sheet 92% высоты, радиус 18; десктоп: центр, 640px, радиус 16, `zoomIn`. `.sheet` (карточка дела с карты): без бэкдропа, 60% высоты, радиус 16; десктоп — плавающая карточка 420px справа снизу, радиус 14. То есть два нижних листа с разными радиусами, разными десктоп‑воплощениями (модалка vs плавающая карточка) и разной логикой закрытия (у `.sheet` только крестик 34px, клик по карте закрывает через `onSelect(null)`).

`.city-popup` использует `role="dialog" aria-modal` без заголовка‑ссылки и без focus‑trap; `.sheet` — без `role`. Прокрутка `body`/карты под открытым листом не блокируется (у карты `touch-action: none`, так что на телефоне терпимо).

Целевой вариант для всех трёх оверлеев — один примитив `Overlay` с двумя раскладками по брейкпоинту: `sheet` (телефон: снизу, радиус `--r-lg` сверху, ручка‑полоска 36×4, `max-height: 92dvh`, `padding-bottom: env(safe-area-inset-bottom)`) и `dialog` (≥720: центр, радиус `--r-lg`, ширина `sm` 440 / `md` 640). Один бэкдроп (`rgba(31,27,22,.45)`, blur 2), одна анимация (`rise` 240 мс на телефоне, `fade+scale .98→1` 200 мс на десктопе), одна кнопка закрытия 44×44 в правом верхнем углу, `aria-labelledby`, focus‑trap, возврат фокуса, Esc, `overflow: hidden` на `body` через класс. Подтверждение — `dialog sm`, лист дела — `sheet`/`dialog sm`, город — `sheet`/`dialog md`. Плюс: один код, одинаковое поведение везде; минус: плавающая карточка дела на десктопе (удобно смотреть карту рядом) станет модалкой — можно сохранить как третью раскладку `popover` для десктопа, но тогда это осознанный выбор, а не побочный.

### 3.12. HUD карты (`TeamMap`, `AdminMap`)

`.map-hud` (top‑left 10px, pill, аватар 30 + имя + счётчики), `.map-controls` (top‑right, колонка `secondary sm` 42×34 с глифами `⤢`/`★`), `.edge-handle` (слева по центру, 26×64, `›` 18px и счётчик), `.finish-banner` (top 70px), `.map-fab` — **мёртвый** класс. В `AdminMap` панель управления продублирована inline‑стилями (`position:absolute; right:10; top:10; …`) с шириной 40 вместо 42 и одной кнопкой `⤢`; легенда `.legend` под картой, `.timeline` — ползунок. Ни один элемент HUD не учитывает `env(safe-area-inset-top)`: в standalone‑PWA (`display: standalone`, `viewport-fit=cover`) `.map-screen { position: fixed; inset: 0 }` уходит под статус‑бар, и HUD с `top: 10px` накладывается на часы/челку. То же — `.topbar` (sticky top 0 без верхнего отступа) на обычных страницах. Нижний отступ учтён в `.sheet`, `.city-popup`, `.menu-links`, но не в `.toasts`.

Кнопок зума «+/−» нет (только колесо/щипок и «вся карта»); на десктопе с тачпадом это работает, с мышью без колеса — нет. Иконки‑эмодзи в SVG (`🌊` с `paintOrder="stroke"`, `🏰`, `🔭`) рендерятся системными шрифтами эмодзи: на iPhone, Android и Windows они выглядят по‑разному (цвет, форма, базовая линия) — прямое нарушение «единого стиля на телефоне и компьютере».

Целевой вариант: `.hud` с токенами `--hud-inset: max(var(--sp-3), env(safe-area-inset-*))`; кнопки HUD — `.btn--icon` 44×44 на белом .92 с тенью‑1; иконки — `<use href="#i-…">` из одного SVG‑спрайта, тем же спрайтом рисовать маркеры на карте (`<use>` масштабируется через `transform`); язычок — заменить кнопкой «меню» (иконка `list`) в HUD, свайп от края оставить; легенду — в сворачиваемую плитку HUD, а не под картой (на телефоне она под картой не видна без прокрутки).

---

## 4. Раскладка

Ширины: `.container` 1040 (паддинг 1rem / 1.5rem ≥720), `.topbar-inner` 1040, `.auth`/`.card.auth` 420, `.modal` 440, `.sheet` desktop 420, `.side-menu` min(380, 88%), `.city-popup` 640, `.userchip .name` 160, `.cards` `minmax(280px,1fr)` (≥640), `.tiles` `minmax(150px,1fr)`, `.grid.cols-2/3` (≥640), `.label-row` 2 колонки (>640).

Медиазапросы (15 штук): `min-width: 720` ×7 (container, card, sheet, city‑popup, tabbar, map‑card, city‑head), `min-width: 640` ×2 (grid, cards), `min-width: 540` ×1 (`.brand .sub`), `max-width: 540` ×1 (`.actions button` растягивается), `max-width: 480` ×1 (`.team-card`), `max-width: 640` ×1 (ярлыки), `prefers-reduced-motion`, `print`. Смешение `min-` и `max-` на одном значении (540) означает, что при ширине ровно 540 срабатывают оба. Четыре точки (480/540/640/720) для приложения из ~10 экранов — много; при этом нет ни одной точки выше 720, т.е. «десктоп» = «планшет».

Что меняется между телефоном и десктопом: паддинг контейнера и карточек; подпись бренда; сетки форм 1→2/3; кнопки `.actions` растянутые→авто; `.sheet` низ→плавающая карточка; `.city-popup` низ→центр‑модалка с другой анимацией; `.tabbar` «вклеенная полоса»→«плавающая панель со скруглением и тенью»; `.team-card .go` текст скрыт <480; `.map-card` паддинг; ярлыки 1→2 колонки. Не меняется (и это хорошо): экран карты команды, боковое меню, шапка, формы входа.

Где телефон и десктоп — «разные продукты»: (1) лист дела: bottom‑sheet без бэкдропа vs плавающая карточка; (2) попап города: bottom‑sheet vs центрированная модалка; (3) `.tabbar`: две разные визуальные модели; (4) нативные `select`/`datetime-local`/`number`/`range`; (5) эмодзи в SVG и в текстах; (6) шапка: на телефоне «Выйти» текстом + имя обрезано 160px, на десктопе + «Аналитика»; (7) карта админа: внутри карточки высотой `min(70vh,640)` с кнопкой 40px, карта команды — полноэкранная с кнопками 42px и другим фоном (`#2B2724` vs `--surface-2`).

Sticky/fixed: `.topbar` (sticky, z 10), `.tabbar` (sticky top 57, z 9), `.map-screen` (fixed), `.toasts` (fixed, z 110), `.modal-backdrop` (fixed, z 100), `.side-head` (sticky внутри меню), `body::before`/`.login-page::before/::after` (fixed фон). `overscroll-behavior-x: none` на body и `overscroll-behavior: none` на карте — верно. `.tabbar` со скрытым скроллбаром без подсказки — см. 3.7. `.verses` (300px) и `.passage .text` (220px) — вложенные скроллы внутри скроллящегося попапа: на телефоне «ловушка прокрутки» (палец на списке стихов прокручивает список, а не попап). Прокрутка `body` под модалками не блокируется.

Safe‑area: учтён только низ в 3 местах (см. 3.12). Боковые вставки (`env(safe-area-inset-left/right)`) для ландшафта с челкой не учтены нигде; `.container` даёт 16px, чего хватает не всегда.

Целевой вариант: две точки — `sm: 640px` (формы в 2 колонки, карточки в сетку) и `md: 960px` (контейнер до 1040, боковые панели); только `min-width`; ни один компонент не меняет визуальную модель между точками — меняется только раскладка (колонки, позиция оверлея). Токены `--gutter: clamp(16px, 4vw, 24px)` и `--safe-top/bottom/left/right`. Единая z‑шкала: `--z-sticky: 10; --z-overlay: 20; --z-drawer: 30; --z-dialog: 40; --z-toast: 50`.

---

## 5. Цвет

### 5.1. Палитра, которая есть

UI‑палитра (`:root`): пергамент `#F6F4EF`, белый, `#FBFAF7`, рамки `#E6E1D6`/`#CFC7B8`, чернила `#1F1B16`, приглушённый `#6B645A`, акцент `#C7742A`/`#B0651F`/`#FBEEDF`, danger `#B3402F`/`#FBE9E5`, success `#3E7A4E`/`#E6F2E9`, warn `#8A6A12`/`#FBF3DD`. Вне токенов: синий `#2F6FB3`/`#E4EEF9`, сливовый `#7B4E8A`/`#F0E6F3`, зелёный №2 `#2F6B3A`, красный №3 `#F5D9D3`, серый ярлыков `#8a8378`, кремовая шапка `rgba(255,253,249,.9)`. Карта (`hexmap.ts`): местность `#D9B97A #B99A5B #8FA05A #8E8272 #4F7C99 #7D8B4E`, туман `#3F3A34`, фон экрана `#2B2724`, команды `#A9553A #4F7C99 #7D8B4E #8E5A9E #C48A3F #3B6E6E`, подписи `#F3EAD3`, дальний узел `#B9B1A5`.

Эталонная палитра иллюстраций из `docs/ART_BRIEF.md`: parchment `#E8D9B5`, sand `#D9B97A`, ochre `#C48A3F`, olive `#7D8B4E`, terracotta `#A9553A`, river blue `#4F7C99`, ink `#3B2F2F`. Командные цвета и местность из неё взяты (согласовано), а UI‑акцент `#C7742A` и чернила `#1F1B16` — нет: акцент интерфейса чуть ярче и краснее охры иллюстраций, чернила холоднее. Это заметно на странице входа, где карточка лежит поверх панорамы. Решение — не менять бренд‑акцент (он задан владельцем), а вывести из него семейство (см. 9.2) и слегка потеплить нейтральные (`--text: #2A241E` даёт 13.95:1 — запас огромный).

### 5.2. Контраст (расчёт по WCAG 2.x, относительная яркость sRGB)

| Пара | Коэффициент | Итог | Где |
|---|---|---|---|
| текст `#1F1B16` / пергамент `#F6F4EF` | 15.58 | AAA | везде |
| текст / белая карточка | 17.12 | AAA | |
| `--muted` / пергамент | 5.31 | AA | `.muted`, подписи |
| `--muted` / белый | 5.84 | AA | |
| `--muted` / surface‑2 | 5.60 | AA | `.tile .label`, районы до сортировки |
| **акцент `#C7742A` как текст ссылки / пергамент** | **3.21** | **не AA** (только крупный текст ≥18.66px bold) | `a { color: var(--accent) }` — все ссылки «видео», «Открыть», «Запросить новую», «Выбрать все оставшиеся» |
| акцент / белый | 3.52 | не AA | ссылки внутри карточек |
| `--accent-hover #B0651F` / белый | 4.44 | не AA (на 0.06) | `.tabbar .active`, `.badge.accent`, `.avatar` |
| **белый / акцент `#C7742A`** | **3.52** | **не AA** для текста кнопок (.925rem/600 = 13.9px — не «крупный») | все primary‑кнопки, `.district .num`, `.cipher .on`, `.tabbar .n.hot`, `.edge-handle .count` |
| белый / `#B0651F` (hover) | 4.44 | не AA | |
| чернила `#1F1B16` / акцент | 4.86 | AA | кандидат для primary‑кнопки |
| `--accent-hover` / `--accent-soft` | 3.89 | не AA | `.badge.accent`, `.avatar` буква |
| danger / danger‑soft | 4.85 | AA | `.note.bad`, `.error`, `button.danger` |
| danger / `#F5D9D3` | 4.27 | не AA | `button.danger:hover` |
| success / success‑soft | 4.45 | не AA (на 0.05) | `.note.ok`, `.badge.ok`, `.readiness .ok` |
| warn / warn‑soft | 4.57 | AA | |
| blue / `#E4EEF9` | 4.42 | не AA | `data-tone="blue"` иконка |
| plum / `#F0E6F3` | 5.25 | AA | |
| белый / `--text` (тост) | 17.12 | AAA | |
| белый / danger | 5.69 | AA | `.toast.bad`, красные бейджи |
| белый / success | 5.12 | AA | `.district.done .num` |
| `#2F6B3A` / белый (`.reading.ok`) | 6.39 | AA | |
| `--border-strong` / белый | 1.68 | — (не текст; для UI‑границ норма 3:1 — не проходит) | иконка пустого состояния `.tab-empty .i`, рамки полей |
| `--border` / белый | 1.30 | — | рамки карточек почти не видны на белом; полагаемся на тень |
| подпись города `#1F1B16` / `#F3EAD3` | 14.28 | AAA | карта |
| белый / шапка города (.85 чернил над средней картинкой) | ≈14 | AAA | |
| белый .82 / шапка (.55 над светлой картинкой) | ≈5.9 | AA | нижняя часть градиента — на светлых городах близко к границе |

Командные цвета:

| Цвет | белый на нём | чернила на нём | как текст на пергаменте |
|---|---|---|---|
| `#A9553A` | 5.19 AA | 3.30 | 4.72 AA |
| `#4F7C99` | 4.49 (не AA на 0.01) | 3.81 | 4.09 |
| `#7D8B4E` | **3.70** | 4.63 | 3.37 |
| `#8E5A9E` | 5.11 AA | 3.35 | 4.65 AA |
| `#C48A3F` | **2.98** | 5.75 | **2.71** |
| `#3B6E6E` | 5.77 AA | 2.97 | 5.25 AA |

Выводы: командные бейджи «белым по цвету» (8 мест) не проходят для двух команд из шести; «цвет команды как текст» (`JoinPage`, `CityPopup` бейдж владельца) — для двух‑трёх. На карте подписи городов владельца — белым по цвету команды (`TeamMap.tsx:92`) — та же проблема при масштабе с подписями. Затемнённые на 20% варианты (`#87442E #3F637A #646F3E #72487E #9D6E32 #2F5858`) дают ≥4.06 как текст и ≥4.46 под белым; тон 16% на белом с затемнённым текстом даёт 3.8–6.4 (для `#C48A3F` всё ещё 3.82 — этот цвет стоит заменить в `TEAM_COLORS` на более тёмную охру, например `#A9762F`).

Семантика: `ok/success` — один токен, но три зелёных (`--success`, `#2F6B3A`, `.reading.ok` fallback); `warn` — используется и как «предупреждение», и как тон карточек «Подготовка»/«Итоги», и как цвет черновика (`.pill.draft`), и как «оборона» (`.battle.defense`); `danger` — и «ошибка», и «атака», и «испытание» (`.battle.won` — красный для *выигранного* боя, потому что описан с точки зрения админа), и `data-tone` карточки испытаний; `accent` — бренд, ссылка, hover, «мы», «на проверке» (`.badge.accent` для SUBMITTED), «столица», «лидер», «пожертвование». Акцент перегружен: он одновременно «бренд», «интерактивно» и «статус».

Целевой вариант палитры — в 9.2. Ключевые решения: (1) `--link`/`--accent-ink = #9B5A21` (4.93 на пергаменте, 5.41 на белом) для текста и ссылок; акцент `#C7742A` — только для заливок, иконок, полос (для нетекстовых элементов норма 3:1 — проходит на всех фонах); (2) primary‑кнопка: либо `#C7742A` + чернила (4.86, «золотая печать» — уместно пергаменту), либо `#9B5A21` + белый (5.41); рекомендую второе для однозначности «главного действия» и первого варианта не делать hover‑цветом (hover = `#8F541E`); (3) `--success: #356A44` (5.53 на soft), `--danger` оставить, `--warn` оставить; (4) убрать `blue`/`plum`; «сторона» боя не кодировать цветом семантики — использовать командные цвета атакующего/защитника; (5) статус «на проверке» — `warn`, а не `accent`; «мы» — командный чип, а не accent.

---

## 6. Иконки

`Icon.tsx`: 35 контурных имён (24×24, stroke 2, `currentColor`, `aria-hidden` без `title`), стиль Feather/Lucide. Используются 30 (по частоте: scroll 7, users/trash/map 5, settings/check/back 4, wave/user/bell/alert 3, …). Не используются: `list` (только как fallback), `star`, `expand`, `telescope`; `copy` используется динамически (`Icon name={copied ? "check" : "copy"}`). Ни разу не передаётся `size` — размер задаётся CSS (`1.1em`, `1.15em` в кнопке, `1.2em` в `.icon`, 20px в `.menu-links`, 40px в `.tab-empty`, `.95em` в `.standing .nums`) — 6 размеров без токена.

Эмодзи и глифы в TSX (44 вхождения в 14 файлах):

| Символ | Вхождений | Где | Есть иконка? |
|---|---|---|---|
| → | 6 | «атакующий → защитник» в 4 админских блоках, `AdminMap` ответы, `PushToggle` текст | `chevron` |
| 🌊 | 5 | SVG‑карта команды и админа, заголовок `BattleCard`, `.note` на карте; строки i18n | `wave` (есть!) |
| ✓ | 4 | `.district .check`, `.verses .box`, маркер дела на SVG | `check` |
| ⋮⋮ | 2 (4 символа) | `.grip`, текст подсказки | `list` |
| 🏆 | 3 | `.finish-banner`, `.note` итогов, `.standing .rank` | `crown` |
| ★ | 3 | «К старту» на карте, столица в подписи и в бейдже | `star` (не используется!) |
| ← | 3 | «← Ко входу», «← К странице игры», «← Мои игры» | `back` (используется в `.crumb` на других страницах — два стиля «назад» в одном приложении) |
| ▲ ▼ ▴ ▾ | 4 | стрелки сортировки, «Свернуть/Список», дельта в дашборде | `chevron` с поворотом |
| ⤢ | 2 | «Вся карта» в обоих HUD | `expand` (не используется!) |
| ✕ | 2 | закрыть панель города админа, закрыть лист дела | `x` (используется в 2 других местах — два стиля «закрыть») |
| 🔒 | 2 | закрытое задание | нет (`lock` добавить) |
| 🔭 | 2 + i18n | «Разведать», метка разведки на SVG | `telescope` (не используется!) |
| 🔮 | 1 + i18n | «Открыть подсказку пророка» | нет (`sparkle`/`eye`) |
| 🏰 | 1 | метка «там город» на SVG | `city` |
| › ‹ • · | ~8 | язычок меню, «‹ К районам», выбранный стих, разделители | `chevron`/`back`; `·` как разделитель — норма |
| ⚙ 🗺 | 0 в TSX | ключи в `i18n.en.ts:211,214` — мёртвые записи | |

Эмодзи в i18n‑ключах (`"🌊 Вы бросили вызов…"`, `"🔭 Разведать…"`, `"🔮 Открыть подсказку…"`) означают, что при замене на иконки придётся менять и ключи переводов.

Политика (предлагаемая): один набор — текущий контурный (Lucide‑совместимый), 24px сетка, stroke 2 (1.75 при размере ≥28), только `currentColor`; в UI‑тексте — никаких эмодзи и псевдографики (`→ ← ✓ ✕ ★ ▲ ▼ ⤢ ⋮⋮ › ‹`); размеры — три токена `--icon-sm 16`, `--icon-md 20`, `--icon-lg 24` (+ 40 для пустых состояний); иконка‑кнопка всегда с `aria-label`; на SVG‑карте — тот же набор через спрайт `<symbol>`/`<use>`, чтобы 🌊/🏰/🔭 не зависели от системного шрифта эмодзи; добавить в набор: `lock`, `menu`, `zoom-in`, `zoom-out`, `sparkle` (подсказка), `arrow-right` (для «A → B» лучше вообще не стрелка, а два чипа с подписью «вызов»/«ответ»); удалить мёртвые i18n‑ключи. Плюсы: одинаковый рендер на всех ОС, единый вес линий с Icon‑набором, доступность. Минусы: 44 правки + 5 ключей i18n; 🏆 как «праздничный» акцент потеряется — вместо него можно оставить иллюстрацию (в бренд‑папке есть `capital.webp`) для баннера победы.

---

## 7. Движение

Keyframes: 14 определений (`fade pop rise zoomIn slideIn fadeUp popCheck flipIn ripple toastIn sheet drawer side` + `--spring/--ease`). Не используются: `pop`, `sheet`, `drawer`, `side` (4 мёртвых). Используются: `fade` (3 бэкдропа с разными длительностями .2/.22/.25), `rise` (.32 и .36 — два разных листа), `zoomIn` (.26 и .3), `slideIn` (.3 ×2), `toastIn` .3, `fadeUp` .25 (каждое переключение вкладки), `popCheck` .4, `flipIn` .45, `ripple` .6.

Transitions: `.15s` (поля, кнопки, `.district`, `.game-card` тень/рамка), `.05s` transform кнопки, `.1s` transform карточки игры, `.12s` `.choices li`, `.2s` `.card` тень (без hover‑эффекта — пустой), `1s linear` прогресс чтения. Итого 15 разных длительностей (.05 .1 .12 .15 .2 .22 .25 .26 .3 .32 .36 .4 .45 .6 1) и 4 кривые (`--spring` с перелётом 1.15, `--ease`, `ease-out`, `linear`, дефолтная `ease`).

`--spring` (перелёт) применяется к модалкам, листам, тостам, галочкам и буквам шифра — «пружинистость» противоречит запросу на минимализм и на слабых Android заметно дёргается при `backdrop-filter`. `backdrop-filter: blur` используется в 5 местах (`.topbar`, `.tabbar`, `.map-hud`, бэкдропы) — дорого на телефонах при прокрутке под sticky‑шапкой.

`prefers-reduced-motion`: глобально `animation-duration/transition-duration: .01ms !important` — есть, это хорошо; но `ripple` с `forwards` и `transform` оставляют конечное состояние мгновенно (норма), а `.reading i::after { transition: width 1s }` перестаёт быть плавным (допустимо).

Целевой вариант: три длительности `--dur-fast 120ms` (hover/press), `--dur-base 200ms` (появление элементов, вкладки), `--dur-slow 320ms` (листы/меню); одна кривая `--ease-out: cubic-bezier(.2,.7,.2,1)` для входа, `--ease-in: cubic-bezier(.4,0,1,1)` для выхода; пружина — только для «наград» (`popCheck`, `flipIn`), с длительностью ≤400ms; одна анимация появления для всех оверлеев (`rise` на телефоне, `fade+scale` на десктопе); `fadeUp` на вкладках убрать (переключение должно быть мгновенным); `backdrop-filter` оставить только на бэкдропах модалок, sticky‑шапке дать непрозрачный фон.

---

## 8. Мёртвый и дублирующийся CSS

Селекторы, не встречающиеся ни в одном TSX: `.drawer`, `.drawer .close`, `.map-fab`, `.side-menu .menu-link`, `.side-menu .menu-link:hover`, `@keyframes pop`, `@keyframes sheet`, `@keyframes drawer`, `@keyframes side`, `.hint` в базовом размере (перекрыт `.card .hint` практически всегда). Классы `.battle.attack/.defense/.won/.repelled/.queued/.expired` живы: они собираются из `b.status.toLowerCase()` (статический grep их не видит) — но `.queued` и `.expired` не описаны, а `.attack` (danger) сталкивается с `.att` (blue) на одном элементе.

Дублирующиеся/перекрывающие правила (второе объявление побеждает, первое — мусор):
- `:root` ×3 (стр. 1, 33, 135).
- `.card` (стр. 47) + `.card { transition }` (стр. 374).
- `.list li { padding: .7rem 0 }` (стр. 91) → `.55rem 0` (стр. 373).
- `.side-menu { padding: 1rem; gap: 1rem }` (стр. 163) → `padding: 0; gap: 0` (стр. 340).
- `.city-head`, `.city-head img`, `.city-head .title strong` (стр. 178–181) → (стр. 355–358).
- `.btn.secondary` / `.btn.sm` (стр. 380) дублируют `button.secondary` / `button.sm` (стр. 73, 79).
- `.error` ≡ `.note.bad` с другим margin.
- `.lock-note textarea` повторяет базовый `textarea` (рамка, радиус, `font: inherit`), отличается только `padding .5rem .7rem` и `resize`.
- `.capture .row`, `.war .declare .row`, `.battle .entry-form .row` — три раза `display:flex; gap:.5rem` поверх `.row` (у которого `.6rem` и `flex-wrap`).
- `h1 .ico, .card-head h2 .ico, h2 .ico` — второй селектор лишний.
- `.choices li.on { background: var(--accent-soft, var(--surface-2)) }` — fallback у всегда определённой переменной.
- `.map-controls` продублирован inline в `AdminMap.tsx:104`.
- `.tabbar` описан дважды (мобильный и `≥720`) с 6 из 8 свойств переопределёнными — проще описать один вид.

Классы в TSX без правил в CSS: `.label.inner` (есть только `.outer`), `.lbl-brand`, `.labels-page`, `.battle.admin`, `.sortable.frozen` (свойство `disabled` у `SortableList` никем не передаётся → и `frozen`, и ветка `disabled` мёртвые), `.no-print` (только в `@media print` — это нормально).

Структура файла: 419 строк в одном файле без порядка «токены → база → раскладка → компоненты → страницы»: `.badge.ok` лежит в секции «Битвы», `button.icon` — после дашборда, `.btn.sm` — в «Ярлыках», `.list li` — в «Компактных строках». Рекомендуемое разбиение: `tokens.css`, `base.css`, `layout.css`, `components/*.css` (button, field, card, chip, note, list, tabs, overlay, hud), `pages/*.css` (login, labels/print, map) — Vite соберёт в один бандл.

---

## 9. Приоритеты и токен‑лист

### 9.1. Список изменений

P0 — ломает «единый стиль» или доступность прямо сейчас:
1. Базовый размер 16px, поля 16px — устраняет iOS‑зум при фокусе (`body`, `input/select/textarea`).
2. `safe-area-inset-top` для `.topbar`, `.map-hud`, `.map-controls`, `.edge-handle`, `.finish-banner`, `.side-head`; `safe-area-inset-bottom` для `.toasts`; боковые вставки для `.container` в ландшафте.
3. Контраст: `--accent-ink #9B5A21` для ссылок и текста; primary‑кнопка с контрастом ≥4.5 (см. 5.2); `--success #356A44`; командные чипы — тон 16% + затемнённый текст, замена `#C48A3F` в `TEAM_COLORS`.
4. Убрать `border-radius: 6px` из `:focus-visible` (одна строка, глобальный визуальный дефект на фокусе).
5. `.btn` как полноценный класс для `<a>`: `.btn.ghost`, `:hover`, `:active`, чтобы «Предпросмотр» не выглядел главным действием; `button:disabled:hover` без смены фона.
6. Цели касания ≥40px: `.sortable .arrows button` (22→36), `button.icon` (36→44), `label.check` (строка 44 + кастомный 20px чекбокс), `.verses li` (≥40), HUD‑кнопки 44.
7. Тосты: перенос строк, `max-width`, `aria-live`; ошибки форм `role="alert"`.
8. Эмодзи на SVG‑карте (🌊 🏰 🔭) → `<use>` из спрайта — единственный способ получить одинаковую карту на iPhone/Android/Windows.
9. `.tabbar` на телефоне: видимость пятой вкладки (иконки+подписи или градиент‑подсказка), `aria-controls`.

P1 — унификация компонентов (можно делать по одному, каждая правка самостоятельна):
1. Токены типографики (6 ступеней), отступов (8), радиусов (5), теней (3), длительностей (3), z‑index (5); запрет inline `fontSize`/`margin` через grep в CI.
2. Один `Overlay` (sheet/dialog) для подтверждения, листа дела и города: одинаковые радиус, бэкдроп, анимация, кнопка закрытия, focus‑trap, блокировка прокрутки.
3. Один `.chip` вместо `.badge/.pill/.stat/.n/.count/.num`; один `.note`; один `.tabs`; один `.list` + `.item`.
4. `.field` с состояниями `disabled/readonly/invalid/placeholder/autofill`, кастомные `select`, чекбокс, range; `label for` везде; textarea для «Описание дела».
5. Карточки: один паддинг на всех экранах, `card--flat` для вложенных, `data-tone` только для семантики (убрать blue/plum), командный цвет только через `--team`.
6. Командный цвет: единый механизм `style={{"--team": color}}` + CSS; удалить 19 inline `background/borderColor/color`.
7. Замена эмодзи/глифов в UI на иконки (44 места + 5 ключей i18n), добавить `lock`, `menu`, `zoom-in/out`, `sparkle`; удалить неиспользуемые i18n‑ключи.
8. Брейкпоинты 640/960 только `min-width`; `.actions button` без растягивания по `max-width`.
9. Разбить `styles.css` на файлы, удалить мёртвые/дублирующие правила из раздела 8.

P2 — полировка:
1. Самостоятельный хостинг Inter (variable, cyrillic) + precache в PWA.
2. Кнопки зума ±, кнопка «меню» в HUD, легенда в HUD; `.legend` под картой убрать.
3. Состояние `aria-busy` со спиннером для всех асинхронных кнопок; skeleton вместо «Загрузка…».
4. `PassagePicker`: главы — `select` или горизонтальная лента с прокруткой вместо 150 кнопок; `.verses` без вложенного скролла (высота по содержимому внутри прокручиваемого диалога).
5. Убрать `backdrop-filter` со sticky‑элементов; `fadeUp` с вкладок.
6. Печать ярлыков: цвета через токены с `@media print` переопределением, `.label.inner` описать.
7. `color-scheme: light` в `:root` и `meta name="color-scheme"` — чтобы системная тёмная тема не красила нативные контролы в тёмный на пергаменте (сейчас `select`/`datetime-local` на Android в тёмной теме — тёмные).
8. Dark‑тема — не сейчас: пергаментная концепция светлая; если делать, то через те же токены (в этом главный смысл токен‑листа).

### 9.2. Предлагаемый токен‑лист

Цвет (все текстовые пары ≥4.5:1 на своих фонах; проверено расчётом в 5.2):

```
--bg:            #F6F4EF   пергамент страницы (оставить; бренд‑фон, theme-color в манифесте)
--surface:       #FFFFFF   карточки, поля
--surface-2:     #FAF8F3   вложенные плитки (чуть теплее нынешнего #FBFAF7, ближе к --bg)
--border:        #E3DDD0   разделители (чуть темнее, чтобы читались на белом; UI‑граница ≥1.4:1 достаточно для декоративных)
--border-strong: #B9B0A0   рамки контролов (3.0:1 на белом — норма для UI‑компонентов WCAG 1.4.11; сейчас 1.68)
--text:          #2A241E   чернила (13.95:1; теплее, ближе к ink иллюстраций #3B2F2F, без потери запаса)
--muted:         #6B645A   оставить (5.3:1)
--accent:        #C7742A   бренд: заливки, иконки, полосы, индикаторы (≥3:1 на всех фонах для нетекстового)
--accent-ink:    #9B5A21   ссылки и текст акцентом (4.93 на --bg, 5.41 на белом), primary‑кнопка (белый 5.41)
--accent-strong: #8F541E   hover/active primary (6.08)
--accent-soft:   #FBEEDF   тон
--on-accent:     #FFFFFF
--success / --success-soft:  #356A44 / #E6F2E9  (5.53)
--warn / --warn-soft:        #8A6A12 / #FBF3DD  (4.57)  — статус «на проверке», черновик
--danger / --danger-soft:    #B3402F / #FBE9E5  (4.85; белый на danger 5.69 для сплошной кнопки)
--link:          var(--accent-ink)
--focus:         var(--accent)  кольцо 2px + смещение 2px, без изменения radius
--overlay:       rgba(42,36,30,.45)
--team:          задаётся inline; производные: color-mix(in srgb, var(--team) 16%, white) для фона чипа,
                 color-mix(in srgb, var(--team) 80%, black) для текста
TEAM_COLORS:     #A9553A #4F7C99 #7D8B4E #8E5A9E #A9762F #3B6E6E  (охра затемнена: белый 4.6, текст 4.9)
```

Почему так: акцент не трогаем (узнаваемость, манифест, письма), но снимаем с него роль «текста» — это единственный способ выполнить AA, не меняя бренд. Минус: два оранжевых в системе; правило простое — «заливка = accent, буквы = accent‑ink». Убираем blue/plum: минус две сущности, декоративная навигация по карточкам заменяется иконками. Тёплые чернила `#2A241E` — вкусовое решение, можно оставить `#1F1B16` (плюс: ничего не менять; минус: на панораме входа UI выглядит «холоднее» иллюстраций).

Типографика: см. 2.3 (`--fs-xs .. --fs-2xl`, `--lh-tight 1.2 / --lh-ui 1.45 / --lh-text 1.55`, веса 400/500/600, 700 только h1 и большие числа).

Отступы (сетка 4px):

```
--sp-1: 4px  --sp-2: 8px  --sp-3: 12px  --sp-4: 16px  --sp-5: 20px  --sp-6: 24px  --sp-8: 32px  --sp-10: 40px
--gutter: clamp(16px, 4vw, 24px)      --stack: var(--sp-4)  (между карточками)
--control-h: 44px  --control-h-sm: 36px  --touch: 44px
```

Почему: 27 текущих значений сводятся к 8; 4px‑шаг совместим с высотами 36/44 и иконками 16/20/24. Минус: rem‑дроби вида `.55rem` уйдут, макеты станут чуть «воздушнее» — компенсируется единым паддингом карточек 20px вместо 22.4px на десктопе.

Радиусы:

```
--r-xs: 4px   (чипы внутри строк, `.verses .box`, прогресс)
--r-sm: 8px   (кнопки, поля, плитки)
--r-md: 12px  (карточки)
--r-lg: 16px  (листы, диалоги, боковое меню)
--r-full: 999px (pill, аватар)
```

Тени:

```
--shadow-1: 0 1px 2px rgba(42,36,30,.05), 0 2px 8px rgba(42,36,30,.06)    карточки, HUD
--shadow-2: 0 4px 12px rgba(42,36,30,.10), 0 12px 32px rgba(42,36,30,.10)  hover карточек, поповеры
--shadow-3: 0 12px 40px rgba(42,36,30,.25)                                  диалоги, листы, меню, тосты
--ring:     0 0 0 3px var(--accent-soft)                                     фокус полей
```

Движение и слои:

```
--dur-fast: 120ms  --dur-base: 200ms  --dur-slow: 320ms
--ease-out: cubic-bezier(.2,.7,.2,1)  --ease-in: cubic-bezier(.4,0,1,1)  --spring: cubic-bezier(.2,.9,.3,1.15) (только награды)
--z-sticky: 10  --z-overlay: 20  --z-drawer: 30  --z-dialog: 40  --z-toast: 50
```

Иконки: `--icon-sm 16px`, `--icon-md 20px`, `--icon-lg 24px`, stroke 2 / 1.75 при ≥28px.

Брейкпоинты: `--bp-sm 640px`, `--bp-md 960px` (в медиазапросах custom properties не работают — держать как комментарий/константу в PostCSS, либо просто два числа).

### 9.3. Порядок внедрения, чтобы не сломать игру в сезон

1. Добавить новые токены рядом со старыми (ничего не ломается), переключить `body`/поля на 16px, поправить `:focus-visible`, safe‑area, `.btn` — это P0 за один день без изменения разметки.
2. Компонент за компонентом (кнопка → поле → чип → note → list → overlay), каждый раз удаляя старые правила и inline‑стили, проверяя три экрана: вход, страница игры (админ), карта команды с попапом города — на 360×740, 768×1024 и 1280×800.
3. Иконки и эмодзи — отдельный проход по 14 файлам + i18n.
4. В конце — разбиение `styles.css` и `grep`‑проверка в CI: `style={{` только с `--team`/`--p`/`--c`/`--tone`, ни одного `fontSize`/`margin` inline; ни одного `#` вне `tokens.css`, кроме `@media print`.
