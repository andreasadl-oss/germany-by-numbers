import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";
import { buildSite, fixture, launch, LANGS, open, serve, WIDTHS } from "./harness.mjs";

const COMING_SOON = { de: "In Vorbereitung", en: "Coming soon" };
const PLANNED = { de: "Ein geplanter Testindikator", en: "A planned test indicator" };
const PLANNED_SOURCE = { de: "Planungsamt", en: "Planning Office" };

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

describe("a site built from a fixture", () => {
  let site, out;
  before(async () => { out = await buildSite(fixture("planned")); site = await serve(out); });
  after(async () => { await site?.close(); fs.rmSync(out, { recursive: true, force: true }); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    test(`serves the fixture topic with its chart drawn (${name})`, async () => {
      const page = await open(browser, `${site.url}en/fixture-topic/`, width);
      assert.equal(await page.locator("h1").innerText(), "Test topic");
      const chart = page.locator("figure", { hasText: "A test indicator with data" });
      assert.ok(await chart.locator("svg text", { hasText: "2002" }).count(), "x axis shows fixture years");
      assert.match(await chart.innerText(), /2001-02-03/, "shows the retrieval date from the fixture's status file");
      await page.close();
    });

    for (const lang of LANGS) {
      test(`topic page shows only indicators with data, no "Coming soon" (${lang}, ${name})`, async () => {
        const page = await open(browser, `${site.url}${lang}/fixture-topic/`, width);
        const text = await page.locator("main").innerText();
        assert.ok(!text.includes(COMING_SOON[lang]), `no "${COMING_SOON[lang]}" section`);
        assert.ok(!text.includes(PLANNED[lang]), "planned indicator is not listed");
        await page.close();
      });

      test(`Sources page lists the planned indicator with its source (${lang}, ${name})`, async () => {
        const page = await open(browser, `${site.url}${lang}/sources/`, width);
        const row = page.locator("tr", { hasText: PLANNED[lang] });
        assert.equal(await row.count(), 1, "planned indicator has a row");
        assert.match(await row.innerText(), new RegExp(PLANNED_SOURCE[lang]));
        assert.match(await row.innerText(), new RegExp(COMING_SOON[lang]), "row shows its status");
        await page.close();
      });
    }
  }
});

describe("the real site", () => {
  let site, out;
  before(async () => { out = await buildSite(); site = await serve(out); });
  after(async () => { await site?.close(); fs.rmSync(out, { recursive: true, force: true }); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) {
      test(`no topic page has a "Coming soon" section (${lang}, ${name})`, async () => {
        const home = await open(browser, `${site.url}${lang}/`, width);
        const topics = await home.locator("#topics a").evaluateAll((as) => as.map((a) => a.href));
        await home.close();
        assert.ok(topics.length >= 4, "home page links to the topics");
        for (const url of topics) {
          const page = await open(browser, url, width);
          const text = await page.locator("main").innerText();
          assert.ok(!text.includes(COMING_SOON[lang]), `${url} has no "${COMING_SOON[lang]}" section`);
          assert.ok(await page.locator("figure[data-chart] .plot svg").count(), `${url} shows charts`);
          await page.close();
        }
      });
    }
  }
});
