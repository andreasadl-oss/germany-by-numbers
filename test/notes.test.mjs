import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { buildSite, fixture, launch, LANGS, ROOT, servedSite, WIDTHS, withPage } from "./harness.mjs";

const NOTES_HEADING = { de: "Hinweise", en: "Notes" };
// The notes of the "notes" fixture, in year order (the order the page numbers them).
const FIXTURE_NOTES = JSON.parse(fs.readFileSync(path.join(fixture("notes").indicators, "fixture.json"), "utf8")).indicators[0].notes
  .sort((a, b) => a.year - b.year);

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
  const notes = FIXTURE_NOTES;
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

  test("government revenue and spending has an event note at 1995 (the Treuhand debt takeover)", () => {
    const finances = definitions.find((ind) => ind.id === "government-revenue-expenditure");
    assert.ok(finances?.notes.some((n) => n.year === 1995 && n.kind === "event" && /Treuhand/.test(n.text.de) && /Treuhand/.test(n.text.en)));
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
const chart = (page) => page.locator("figure[data-chart]").first();

/** Switch a chart to its table view. Returns the column headers and the rows: each
 *  with its cell texts and whether all of its text is visible without scrolling. */
async function openTable(page) {
  await chart(page).getByRole("button", { name: /^(Tabelle|Table)$/ }).click();
  const table = chart(page).getByRole("table");
  const header = (await table.getByRole("columnheader").allInnerTexts()).map((h) => h.trim());
  const rows = await table.locator("tbody tr").evaluateAll((trs) => {
    const view = trs[0].closest("figure").getBoundingClientRect();
    return trs.map((tr) => {
      const range = document.createRange();
      range.selectNodeContents(tr);
      const box = range.getBoundingClientRect();
      return { cells: Array.from(tr.cells, (td) => td.innerText.trim()), visible: box.left >= view.left && box.right <= view.right };
    });
  });
  return { header, rows };
}

/** Download the chart as SVG and return the file's text. */
async function exportedSvg(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), chart(page).getByRole("button", { name: "SVG" }).click()]);
  return fs.readFileSync(await download.path(), "utf8");
}

/** Hover the chart at page position x (halfway down) and return the tooltip's text.
 *  Fails if the tooltip sticks out of the chart. */
async function hoverTooltip(page, x) {
  const box = await chart(page).locator(".plot svg").first().boundingBox();
  await page.mouse.move(x, box.y + box.height / 2);
  const tip = chart(page).getByRole("tooltip");
  await tip.waitFor({ state: "visible" });
  const tipBox = await tip.boundingBox();
  assert.ok(tipBox.x >= box.x - 0.5 && tipBox.x + tipBox.width <= box.x + box.width + 0.5, "the tooltip stays inside the chart");
  return tip.innerText();
}

describe("notes beyond the chart", () => {
  let site;
  const notes = FIXTURE_NOTES;
  before(async () => { site = await servedSite(fixture("notes")); });
  after(async () => { await site?.close(); });

  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) {
      const url = () => `${site.url}${lang}/chart/fixture-notes/`;

      test(`the table view marks noted years and shows the note text (${lang}, ${name})`, () =>
        withPage(browser, url(), width, async (page) => {
          const { rows } = await openTable(page);
          // A year row starts with the year, followed by the numbers of its notes.
          const yearRows = rows.filter((r) => /^\d{4}\b/.test(r.cells[0]));
          const marks = (year) => yearRows.find((r) => r.cells[0].split(/\s+/)[0] === String(year))?.cells[0].split(/\s+/).slice(1) ?? [];
          const noted = new Set();
          notes.forEach((n, i) => {
            for (const year of noteYears(n)) {
              noted.add(year);
              assert.deepEqual(marks(year), [String(i + 1)], `${year} is marked with note ${i + 1}`);
            }
            const text = rows.filter((r) => r.cells.join(" ").includes(n.text[lang]));
            assert.equal(text.length, 1, `"${n.text[lang]}" is shown once`);
            assert.ok(text[0].visible, `"${n.text[lang]}" is readable without scrolling sideways`);
          });
          for (const r of yearRows) {
            const year = Number(r.cells[0].split(/\s+/)[0]);
            if (!noted.has(year)) assert.deepEqual(marks(year), [], `${year} is not marked`);
          }
        }));

      test(`hovering a noted year shows the note in the tooltip (${lang}, ${name})`, () =>
        withPage(browser, url(), width, async (page) => {
          const { marks } = await chartNotes(page);
          const centre = (n) => { const m = marks.find((m) => m.title.includes(n.text[lang]) && m.tag !== "text"); return (m.box.left + m.box.right) / 2; };
          for (const n of notes) {
            const tip = await hoverTooltip(page, centre(n));
            assert.ok(tip.includes(n.text[lang]), `tooltip at ${n.year} shows "${n.text[lang]}"`);
          }
          // Halfway between the middle of the crisis band (2002) and the 2005 break is
          // 2003.5; a little further right is 2004, which has no note.
          const [crisis, counting] = notes;
          const x2004 = centre(crisis) + (centre(counting) - centre(crisis)) * (2 / 3);
          const tip = await hoverTooltip(page, x2004);
          assert.ok(tip.startsWith("2004"), "the tooltip shows 2004");
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

  for (const [name, width] of Object.entries(WIDTHS)) {
    for (const lang of LANGS) {
      test(`tabulates and exports without notes (${lang}, ${name})`, () =>
        withPage(browser, `${site.url}${lang}/chart/fixture-ready/`, width, async (page) => {
          const { header, rows } = await openTable(page);
          assert.deepEqual(header, [lang === "de" ? "Jahr" : "Year", lang === "de" ? "Reihe A" : "Series A"]);
          assert.ok(rows.every((r) => r.cells.length === 2 && /^\d{4}$/.test(r.cells[0])), "every row is a bare year and one value");
          const svg = await exportedSvg(page);
          assert.ok(!svg.includes(`>${NOTES_HEADING[lang]}<`), "has no Notes heading");
        }));
    }
  }
});
