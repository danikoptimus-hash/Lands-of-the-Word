import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const S = "/tmp/claude-0/-home-user-Lands-of-the-Word/d8e856f4-8e32-5733-84dd-3357c8f44241/scratchpad/";
const buf = readFileSync("/home/user/lotw-materials/review/tasks.pdf");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage();
await p.route("**/tasks.pdf", (r) => r.fulfill({ body: buf, contentType: "application/pdf" }));
await p.route("**/worker.js", (r) => r.fulfill({ body: readFileSync(S + "node_modules/pdfjs-dist/build/pdf.worker.min.js"), contentType: "application/javascript" }));
await p.setContent(`<html><body></body></html>`, { baseURL: "http://local.test/" });
await p.addScriptTag({ path: S + "node_modules/pdfjs-dist/build/pdf.min.js" });
const data = await p.evaluate(async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "http://local.test/worker.js";
  const pdf = await pdfjsLib.getDocument({ url: "http://local.test/tasks.pdf" }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const anchors = [];
    const items = tc.items;
    for (let k = 0; k < items.length; k++) {
      const s = items[k].str.trim();
      let m = /^№\s*(\d+)$/.exec(s);
      if (!m && s === "№" && items[k + 1]) m = /^(\d+)$/.exec(items[k + 1].str.trim()) && [null, items[k + 1].str.trim()];
      if (m) anchors.push({ n: Number(m[1]), y: items[k].transform[5], x: items[k].transform[4] });
    }
    const anns = (await page.getAnnotations()).filter((a) => a.subtype === "Ink").map((a) => ({ rect: a.rect, strokes: (a.inkLists || []).map((l) => l.length) }));
    pages.push({ i, h: vp.height, w: vp.width, anchors, anns });
  }
  return pages;
});
writeFileSync(S + "marks.json", JSON.stringify(data));
console.log("pages", data.length, "anchors", data.reduce((n, p) => n + p.anchors.length, 0), "inks", data.reduce((n, p) => n + p.anns.length, 0));
await b.close();
