import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { launch, LANGS, servedSite, WIDTHS, withPage } from "./harness.mjs";

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

/** The y-axis labels of a bar or dot chart (the Land names), with their boxes.
 *  `read` is the label as a reader reads it: its lines joined by a space, or
 *  directly after a line that ends in a hyphen. */
async function barLabels(page) {
  return page.locator("figure[data-chart] .plot svg").first().evaluate((svg) => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const read = (t) => {
      const lines = t.querySelectorAll("tspan").length ? Array.from(t.querySelectorAll("tspan"), (s) => s.textContent) : [t.textContent];
      return lines.reduce((acc, l) => (!acc ? l : acc.endsWith("-") ? acc + l : `${acc} ${l}`), "");
    };
    return Array.from(svg.querySelectorAll("[aria-label='y-axis tick label'] text")).map((t) => ({ text: t.textContent, read: read(t), box: box(t) }));
  });
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

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
        // A few pages at a time keeps the run short.
        const queue = [...singles];
        await Promise.all(Array.from({ length: 4 }, async () => {
          for (let url; (url = queue.shift()); ) {
            await withPage(browser, url, width, async (page) => {
              for (const p of await textOutsideCharts(page)) problems.push(`${url} ${p}`);
            });
          }
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

  for (const id of ["causes-of-death", "government-spending-by-function"]) {
    for (const lang of LANGS) {
      test(`${id}: category labels wrapped on a phone keep every word of the name (${lang})`, () =>
        withPage(browser, `${site.url}${lang}/chart/${id}/`, WIDTHS.phone, async (page) => {
          const labels = await barLabels(page);
          const fig = page.locator("figure[data-chart]").first();
          await fig.locator("[data-action=table]").click();
          const names = await fig.locator(".table-view thead th").allInnerTexts();
          for (const l of labels) assert.ok(names.includes(l.read), `"${l.read}" reads as one of the categories in the table`);
        }));
    }
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
