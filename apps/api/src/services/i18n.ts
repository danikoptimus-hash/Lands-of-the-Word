import { BOOKS } from "@lotw/domain";

/**
 * Перевод серверных текстов (письма, PDF, ответы API). Ключ — русская строка как в коде; msg() возвращает перевод
 * для языка получателя или саму строку. Подстановки: msg("en", "Город {book} взят", { book: "rut" }) —
 * значение ключа book считается кодом книги и подставляется её названием на нужном языке; остальные
 * строковые значения тоже переводятся, если есть в словаре (например «вызов» / «ответ»).
 */
export type Locale = "ru" | "en";

const EN: Record<string, string> = {
  "Земли Слова": "Lands of the Word",
  "Открыть карту команды": "Open the team map",
  "Проверить": "Review",
  "вызов": "challenge",
  "ответ": "answer",
  "семья": "family",
  "вдова": "widow",
  "старец / старица": "elder",
  "другой адресат": "other recipient",
  // игра
  "игра завершена": "the game is over",
  "в строю осталась одна команда": "only one team is left standing",
  "вышел срок игры": "the game's time limit ran out",
  "администратор завершил игру": "an administrator ended the game",
  "Игра «{game}» завершена: {why}.": "The game “{game}” is over: {why}.",
  " Победила команда «{team}».": " The winning team is “{team}”.",
  // испытания
  "вызов городу {book} отменён": "challenge to the city of {book} cancelled",
  "Пока вы стояли в очереди, уровень испытания города вырос до {level}, а ваша ставка {bid} стала ниже минимальной ({min}). Вызов отменён; можно бросить вызов заново с большей ставкой.": "While you were waiting in the queue, the city's trial level rose to {level}, and your bid of {bid} fell below the minimum ({min}). The challenge is cancelled; you can challenge again with a higher bid.",
  "пошло время ответа города {book}": "the answer clock for the city of {book} is running",
  "Вызов одобрен: {verses} стихов. У вас {hours} ч (до {deadline}), чтобы выучить не меньше. Капитан выбирает отрывок из книги, участники отмечают выученные стихи и прикрепляют видео.": "The challenge is approved: {verses} verses. You have {hours} h (until {deadline}) to learn at least as many. The captain picks a passage from the book, members mark the verses they have learned and attach videos.",
  "город {book} устоял": "the city of {book} stood firm",
  "Ответ одобрен: {m} стихов против {need}. Город остаётся вашим, уровень испытания теперь {m}.": "The answer is approved: {m} verses against {need}. The city stays yours; its trial level is now {m}.",
  "Хранители ответили {m} стихами против ваших {need}. Следующий вызов этому городу потребует не меньше {next}.": "The keepers answered with {m} verses against your {need}. The next challenge to this city will require at least {next}.",
  "город {book} взят": "the city of {book} is taken",
  "Это была столица противника: команда противника выбыла, город стал вашей второй столицей.": "That was the opponents' capital: their team is out, and the city has become your second capital.",
  "Город теперь ваш.": "The city is now yours.",
  "город {book} потерян": "the city of {book} is lost",
  "Потеряна столица: команда выбывает из игры.": "The capital is lost: the team is out of the game.",
  "Ответ не дан в срок или город уступлен. Город перешёл претендентам; его можно вернуть по тем же правилам.": "No answer was given in time, or the city was yielded. The city has passed to the challengers; it can be won back under the same rules.",
  "вызов городу {book} не завершён": "challenge to the city of {book} not completed",
  "За 14 дней вызов не был отправлен на проверку. Штраф: минимальная ставка на этот город для вашей команды выросла на {penalty}.": "The challenge was not submitted for review within 14 days. Penalty: your team's minimum bid for this city has grown by {penalty}.",
  "вызов вашему городу {book}": "a challenge to your city of {book}",
  "Команда «{team}» бросила вызов вашему городу {book} (игра «{game}»), ставка {bid} стихов. Когда админ одобрит их записи, у вас будет ровно столько же времени, сколько ушло у них.": "Team “{team}” has challenged your city of {book} (game “{game}”) with a bid of {bid} verses. Once the admin approves their recordings, you will have exactly as much time as they took.",
  "новые стихи в испытании города {book}": "new verses in the trial of the city of {book}",
  "Команда «{team}» отметила {n} ст. ({side}) и прикрепила ссылки. Проверьте записи в блоке «Испытания».": "Team “{team}” marked {n} verses ({side}) and attached links. Review the recordings in the “Trials” block.",
  "{side} отправлен на проверку": "{side} submitted for review",
  "Команда «{team}» отправила {side} за город {book} на проверку. Проверьте записи в блоке «Испытания».": "Team “{team}” submitted their {side} for the city of {book} for review. Review the recordings in the “Trials” block.",
  "запись в испытании возвращена": "a trial recording was returned",
  "Админ вернул запись ({side}){comment} Переснимите и прикрепите заново.": "The admin returned a recording ({side}){comment} Re-record it and attach it again.",
  // дела
  "новая сдача дела": "a new deed submission",
  "Команда «{team}» сдала дело «{deed}»{donation}. Нужно проверить и одобрить или вернуть.": "Team “{team}” submitted the deed “{deed}”{donation}. It needs to be reviewed and approved or returned.",
  " (пожертвование {amount})": " (donation {amount})",
  "дело вернули на доработку": "a deed was returned for rework",
  "Администратор вернул дело «{deed}».{comment}": "An administrator returned the deed “{deed}”.{comment}",
  " Комментарий: {comment}": " Comment: {comment}",
  // споры по заданиям
  "спор по заданию города {book}": "a dispute over a task in the city of {book}",
  "Команда «{team}» оспаривает блокировку задания {n} города {book}: «{message}». Снимите блокировку или ответьте на вкладке «Проверка».": "Team “{team}” disputes the lock on task {n} of the city of {book}: “{message}”. Lift the lock or reply on the Review tab.",
  "ответ администратора по заданию города {book}": "the admin's answer about a task in the city of {book}",
  "Задание {n}: {verdict}{answer}": "Task {n}: {verdict}{answer}",
  "блокировка снята, можно отвечать снова": "the lock is lifted, you can answer again",
  "блокировка оставлена до истечения суток": "the lock stays until the day is over",
  " Ответ администратора: {answer}": " Admin's reply: {answer}",
  // проходы
  "проход не разрешён": "passage not granted",
  "Владелец города три дня не отвечал на запрос прохода: по правилам это отказ. Можно запросить снова.": "The city's owner did not answer the passage request for three days: by the rules that is a refusal. You can ask again.",
  "запрос прохода через {book}": "a passage request through {book}",
  "ваш город": "your city",
  "Команда «{team}» просит разрешить проход через ваш город.{message} На ответ три дня; молчание — отказ.": "Team “{team}” asks for passage through your city.{message} You have three days to answer; silence counts as a refusal.",
  " Сообщение: {message}": " Message: {message}",
  "проход разрешён": "passage granted",
  "в проходе отказано": "passage refused",
  "Команда «{team}» {verb} проход через свой город.{answer}": "Team “{team}” {verb} passage through their city.{answer}",
  "разрешила": "granted",
  "не разрешила": "refused",
  " Ответ: {answer}": " Reply: {answer}",
  "проход закрыт": "passage closed",
  "Команда «{team}» закрыла проход через свой город. Уже взятые дела остаются.": "Team “{team}” closed the passage through their city. Deeds already taken stay with you.",
  // учётка
  "восстановление пароля": "password reset",
  "Здравствуйте!\n\nКто-то (надеемся, вы) запросил восстановление пароля для учётки «{nickname}» на сайте Земли Слова.\n\nЧтобы задать новый пароль, откройте ссылку (действует 1 час):\n{url}\n\nЕсли это были не вы, просто не открывайте ссылку: пароль не изменится.": "Hello!\n\nSomeone (we hope it was you) requested a password reset for the account “{nickname}” on Lands of the Word.\n\nTo set a new password, open this link (valid for 1 hour):\n{url}\n\nIf it wasn't you, simply don't open the link: the password will not change.",
  "проверка почты": "email check",
  "Почта настроена: письма с сайта доходят.": "Email is set up: messages from the site are getting through.",
  "Уведомления включены: сюда придут вести о делах, испытаниях и проходах.": "Notifications are on: news about deeds, trials and passages will arrive here.",
  // ярлыки
  "Ярлыки для конвертов": "Envelope labels",
  "Город {name}": "City of {name}",
  "Кому": "To",
  "Шифр для семьи": "Cipher for the family",
  "Отдайте конверт команде, которая назовёт этот шифр.": "Hand the envelope to the team that says this cipher.",
  "Поздравляем с открытием города {name}!": "Congratulations on discovering the city of {name}!",
  "Ключ города": "City key",
  "Введите ключ в игре, чтобы занять город. Ключ секретный: не показывайте его другим командам.": "Enter the key in the game to take the city. The key is secret: do not show it to other teams.",
  "Левый ярлык клеится снаружи конверта, правый вкладывается внутрь. Разрежьте по пунктиру.": "The left label goes on the outside of the envelope, the right one inside. Cut along the dashed lines.",
  "Ярлыки для конвертов · {game} · {n} конвертов": "Envelope labels · {game} · {n} envelopes",
  // ответы API (ошибки 4xx): ключ — русская строка из routes/*.ts и services/*.ts
  "Такой никнейм или почта уже заняты": "This nickname or email is already taken",
  "Неверный никнейм, почта или пароль": "Wrong nickname, email or password",
  "Эта почта уже занята": "This email is already taken",
  "Текущий пароль неверный": "The current password is wrong",
  "Письмо не отправилось: почтовый сервер не отвечает. Попробуйте позже или сообщите администратору": "The email was not sent: the mail server is not responding. Try again later or tell an administrator",
  "Ссылка недействительна или устарела. Запросите новую": "The link is invalid or has expired. Request a new one",
  "Только для администратора платформы": "Platform administrators only",
  "Пользователь не найден": "User not found",
  "Город не найден": "City not found",
  "Ваша команда ещё не дошла до этого города": "Your team has not reached this city yet",
  "Испытание не найдено": "Trial not found",
  "Текст этой книги ещё не загружен": "The text of this book is not loaded yet",
  "Игра не идёт": "The game is not running",
  "Нельзя бросить вызов": "You cannot challenge this city",
  "Минимальная ставка на этот город для вашей команды — {min} стихов": "Your team's minimum bid for this city is {min} verses",
  "Ставку можно менять, только пока вызов в очереди": "The bid can be changed only while the challenge is in the queue",
  "Минимальная ставка — {min} стихов": "The minimum bid is {min} verses",
  "Отрывок ответа выбирает капитан": "The captain picks the answer passage",
  "Ответ ещё не начался или уже завершён": "The answer has not started yet or is already over",
  "Отрывок нельзя менять: участники уже отметили стихи": "The passage cannot be changed: members have already marked verses",
  "Укажите отрывок в пределах книги: от «глава:стих» до «глава:стих»": "Give a passage within the book: from “chapter:verse” to “chapter:verse”",
  "Ваша команда не участвует в этом испытании": "Your team is not part of this trial",
  "Вызов ещё в очереди": "The challenge is still in the queue",
  "Вызов уже завершён": "The challenge is already over",
  "Вызов отправлен на проверку: добавлять стихи нельзя": "The challenge has been submitted for review: no more verses can be added",
  "Ответ начнётся, когда вызов будет принят": "The answer starts once the challenge is accepted",
  "Ответ уже завершён": "The answer is already over",
  "Ответ отправлен на проверку: добавлять стихи нельзя": "The answer has been submitted for review: no more verses can be added",
  "Время ответа вышло": "The answer time is up",
  "Сначала капитан должен выбрать отрывок ответа": "The captain must pick the answer passage first",
  "Отмечать можно только стихи из отрывка {range}": "Only verses from the passage {range} can be marked",
  "Эти стихи вы уже отметили": "You have already marked these verses",
  "Запись не найдена": "Recording not found",
  "Принятую запись убрать нельзя": "An accepted recording cannot be removed",
  "Вызов уже отправлен на проверку": "The challenge has already been submitted for review",
  "Ответ уже отправлен на проверку": "The answer has already been submitted for review",
  "Чужую запись может убрать только капитан": "Only the captain can remove someone else's recording",
  "Отправить на проверку может только капитан": "Only the captain can submit for review",
  "Уступить город может только капитан": "Only the captain can yield the city",
  "Идущее испытание не найдено": "No trial in progress was found",
  "Вызов сейчас не идёт": "The challenge is not in progress now",
  "Ответ сейчас не идёт": "The answer is not in progress now",
  "Выучено {sum} из {need} стихов: не хватает {missing}": "{sum} of {need} verses learned: {missing} more needed",
  "Это руины: город берут, решив задания, без ключа и без испытания": "These are ruins: the city is taken by solving its tasks, with no key and no trial",
  "Город свободен: его берут ключом из конверта, а не испытанием": "The city is free: it is taken with the key from the envelope, not by a trial",
  "Это ваш город": "This is your city",
  "Ваша команда выбыла из игры": "Your team is out of the game",
  "Город устоял окончательно: бросить ему вызов больше нельзя": "The city has stood firm for good: it can no longer be challenged",
  "Сначала решите задания всех районов": "Solve the tasks of all districts first",
  "Текст этой книги ещё не загружен: бросить вызов нельзя": "The text of this book is not loaded yet: the city cannot be challenged",
  "Ваш вызов уже в очереди": "Your challenge is already in the queue",
  "Ваш вызов этому городу уже идёт": "Your challenge to this city is already in progress",
  "Задания для этой книги ещё готовятся": "The tasks for this book are still being prepared",
  "Порядок районов уже собран": "The district order is already solved",
  "Расставьте все районы, каждый по одному разу": "Place every district exactly once",
  "Сначала расставьте районы по порядку": "Put the districts in order first",
  "Задание не найдено": "Task not found",
  "Задание уже решено": "The task is already solved",
  "Подождите немного перед следующей попыткой": "Wait a little before the next attempt",
  "Сначала прочитайте текст: время чтения ещё не набрано": "Read the text first: the reading time is not up yet",
  "Задание закрыто на сутки после двух неверных ответов": "The task is closed for a day after two wrong answers",
  "Задание не закрыто: оспаривать нечего": "The task is not closed: there is nothing to dispute",
  "Спор уже отправлен: ждите ответа администратора": "The dispute has already been sent: wait for the administrator's answer",
  "Спор не найден": "Dispute not found",
  "Спор уже решён": "The dispute is already resolved",
  "Город уже ваш": "The city is already yours",
  "Ключ не подходит. Проверьте буквы в конверте": "The key does not fit. Check the letters in the envelope",
  "Город уже принадлежит команде «{team}»": "The city already belongs to team “{team}”",
  "Город или команда не найдены": "City or team not found",
  "Игра не найдена": "Game not found",
  "Вы не администратор этой игры": "You are not an administrator of this game",
  "Дело не найдено": "Deed not found",
  "Вы не состоите в команде": "You are not in a team",
  "С другими командами говорит посол вашей команды": "Your team's ambassador speaks with other teams",
  "Запросы другим командам отправляет капитан или посол, если он назначен": "Requests to other teams are sent by the captain, or by the ambassador if one is appointed",
  "Город не принадлежит другой команде: проход свободен": "The city does not belong to another team: passage is free",
  "Проход уже разрешён": "Passage is already granted",
  "Запрос уже отправлен: ответ ждём до {date}": "The request has already been sent: an answer is expected by {date}",
  "Запрос не найден": "Request not found",
  "Запрос уже рассмотрен": "The request has already been answered",
  "Действующее разрешение не найдено": "No active permission was found",
  "Разведать перекрёсток может только разведчик команды": "Only the team's scout can scout a crossing",
  "Разведать можно только перекрёсток за стороной с делом": "Only a crossing behind a side with a deed can be scouted",
  "Разведка доступна раз в неделю: следующая — {date}": "Scouting is available once a week: next on {date}",
  "Подсказку открывает только пророк команды": "Only the team's prophet can open a hint",
  "Подсказка к этому заданию уже открыта": "The hint for this task is already open",
  "Подсказка доступна раз в неделю: следующая — {date}": "A hint is available once a week: next on {date}",
  "Перенести столицу может только капитан": "Only the captain can move the capital",
  "Столицу можно перенести только один раз за игру, и это уже сделано": "The capital can be moved only once per game, and that has already been done",
  "Это не ваш город": "This is not your city",
  "Это уже столица": "This is already the capital",
  "У команды нет столицы: переносить нечего": "The team has no capital: there is nothing to move",
  "Подсказка не открыта": "The hint is not open",
  "Район не найден": "District not found",
  "Нет доступа к игре": "No access to this game",
  "Игра уже начата: после старта можно менять только срок окончания и пожертвование": "The game has already started: only the end date and the donation can be changed now",
  "Команд уже создано: {n}. Сначала удалите лишние": "Teams already created: {n}. Delete the extra ones first",
  "Игра уже начата: карту менять нельзя": "The game has already started: the map cannot be changed",
  "Нет доступа": "No access",
  "Пользователь с таким никнеймом или почтой не найден: сначала он должен зарегистрироваться": "No user with this nickname or email was found: they must register first",
  "Этот пользователь уже администратор игры": "This user is already an administrator of the game",
  "Создателя игры убрать нельзя": "The game's creator cannot be removed",
  "Игра уже начата": "The game has already started",
  "Уведомления пока недоступны: попробуйте позже": "Notifications are not available yet: try again later",
  "Слишком много устройств с уведомлениями": "Too many devices with notifications",
  "Игра завершена: список адресатов очищен": "The game is over: the recipient list has been cleared",
  "Слишком много адресатов": "Too many recipients",
  "Адресат не найден": "Recipient not found",
  "Сначала добавьте адресатов конвертов на вкладке «Дела»": "Add envelope recipients on the “Deeds” tab first",
  "Вы не состоите в команде этой игры": "You are not in a team of this game",
  "Дело уже взято или сдано": "The deed is already taken or submitted",
  "Дело не взято: отпускать нечего": "The deed is not taken: there is nothing to release",
  "Отпустить дело может тот, кто взял, капитан или летописец": "A deed can be released by whoever took it, the captain or the chronicler",
  "Дело уже сдано": "The deed is already submitted",
  "Сдать чужое дело может только капитан или летописец": "Only the captain or the chronicler can submit someone else's deed",
  "В этой игре пожертвование вместо дела не предусмотрено": "This game does not allow a donation instead of a deed",
  "Минимальное пожертвование — {amount}": "The minimum donation is {amount}",
  "Приложите ссылку на чек или подтверждение перевода": "Attach a link to the receipt or transfer confirmation",
  "Для этого дела нужна хотя бы одна ссылка на фото или видео": "This deed needs at least one photo or video link",
  "Опишите, что сделано": "Describe what was done",
  "Сдача не найдена": "Submission not found",
  "Эта сдача уже рассмотрена": "This submission has already been reviewed",
  "Команда или перекрёсток не найдены": "Team or crossing not found",
  "Перекрёсток уже открыт этой команде": "The crossing is already open to this team",
  "Вы не состоите в этой игре": "You are not part of this game",
  "Все команды уже созданы: по настройкам их {n}": "All teams are already created: the settings allow {n}",
  "Команда с таким названием уже есть": "A team with this name already exists",
  "Игра уже начата: команды удалять нельзя": "The game has already started: teams cannot be deleted",
  "Команда не найдена": "Team not found",
  "Участник не найден": "Member not found",
  "Капитана назначает администратор игры": "The captain is appointed by the game's administrator",
  "Игровые роли раздаёт капитан": "Game roles are assigned by the captain",
  "У капитана уже есть роль: игровые роли получают только участники": "The captain already has a role: game roles go to members only",
  "Приглашение не найдено или истекло": "The invitation was not found or has expired",
  "Вы уже состоите в команде этой игры": "You are already in a team of this game",
};

