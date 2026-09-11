import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const S = "/tmp/claude-0/-home-user-Lands-of-the-Word/d8e856f4-8e32-5733-84dd-3357c8f44241/scratchpad/";
const pages = process.argv.slice(2).map(Number);
const buf = readFileSync("/home/user/lotw-materials/review/tasks.pdf");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 900, height: 1273 } });
await p.route("**/tasks.pdf", (r) => r.fulfill({ body: buf, contentType: "application/pdf" }));
await p.route("**/worker.js", (r) => r.fulfill({ body: readFileSync(S + "node_modules/pdfjs-dist/build/pdf.worker.min.js"), contentType: "application/javascript" }));
await p.setContent(`<html><body style="margin:0"><canvas id="c"></canvas></body></html>`, { baseURL: "http://local.test/" });
await p.addScriptTag({ path: S + "node_modules/pdfjs-dist/build/pdf.min.js" });
for (const n of pages) {
  await p.evaluate(async (n) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "http://local.test/worker.js";
    window.__pdf ??= await pdfjsLib.getDocument({ url: "http://local.test/tasks.pdf" }).promise;
    const page = await window.__pdf.getPage(n);
    const vp = page.getViewport({ scale: 1.5 });
    const c = document.getElementById("c"); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
  }, n);
  await p.screenshot({ path: S + `rv_p${n}.png` });
}
await b.close();
