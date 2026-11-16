import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { launch, LANGS, ROOT, servedSite, WIDTHS, withPage } from "./harness.mjs";

// Every indicator definition on the real site that has data.
const definitions = fs.readdirSync(path.join(ROOT, "indicators"))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "indicators", f), "utf8")).indicators)
  .filter((ind) => fs.existsSync(path.join(ROOT, "data", `${ind.id}.csv`)));

/** The largest yearly total of an indicator's charted series, read from its data. */
function largestStackTotal(ind) {
  const totals = {};
  for (const line of fs.readFileSync(path.join(ROOT, "data", `${ind.id}.csv`), "utf8").trim().split("\n").slice(1)) {
    const [year, , series, value] = line.split(",");
    if (series in ind.series) totals[year] = (totals[year] ?? 0) + Number(value);
  }
  return Math.max(...Object.values(totals));
}

/** A tick label as a number, read the way a reader of that language would. */
function tickValue(text, lang) {
  let s = text.trim();
  const millions = /(Mio\.|M)$/.test(s);
  s = s.replace(/\s*(Mio\.|M)$/, "").replace(/[\s−]/g, (c) => (c === "−" ? "-" : ""));
  s = lang === "de" ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  return millions ? n * 1e6 : n;
}

/** The values on the chart's y-axis, bottom to top. */
async function yTicks(page, lang) {
  const texts = await page.locator('figure[data-chart] .plot svg [aria-label="y-axis tick label"] text').allTextContents();
  assert.ok(texts.length >= 2, "the chart has a y-axis with ticks");
  return texts.map((t) => tickValue(t, lang)).sort((a, b) => a - b);
}

let browser;
let site;
before(async () => { [browser, site] = await Promise.all([launch(), servedSite()]); });
after(async () => { await Promise.all([browser?.close(), site?.close()]); });

const pages = (fn) => {
  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) fn({ name, width, lang });
  }
};

describe("line and bar charts start at zero unless the indicator opts out", () => {
  const timeCharts = definitions.filter((ind) => ["line", "bar-time"].includes(ind.chart));
  const zero = timeCharts.filter((ind) => ind.baseline !== "data");
  const zoomed = timeCharts.filter((ind) => ind.baseline === "data");

  test("most line and bar charts start at zero; opt-outs are the exception", () => {
    assert.ok(zero.length > zoomed.length, `${zero.length} start at zero, ${zoomed.length} opt out`);
  });

  for (const ind of zero) {
    pages(({ name, width, lang }) =>
      test(`${ind.id}: the y-axis has a 0 tick (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/chart/${ind.id}/`, width, async (page) => {
          assert.ok((await yTicks(page, lang)).includes(0), "y-axis includes 0");
        })));
  }

  for (const ind of zoomed) {
    pages(({ name, width, lang }) =>
      test(`${ind.id} opts out: the y-axis is zoomed to the data, without a 0 tick (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/chart/${ind.id}/`, width, async (page) => {
          const ticks = await yTicks(page, lang);
          assert.ok(!ticks.includes(0) && ticks[0] > 0, `lowest tick ${ticks[0]} is above 0`);
        })));
  }
});

describe("stacked shares fit the data", () => {
  const shares = definitions.filter((ind) => ind.chart === "area" && ind.unit === "%");
  const whole = shares.filter((ind) => largestStackTotal(ind) >= 95);
  const partial = shares.filter((ind) => largestStackTotal(ind) < 95);

  test("the tax-revenue-by-type chart is a stacked share that doesn't add up to 100 %", () => {
    assert.ok(partial.some((ind) => ind.id === "tax-revenue-by-type"));
  });

  test("at least one stacked share on the site adds up to about 100 %", () => {
    assert.ok(whole.length > 0);
  });

  for (const ind of partial) {
    pages(({ name, width, lang }) =>
      test(`${ind.id}: the top y tick is below 100 and above the largest stack (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/chart/${ind.id}/`, width, async (page) => {
          const ticks = await yTicks(page, lang);
          const top = ticks.at(-1);
          assert.ok(top < 100, `top tick ${top} is below 100`);
          assert.ok(top >= largestStackTotal(ind), `top tick ${top} covers the largest stack ${largestStackTotal(ind)}`);
          assert.equal(ticks[0], 0, "starts at 0");
        })));
  }

  for (const ind of whole) {
    pages(({ name, width, lang }) =>
      test(`${ind.id}: adds up to about 100 %, so the y-axis runs 0–100 (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/chart/${ind.id}/`, width, async (page) => {
          const ticks = await yTicks(page, lang);
          assert.equal(ticks[0], 0, "starts at 0");
          assert.equal(ticks.at(-1), 100, "ends at 100");
        })));
  }
});
