# Разбор мест отправки событий (независимый исследователь, 16.11) — что править при адресной доставке
Правило сброса продублировано в apps/api/src/services/views.ts:49 (готовые ответы teams, battles, passages, peace, feed).
Положение (standings, routes/games.ts:69) — одно на партию, сбрасывается любым событием из своего списка; tasks/submissions в списке НЕТ (добавить).

## Сломается при адресной доставке (править)
- routes/cities.ts:377 взятие города ключом: убрать teamId у `cities` (map можно адресным).
- routes/teamMap.ts «/land» (высадка): map → без teamId или командам, у кого открыт любой конец стороны.
- routes/teamMap.ts «/reveal» (админ открывает узел): убрать teamId.
- services/teamMap.ts penalizeTeam: убрать teamId у map и cities.
- routes/diplomacy.ts:319 перенос столицы: убрать teamId у cities.
- routes/diplomacy.ts:40 expirePassages: добавить publish(map, teamId: r.ownerId).
- routes/teams.ts перевод/удаление/вступление: убрать teamId (число участников в положении).
- battles: один помощник — событие претендентам, хранителям и союзникам (PROPOSED/ACTIVE): services/battles.ts:281–282, routes/battles.ts:518–519 (/attack — проще общий battles), :382, :479, services/wall.ts:191–192, services/battles.ts:313,317,441–442,176–177, routes/battles.ts:360, :565–566, :589–591, :333–334.
- routes/wall.ts:297 блок возвращён: teamId: row.holderId ?? row.teamId.
## Покрыто только соседним общим событием — не сужать
- routes/quarry.ts:160–162 (общий teams), routes/wrecks.ts:144 (общий teams), battles/wall — общий submissions.
## Безопасны целиком
trades 8/8, quarry 3/3, wrecks 5/5, journal; map 20 из 25; cities 11 из 15; teams 3 из 7 (роль, аватарка).
## Уже сейчас сломано (чужим видно, события нет)
1. decideTask (принято сухопутное дело): foreign у команд с открытым концом стороны, standings, visitors, осада, top — слать map командам, у кого в TeamNodeState открыт fromKey или toKey (тот же помощник для высадки, мощения, открытия узла, штрафа).
2. routes/games.ts:69: standings не сбрасывается по tasks/submissions — добавить.
3. approached: приложение по map не перечитывает /my-map → arrivals («Внимание») только при плановой сверке.
4. expirePassages — владелец города.
5. Лишняя рассылка: личные записи без teamId (deed_assigned, deed_assign_declined) идут общим journal — передавать teamId.
## В приложении у чужой команды перестанет обновляться
Положение (standingsLater), лист города (cityLater), испытания (battlesLater), «Служение» (feedLater), foreign в разнице карты.
Краевой случай не разобран: assignPeople из ensureFrontier.
