import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { launch, LANGS, ROOT, servedSite, WIDTHS, withPage } from "./harness.mjs";

// The full Land name a reader must find in tooltips and tables.
const MV = { de: "Mecklenburg-Vorpommern", en: "Mecklenburg-Western Pomerania" };
// Its short form, as the spec gives it.
const MV_SHORT = { de: "Meckl.-Vorpommern", en: "Mecklenburg-W. Pom." };
const TURNOUT_BY_LAND = "bundestag-turnout-laender";

/** Every text element in every chart's SVG on the page that sticks out of its
 *  SVG's box, as "chart: text". Empty when all chart text fits. */
async function textOutsideCharts(page) {
  return page.locator("figure[data-chart] .plot svg").evaluateAll((svgs) =>
    svgs
      .filter((svg) => !svg.parentElement.closest("svg"))
      .flatMap((svg) => {
        const b = svg.getBoundingClientRect();
        const chart = svg.closest("figure").dataset.chart;
        return Array.from(svg.querySelectorAll("text"))
          .filter((t) => t.textContent.trim())
          .filter((t) => {
            const r = t.getBoundingClientRect();
            return r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
          })
          .map((t) => `${chart}: "${t.textContent}"`);
      })
  );
}

/** The y-axis labels of a bar or dot chart (the Land names), with their boxes
 *  and drawn `lines`; the array's `svg` is the chart's own box. `read` is the label as a reader reads it: its lines joined by a space, or
 *  directly after a line that ends in a hyphen. `reads` is every way a reader may
 *  read it: a hyphen at a line end is part of the name ("Herz-Kreislauf-" /
 *  "Erkrankungen") or only marks a word broken across lines ("Behandlungs-" /
 *  "komplikationen"). */
async function barLabels(page) {
  return page.locator("figure[data-chart] .plot svg").first().evaluate((svg) => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const labels = Array.from(svg.querySelectorAll("[aria-label='y-axis tick label'] text")).map((t) => {
      const lines = t.querySelectorAll("tspan").length ? Array.from(t.querySelectorAll("tspan"), (s) => s.textContent) : [t.textContent];
      const reads = lines.reduce((accs, l) => accs.flatMap((acc) =>
        !acc ? [l] : acc.endsWith("-") ? [acc + l, acc.slice(0, -1) + l] : [`${acc} ${l}`]), [""]);
      return { text: t.textContent, lines, read: reads[0], reads, box: box(t) };
    });
    return { labels, svg: box(svg) };
  }).then(({ labels, svg }) => Object.assign(labels, { svg }));
}

/** Run `fn(job)` for every job, a few at a time: that keeps a page sweep short. */
async function inParallel(jobs, fn) {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job; (job = queue.shift()); ) await fn(job);
  }));
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

