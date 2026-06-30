# Lake Louise Bite Tracker

A self-hosted fishing **bite-prediction system** for **Lake Louise** in Lakewood, WA
(lat `47.161861`, lon `-122.567972`), tuned for **rainbow trout** and **largemouth bass**.

Every 30 minutes a GitHub Action computes a 0–100 "bite score" from solunar timing,
sun position, moon phase, and barometric-pressure trend, then:

- writes the latest result to [`data/latest_score.json`](data/latest_score.json),
- appends a rolling record to [`data/history.json`](data/history.json),
- updates a live dashboard, and
- (optionally) sends a push notification to your phone/watch via [ntfy.sh](https://ntfy.sh).

## 📊 Live dashboard

**https://audaddy.github.io/lake-louise-bite-tracker/**

Large color-coded score (green ≥70, yellow 40–69, red <40), current tier and message,
countdowns to the next major/minor solunar periods, a score-history chart, and current
conditions. Auto-refreshes every 5 minutes and is mobile-friendly.

## How the score works

A **weather-driven** model: the factors with the strongest real-world support
(barometric pressure trend, cloud cover, wind, low light) carry the most weight,
with solunar timing and dawn/dusk added as bonuses on top of a higher baseline.

| Factor | Points |
| --- | --- |
| Baseline ("average day" floor) | +35 |
| Pressure falling >3 hPa/3 h (pre-front feeding) | +25 |
| Pressure falling 1–3 hPa/3 h | +18 |
| Pressure stable (±1 hPa) | +12 |
| Pressure rising 1–3 hPa/3 h | +5 |
| Pressure rising >3 hPa/3 h | −10 |
| Cloud cover ≥70% / 40–70% / 20–40% | +12 / +8 / +4 |
| Wind 3–10 mph (ideal ripple) | +12 |
| Wind 1–3 or 10–15 mph | +6 |
| Wind <1 mph (dead calm) | +3 |
| Wind >15 mph | −8 |
| Solunar **major** — moon transit/underfoot ±60 min | +18 |
| Solunar **minor** — moonrise/moonset ±30 min (higher of major/minor, not both) | +10 |
| Dawn/dusk — sunrise/sunset ±60 min | +12 |
| Moon phase — >95% / <5% illumination, or 45–55% | +6 |

Score is clamped to 0–100. **Tiers:** 80–100 Excellent · 60–79 Good · 40–59 Fair · <40 Slow.
The dashboard lists the specific positive/negative factors behind each score.

**Species logic:** air temperature is used as a rough water-temperature proxy (an
approximation). Above 65 °F the messaging favors bass; cooler/low-light conditions favor
trout — e.g. *"Good bass window right now"* or *"Trout biting for the next ~2 hours."*

**Data sources:** weather from [Open-Meteo](https://open-meteo.com) (no API key); sun
times from the [`astral`](https://pypi.org/project/astral/) package; moon position/phase
from [`ephem`](https://pypi.org/project/ephem/). All solunar math runs offline.

## Repo layout

```
lake-louise-bite-tracker/
├── .github/workflows/check_bite_score.yml   # runs every 30 min + manual dispatch
├── scripts/score_calculator.py              # scoring + notification logic
├── docs/index.html                          # GitHub Pages dashboard (served from /docs)
├── docs/data/*.json                          # data mirror the dashboard reads
├── data/latest_score.json                   # canonical latest result
├── data/history.json                        # rolling history (capped at 500)
├── requirements.txt
└── README.md
```

## 🔔 Enabling push notifications (ntfy.sh)

Notifications fire when the score is **≥ 70**, or **≥ 55 within 30 minutes of a major/minor
period start**. Duplicate alerts for the same solunar period are suppressed.

The notification topic is read from a GitHub Actions secret named `NTFY_TOPIC`. Until you
set it, the workflow runs normally and simply skips sending — no errors.

**1. Pick a topic name** at [ntfy.sh](https://ntfy.sh). Choose something unguessable
(anyone who knows the topic can read its messages), e.g. `lake-louise-bite-7h2k9`.

**2. Add the secret:**

1. In this repo, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. Name: `NTFY_TOPIC`
4. Value: the topic string you chose (just the name, e.g. `lake-louise-bite-7h2k9` — not the full URL).
5. Click **Add secret**.

**3. Subscribe on your phone:**

1. Install the **ntfy** app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) /
   [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. Add a subscription to the **same topic name**.
3. On iOS, notifications mirror to **Apple Watch** automatically via standard iOS
   notification mirroring — no extra setup.

Notifications use the `species_note` as the title, the `message` as the body,
`default` priority, and the `fish` tag.

## Running locally

```bash
pip install -r requirements.txt
python scripts/score_calculator.py        # fetches live weather, writes data/*.json
```

To skip the actual ntfy POST while testing, leave `NTFY_TOPIC` unset (default) or set
`LLBT_DRY_RUN=1`. To test without network access to Open-Meteo, point
`LLBT_MOCK_WEATHER` at a saved JSON response.

## Notes & caveats

- Scheduled GitHub Actions can be delayed during peak load; 30-minute cadence is best-effort.
- Water temperature is approximated from air temperature; treat species hints as guidance.
- Solunar theory is a fishing heuristic, not a guarantee — go fish and find out. 🎣
