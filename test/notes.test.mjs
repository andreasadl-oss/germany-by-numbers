import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { buildSite, fixture, launch, LANGS, ROOT, servedSite, WIDTHS, withPage } from "./harness.mjs";

const NOTES_HEADING = { de: "Hinweise", en: "Notes" };

describe("the build checks every note", () => {
  test("a note missing a language stops the build, naming the indicator", async () => {
    await assert.rejects(buildSite(fixture("note-missing-language")), /note-missing-language.*\ben\b/s);
  });

  test("a note with an unknown kind stops the build, naming the indicator", async () => {
    await assert.rejects(buildSite(fixture("note-unknown-kind")), /note-unknown-kind.*revision/s);
  });

  test("a note outside the indicator's data years stops the build, naming the indicator", async () => {
    await assert.rejects(buildSite(fixture("note-year-out-of-range")), /note-year-out-of-range.*2007/s);
  });

  test("a note on a chart without a time axis stops the build, naming the indicator", async () => {
    await assert.rejects(buildSite(fixture("note-on-bar-chart")), /note-on-bar-chart.*bar-latest/s);
  });
});

/** What the chart draws for its notes: every SVG mark whose tooltip (<title>) is a
 *  note, with its shape, whether its stroke is dashed, and its box. Plus every other
 *  text in the SVG, so tests can check that note labels don't overlap them. */
async function chartNotes(page) {
  return page.locator("figure[data-chart] .plot svg").first().evaluate((svg) => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const marks = Array.from(svg.querySelectorAll("title"))
      .map((t) => ({ el: t.parentElement, title: t.textContent }))
      .filter(({ el }) => el !== svg)
      .map(({ el, title }) => ({ title, tag: el.tagName, dashed: getComputedStyle(el).strokeDasharray !== "none", box: box(el) }));
    const texts = Array.from(svg.querySelectorAll("text")).filter((t) => !t.querySelector("title")).map((t) => ({ text: t.textContent, box: box(t) }));
    return { marks, texts, svg: box(svg) };
  });
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;

/** Check one single-indicator page against the notes in its definition. */
async function assertNotesShown(page, notes, lang) {
  // The notes list repeats every note as page text, in year order.
  const list = page.locator("figure").getByRole("region", { name: NOTES_HEADING[lang] });
  const items = await list.getByRole("listitem").allInnerTexts();
  const sorted = [...notes].sort((a, b) => a.year - b.year);
  assert.equal(items.length, sorted.length, "one list item per note");
  sorted.forEach((n, i) => {
    assert.ok(items[i].includes(n.text[lang]), `item ${i + 1} shows "${n.text[lang]}"`);
    assert.ok(items[i].includes(n.to_year ? `${n.year}–${n.to_year}` : String(n.year)), `item ${i + 1} shows its year`);
  });

  const { marks, texts, svg } = await chartNotes(page);
  sorted.forEach((n, i) => {
    const own = marks.filter((m) => m.title.includes(n.text[lang]));
    const rule = own.find((m) => m.tag === "line");
    const band = own.find((m) => m.tag === "rect");
    if (n.kind === "break") assert.ok(rule?.dashed, `"${n.text[lang]}" is a dashed rule`);
    else if (n.to_year) assert.ok(band, `"${n.text[lang]}" is a shaded band`);
    else assert.ok(rule && !rule.dashed, `"${n.text[lang]}" is a solid rule`);

    const label = own.find((m) => m.tag === "text");
    assert.ok(label, `"${n.text[lang]}" has a label on the chart`);
    assert.ok(inside(label.box, svg), `label ${i + 1} is inside the chart`);
    for (const t of texts) assert.ok(!overlaps(label.box, t.box), `label ${i + 1} does not overlap "${t.text}"`);
  });
}

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

describe("notes on a chart", () => {
  let site;
  const notes = JSON.parse(fs.readFileSync(path.join(fixture("notes").indicators, "fixture.json"), "utf8")).indicators[0].notes;
  before(async () => { site = await servedSite(fixture("notes")); });
  after(async () => { await site?.close(); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) {
      test(`breaks and events are drawn differently and listed below the chart (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/chart/fixture-notes/`, width, (page) => assertNotesShown(page, notes, lang)));
    }
  }
});

describe("notes on the real site", () => {
  let site;
  const definitions = fs.readdirSync(path.join(ROOT, "indicators"))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "indicators", f), "utf8")).indicators)
    .filter((ind) => ind.notes?.length);
  before(async () => { site = await servedSite(); });
  after(async () => { await site?.close(); });

  test("population has a break note at 2011", () => {
    const population = definitions.find((ind) => ind.id === "population");
    assert.ok(population?.notes.some((n) => n.year === 2011 && n.kind === "break"));
  });

  for (const ind of definitions) {
    for (const [name, width] of Object.entries(WIDTHS)) {
      for (const lang of LANGS) {
        test(`${ind.id} shows its notes on the chart and in the notes list (${lang}, ${name})`, () =>
          withPage(browser, `${site.url}${lang}/chart/${ind.id}/`, width, (page) => assertNotesShown(page, ind.notes, lang)));
      }
    }
  }
});

// ---------------------------------------------------------------- notes beyond the chart
// The same notes reach the reader in the table view, the tooltip and exported images.

