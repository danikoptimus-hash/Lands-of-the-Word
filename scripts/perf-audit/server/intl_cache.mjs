// Проверка гипотезы: если форматтер дат (Intl.DateTimeFormat) создавать один раз на пояс, а не на каждый вызов.
// Подменяем конструктор на запоминающий — только в этом процессе замера.
const Orig = Intl.DateTimeFormat; const memo = new Map();
function Cached(locale, opts) { const k = locale + "|" + JSON.stringify(opts ?? {}); let f = memo.get(k); if (!f) { f = new Orig(locale, opts); memo.set(k, f); } return f; }
Cached.supportedLocalesOf = Orig.supportedLocalesOf.bind(Orig); Cached.prototype = Orig.prototype;
globalThis.__useIntlCache = () => { Intl.DateTimeFormat = Cached; };
globalThis.__noIntlCache = () => { Intl.DateTimeFormat = Orig; };
