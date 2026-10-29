/**
 * Награды (решение владельца 29.10): зал наград с командными и личными значками и серия непрерывных дней.
 * Каталог один для сервера и клиента: код — имя файла значка (`/img/awards/<code>.webp`), названия и условия
 * на двух языках, `repeat` — награду можно заработать несколько раз (тогда показывается счётчик).
 * Список согласован владельцем 29.10 (из 22 командных и 22 личных предложенных).
 */
export type AwardKind = "TEAM" | "PERSONAL";
export interface AwardDef {
  code: string;
  kind: AwardKind;
  nameRu: string; nameEn: string;
  /** Условие одной строкой — показывается под значком и в карточке награды. */
  condRu: string; condEn: string;
  /** Награду можно получить несколько раз (вызовы, проходы, недели). */
  repeat?: boolean;
  /** Рубеж серии дней — для плашки серии и праздника рубежа. */
  streakDays?: number;
  /** Что нарисовано на значке — подсказка для генерации картинки (на английском, без текста на самой картинке). */
  symbol: string;
}

export const STREAK_MILESTONES = [5, 10, 15, 20, 25, 30, 40, 50] as const;

export const AWARDS: ReadonlyArray<AwardDef> = [
  // Командные
  { code: "t_open_all", kind: "TEAM", nameRu: "Без единого облака", nameEn: "Not a Single Cloud", condRu: "Вся карта открыта, ни клочка тумана", condEn: "The whole map revealed, not a patch of fog left", symbol: "a fully unrolled map with two islands and a small sun above, no clouds" },
  { code: "t_first_deed", kind: "TEAM", nameRu: "Первый шаг", nameEn: "First Step", condRu: "Первое одобренное дело команды", condEn: "The team's first approved deed", symbol: "a single footprint on a path leading into the distance" },
  { code: "t_first_city", kind: "TEAM", nameRu: "Первые ключи", nameEn: "First Keys", condRu: "Первый взятый город", condEn: "The first city taken", symbol: "two crossed old keys above a small city gate" },
  { code: "t_three_towers", kind: "TEAM", nameRu: "Три башни", nameEn: "Three Towers", condRu: "Три города во владении одновременно", condEn: "Three cities held at the same time", symbol: "three stone towers of different height standing together" },
  { code: "t_island_lords", kind: "TEAM", nameRu: "Хозяева острова", nameEn: "Lords of the Island", condRu: "Все города одного острова у команды", condEn: "Every city of one island held by the team", repeat: true, symbol: "an island silhouette with a crown resting on it" },
  { code: "t_ot_nt", kind: "TEAM", nameRu: "Ветхий и Новый", nameEn: "Old and New", condRu: "Города на обоих островах", condEn: "Cities held on both islands", symbol: "two islands joined by a bridge of light, one with an old scroll, one with an open book" },
  { code: "t_landing", kind: "TEAM", nameRu: "От берега до берега", nameEn: "Shore to Shore", condRu: "Первая высадка на другой остров", condEn: "The first landing on the other island", symbol: "a small sailing ship arriving at a shore with a landing plank" },
  { code: "t_full_crew", kind: "TEAM", nameRu: "Полный состав", nameEn: "Full Crew", condRu: "Каждый участник команды сдал хотя бы одно дело", condEn: "Every team member submitted at least one deed", symbol: "a circle of joined hands seen from above" },
  { code: "t_fifty", kind: "TEAM", nameRu: "Полсотни", nameEn: "Fifty", condRu: "50 одобренных дел команды", condEn: "50 approved team deeds", symbol: "a stack of five tied scroll bundles" },
  { code: "t_hundred", kind: "TEAM", nameRu: "Сотня", nameEn: "Hundred", condRu: "100 одобренных дел команды", condEn: "100 approved team deeds", symbol: "a tall sheaf of wheat bound with a ribbon" },
  { code: "t_three_books_day", kind: "TEAM", nameRu: "Книжники", nameEn: "Scribes", condRu: "Задания районов в трёх городах решены за один день", condEn: "District tasks solved in three cities within one day", repeat: true, symbol: "three open books fanned out with a quill" },
  { code: "t_trial_won", kind: "TEAM", nameRu: "Победители испытания", nameEn: "Trial Victors", condRu: "Выигран вызов на чужой город", condEn: "A challenge for another team's city won", repeat: true, symbol: "a laurel wreath around a small banner" },
  { code: "t_city_shield", kind: "TEAM", nameRu: "Щит города", nameEn: "City Shield", condRu: "Свой город отстоян при вызове", condEn: "Own city defended in a challenge", repeat: true, symbol: "a round shield with a city tower emblem" },
  { code: "t_masons", kind: "TEAM", nameRu: "Каменщики", nameEn: "Masons", condRu: "Первая дорога замощена тёсаным камнем", condEn: "The first road paved with hewn stone", symbol: "a mason's hammer and chisel over a cobbled road" },
  { code: "t_envoys", kind: "TEAM", nameRu: "Послы мира", nameEn: "Envoys of Peace", condRu: "Получен проход через чужой город", condEn: "Passage through another team's city granted to us", repeat: true, symbol: "a white dove carrying an olive branch over a gate" },
  { code: "t_hosts", kind: "TEAM", nameRu: "Гостеприимные", nameEn: "Hospitable", condRu: "Дан проход другой команде", condEn: "Passage granted to another team", repeat: true, symbol: "an open city gate with a lantern hanging above it" },
  { code: "t_long_road", kind: "TEAM", nameRu: "Долгая дорога", nameEn: "Long Road", condRu: "Пройдено 50 сторон", condEn: "50 road sides travelled", symbol: "a winding road over hills vanishing at the horizon" },
  { code: "t_no_returns", kind: "TEAM", nameRu: "Без возвратов", nameEn: "No Returns", condRu: "20 дел подряд одобрены с первого раза", condEn: "20 deeds in a row approved at first try", symbol: "a wax seal with a check mark" },
  { code: "t_team_eyes", kind: "TEAM", nameRu: "Глаза команды", nameEn: "Eyes of the Team", condRu: "Разведчик разведал 5 перекрёстков", condEn: "The scout has scouted 5 crossroads", symbol: "a spyglass pointed at a distant hill" },
  // Личные: серия дней
  { code: "p_streak_5", kind: "PERSONAL", nameRu: "Искра", nameEn: "Spark", condRu: "Серия 5 дней", condEn: "A 5-day streak", streakDays: 5, symbol: "a single small spark" },
  { code: "p_streak_10", kind: "PERSONAL", nameRu: "Огонёк", nameEn: "Little Flame", condRu: "Серия 10 дней", condEn: "A 10-day streak", streakDays: 10, symbol: "a small candle flame" },
  { code: "p_streak_15", kind: "PERSONAL", nameRu: "Пламя", nameEn: "Flame", condRu: "Серия 15 дней", condEn: "A 15-day streak", streakDays: 15, symbol: "a bright flame" },
  { code: "p_streak_20", kind: "PERSONAL", nameRu: "Костёр", nameEn: "Bonfire", condRu: "Серия 20 дней", condEn: "A 20-day streak", streakDays: 20, symbol: "a campfire with logs" },
  { code: "p_streak_25", kind: "PERSONAL", nameRu: "Светильник", nameEn: "Lamp", condRu: "Серия 25 дней", condEn: "A 25-day streak", streakDays: 25, symbol: "an ancient clay oil lamp with a flame" },
  { code: "p_streak_30", kind: "PERSONAL", nameRu: "Маяк", nameEn: "Lighthouse", condRu: "Серия 30 дней", condEn: "A 30-day streak", streakDays: 30, symbol: "a lighthouse with a beam of light" },
  { code: "p_streak_40", kind: "PERSONAL", nameRu: "Столп огненный", nameEn: "Pillar of Fire", condRu: "Серия 40 дней", condEn: "A 40-day streak", streakDays: 40, symbol: "a tall pillar of fire rising to the sky" },
  { code: "p_streak_50", kind: "PERSONAL", nameRu: "Неугасимый", nameEn: "Unquenchable", condRu: "Серия 50 дней", condEn: "A 50-day streak", streakDays: 50, symbol: "a burning bush that is not consumed" },
  // Личные: дела
  { code: "p_first_deed", kind: "PERSONAL", nameRu: "Первое дело", nameEn: "First Deed", condRu: "Первое одобренное дело", condEn: "The first approved deed", symbol: "a single sprouting seedling" },
  { code: "p_ten", kind: "PERSONAL", nameRu: "Верный в малом", nameEn: "Faithful in Little", condRu: "10 одобренных дел", condEn: "10 approved deeds", symbol: "a small cluster of ten grains" },
  { code: "p_thirty", kind: "PERSONAL", nameRu: "Верный во многом", nameEn: "Faithful in Much", condRu: "30 одобренных дел", condEn: "30 approved deeds", symbol: "a basket full of fruit" },
  { code: "p_hundred", kind: "PERSONAL", nameRu: "Сотник", nameEn: "Centurion", condRu: "100 одобренных дел", condEn: "100 approved deeds", symbol: "a roman centurion helmet with a crest" },
  { code: "p_early_bird", kind: "PERSONAL", nameRu: "Ранняя птица", nameEn: "Early Bird", condRu: "5 дел взяты и сданы в тот же день до 9 утра", condEn: "5 deeds taken and submitted the same day before 9 a.m.", symbol: "a small bird singing at sunrise" },
  { code: "p_first_try", kind: "PERSONAL", nameRu: "С первого раза", nameEn: "First Try", condRu: "10 дел подряд одобрены без возврата", condEn: "10 deeds in a row approved without a return", symbol: "an arrow in the centre of a target" },
  // Личные: стихи в испытаниях
  { code: "p_verses_10", kind: "PERSONAL", nameRu: "Стих в сердце", nameEn: "Verse in the Heart", condRu: "10 стихов зачтены в испытаниях", condEn: "10 verses counted in trials", symbol: "a heart with a small scroll inside" },
  { code: "p_verses_30", kind: "PERSONAL", nameRu: "Хранитель Слова", nameEn: "Keeper of the Word", condRu: "30 стихов зачтены в испытаниях", condEn: "30 verses counted in trials", symbol: "an open book with a key lying on it" },
  { code: "p_verses_60", kind: "PERSONAL", nameRu: "Сильный в Писании", nameEn: "Mighty in Scripture", condRu: "60 стихов зачтены в испытаниях", condEn: "60 verses counted in trials", symbol: "a sword with a scroll wrapped around its blade" },
  { code: "p_verses_100", kind: "PERSONAL", nameRu: "Псалмопевец", nameEn: "Psalmist", condRu: "100 стихов зачтены в испытаниях", condEn: "100 verses counted in trials", symbol: "a small harp (lyre)" },
  // Личные: карта и море
  { code: "p_pathfinder", kind: "PERSONAL", nameRu: "Следопыт", nameEn: "Pathfinder", condRu: "Своими делами открыл 10 перекрёстков", condEn: "Revealed 10 crossroads with own deeds", symbol: "a compass rose" },
  { code: "p_keyholder", kind: "PERSONAL", nameRu: "Ключник", nameEn: "Keyholder", condRu: "Своим делом открыл дорогу в город", condEn: "Opened the road into a city with own deed", repeat: true, symbol: "a single ornate key" },
  { code: "p_sea_wolf", kind: "PERSONAL", nameRu: "Морской волк", nameEn: "Sea Wolf", condRu: "Участвовал в морском переходе", condEn: "Took part in a sea crossing", repeat: true, symbol: "a ship's wheel with a wave" },
  { code: "p_team_pillar", kind: "PERSONAL", nameRu: "Опора команды", nameEn: "Pillar of the Team", condRu: "Больше всех дел в команде за неделю", condEn: "Most deeds in the team in a week", repeat: true, symbol: "a stone column holding up an arch" },
];

export const AWARD_BY_CODE: ReadonlyMap<string, AwardDef> = new Map(AWARDS.map((a) => [a.code, a]));
export const TEAM_AWARDS = AWARDS.filter((a) => a.kind === "TEAM");
export const PERSONAL_AWARDS = AWARDS.filter((a) => a.kind === "PERSONAL");
export function streakAward(days: number): AwardDef | undefined { return AWARDS.find((a) => a.streakDays === days); }
/** Ближайший рубеж серии, который ещё не взят. */
export function nextStreakMilestone(days: number): number | null { return STREAK_MILESTONES.find((m) => m > days) ?? null; }
