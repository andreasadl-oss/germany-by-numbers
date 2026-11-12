# Data sources: where Germany's numbers come from

This file maps each topic to the best public source, says how we fetch it, and
records what has been verified. Use it to decide what to add next.

**Status key:** ✅ fetched and charted · 🟡 wired in the pipeline, not yet run
(the dataset code and filters still need checking against the live API) · 📋
planned, no fetcher yet.

> Why many items are 🟡: the cloud sandbox this was built in could only reach
> GitHub, so the Eurostat fetcher was written against the documented API but
> not yet run. The first GitHub Actions run (or a local
> `python pipeline/fetch.py`) will show which codes need fixing. Failures are
> listed in `data/_status.json`.

## Principles

1. **Official first.** Destatis, Eurostat (which republishes Destatis data in a
   harmonised, easy-to-query form), federal agencies. Curated aggregators (Our
   World in Data) only when they add real value, e.g. long energy series.
2. **Licence must allow reuse.** We publish everything under CC BY 4.0. Sources
   below all permit reuse with attribution.
3. **Same geography codes everywhere.** `DE` for Germany, NUTS 1 `DE1`–`DEG`
   for the 16 Länder. Kreise (NUTS 3) and Gemeinden (AGS) fit in the same
   `geo` column later.
4. **Automated.** Every chart is fetched by `pipeline/fetch.py`. Nothing is
   typed in by hand.

## Sources by organisation

| Source | What it has | Access | Licence | Status |
|---|---|---|---|---|
| **Eurostat** | Harmonised German data on GDP, prices, labour, public finances (COFOG), population, health, poverty (EU-SILC), crime, education, emissions. National + Länder (NUTS 1/2) + Kreise (NUTS 3) for some series | Open REST API, JSON-stat, no key | Free reuse with attribution (CC BY 4.0) | 🟡 21 indicators wired |
| **Our World in Data** (GitHub) | Energy mix and CO₂ series from 1950 (Ember, Energy Institute, Global Carbon Budget) | CSV on GitHub, no key | CC BY 4.0 (OWID); underlying third-party data have their own terms, credited on each chart | ✅ 6 indicators |
| **Destatis GENESIS-Online** | The primary source for nearly everything German: Bundeshaushalt, tax revenue by tax (Kassenmäßige Steuereinnahmen), causes of death, Mikrozensus, housing, wages (Verdiensterhebung), Länder and Kreis data | REST API `genesis.destatis.de/genesisWS/rest/2020`; needs a free account/API token | Datenlizenz Deutschland – Namensnennung 2.0 (dl-de/by-2-0) | 📋 needs account |
| **Regionalstatistik.de** (Statistische Ämter des Bundes und der Länder) | Same GENESIS engine, for Kreise and Gemeinden: the source for a "look up your Kreis" feature | Same API as GENESIS; free account | dl-de/by-2-0 | 📋 for v2 |
| **Bundeswahlleiterin** | Bundestag and European election results by Land and Wahlkreis | CSV downloads per election | Free reuse with attribution | 📋 |
| **Bundeskriminalamt – PKS** | Polizeiliche Kriminalstatistik: all recorded offences by type and Land, back to 1987 | Yearly CSV/Excel tables | Free reuse with attribution | 📋 (Eurostat covers headline categories for now) |
| **SMARD (Bundesnetzagentur)** / **Energy-Charts (Fraunhofer ISE)** | Hourly/daily electricity generation, prices, imports | Open JSON APIs | CC BY 4.0 | 📋 (for monthly/real-time energy charts) |
| **Umweltbundesamt** | Official GHG inventory by sector (Klimaschutzgesetz sectors), air quality | Excel/CSV downloads | dl-de/by-2-0 | 📋 (Eurostat env_air_gge used meanwhile) |
| **Deutsche Bundesbank** | Interest rates, government debt, household wealth | Open SDMX API, no key | Free reuse with attribution | 📋 |
| **Bundesagentur für Arbeit** | Registered unemployment (SGB II/III), Bürgergeld recipients, by Kreis, monthly | Excel downloads; some APIs | Free reuse with attribution | 📋 |
| **Deutscher Wetterdienst** | Temperature and rainfall since 1881, by Land | Open data server (CSV) | CC BY 4.0 | 📋 |
| **Kraftfahrt-Bundesamt** | Car fleet and new registrations by fuel (EVs) | Excel downloads | Free reuse with attribution | 📋 |
| **GBE-Bund (RKI/Destatis)** | Health reporting: causes of death, hospital data | Web tables | dl-de/by-2-0 | 📋 |