describe("chart labels on the real site", () => {
  let site;
  before(async () => { site = await servedSite(); });
  after(async () => { await site?.close(); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) {
      test(`no chart text spills outside its chart on any topic or single-indicator page (${lang}, ${name})`, async () => {
        const topics = await withPage(browser, `${site.url}${lang}/`, width, (home) =>
          home.locator("#topics a").evaluateAll((as) => as.map((a) => a.href))
        );
        assert.ok(topics.length > 0, "home page links to the topics");
        const singles = new Set();
        const problems = [];
        for (const url of topics) {
          await withPage(browser, url, width, async (page) => {
            for (const p of await textOutsideCharts(page)) problems.push(`${url} ${p}`);
            for (const href of await page.locator(`main a[href*="/${lang}/chart/"]`).evaluateAll((as) => as.map((a) => a.href))) singles.add(href);
          });
        }
        assert.ok(singles.size > 0, "topic pages link to single-indicator pages");
        await inParallel(singles, (url) =>
          withPage(browser, url, width, async (page) => {
            for (const p of await textOutsideCharts(page)) problems.push(`${url} ${p}`);
          }));
        assert.deepEqual(problems, [], "every chart text stays inside its chart");
      });

      test(`the turnout-by-Land chart shows a readable Mecklenburg-Vorpommern label (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/chart/${TURNOUT_BY_LAND}/`, width, async (page) => {
          const labels = await barLabels(page);
          assert.equal(labels.length, 16, "one label per Land");
          const mv = labels.find((l) => l.text.startsWith("Meckl"));
          assert.ok(mv, "there is a Mecklenburg-Vorpommern label");
          assert.ok(!mv.text.includes("…"), `"${mv.text}" is not cut off with an ellipsis`);
          for (const other of labels.filter((l) => l !== mv)) assert.ok(!overlaps(mv.box, other.box), `"${mv.text}" does not overlap "${other.text}"`);
          const svg = await page.locator("figure[data-chart] .plot svg").first().evaluate((s) => s.getBoundingClientRect().left);
          assert.ok(mv.box.left >= svg - 0.5, `"${mv.text}" starts inside the chart`);
        }));
    }
  }

  // Bar and dot charts carry the longest labels (category and Land names), so they
  // are checked at every phone width the spec names as well as on a desktop.
  const BAR_WIDTHS = [320, 360, 390, 1280];
  const barCharts = fs.readdirSync(path.join(ROOT, "indicators"))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "indicators", f), "utf8")).indicators)
    .filter((ind) => ind.chart === "bar-latest")
    .map((ind) => ind.id);
  const barPages = barCharts.flatMap((id) => BAR_WIDTHS.map((width) => ({ id, width })));

  for (const lang of LANGS) {
    test(`bar and dot chart row labels stay inside the chart and clear of each other at 320–1280 px (${lang})`, async () => {
      assert.ok(barCharts.length > 0, "the site has bar or dot charts");
      const problems = [];
      await inParallel(barPages, (job) =>
        withPage(browser, `${site.url}${lang}/chart/${job.id}/`, job.width, async (page) => {
          const where = `${job.id} at ${job.width}px`;
          const labels = await barLabels(page);
          for (const l of labels) if (!inside(l.box, labels.svg)) problems.push(`${where}: "${l.read}" sticks out of the chart`);
          labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => {
            if (overlaps(a.box, b.box)) problems.push(`${where}: "${a.read}" overlaps "${b.read}"`);
          }));
        }));
      assert.deepEqual(problems, [], "every row label is fully inside its chart and overlaps no other");
    });
  }

  for (const id of ["causes-of-death", "government-spending-by-function"]) {
    for (const lang of LANGS) {
      for (const width of [320, 360, WIDTHS.phone]) {
        test(`${id}: category labels wrapped on a phone keep every word of the name (${lang}, ${width} px)`, () =>
          withPage(browser, `${site.url}${lang}/chart/${id}/`, width, async (page) => {
            const labels = await barLabels(page);
            const fig = page.locator("figure[data-chart]").first();
            await fig.locator("[data-action=table]").click();
            const names = await fig.locator(".table-view thead th").allInnerTexts();
            for (const l of labels) assert.ok(l.reads.some((r) => names.includes(r)), `"${l.read}" reads as one of the categories in the table`);
          }));
      }
    }
  }

  // Where a long word may break: the soft hyphens (U+00AD) an indicator's series
  // labels carry, as positions in the plain name a reader sees.
  const SHY = "\u00ad";
  const breakPoints = new Map(fs.readdirSync(path.join(ROOT, "indicators"))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "indicators", f), "utf8")).indicators)
    .flatMap((ind) => Object.values(ind.series ?? {}).flatMap((l) => LANGS.map((lang) => l[lang])))
    .map((name) => {
      const at = [];
      let plain = "";
      for (const c of name) c === SHY ? at.push(plain.length) : (plain += c);
      return [plain, at];
    }));

  /** Where the drawn lines break a word of `name` with a hyphen the name lacks,
   *  as positions in `name`; null if the lines don't spell the name. */
  function insertedBreaks(lines, name) {
    const at = [];
    let p = 0;
    for (const l of lines) {
      if (name.startsWith(l, p)) p += l.length;
      else if (l.endsWith("-") && name.startsWith(l.slice(0, -1), p)) { p += l.length - 1; at.push(p); continue; }
      else return null;
      if (name[p] === " ") p++;
    }
    return p === name.length ? at : null;
  }

  for (const lang of LANGS) {
    test(`a word of a category name too long for its line breaks only where the name marks a break, between the parts of a compound (${lang})`, async () => {
      const problems = [];
      let checked = 0;
      await inParallel(barPages, (job) =>
        withPage(browser, `${site.url}${lang}/chart/${job.id}/`, job.width, async (page) => {
          for (const l of await barLabels(page)) {
            // Category names are series labels; Land names shorten rather than break.
            const name = l.reads.find((r) => breakPoints.has(r));
            if (!name) continue;
            checked++;
            if (insertedBreaks(l.lines, name)?.some((i) => !breakPoints.get(name).includes(i))) problems.push(`${job.id} at ${job.width}px: ${JSON.stringify(l.lines)}`);
          }
        }));
      assert.ok(checked > 0, "the bar charts show category names");
      assert.deepEqual(problems, [], "no word is broken anywhere but at a marked break");
    });
  }

  // The Germany figure on a Länder chart, as the chart labels it.
  const GERMANY = { de: "Deutschland gesamt", en: "Germany overall" };
  const chartTexts = (page) => page.locator("figure[data-chart] .plot svg").first().locator("text").allTextContents();

  for (const lang of LANGS) {
    test(`a Länder rate chart marks the Germany figure on its axis (${lang})`, () =>
      withPage(browser, `${site.url}${lang}/chart/unemployment-laender/`, WIDTHS.desktop, async (page) => {
        const marked = (await chartTexts(page)).filter((t) => t.startsWith(GERMANY[lang]));
        assert.equal(marked.length, 1, `the chart shows "${GERMANY[lang]}" once`);
      }));

    test(`a Länder count chart leaves out the Germany figure, which is the sum of all bars (${lang})`, () =>
      withPage(browser, `${site.url}${lang}/chart/population-laender/`, WIDTHS.desktop, async (page) => {
        const texts = await chartTexts(page);
        assert.ok(texts.length > 0, "the chart has drawn its text");
        assert.deepEqual(texts.filter((t) => t.startsWith(GERMANY[lang])), [], `no "${GERMANY[lang]}" label`);
      }));
  }

  for (const lang of LANGS) {
    test(`tooltip and table show the full Land name where the phone chart shortens it (${lang})`, () =>
      withPage(browser, `${site.url}${lang}/chart/${TURNOUT_BY_LAND}/`, WIDTHS.phone, async (page) => {
        const fig = page.locator("figure[data-chart]").first();
        const label = (await barLabels(page)).find((l) => l.text.startsWith("Meckl"));
        assert.equal(label.text, MV_SHORT[lang], "the phone chart uses the short form, on one line");

        // Hover the Mecklenburg-Vorpommern row.
        const b = label.box;
        await page.mouse.move(b.right + 40, (b.top + b.bottom) / 2);
        const tip = fig.locator(".tooltip");
        await tip.waitFor({ state: "visible" });
        assert.match(await tip.innerText(), new RegExp(MV[lang]), "tooltip shows the full name");

        await fig.locator("[data-action=table]").click();
        const names = await fig.locator(".table-view tbody tr td:first-child").allInnerTexts();
        assert.ok(names.includes(MV[lang]), "table shows the full name");
      }));
  }
});
