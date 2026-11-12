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

/** Build the site into a fresh temp folder and return its path. `indicators`/`data`
 *  default to the real ones. If the build fails, the error message is its stderr. */
export async function buildSite({ indicators, data } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "gbn-site-"));
  const args = [path.join(ROOT, "site/build.mjs"), "--out", out];
  if (indicators) args.push("--indicators", indicators);
  if (data) args.push("--data", data);
  try {
    await run(process.execPath, args, { cwd: ROOT });
  } catch (e) {
    fs.rmSync(out, { recursive: true, force: true });
    throw new Error(e.stderr || e.message);
  }
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
    let file = path.join(dir, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Build and serve a site. `close()` stops the server and deletes the build. */
export async function servedSite(opts) {
  const out = await buildSite(opts);
  const site = await serve(out);
  return { url: site.url, close: async () => { await site.close(); fs.rmSync(out, { recursive: true, force: true }); } };
}

/** Start Chromium. Uses the browser for this Playwright version, or a shared one
 *  at $PLAYWRIGHT_BROWSERS_PATH/chromium (cloud sessions) when that is all there is. */
export async function launch() {
  let executablePath;
  const shared = process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium");
  if (!fs.existsSync(chromium.executablePath()) && shared && fs.existsSync(shared)) executablePath = shared;
  return chromium.launch({ executablePath });
}

/** Open a page at a given width and scroll every chart into view so lazy charts
 *  draw. Fails if a chart doesn't draw. */
export async function open(browser, url, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    const res = await page.goto(url);
    if (!res.ok()) throw new Error(`${url}: HTTP ${res.status()}`);
    for (const fig of await page.locator("figure[data-chart]").all()) {
      await fig.scrollIntoViewIfNeeded();
      await fig.locator(".plot svg").first().waitFor({ timeout: 10_000 }).catch(async () => {
        throw new Error(`${url}: chart "${await fig.getAttribute("data-chart")}" did not draw`);
      });
    }
    return page;
  } catch (e) {
    await page.close();
    throw e;
  }
}

/** Open a page, run `fn(page)`, and always close the page afterwards. */
export async function withPage(browser, url, width, fn) {
  const page = await open(browser, url, width);
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}
