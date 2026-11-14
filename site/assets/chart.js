/* Renders every <figure data-chart="id"> on the page with Observable Plot.
 * Chart specs come from window.__CHARTS__ (written by build.mjs); data from data/<id>.csv
 * in tidy form: year,geo,series,value. */
(function () {
  "use strict";
  const LANG = window.__LANG__;
  const ROOT = window.__ROOT__;
  const T = window.__I18N__;
  const SPECS = Object.fromEntries((window.__CHARTS__ || []).map((s) => [s.id, s]));
  const LOCALE = LANG === "de" ? "de-DE" : "en-GB";

  const LAENDER = {
    DE1: ["Baden-Württemberg", "Baden-Württemberg"], DE2: ["Bayern", "Bavaria"], DE3: ["Berlin", "Berlin"],
    DE4: ["Brandenburg", "Brandenburg"], DE5: ["Bremen", "Bremen"], DE6: ["Hamburg", "Hamburg"],
    DE7: ["Hessen", "Hesse"], DE8: ["Mecklenburg-Vorpommern", "Mecklenburg-Western Pomerania"],
    DE9: ["Niedersachsen", "Lower Saxony"], DEA: ["Nordrhein-Westfalen", "North Rhine-Westphalia"],
    DEB: ["Rheinland-Pfalz", "Rhineland-Palatinate"], DEC: ["Saarland", "Saarland"], DED: ["Sachsen", "Saxony"],
    DEE: ["Sachsen-Anhalt", "Saxony-Anhalt"], DEF: ["Schleswig-Holstein", "Schleswig-Holstein"], DEG: ["Thüringen", "Thuringia"],
  };
  const landName = (code) => (LAENDER[code] ? LAENDER[code][LANG === "de" ? 0 : 1] : code);

  // ------------------------------------------------------------ helpers
  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
      // Fixed colours with a meaning across charts: energy sources ("coal" ->
      // --energy-coal) and parties ("party-spd" -> --party-spd).
      fixed: (name) => v(`--energy-${name}`) || v(`--${name}`),
      surface: v("--surface-1"),
      ink: v("--text-primary"),
      ink2: v("--text-secondary"),
      muted: v("--text-muted"),
      grid: v("--grid"),
      axis: v("--axis"),
    };
  }

  function fmt(value, unit) {
    const abs = Math.abs(value);
    const digits = abs >= 1000 ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    const s = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(value);
    if (!unit) return s;
    if (unit === "%") return LANG === "de" ? `${s} %` : `${s}%`;
    if (unit === "€") return LANG === "de" ? `${s} €` : `€${s}`;
    return `${s} ${unit}`;
  }

  function axisFormat(unit) {
    return (d) => {
      const abs = Math.abs(d);
      if (abs >= 1e6) return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(d / 1e6) + (LANG === "de" ? " Mio." : "M");
      return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: abs < 10 ? 2 : 1 }).format(d);
    };
  }

  const cache = {};
  function load(id) {
    if (!cache[id]) cache[id] = d3.csv(`${ROOT}data/${id}.csv`, d3.autoType);
    return cache[id];
  }

  // Turn tidy rows into what a chart needs, labelled in the page language.
  function prepare(spec, rows) {
    const keys = Object.keys(spec.series);
    const color = Object.fromEntries(keys.map((k, i) => [spec.series[k], i]));
    const data = rows
      .filter((r) => keys.includes(String(r.series)))
      .map((r) => ({ ...r, series: String(r.series), label: spec.series[String(r.series)] }));
    return { keys, labels: keys.map((k) => spec.series[k]), color, data };
  }

  // One colour per series, in series order. An indicator may name a fixed colour
  // per series ("colors": {"coal_co2": "coal", "spd": "party-spd"}); otherwise
  // the categorical order is used.
  function seriesColors(spec, prep, tk) {
    return prep.keys.map((k, i) => (spec.colors && spec.colors[k] && tk.fixed(spec.colors[k])) || tk.series[i % 8]);
  }

  // ------------------------------------------------------------ notes
  // A break is a dashed rule, an event a lighter solid rule (or a shaded band when
  // it spans years). Each gets a number above the plot area, where it can't collide
  // with the lines or the end-of-line labels; the notes list below the chart uses
  // the same numbers. Every mark carries the note as its tooltip.
  const TOP = 18; // top margin of a time chart
  const NOTE_ROW = 18; // extra top margin that holds the note numbers

  // A note as one line of text, as the chart, tooltip, table and export all show it.
  const noteText = (n) => `${n.when} · ${n.kind}: ${n.text}`;

  function noteMarks(notes, tk) {
    if (!notes.length) return { under: [], over: [] };
    const tagged = notes.map((n, i) => ({ ...n, label: String(i + 1), title: `${i + 1}. ${noteText(n)}` }));
    const bands = tagged.filter((n) => n.to_year);
    const breaks = tagged.filter((n) => !n.to_year && n.dashed);
    const events = tagged.filter((n) => !n.to_year && !n.dashed);
    return {
      under: [
        Plot.rect(bands, { x1: "year", x2: "to_year", fill: tk.muted, fillOpacity: 0.14, title: "title" }),
        Plot.ruleX(events, { x: "year", stroke: tk.muted, strokeOpacity: 0.6, strokeWidth: 1.5, title: "title" }),
      ],
      over: [
        Plot.ruleX(breaks, { x: "year", stroke: tk.ink2, strokeWidth: 1.25, strokeDasharray: "4,3", title: "title" }),
        Plot.text(tagged, {
          x: (n) => (n.to_year ? (n.year + n.to_year) / 2 : n.year),
          frameAnchor: "top",
          dy: -(NOTE_ROW - 2),
          text: "label",
          fill: tk.ink2,
          fontSize: 11,
          fontWeight: 600,
          title: "title",
        }),
      ],
    };
  }

  // The notes that cover a year, with the number they carry on the chart and in the
  // notes list: [{ number, note }]. Used by the tooltip and the table view.
  function notesAt(spec, year) {
    return (spec.notes || [])
      .map((note, i) => ({ number: i + 1, note }))
      .filter(({ note }) => year >= note.year && year <= (note.to_year ?? note.year));
  }

  // ------------------------------------------------------------ chart forms
  function timeChart(spec, prep, width, tk) {
    const { data, labels } = prep;
    const isArea = spec.chart === "area";
    const range = seriesColors(spec, prep, tk);
    const height = Math.round(Math.max(260, Math.min(420, width * 0.55)));
    const ymin = d3.min(data, (d) => d.value);
    const direct = !isArea && labels.length <= 4 && width >= 480;
    const last = direct
      ? labels.map((l) => {
          const pts = data.filter((d) => d.label === l);
          return pts[pts.length - 1];
        }).filter(Boolean)
      : [];
    const marginRight = direct ? Math.min(150, 12 + 7 * d3.max(labels, (l) => l.length)) : 16;
    const notes = noteMarks(spec.notes || [], tk);
    const marginTop = TOP + (spec.notes?.length ? NOTE_ROW : 0);
    const ymax = d3.max(data, (d) => d.value);
    const zero = isArea || spec.chart === "bar-time" || ymin < 0 || ymin < ymax * 0.25;
    // Stacked shares can't exceed 100 %.
    const yDomainMax = isArea && spec.unit === "%" ? 100 : undefined;
    // Nudge end labels apart so they never overlap (min 14px between them).
    if (direct && last.length > 1) {
      const plotH = height - marginTop - 30;
      const lo = zero ? Math.min(0, ymin) : ymin;
      const perPx = (ymax - lo) / plotH;
      const sorted = last.map((d) => ({ ...d, ly: d.value })).sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].ly - sorted[i - 1].ly < 14 * perPx) sorted[i].ly = sorted[i - 1].ly + 14 * perPx;
      }
      last.splice(0, last.length, ...sorted);
    }
    const marks = [
      Plot.gridY({ stroke: tk.grid, strokeOpacity: 1 }),
      ...notes.under,
      isArea
        ? Plot.areaY(data, { x: "year", y: "value", fill: "label", order: labels, stroke: tk.surface, strokeWidth: 1, curve: "linear" })
        : spec.chart === "bar-time"
        ? Plot.rectY(data, { x1: (d) => d.year - 0.42, x2: (d) => d.year + 0.42, y: "value", fill: "label", rx: 2 })
        : Plot.lineY(data, { x: "year", y: "value", stroke: "label", strokeWidth: 2, curve: "linear" }),
      // Only draw (and so only include) zero when the axis starts there; an
      // invisible rule at 0 would still stretch a zoomed axis down to 0.
      zero ? Plot.ruleY([0], { stroke: ymin < 0 || isArea || spec.chart === "bar-time" ? tk.axis : "none" }) : null,
      ...notes.over,
    ];
    if (direct) {
      marks.push(Plot.text(last, { x: "year", y: "ly", text: "label", dx: 6, textAnchor: "start", fill: tk.ink2, fontSize: 12 }));
    }
    const plot = Plot.plot({
      width,
      height,
      marginLeft: 52,
      marginRight,
      marginTop,
      style: { background: "transparent", color: tk.muted, fontSize: "12px", fontFamily: "inherit" },
      x: { label: null, tickFormat: (d) => String(d), ticks: Math.max(3, Math.floor(width / 90)), domain: d3.extent(data, (d) => d.year) },
      y: { label: null, tickFormat: axisFormat(spec.unit), ticks: Math.max(4, Math.floor(height / 50)), nice: !yDomainMax, zero, ...(yDomainMax ? { domain: [0, yDomainMax] } : {}) },
      color: { domain: labels, range },
      marks,
    });
    return { node: plot, height };
  }

  function latestBars(spec, prep, width, tk) {
    let rows;
    let avg = null;
    let year;
    if (spec.geo === "laender") {
      const land = prep.data.filter((d) => d.geo !== "DE");
      year = d3.max(land, (d) => d.year);
      rows = land.filter((d) => d.year === year).map((d) => ({ ...d, name: landName(d.geo) }));
      const de = prep.data.find((d) => d.geo === "DE" && d.year === year);
      if (de) avg = de.value;
    } else {
      const de = prep.data.filter((d) => d.geo === "DE");
      year = d3.max(de, (d) => d.year);
      rows = de.filter((d) => d.year === year).map((d) => ({ ...d, name: d.label }));
    }
    rows.sort((a, b) => b.value - a.value);
    const narrow = width < 560;
    const marginLeft = narrow ? Math.round(width * 0.42) : 230;
    const rowH = narrow ? 34 : 28;
    const height = rows.length * rowH + 40;
    const minV = d3.min(rows, (d) => d.value);
    const maxV0 = d3.max(rows, (d) => d.value);
    // When all values are close together (e.g. life expectancy), bars from zero
    // hide the differences: use dots on a zoomed axis instead.
    const dots = minV > 0 && minV > maxV0 * 0.6;
    const marks = [
      Plot.gridX({ stroke: tk.grid, strokeOpacity: 1 }),
      dots
        ? Plot.dot(rows, { x: "value", y: "name", fill: tk.series[0], r: 5 })
        : Plot.barX(rows, { x: "value", y: "name", fill: tk.series[0], rx: 2, insetTop: 3, insetBottom: 3 }),
      avg != null ? Plot.ruleX([avg], { stroke: tk.ink, strokeDasharray: "3,3", strokeOpacity: 0.6 }) : null,
      Plot.text(rows, { x: "value", y: "name", text: (d) => fmt(d.value, spec.unit), dx: dots ? 9 : 5, textAnchor: "start", fill: tk.ink2, fontSize: 11, stroke: tk.surface, strokeWidth: 4, paintOrder: "stroke" }),
      dots ? null : Plot.ruleX([0], { stroke: tk.axis }),
      Plot.axisY({ lineWidth: Math.floor((marginLeft - 12) / 6.5), tickSize: 0, fill: tk.ink2, label: null }),
    ];
    if (avg != null) {
      marks.push(Plot.text([avg], { x: (d) => d, frameAnchor: "top", dy: -12, text: () => `${T.germanyAvg}: ${fmt(avg, spec.unit)}`, fill: tk.ink, fontSize: 11 }));
    }
    const maxV = d3.max(rows, (d) => d.value);
    const plot = Plot.plot({
      width,
      height,
      marginLeft,
      marginRight: 64,
      marginTop: avg != null ? 26 : 10,
      style: { background: "transparent", color: tk.muted, fontSize: "12px", fontFamily: "inherit" },
      x: { label: null, axis: "bottom", tickFormat: axisFormat(spec.unit), domain: dots ? [Math.min(minV, avg ?? minV) - (maxV - minV) * 0.15, maxV] : [Math.min(0, minV), maxV], nice: true, ticks: Math.max(2, Math.floor((width - marginLeft) / 90)) },
      y: { label: null, domain: rows.map((d) => d.name), axis: null },
      marks,
    });
    return { node: plot, height, year, rows };
  }

  // ------------------------------------------------------------ tooltip (line / area / bar-time)
  function attachHover(fig, spec, prep, plotNode, tk) {
    const wrap = fig.querySelector(".plot");
    const tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    const rule = document.createElement("div");
    rule.className = "crosshair";
    rule.hidden = true;
    wrap.append(rule, tip);
    const x = plotNode.scale("x");
    const years = Array.from(new Set(prep.data.map((d) => d.year))).sort((a, b) => a - b);
    const byYear = d3.group(prep.data, (d) => d.year);
    const svg = plotNode;
    function move(ev) {
      const box = svg.getBoundingClientRect();
      const px = ev.clientX - box.left;
      const yr = x.invert(px);
      const i = d3.bisectCenter(years, yr);
      const year = years[i];
      const xpos = x.apply(year);
      if (xpos == null || isNaN(xpos)) return;
      const rows = (byYear.get(year) || []).slice().sort((a, b) => prep.labels.indexOf(a.label) - prep.labels.indexOf(b.label));
      if (!rows.length) return;
      tip.innerHTML =
        `<strong>${year}</strong>` +
        rows
          .map((r) => `<div class="tip-row"><span class="sw" style="background:${seriesColors(spec, prep, tk)[prep.labels.indexOf(r.label)]}"></span><span>${r.label}</span><span class="tip-val">${fmt(r.value, spec.unit)}</span></div>`)
          .join("") +
        notesAt(spec, year).map((n) => `<div class="tip-note">${n.number}. ${escapeXml(noteText(n.note))}</div>`).join("");
      tip.hidden = false;
      rule.hidden = false;
      rule.style.left = `${xpos}px`;
      const w = tip.offsetWidth;
      // Beside the pointer, on whichever side has room, and never outside the chart.
      const left = xpos + 12 + w > box.width ? xpos - 12 - w : xpos + 12;
      tip.style.left = `${Math.max(0, Math.min(left, box.width - w))}px`;
    }
    function hide() {
      tip.hidden = true;
      rule.hidden = true;
    }
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("touchstart", (e) => move(e.touches[0]), { passive: true });
  }

  function attachBarHover(fig, spec, res) {
    const wrap = fig.querySelector(".plot");
    const tip = document.createElement("div");
    tip.className = "tooltip";
    tip.hidden = true;
    wrap.append(tip);
    const y = res.node.scale("y");
    const step = y.bandwidth / (1 - (y.paddingInner ?? 0.1)) || 28;
    res.node.addEventListener("pointermove", (ev) => {
      const box = res.node.getBoundingClientRect();
      const py = ev.clientY - box.top;
      const row = res.rows.find((r) => {
        const top = y.apply(r.name);
        return py >= top - (step - y.bandwidth) / 2 && py < top + y.bandwidth + (step - y.bandwidth) / 2;
      });
      if (!row) return void (tip.hidden = true);
      tip.innerHTML = `<strong>${row.name}</strong><div class="tip-row"><span>${res.year}</span><span class="tip-val">${fmt(row.value, spec.unit)}</span></div>`;
      tip.hidden = false;
      tip.style.left = `${Math.min(ev.clientX - box.left + 12, box.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${y.apply(row.name) + y.bandwidth + 4}px`;
    });
    res.node.addEventListener("pointerleave", () => (tip.hidden = true));
  }

  // ------------------------------------------------------------ table view
  function renderTable(fig, spec, prep) {
    const el = fig.querySelector(".table-view");
    let cols, rows;
    if (spec.geo === "laender") {
      const years = Array.from(new Set(prep.data.map((d) => d.year))).sort((a, b) => b - a).slice(0, 6);
      cols = [spec.geo === "laender" ? "" : T.year, ...years];
      const geos = Array.from(new Set(prep.data.map((d) => d.geo)));
      rows = geos.map((g) => [g === "DE" ? T.germany : landName(g), ...years.map((y) => prep.data.find((d) => d.geo === g && d.year === y))]);
    } else {
      cols = [T.year, ...prep.labels];
      const years = Array.from(new Set(prep.data.map((d) => d.year))).sort((a, b) => b - a);
      rows = years.map((y) => [y, ...prep.labels.map((l) => prep.data.find((d) => d.year === y && d.label === l))]);
    }
    // A noted year carries the numbers of its notes; each note's text follows as a
    // full-width row under the first of its years in the table, so it's readable
    // without scrolling sideways. Länder tables (years as columns) have no notes.
    const hasNotes = spec.geo !== "laender" && spec.notes?.length > 0;
    const shown = new Set();
    el.innerHTML =
      `<div class="table-scroll"><table class="data-table"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
      rows
        .map((r) => {
          const here = hasNotes ? notesAt(spec, r[0]) : [];
          const fresh = here.filter((n) => !shown.has(n.number));
          fresh.forEach((n) => shown.add(n.number));
          const refs = here.map((n) => ` <span class="note-ref">${n.number}</span>`).join("");
          return (
            `<tr${here.length ? ' class="noted"' : ""}><td>${r[0]}${refs}</td>${r.slice(1).map((c) => `<td class="num">${c ? fmt(c.value, "") : "–"}</td>`).join("")}</tr>` +
            fresh.map((n) => `<tr class="note-row"><td colspan="${cols.length}"><span class="note-ref">${n.number}</span> ${escapeXml(noteText(n.note))}</td></tr>`).join("")
          );
        })
        .join("") +
      `</tbody></table></div>`;
  }

  // ------------------------------------------------------------ export
  function exportSvg(fig, spec) {
    const tk = tokens();
    const plotSvg = fig.querySelector(".plot svg");
    const w = plotSvg.getAttribute("width") * 1;
    const h = plotSvg.getAttribute("height") * 1;
    const pad = 20;
    const legendItems = Array.from(fig.querySelectorAll(".legend .item"));
    const wrapText = (text, size, maxW) => {
      const words = text.split(" ");
      const lines = [];
      let line = "";
      const per = maxW / (size * 0.52);
      for (const wd of words) {
        if ((line + " " + wd).trim().length > per) { lines.push(line.trim()); line = wd; } else line += " " + wd;
      }
      if (line.trim()) lines.push(line.trim());
      return lines;
    };
    const titleLines = wrapText(spec.title, 20, w);
    const subLines = wrapText(spec.subtitle, 13, w);
    let y = pad + 20;
    const ns = "http://www.w3.org/2000/svg";
    const out = document.createElementNS(ns, "svg");
    const parts = [];
    titleLines.forEach((l) => { parts.push(`<text x="${pad}" y="${y}" font-size="20" font-weight="700" fill="${tk.ink}">${escapeXml(l)}</text>`); y += 25; });
    subLines.forEach((l) => { parts.push(`<text x="${pad}" y="${y}" font-size="13" fill="${tk.ink2}">${escapeXml(l)}</text>`); y += 18; });
    y += 6;
    if (legendItems.length) {
      let x = pad;
      legendItems.forEach((it) => {
        const label = it.textContent.trim();
        const color = it.querySelector(".sw").style.background;
        const lw = 22 + label.length * 6.8;
        if (x + lw > w + pad) { x = pad; y += 20; }
        parts.push(`<rect x="${x}" y="${y - 10}" width="12" height="12" rx="2" fill="${color}"/><text x="${x + 17}" y="${y}" font-size="12" fill="${tk.ink2}">${escapeXml(label)}</text>`);
        x += lw;
      });
      y += 14;
    }
    const plotY = y;
    y += h + 18;
    // The notes list, so a chart shared on its own keeps its context.
    const notes = spec.notes || [];
    if (notes.length) {
      parts.push(`<text x="${pad}" y="${y}" font-size="12" font-weight="600" fill="${tk.ink}">${escapeXml(T.notes)}</text>`);
      y += 17;
      notes.forEach((note, i) => {
        wrapText(`${i + 1}. ${noteText(note)}`, 12, w).forEach((l) => {
          parts.push(`<text x="${pad}" y="${y}" font-size="12" fill="${tk.ink2}">${escapeXml(l)}</text>`);
          y += 16;
        });
      });
      y += 6;
    }
    const src = `${T.source}: ${spec.source.name} · ${spec.source.license} · ${window.__SITE__}`;
    wrapText(src, 11, w).forEach((l) => { parts.push(`<text x="${pad}" y="${y}" font-size="11" fill="${tk.muted}">${escapeXml(l)}</text>`); y += 15; });
    const totalH = y + pad - 10;
    const totalW = w + pad * 2;
    const clone = plotSvg.cloneNode(true);
    clone.setAttribute("x", pad);
    clone.setAttribute("y", plotY);
    out.setAttribute("xmlns", ns);
    out.setAttribute("width", totalW);
    out.setAttribute("height", totalH);
    out.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);
    out.setAttribute("font-family", "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
    out.innerHTML = `<rect width="100%" height="100%" fill="${tk.surface}"/>` + parts.join("");
    out.append(clone);
    return { svg: new XMLSerializer().serializeToString(out), width: totalW, height: totalH };
  }
  const escapeXml = (s) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

  function download(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function onAction(fig, spec, prep, action, btn) {
    if (action === "table") {
      const tv = fig.querySelector(".table-view");
      const plot = fig.querySelector(".plot");
      const showTable = tv.hidden;
      tv.hidden = !showTable;
      plot.hidden = showTable;
      fig.querySelector(".legend").hidden = showTable;
      btn.textContent = showTable ? T.chart : T.table;
      if (showTable) renderTable(fig, spec, prep);
      return;
    }
    if (action === "embed") {
      const url = new URL(`${ROOT}${LANG}/chart/${spec.id}/`, location.href).href;
      const code = `<iframe src="${url}" width="100%" height="640" style="border:0" title="${spec.title.replace(/"/g, "&quot;")}"></iframe>`;
      navigator.clipboard?.writeText(code).then(() => {
        const old = btn.textContent;
        btn.textContent = T.copied;
        setTimeout(() => (btn.textContent = old), 1500);
      });
      return;
    }
    const { svg, width, height } = exportSvg(fig, spec);
    if (action === "svg") return download(`${spec.id}.svg`, new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const c = document.createElement("canvas");
      c.width = width * scale;
      c.height = height * scale;
      const ctx = c.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      c.toBlob((b) => download(`${spec.id}.png`, b), "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // ------------------------------------------------------------ render
  async function render(fig) {
    const spec = SPECS[fig.dataset.chart];
    if (!spec) return;
    const plotEl = fig.querySelector(".plot");
    let rows;
    try {
      rows = await load(spec.id);
    } catch (e) {
      plotEl.innerHTML = `<p class="muted">${T.noData}</p>`;
      return;
    }
    const prep = prepare(spec, rows);
    const tk = tokens();
    const width = Math.max(280, plotEl.clientWidth);

    // Legend: always for >= 2 series; never for one.
    const legend = fig.querySelector(".legend");
    const showLegend = spec.chart !== "bar-latest" && prep.labels.length >= 2;
    legend.innerHTML = showLegend
      ? prep.labels.map((l, i) => `<span class="item"><span class="sw" style="background:${seriesColors(spec, prep, tk)[i]}"></span>${l}</span>`).join("")
      : "";
    legend.hidden = !showLegend || fig.querySelector(".table-view").hidden === false;

    const res = spec.chart === "bar-latest" ? latestBars(spec, prep, width, tk) : timeChart(spec, prep, width, tk);
    if (res.year) {
      legend.hidden = false;
      legend.innerHTML = `<span class="year-chip">${res.year}</span>`;
    }
    plotEl.replaceChildren(res.node);
    if (spec.chart === "bar-latest") attachBarHover(fig, spec, res);
    else attachHover(fig, spec, prep, res.node, tk);

    if (!fig.dataset.bound) {
      fig.dataset.bound = "1";
      fig.querySelectorAll("[data-action]").forEach((btn) =>
        btn.addEventListener("click", () => onAction(fig, spec, prep, btn.dataset.action, btn))
      );
    }
  }

  const figs = Array.from(document.querySelectorAll("figure[data-chart]"));
  const renderAll = () => figs.forEach((f) => render(f));

  // Render lazily as charts scroll into view.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); render(e.target); e.target.dataset.seen = "1"; } }),
      { rootMargin: "300px" }
    );
    figs.forEach((f) => io.observe(f));
  } else renderAll();

  let lastW = window.innerWidth;
  let timer;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(() => figs.filter((f) => f.dataset.seen).forEach(render), 200);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => figs.filter((f) => f.dataset.seen).forEach(render));
})();
