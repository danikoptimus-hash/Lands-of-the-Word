import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RECIPIENT_KIND_LABEL } from "./recipients.js";
import { msg, type Locale } from "./i18n.js";

/**
 * Один PDF со всеми ярлыками для конвертов: на каждый город полоса из двух ярлыков —
 * наружный (кому, город, шифр для семьи) и вкладыш (поздравление, ключ города). A4, 4 полосы на страницу,
 * рез по пунктиру. Шрифт DejaVu Sans лежит в apps/api/assets/fonts (кириллица; стандартные шрифты PDF её не знают).
 */
export interface LabelRow { number: number; name: string; cityKey: string; cityCode: string; recipient: { label: string; kind: string } | null }

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");
const MM = 72 / 25.4;
const PAGE = { w: 210 * MM, h: 297 * MM, margin: 12 * MM };
const ROW_H = 58 * MM, GAP = 6 * MM, PER_PAGE = 4;
const INK = "#1F1B16", MUTED = "#6B645A", LINE = "#8a8378", ACCENT = "#C7742A";

/** Подбирает размер шрифта, чтобы строка (шифр из знака за район — до 16 и больше знаков) поместилась в ширину. */
function fitText(doc: PDFKit.PDFDocument, text: string, width: number, size: number, spacing: number): { size: number; spacing: number } {
  doc.font("bold");
  while (size > 9 && doc.fontSize(size).widthOfString(text, { characterSpacing: spacing }) > width) { size -= 0.5; spacing = Math.max(0.6, spacing - 0.12); }
  return { size, spacing };
}

export function renderLabelsPdf(game: string, rows: LabelRow[], locale: Locale): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, info: { Title: msg(locale, "Ярлыки для конвертов") + " · " + game }, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("body", path.join(FONTS, "DejaVuSans.ttf"));
    doc.registerFont("bold", path.join(FONTS, "DejaVuSans-Bold.ttf"));
    const brand = msg(locale, "Земли Слова");
    const innerW = PAGE.w - PAGE.margin * 2, colW = innerW / 2;

    const header = () => {
      doc.font("body").fontSize(8).fillColor(MUTED).text(msg(locale, "Ярлыки для конвертов · {game} · {n} конвертов", { game, n: rows.length }), PAGE.margin, PAGE.margin - 6 * MM, { width: innerW, align: "left", lineBreak: false });
      doc.text(msg(locale, "Левый ярлык клеится снаружи конверта, правый вкладывается внутрь. Разрежьте по пунктиру."), PAGE.margin, PAGE.margin - 2.5 * MM, { width: innerW, lineBreak: false });
    };
    header();
    rows.forEach((r, i) => {
      const slot = i % PER_PAGE;
      if (i > 0 && slot === 0) { doc.addPage(); header(); }
      const y0 = PAGE.margin + 4 * MM + slot * (ROW_H + GAP);
      const pad = 5 * MM;
      // Рамки: наружный ярлык и вкладыш, общая пунктирная линия посередине.
      doc.save().dash(3, { space: 3 }).lineWidth(0.6).strokeColor(LINE);
      doc.rect(PAGE.margin, y0, innerW, ROW_H).stroke();
      doc.moveTo(PAGE.margin + colW, y0).lineTo(PAGE.margin + colW, y0 + ROW_H).stroke();
      doc.restore();
      const top = (x: number) => {
        doc.font("body").fontSize(7.5).fillColor(MUTED).text(`${brand} · ${game}`, x + pad, y0 + pad - 1 * MM, { width: colW - pad * 2 - 12 * MM, lineBreak: false, ellipsis: true });
        const nx = x + colW - pad - 10 * MM;
        doc.roundedRect(nx, y0 + pad - 1.6 * MM, 10 * MM, 5 * MM, 2.5 * MM).lineWidth(0.6).strokeColor(MUTED).stroke();
        doc.font("bold").fontSize(8).fillColor(MUTED).text(String(r.number), nx, y0 + pad - 0.4 * MM, { width: 10 * MM, align: "center", lineBreak: false });
      };
      // Наружный ярлык.
      let x = PAGE.margin;
      top(x);
      doc.font("bold").fontSize(15).fillColor(INK).text(msg(locale, "Город {name}", { name: r.name }), x + pad, y0 + pad + 6 * MM, { width: colW - pad * 2, lineBreak: false, ellipsis: true });
      if (r.recipient) {
        doc.font("body").fontSize(10.5).fillColor(INK).text(`${msg(locale, "Кому")}: `, x + pad, y0 + pad + 14 * MM, { continued: true, lineBreak: false })
          .font("bold").text(r.recipient.label, { continued: true, lineBreak: false })
          .font("body").fillColor(MUTED).text(` (${msg(locale, RECIPIENT_KIND_LABEL[r.recipient.kind] ?? r.recipient.kind)})`, { lineBreak: false });
      }
      doc.font("body").fontSize(8.5).fillColor(MUTED).text(msg(locale, "Шифр для семьи"), x + pad, y0 + ROW_H - pad - 21 * MM, { lineBreak: false });
      const code = fitText(doc, r.cityCode, colW - pad * 2, 20, 2.5);
      doc.font("bold").fontSize(code.size).fillColor(INK).text(r.cityCode, x + pad, y0 + ROW_H - pad - 17 * MM, { characterSpacing: code.spacing, lineBreak: false });
      doc.font("body").fontSize(8).fillColor(MUTED).text(msg(locale, "Отдайте конверт команде, которая назовёт этот шифр."), x + pad, y0 + ROW_H - pad - 5 * MM, { width: colW - pad * 2, lineBreak: false, ellipsis: true });
      // Вкладыш.
      x = PAGE.margin + colW;
      top(x);
      doc.font("bold").fontSize(12.5).fillColor(INK).text(msg(locale, "Поздравляем с открытием города {name}!", { name: r.name }), x + pad, y0 + pad + 6 * MM, { width: colW - pad * 2, height: 12 * MM, ellipsis: true });
      doc.font("body").fontSize(8.5).fillColor(MUTED).text(msg(locale, "Ключ города"), x + pad, y0 + ROW_H - pad - 24 * MM, { lineBreak: false });
      doc.font("bold").fontSize(24).fillColor(ACCENT).text(r.cityKey, x + pad, y0 + ROW_H - pad - 20 * MM, { characterSpacing: 3, lineBreak: false });
      doc.font("body").fontSize(8).fillColor(MUTED).text(msg(locale, "Введите ключ в игре, чтобы занять город. Ключ секретный: не показывайте его другим командам."), x + pad, y0 + ROW_H - pad - 7 * MM, { width: colW - pad * 2, height: 8 * MM });
    });
    doc.end();
  });
}