/** The years a note covers: one year, or every year of a range. */
const noteYears = (n) => Array.from({ length: (n.to_year ?? n.year) - n.year + 1 }, (_, i) => n.year + i);

/** Switch a chart to its table view and return the header and the rows as cell texts. */
async function openTable(page) {
  const fig = page.locator("figure[data-chart]").first();
  await fig.getByRole("button", { name: /^(Tabelle|Table)$/ }).click();
  const table = fig.locator(".table-view table");
  const header = await table.locator("thead th").allInnerTexts();
  const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Array.from(tr.cells, (td) => td.innerText.trim())));
  return { header: header.map((h) => h.trim()), rows };
}

/** Download the chart as SVG and return the file's text. */
async function exportedSvg(page) {
  const fig = page.locator("figure[data-chart]").first();
  const [download] = await Promise.all([page.waitForEvent("download"), fig.getByRole("button", { name: "SVG" }).click()]);
  return fs.readFileSync(await download.path(), "utf8");
}

/** Hover the chart at the x position of a note's mark (the middle of a band) and
 *  return what the tooltip says. */
async function tooltipAt(page, x) {
  const svg = page.locator("figure[data-chart] .plot svg").first();
  const box = await svg.boundingBox();
  await page.mouse.move(x, box.y + box.height / 2);
  const tip = page.locator("figure[data-chart] .tooltip").first();
  await tip.waitFor({ state: "visible" });
  const tipBox = await tip.boundingBox();
  assert.ok(tipBox.x >= box.x - 0.5 && tipBox.x + tipBox.width <= box.x + box.width + 0.5, "the tooltip stays inside the chart");
  return tip.innerText();
}

describe("notes beyond the chart", () => {
  let site;
  const notes = JSON.parse(fs.readFileSync(path.join(fixture("notes").indicators, "fixture.json"), "utf8")).indicators[0].notes;
  const sorted = [...notes].sort((a, b) => a.year - b.year);
  before(async () => { site = await servedSite(fixture("notes")); });
  after(async () => { await site?.close(); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) {
      const url = () => `${site.url}${lang}/chart/fixture-notes/`;

      test(`the table view marks noted years and shows the note text (${lang}, ${name})`, () =>
        withPage(browser, url(), width, async (page) => {
          const { header, rows } = await openTable(page);
          assert.equal(header.at(-1), NOTES_HEADING[lang], "the last column is headed Notes");
          const row = (year) => rows.find((r) => r[0] === String(year));
          const noted = new Set();
          sorted.forEach((n, i) => {
            for (const year of noteYears(n)) {
              noted.add(year);
              const cell = row(year)?.at(-1) ?? "";
              assert.ok(cell.startsWith(`${i + 1}`), `${year} is marked with note ${i + 1}`);
              assert.ok(cell.includes(n.text[lang]), `${year} shows "${n.text[lang]}"`);
            }
          });
          for (const r of rows.filter((r) => !noted.has(Number(r[0])))) assert.equal(r.at(-1), "", `${r[0]} has no note`);
        }));

      test(`hovering a noted year shows the note in the tooltip (${lang}, ${name})`, () =>
        withPage(browser, url(), width, async (page) => {
          const { marks } = await chartNotes(page);
          const markOf = (n) => marks.find((m) => m.title.includes(n.text[lang]) && m.tag !== "text");
          for (const n of sorted) {
            const m = markOf(n);
            const tip = await tooltipAt(page, (m.box.left + m.box.right) / 2);
            assert.ok(tip.includes(n.text[lang]), `tooltip at ${n.year} shows "${n.text[lang]}"`);
          }
          // 2004 lies between the crisis band (to 2003) and the 2005 break, and has no note.
          const band = markOf(sorted[0]);
          const rule = markOf(sorted[1]);
          const tip = await tooltipAt(page, (band.box.right + (rule.box.left + rule.box.right) / 2) / 2);
          assert.ok(tip.startsWith("2004"), "hovering between them shows 2004");
          for (const n of notes) assert.ok(!tip.includes(n.text[lang]), `tooltip at 2004 doesn't mention "${n.text[lang]}"`);
        }));

      test(`the exported SVG lists the notes (${lang}, ${name})`, () =>
        withPage(browser, url(), width, async (page) => {
          const svg = await exportedSvg(page);
          assert.ok(svg.includes(`>${NOTES_HEADING[lang]}<`), "has a Notes heading");
          for (const n of notes) assert.ok(svg.includes(n.text[lang]), `contains "${n.text[lang]}"`);
        }));
    }
  }
});

describe("an indicator without notes", () => {
  let site;
  before(async () => { site = await servedSite(fixture("planned")); });
  after(async () => { await site?.close(); });

  for (const lang of LANGS) {
    test(`tabulates and exports without a notes column or list (${lang})`, () =>
      withPage(browser, `${site.url}${lang}/chart/fixture-ready/`, WIDTHS.desktop, async (page) => {
        const { header, rows } = await openTable(page);
        assert.deepEqual(header, [lang === "de" ? "Jahr" : "Year", lang === "de" ? "Reihe A" : "Series A"]);
        assert.ok(rows.every((r) => r.length === 2), "every row has a year and one value");
        const svg = await exportedSvg(page);
        assert.ok(!svg.includes(`>${NOTES_HEADING[lang]}<`), "has no Notes heading");
      }));
  }
});