## Indicator list

The machine-readable list lives in `indicators/*.json`. Each entry carries its
titles (DE/EN), chart type, source and fetch specification.

| Topic | Indicator | Source dataset | Geography | Status |
|---|---|---|---|---|
| Economy | GDP per person (real) | Eurostat `nama_10_pc` | DE | 🟡 |
| Economy | GDP per person by Land | Eurostat `nama_10r_2gdp` | Länder | 🟡 |
| Economy | Inflation (HICP) | Eurostat `prc_hicp_aind` | DE | 🟡 |
| Economy | Unemployment rate | Eurostat `une_rt_a` | DE | 🟡 |
| Economy | Unemployment by Land | Eurostat `lfst_r_lfu3rt` | Länder | 🟡 |
| Economy | Government spending by function (COFOG) | Eurostat `gov_10a_exp` | DE | 🟡 |
| Economy | Government revenue vs. spending | Eurostat `gov_10a_main` | DE | 🟡 |
| Economy | Tax revenue by type | Eurostat `gov_10a_taxag` | DE | 🟡 |
| Economy | Government debt | Eurostat `gov_10dd_edpt1` | DE | 🟡 |
| Society | Population | Eurostat `demo_gind` | DE | 🟡 |
| Society | Population by Land | Eurostat `demo_r_d2jan` | Länder | 🟡 |
| Society | Births and deaths | Eurostat `demo_gind` | DE | 🟡 |
| Society | Net migration | Eurostat `demo_gind` | DE | 🟡 |
| Society | Life expectancy by sex | Eurostat `demo_mlexpec` | DE | 🟡 |
| Society | Life expectancy by Land | Eurostat `demo_r_mlifexp` | Länder | 🟡 |
| Society | At-risk-of-poverty rate | Eurostat `ilc_li02` | DE | 🟡 |
| Society | House prices | Eurostat `prc_hpi_a` | DE | 🟡 |
| Energy | Electricity generation by source | OWID energy-data | DE | ✅ |
| Energy | Renewable share of electricity | OWID energy-data | DE | ✅ |
| Energy | Primary energy by source | OWID energy-data | DE | ✅ |
| Energy | CO₂ emissions | OWID co2-data | DE | ✅ |
| Energy | CO₂ by fuel | OWID co2-data | DE | ✅ |
| Energy | CO₂ per person, territorial vs. consumption | OWID co2-data | DE | ✅ |
| Energy | GHG emissions by sector | Eurostat `env_air_gge` | DE | 🟡 |
| Public life | Intentional homicide rate | Eurostat `crim_off_cat` | DE | 🟡 |
| Public life | Recorded burglary, theft, robbery | Eurostat `crim_off_cat` | DE | 🟡 |
| Public life | Tertiary attainment, 25–34 | Eurostat `edat_lfse_03` | DE | 🟡 |
| Public life | Early school leavers | Eurostat `edat_lfse_14` | DE | 🟡 |

## Next sources to add (suggested order)

1. **Destatis GENESIS** (free account): federal budget by ministry, tax
   revenue by individual tax (Lohnsteuer, Umsatzsteuer, …), causes of death,
   rents. The most "German" charts, and the ones people ask about most.
2. **Bundeswahlleiterin**: Bundestag results 1949–2025 and by Land.
3. **PKS (BKA)**: crime by type and Land, the official German series.
4. **SMARD / Energy-Charts**: monthly electricity data and prices.
5. **Regionalstatistik**: Kreis-level maps (v2).
