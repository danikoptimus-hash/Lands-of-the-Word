import { BOOKS } from "@lotw/domain";

/**
 * Перевод серверных текстов (письма, PDF). Ключ — русская строка как в коде; msg() возвращает перевод
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

/** Дата и время для писем: по языку получателя. */
export function fmtDate(d: Date, locale: Locale): string {
  return d.toLocaleString(locale === "en" ? "en-GB" : "ru-RU");
}
