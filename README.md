# BiteCast

A self-hosted fishing **bite-prediction system**. Built for and defaulting to **Lake
Louise** in Lakewood, WA (lat `47.161861`, lon `-122.567972`), tuned for **rainbow
trout** and **largemouth bass** — and usable anywhere via the browser's location, since
the whole scoring engine runs client-side against live weather.

A 0–100 "bite score" is computed from solunar timing, sun position, moon phase, and
barometric-pressure trend. At the Lake Louise home water, a GitHub Action also runs the
same model every 30 minutes to:

- write the latest result to [`data/latest_score.json`](data/latest_score.json),
- append a rolling record to [`data/history.json`](data/history.json), and
- (optionally) send a push notification to your phone/watch via [ntfy.sh](https://ntfy.sh).

## 📊 Live dashboard

**https://audaddy.github.io/lake-louise-bite-tracker/**

Large color-coded score (green ≥70, yellow 40–69, red <40), current tier and message,
countdowns to the next major/minor solunar periods, a score-history chart, current
conditions, a **Where & how to fish** panel, and an AI fishing assistant. Auto-refreshes
every 5 minutes and is mobile-friendly / installable as a home-screen app.

### 📍 Any location

Tap **"Use my location"** in the header and the dashboard requests your browser's GPS,
reverse-geocodes it to a place name, and recomputes the full score/tactics model live
for wherever you are — no server round-trip, since the scoring engine (ported from
`scripts/score_calculator.py`) runs entirely in the browser against the
[Open-Meteo](https://open-meteo.com) API and the bundled SunCalc solunar math. Your
choice is remembered locally; **"Reset to Lake Louise"** returns to the tuned home view.

Species and tactics guidance (trout vs. bass, fly vs. spin patterns) was built around
Lake Louise's fish. Away from Lake Louise, the score itself is fully accurate for that
spot, but treat species-specific advice as a starting point — the AI assistant is told
explicitly when you're off the home water and reasons generally rather than assuming
trout/bass are present.

### Where & how to fish

From the live conditions the tracker also recommends, as heuristic guidance:

- **Target species** — bass vs. trout lean (driven mainly by water-temp proxy and light).
- **Where** — shoreline/shallow cover vs. open-water drop-offs (plus a windward-shore tip).
- **Depth** — shallow / mid / deep band.
- **Method** — a fly-vs-spin lean with condition-matched patterns: fly options (poppers, dry
  flies, nymphs, woolly buggers/streamers) and spin options (topwater/buzzbaits, spinners &
  spinnerbaits, inline spinners/spoons, jigs & soft plastics), with the best bets for *right
  now* flagged.

This is rule-of-thumb angling logic, not a guarantee — local knowledge still wins.

### 🤖 AI fishing assistant

Snap a lure, snap a fish, or ask the guide a live question — powered by a Cloudflare
Worker running Workers AI (`cloudflare-worker/bite-assistant-worker.js`). See
[Deploying the AI assistant](#-deploying-the-ai-assistant) below.

## ☕ Support this project

Multi-location scoring is free (it runs in your browser). The AI assistant (photo ID +
chat) runs on Cloudflare Workers AI, which is metered — heavier use costs real money to
keep online. If BiteCast helps you catch more fish, consider chipping in:

**https://ko-fi.com/audaddy**

A support link also lives in the dashboard's AI card and a floating Ko-fi button, plus
GitHub's native "Sponsor" button (via [`.github/FUNDING.yml`](.github/FUNDING.yml)).

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
This lean is tuned for Lake Louise's mix; other waters may run differently.

**Data sources:** weather from [Open-Meteo](https://open-meteo.com) (no API key); sun
times from the [`astral`](https://pypi.org/project/astral/) package (server) / bundled
[SunCalc](https://github.com/mourner/suncalc) (browser); moon position/phase from
[`ephem`](https://pypi.org/project/ephem/) (server) / SunCalc (browser). All solunar
math runs offline once weather is fetched.

## Repo layout

```
lake-louise-bite-tracker/
├── .github/workflows/check_bite_score.yml   # Lake Louise cron: runs every 30 min + manual dispatch
├── .github/FUNDING.yml                      # Ko-fi / GitHub Sponsors button
├── scripts/score_calculator.py              # server-side scoring + notification logic (Lake Louise)
├── cloudflare-worker/bite-assistant-worker.js  # AI photo-ID / chat Worker (any location)
├── cloudflare-worker/bite-notifier-worker.js   # advance-alert cron Worker (Lake Louise only)
├── docs/index.html                          # GitHub Pages dashboard (served from /docs) — client-side scoring engine for any location
├── docs/data/*.json                          # data mirror the dashboard falls back to when offline
├── data/latest_score.json                   # canonical latest Lake Louise result
├── data/history.json                        # rolling Lake Louise history (capped at 500)
├── requirements.txt
└── README.md
```

## 🔔 Enabling push notifications (ntfy.sh)

Notifications fire when the score is **≥ 70**, or **≥ 55 within 30 minutes of a major/minor
period start**. Duplicate alerts for the same solunar period are suppressed. These are
tied to the Lake Louise home water (a fixed cron needs a fixed location).

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

## 🤖 Deploying the AI assistant

`cloudflare-worker/bite-assistant-worker.js` is a standalone Cloudflare Worker.

1. In the Cloudflare dashboard, create a Worker and paste in this file's contents (or
   deploy via `wrangler`).
2. **Worker → Settings → Bindings → Add → Workers AI**, variable name `AI`.
3. *(Recommended, cost control)* **Bindings → Add → KV Namespace**, variable name
   `RATE_LIMIT`, pointing at a new KV namespace. This caps free AI requests at 15 per IP
   per UTC day (override with a `DAILY_LIMIT` plain-text variable) and returns a message
   pointing to Ko-fi once the cap is hit. Skip this binding and the Worker still works —
   it just won't limit usage.
4. If you serve the dashboard from a different domain than `audaddy.github.io`, add it
   to `ALLOWED_ORIGINS` at the top of the file.
5. Copy the deployed Worker's `*.workers.dev` URL and paste it into the dashboard when
   prompted (stored in your browser's `localStorage`, not committed to the repo).

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
- Away from Lake Louise, the bite score is accurate for that spot but species/tactics
  guidance was tuned for Lake Louise's trout-and-bass mix — use judgment for local species.
- Solunar theory is a fishing heuristic, not a guarantee — go fish and find out. 🎣
