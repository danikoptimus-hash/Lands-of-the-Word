import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const S = "/tmp/claude-0/-home-user-Lands-of-the-Word/d8e856f4-8e32-5733-84dd-3357c8f44241/scratchpad/";
const buf = readFileSync("/home/user/lotw-materials/review/tasks.pdf");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 900, height: 1273 } });
await p.route("**/tasks.pdf", (r) => r.fulfill({ body: buf, contentType: "application/pdf" }));
await p.route("**/worker.js", (r) => r.fulfill({ body: readFileSync(S + "node_modules/pdfjs-dist/build/pdf.worker.min.js"), contentType: "application/javascript" }));
await p.setContent(`<html><body style="margin:0"><canvas id="c"></canvas></body></html>`, { baseURL: "http://local.test/" });
await p.addScriptTag({ path: S + "node_modules/pdfjs-dist/build/pdf.min.js" });
const info = await p.evaluate(async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "http://local.test/worker.js";
  const pdf = await pdfjsLib.getDocument({ url: "http://local.test/tasks.pdf" }).promise;
  const out = { pages: pdf.numPages, ann: {}, ops: [] };
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const anns = await page.getAnnotations();
    for (const a of anns) { out.ann[a.subtype] = (out.ann[a.subtype] || 0) + 1; }
    if (i <= 3 || i === pdf.numPages) { const ops = await page.getOperatorList(); out.ops.push([i, ops.fnArray.length, anns.length]); }
  }
  return out;
});
console.log(JSON.stringify(info));
await b.close();
