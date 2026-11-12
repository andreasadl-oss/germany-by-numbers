// Static site generator: indicators/*.json + data/*.csv -> dist/
// No framework on purpose: one file, easy to read, nothing to keep upgrading.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const config = read("site/config.json");
const i18n = read("site/i18n.json");
const status = fs.existsSync(path.join(ROOT, "data/_status.json")) ? read("data/_status.json") : {};
const LANGS = ["de", "en"];

const topics = fs
  .readdirSync(path.join(ROOT, "indicators"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read(`indicators/${f}`))
  .sort((a, b) => a.topic.order - b.topic.order);

for (const t of topics) {
  for (const ind of t.indicators) {
    ind.topic = t.topic.id;
    ind.hasData = fs.existsSync(path.join(ROOT, "data", `${ind.id}.csv`));
    ind.updated = status[ind.id]?.updated ?? null;
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- layout

function page({ lang, rel, title, description, body, altPath, chartsJson }) {
  const t = i18n[lang];
  const name = config.name[lang];
  const fullTitle = title ? `${title} – ${name}` : name;
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description ?? config.tagline[lang])}">
<link rel="alternate" hreflang="${t.other}" href="${rel}${t.other}/${altPath}">
<link rel="stylesheet" href="${rel}assets/style.css">
<link rel="icon" href="${rel}assets/favicon.svg" type="image/svg+xml">
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${rel}${lang}/"><span class="brand-mark" aria-hidden="true"></span>${esc(name)}</a>
    <nav class="nav">
      <a href="${rel}${lang}/#topics">${t.topics}</a>
      <a href="${rel}${lang}/sources/">${t.sources}</a>
      <a href="${rel}${lang}/about/">${t.about}</a>
      <a class="lang" href="${rel}${t.other}/${altPath}" hreflang="${t.other}" lang="${t.other}">${t.otherLabel}</a>
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>${t.footer}</p>
    <p>${t.reuse} <a href="${config.licenseUrl[lang]}">${config.license}</a> · <a href="${config.repo}">GitHub</a></p>
  </div>
</footer>
${chartsJson ? `<script>window.__CHARTS__=${JSON.stringify(chartsJson).replace(/</g, "\\u003c")};window.__LANG__="${lang}";window.__ROOT__="${rel}";window.__I18N__=${JSON.stringify(t)};window.__SITE__=${JSON.stringify(name)};</script>
<script src="${rel}assets/vendor/d3.min.js"></script>
<script src="${rel}assets/vendor/plot.umd.min.js"></script>
<script src="${rel}assets/chart.js"></script>` : ""}
</body>
</html>
`;
}

// Data the browser needs to draw a chart (only the current language).
const srcName = (ind, lang) => (typeof ind.source.name === "object" ? ind.source.name[lang] : ind.source.name);

function chartSpec(ind, lang) {
  const series = Object.fromEntries(Object.entries(ind.series).map(([k, v]) => [k, v[lang]]));
  return {
    id: ind.id,
    title: ind.title[lang],
    subtitle: ind.subtitle[lang],
    unit: ind.unit,
    chart: ind.chart,
    geo: ind.geo ?? "national",
    series,
    colors: ind.colors,
    source: { ...ind.source, name: srcName(ind, lang) },
    updated: ind.updated,
  };
}

function chartCard(ind, lang, rel, { compact = false } = {}) {
  const t = i18n[lang];
  const href = `${rel}${lang}/chart/${ind.id}/`;
  return `<figure class="card chart-card${compact ? " compact" : ""}" id="${ind.id}" data-chart="${ind.id}">
  <figcaption>
    <h3><a href="${href}">${esc(ind.title[lang])}</a></h3>
    <p class="subtitle">${esc(ind.subtitle[lang])}</p>
  </figcaption>
  <div class="legend" aria-hidden="true"></div>
  <div class="plot" role="img" aria-label="${esc(ind.title[lang])}"><p class="muted">${t.loading}</p></div>
  <div class="table-view" hidden></div>
  <div class="card-foot">
    <p class="source">${t.source}: <a href="${esc(ind.source.url)}">${esc(srcName(ind, lang))}</a> · ${esc(ind.source.license)}${ind.updated ? ` · ${t.updated} ${ind.updated}` : ""}</p>
    <div class="actions">
      <button type="button" data-action="table">${t.table}</button>
      <button type="button" data-action="png">PNG</button>
      <button type="button" data-action="svg">SVG</button>
      <a href="${rel}data/${ind.id}.csv" download>CSV</a>
      ${compact ? "" : `<button type="button" data-action="embed">${t.embed}</button>`}
    </div>
  </div>
</figure>`;
}

function comingSoon(inds, lang, rel) {
  if (!inds.length) return "";
  const t = i18n[lang];
  return `<section class="coming-soon">
  <h3>${t.comingSoon}</h3>
  <p class="muted">${t.comingSoonText}</p>
  <ul>${inds.map((i) => `<li>${esc(i.title[lang])} <span class="muted">– ${esc(srcName(i, lang))}</span></li>`).join("")}</ul>
</section>`;
}

// ---------------------------------------------------------------- pages

function write(rel, html) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

function home(lang) {
  const rel = "../";
  const t = i18n[lang];
  const counts = topics.map((tp) => tp.indicators.filter((i) => i.hasData).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const featured = topics.flatMap((tp) => tp.indicators.filter((i) => i.hasData).slice(0, 2));
  const body = `
<section class="hero">
  <h1>${esc(config.name[lang])}</h1>
  <p class="lede">${esc(config.tagline[lang])}</p>
  <p class="hero-meta">${total} ${t.charts} · ${topics.length} ${lang === "en" ? t.topics.toLowerCase() : t.topics} · ${t.reuse} <a href="${config.licenseUrl[lang]}">${config.license}</a></p>
</section>
<section id="topics" class="topic-grid">
${topics
  .map(
    (tp, i) => `  <a class="card topic-card" href="${rel}${lang}/${tp.topic.id}/">
    <h2>${esc(tp.topic.title[lang])}</h2>
    <p>${esc(tp.topic.intro[lang])}</p>
    <span class="count">${counts[i]} ${t.charts}</span>
  </a>`
  )
  .join("\n")}
</section>
<section class="featured">
${featured.map((ind) => chartCard(ind, lang, rel, { compact: true })).join("\n")}
</section>`;
  write(`${lang}/index.html`, page({ lang, rel, body, altPath: "", chartsJson: featured.map((i) => chartSpec(i, lang)) }));
}

function topicPage(tp, lang) {
  const rel = "../../";
  const ready = tp.indicators.filter((i) => i.hasData);
  const pending = tp.indicators.filter((i) => !i.hasData);
  const body = `
<section class="page-head">
  <h1>${esc(tp.topic.title[lang])}</h1>
  <p class="lede">${esc(tp.topic.intro[lang])}</p>
  ${ready.length ? `<nav class="toc">${ready.map((i) => `<a href="#${i.id}">${esc(i.title[lang])}</a>`).join("")}</nav>` : ""}
</section>
<section class="chart-list">
${ready.map((ind) => chartCard(ind, lang, rel)).join("\n")}
</section>
${comingSoon(pending, lang, rel)}`;
  write(
    `${lang}/${tp.topic.id}/index.html`,
    page({ lang, rel, title: tp.topic.title[lang], description: tp.topic.intro[lang], body, altPath: `${tp.topic.id}/`, chartsJson: ready.map((i) => chartSpec(i, lang)) })
  );
}

function singleChart(ind, tp, lang) {
  const rel = "../../../";
  const body = `
<p class="crumb"><a href="${rel}${lang}/${tp.topic.id}/">← ${esc(tp.topic.title[lang])}</a></p>
<section class="chart-list single">
${chartCard(ind, lang, rel)}
</section>`;
  write(
    `${lang}/chart/${ind.id}/index.html`,
    page({ lang, rel, title: ind.title[lang], description: ind.subtitle[lang], body, altPath: `chart/${ind.id}/`, chartsJson: [chartSpec(ind, lang)] })
  );
}

function sourcesPage(lang) {
  const rel = "../../";
  const t = i18n[lang];
  const rows = topics.flatMap((tp) =>
    tp.indicators.map(
      (i) => `<tr><td>${esc(tp.topic.title[lang])}</td><td>${i.hasData ? `<a href="${rel}${lang}/chart/${i.id}/">${esc(i.title[lang])}</a>` : esc(i.title[lang])}</td><td><a href="${esc(i.source.url)}">${esc(srcName(i, lang))}</a></td><td>${i.updated ?? `<span class="muted">${t.comingSoon}</span>`}</td></tr>`
    )
  );
  const body = `
<section class="page-head">
  <h1>${t.sources}</h1>
  <p class="lede">${lang === "de"
    ? "Jedes Diagramm nennt seine Quelle. Wo möglich nutzen wir amtliche Statistik (Destatis, Eurostat, Bundesbehörden). Die Daten werden automatisch abgerufen; der Code dafür ist offen."
    : "Every chart names its source. Wherever possible we use official statistics (Destatis, Eurostat, federal agencies). The data is fetched automatically, and the code that does it is open."}</p>
</section>
<div class="table-scroll"><table class="data-table">
<thead><tr><th>${t.topics}</th><th>${t.chart}</th><th>${t.source}</th><th>${t.updated}</th></tr></thead>
<tbody>${rows.join("")}</tbody>
</table></div>`;
  write(`${lang}/sources/index.html`, page({ lang, rel, title: t.sources, body, altPath: "sources/" }));
}

function aboutPage(lang) {
  const rel = "../../";
  const t = i18n[lang];
  const body =
    lang === "de"
      ? `<section class="page-head prose">
  <h1>${t.about}</h1>
  <p class="lede">Gute Debatten brauchen gemeinsame Fakten. Diese Seite sammelt die wichtigsten Zahlen über Deutschland an einem Ort – verständlich aufbereitet, mit Quellen belegt und frei nutzbar.</p>
  <h2>Was ist das?</h2>
  <p>Eine Sammlung von Diagrammen zu Wirtschaft, Staatsfinanzen, Bevölkerung, Gesundheit, Energie, Klima, Kriminalität und Bildung – für Deutschland insgesamt und, wo möglich, für alle 16 Bundesländer.</p>
  <h2>Woher kommen die Daten?</h2>
  <p>Aus offenen, amtlichen Quellen: vor allem dem Statistischen Bundesamt (Destatis), Eurostat und Bundesbehörden, ergänzt um gepflegte offene Datensätze wie Our World in Data. Jedes Diagramm nennt seine Quelle. Eine vollständige Liste steht unter <a href="${rel}de/sources/">Datenquellen</a>.</p>
  <h2>Darf ich die Diagramme verwenden?</h2>
  <p>Ja. Unsere Diagramme und Texte stehen unter <a href="https://creativecommons.org/licenses/by/4.0/deed.de">CC BY 4.0</a>: Sie können sie herunterladen (PNG, SVG, CSV), einbetten und weiterverwenden – auch kommerziell –, solange Sie „Deutschland nach Zahlen“ und die Originalquelle nennen.</p>
  <p>Die Daten selbst gehören den Stellen, die sie veröffentlichen, und gelten unter deren Lizenzen – etwa CC BY 4.0 (Eurostat, Our World in Data) oder Datenlizenz Deutschland – Namensnennung 2.0 (Destatis). Einige Energiedaten, die Our World in Data aufbereitet, stammen von Dritten wie dem Energy Institute, mit eigenen Nutzungsbedingungen. Jedes Diagramm nennt und verlinkt seine Quelle; bitte nennen Sie diese bei jeder Weiterverwendung.</p>
  <h2>Dank</h2>
  <p>Die Idee stammt von Hannah Ritchie und ihrem Projekt <em>UK by Numbers</em>, das die wichtigsten Daten über das Vereinigte Königreich frei und verständlich zugänglich macht. Vielen Dank für die Inspiration! Dies ist ein unabhängiges Projekt für Deutschland und nicht mit ihr verbunden.</p>
  <p>Die Seite wurde mit Hilfe von Claude, einem KI-Assistenten von Anthropic, gebaut. Die Zahlen werden nicht von der KI erzeugt: Sie werden automatisch aus den genannten Quellen geladen.</p>
  <h2>Fehler gefunden?</h2>
  <p>Der gesamte Code und alle Daten liegen offen auf <a href="${config.repo}">GitHub</a>. Hinweise und Korrekturen sind willkommen.</p>
</section>`
      : `<section class="page-head prose">
  <h1>${t.about}</h1>
  <p class="lede">Good debates need shared facts. This site brings the most important numbers about Germany together in one place – clearly presented, sourced and free to use.</p>
  <h2>What is this?</h2>
  <p>A collection of charts on the economy, public finances, population, health, energy, climate, crime and education – for Germany as a whole and, where possible, for all 16 federal states (Länder).</p>
  <h2>Where does the data come from?</h2>
  <p>From open, official sources: mainly the Federal Statistical Office (Destatis), Eurostat and federal agencies, complemented by well-maintained open datasets such as Our World in Data. Every chart names its source. The full list is on the <a href="${rel}en/sources/">data sources</a> page.</p>
  <h2>Can I use the charts?</h2>
  <p>Yes. Our charts and text are licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>: you can download them (PNG, SVG, CSV), embed them and reuse them – commercially too – as long as you credit "Germany by Numbers" and the original source.</p>
  <p>The data itself belongs to the organisations that publish it and stays under their licences, such as CC BY 4.0 (Eurostat, Our World in Data) or the Data Licence Germany – Attribution 2.0 (Destatis). Some energy data processed by Our World in Data comes from third parties such as the Energy Institute, with their own terms. Every chart names and links its source; please credit it whenever you reuse the data.</p>
  <h2>Thanks</h2>
  <p>The idea comes from Hannah Ritchie and her project <em>UK by Numbers</em>, which makes the key data about the United Kingdom free and easy to understand. Thank you for the inspiration! This is an independent project for Germany and is not affiliated with her.</p>
  <p>The site was built with help from Claude, an AI assistant made by Anthropic. The numbers are not generated by AI: they are downloaded automatically from the sources named on each chart.</p>
  <h2>Found a mistake?</h2>
  <p>All code and data are open on <a href="${config.repo}">GitHub</a>. Suggestions and corrections are welcome.</p>
</section>`;
  write(`${lang}/about/index.html`, page({ lang, rel, title: t.about, body, altPath: "about/" }));
}

// ---------------------------------------------------------------- build

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.cpSync(path.join(ROOT, "site/assets"), path.join(DIST, "assets"), { recursive: true });
fs.mkdirSync(path.join(DIST, "assets/vendor"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "node_modules/d3/dist/d3.min.js"), path.join(DIST, "assets/vendor/d3.min.js"));
fs.copyFileSync(path.join(ROOT, "node_modules/@observablehq/plot/dist/plot.umd.min.js"), path.join(DIST, "assets/vendor/plot.umd.min.js"));
fs.cpSync(path.join(ROOT, "data"), path.join(DIST, "data"), { recursive: true });

for (const lang of LANGS) {
  home(lang);
  for (const tp of topics) {
    topicPage(tp, lang);
    for (const ind of tp.indicators.filter((i) => i.hasData)) singleChart(ind, tp, lang);
  }
  sourcesPage(lang);
  aboutPage(lang);
}

// Root: send visitors to their language.
write(
  "index.html",
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(config.name.de)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>location.replace((navigator.language||"de").toLowerCase().startsWith("de")?"de/":"en/");</script>
<meta http-equiv="refresh" content="1; url=de/"></head>
<body><p><a href="de/">Deutsch</a> · <a href="en/">English</a></p></body></html>`
);
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

const n = topics.flatMap((t) => t.indicators);
console.log(`Built ${n.filter((i) => i.hasData).length}/${n.length} charts in ${LANGS.length} languages -> dist/`);
