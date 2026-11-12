// Browser test harness: build the site, serve it, open pages in headless Chromium.
// Tests assert only on what a reader sees (text, chart SVG, element boxes).
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WIDTHS = { phone: 390, desktop: 1280 };
export const LANGS = ["de", "en"];

const run = promisify(execFile);

/** Build the site into a fresh temp folder. `indicators`/`data` default to the real ones. */
export async function buildSite({ indicators, data } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "gbn-site-"));
  const args = [path.join(ROOT, "site/build.mjs"), "--out", out];
  if (indicators) args.push("--indicators", indicators);
  if (data) args.push("--data", data);
  await run(process.execPath, args, { cwd: ROOT });
  return out;
}

export const fixture = (name) => ({
  indicators: path.join(ROOT, "test/fixtures", name, "indicators"),
  data: path.join(ROOT, "test/fixtures", name, "data"),
});

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".csv": "text/csv", ".svg": "image/svg+xml", ".json": "application/json" };

/** Serve a folder on a free local port. Returns { url, close }. */
export async function serve(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(dir, p);
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

/** Start Chromium. Uses the browser for this Playwright version, or a shared one
 *  at $PLAYWRIGHT_BROWSERS_PATH/chromium (cloud sessions) when that is all there is. */
export async function launch() {
  let executablePath;
  const shared = process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium");
  if (!fs.existsSync(chromium.executablePath()) && shared && fs.existsSync(shared)) executablePath = shared;
  return chromium.launch({ executablePath });
}

/** Open a page at a given width and scroll every chart into view so lazy charts draw. */
export async function open(browser, url, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const res = await page.goto(url);
  if (!res.ok()) throw new Error(`${url}: HTTP ${res.status()}`);
  for (const fig of await page.locator("figure[data-chart]").all()) {
    await fig.scrollIntoViewIfNeeded();
    // Drawn = an SVG, or a message other than the "Loading …" placeholder.
    const drawn = fig.locator(".plot svg, .plot p:not(:has-text('…'))").first();
    await drawn.waitFor({ timeout: 10_000 }).catch(async () => {
      throw new Error(`${url}: chart "${await fig.getAttribute("data-chart")}" did not draw`);
    });
  }
  return page;
}