export const toLocale = (l: string | null | undefined): Locale => (l === "en" ? "en" : "ru");

export function bookName(code: string, locale: Locale = "ru"): string {
  const b = BOOKS.find((x) => x.code === code);
  return b ? (locale === "en" ? b.nameEn : b.nameRu) : code;
}

export function msg(locale: Locale, ru: string, vars?: Record<string, string | number>): string {
  const base = locale === "en" ? EN[ru] ?? ru : ru;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m: string, k: string) => {
    if (!(k in vars)) return m;
    const v = vars[k]!;
    if (k === "book") return bookName(String(v), locale);
    return typeof v === "string" && locale === "en" ? EN[v] ?? v : String(v);
  });
}

/** Текст ошибки API на языке текущего пользователя (гость — по-русски). Ключ — русская строка. */
export function err(request: { user?: { locale?: string | null } | null }, ru: string, vars?: Record<string, string | number>): string {
  return msg(toLocale(request.user?.locale), ru, vars);
}

/** Дата без времени для текстов ответов API. */
export function fmtDay(d: Date, locale: Locale): string {
  return d.toLocaleDateString(locale === "en" ? "en-GB" : "ru-RU");
}

/** Дата и время для писем: по языку получателя. */
export function fmtDate(d: Date, locale: Locale): string {
  return d.toLocaleString(locale === "en" ? "en-GB" : "ru-RU");
}
