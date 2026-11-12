# Show only unified Germany; cut Eurostat national series at 1991

Eurostat's "DE" means West Germany before 1991, so its long series jump by about
17 million people at reunification. Charts instead show only unified Germany:
Eurostat data are cut at 1991 (`UNIFIED_FROM` in `pipeline/fetch.py`). Sources
that reconstruct today's borders for earlier years (Our World in Data's energy
and CO₂ series) keep their full history. West/East German history could come
back later as its own clearly labelled indicators, never mixed into "Germany".
