import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fixture, launch, LANGS, servedSite, WIDTHS, withPage } from "./harness.mjs";

// Literal reader-facing wording, so a test fails if the heading quietly returns.
const COMING_SOON = { de: "In Vorbereitung", en: "Coming soon" };
const PLANNED = { de: "Ein geplanter Testindikator", en: "A planned test indicator" };
const PLANNED_SOURCE = { de: "Planungsamt", en: "Planning Office" };

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

describe("a site built from a fixture", () => {
  let site;
  before(async () => { site = await servedSite(fixture("planned")); });
  after(async () => { await site?.close(); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    test(`serves the fixture topic with its chart drawn (${name})`, () =>
      withPage(browser, `${site.url}en/fixture-topic/`, width, async (page) => {
        assert.equal(await page.locator("h1").innerText(), "Test topic");
        const chart = page.locator("figure", { hasText: "A test indicator with data" });
        assert.ok(await chart.locator("svg text", { hasText: "2002" }).count(), "x axis shows fixture years");
        assert.match(await chart.innerText(), /2001-02-03/, "shows the retrieval date from the fixture's status file");
      }));

    for (const lang of LANGS) {
      test(`topic page shows only indicators with data, no "Coming soon" (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/fixture-topic/`, width, async (page) => {
          const text = await page.locator("main").innerText();
          assert.ok(!text.includes(COMING_SOON[lang]), `no "${COMING_SOON[lang]}" section`);
          assert.ok(!text.includes(PLANNED[lang]), "planned indicator is not listed");
        }));

      test(`Sources page lists the planned indicator with its source (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/sources/`, width, async (page) => {
          const row = page.locator("tr", { hasText: PLANNED[lang] });
          assert.equal(await row.count(), 1, "planned indicator has a row");
          assert.match(await row.innerText(), new RegExp(PLANNED_SOURCE[lang]));
          assert.match(await row.innerText(), new RegExp(COMING_SOON[lang]), "row shows its status");
        }));
    }
  }
});

describe("the real site", () => {
  let site;
  before(async () => { site = await servedSite(); });
  after(async () => { await site?.close(); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) {
      test(`no topic page has a "Coming soon" section (${lang}, ${name})`, async () => {
        const topics = await withPage(browser, `${site.url}${lang}/`, width, (home) =>
          home.locator("#topics a").evaluateAll((as) => as.map((a) => a.href))
        );
        assert.ok(topics.length > 0, "home page links to the topics");
        for (const url of topics) {
          await withPage(browser, url, width, async (page) => {
            const text = await page.locator("main").innerText();
            assert.ok(!text.includes(COMING_SOON[lang]), `${url} has no "${COMING_SOON[lang]}" section`);
          });
        }
      });
    }
  }
});
