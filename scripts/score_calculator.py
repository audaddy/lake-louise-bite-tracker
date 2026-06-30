#!/usr/bin/env python3
"""
Lake Louise Bite Tracker — score calculator.

Pulls current weather from Open-Meteo, computes solunar data offline (sun via
`astral`, moon via `ephem`), builds a 0-100 composite "bite score", writes the
result to data/latest_score.json, appends to data/history.json, and optionally
fires an ntfy.sh push notification.

Target water: Lake Louise, Lakewood, WA (47.161861, -122.567972)
Species: rainbow trout + largemouth bass

No external API key is required. Designed to run every 30 min via GitHub Actions.
"""

import json
import math
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import ephem
import requests
from astral import LocationInfo
from astral.sun import sun

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
LAT = 47.161861
LON = -122.567972
TZNAME = "America/Los_Angeles"
TZ = ZoneInfo(TZNAME)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
NTFY_BASE = "https://ntfy.sh"

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(HERE, "..", "data"))
LATEST_PATH = os.path.join(DATA_DIR, "latest_score.json")
HISTORY_PATH = os.path.join(DATA_DIR, "history.json")

# GitHub Pages serves from /docs, so only files under docs/ are published.
# Mirror the data there so the dashboard can fetch it via a relative path.
DOCS_DATA_DIR = os.path.normpath(os.path.join(HERE, "..", "docs", "data"))
DOCS_LATEST_PATH = os.path.join(DOCS_DATA_DIR, "latest_score.json")
DOCS_HISTORY_PATH = os.path.join(DOCS_DATA_DIR, "history.json")

HISTORY_CAP = 500           # max entries kept in history.json
PRESSURE_WINDOW_HRS = 3.0   # window over which the pressure trend is measured

MAJOR_HALF_WINDOW = timedelta(minutes=60)   # transit / underfoot +/- 60 min
MINOR_HALF_WINDOW = timedelta(minutes=30)   # moonrise / moonset +/- 30 min
DAWN_DUSK_HALF_WINDOW = timedelta(minutes=60)
PERIOD_START_GRACE = timedelta(minutes=30)  # "within 30 min of a period start"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def now_local() -> datetime:
    return datetime.now(TZ)


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def iso(dt: datetime) -> str:
    return dt.astimezone(TZ).replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------- #
# 1. Weather (Open-Meteo)
# --------------------------------------------------------------------------- #
def get_weather():
    """Return the parsed Open-Meteo forecast JSON.

    For local testing where Open-Meteo is unreachable, set the env var
    LLBT_MOCK_WEATHER to the path of a JSON file holding a recorded response.
    """
    mock = os.environ.get("LLBT_MOCK_WEATHER")
    if mock:
        with open(mock, "r", encoding="utf-8") as f:
            return json.load(f)

    params = {
        "latitude": LAT,
        "longitude": LON,
        "current": "surface_pressure,cloud_cover,wind_speed_10m,precipitation,temperature_2m",
        "hourly": "surface_pressure,cloud_cover,wind_speed_10m,precipitation,temperature_2m",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": TZNAME,
        "forecast_days": 1,
    }
    resp = requests.get(OPEN_METEO_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def parse_current(weather):
    """Extract current conditions, tolerating schema variations.

    Returns dict: pressure (hPa), temp_f, cloud_cover (%), wind_mph, precip (in).
    Falls back to the nearest hourly sample if the `current` block is absent.
    """
    cur = weather.get("current") or {}

    def pick(key):
        val = cur.get(key)
        if val is not None:
            return val
        # Fall back to the first hourly value if "current" is missing the field.
        hourly = weather.get("hourly") or {}
        series = hourly.get(key) or []
        return series[0] if series else None

    pressure = pick("surface_pressure")
    return {
        "pressure": float(pressure) if pressure is not None else None,
        "temp_f": _f(pick("temperature_2m")),
        "cloud_cover": _f(pick("cloud_cover")),
        "wind_mph": _f(pick("wind_speed_10m")),
        "precip_in": _f(pick("precipitation")),
    }


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# 2. Solunar (sun via astral, moon via ephem)
# --------------------------------------------------------------------------- #
def _ephem_to_local(ed) -> datetime:
    """Convert a PyEphem Date (UTC) to a tz-aware local datetime."""
    return ephem.Date(ed).datetime().replace(tzinfo=timezone.utc).astimezone(TZ)


def moon_events(ref_local: datetime):
    """Compute the moon's transit/underfoot (major) and rise/set (minor) events
    bracketing the reference time, plus phase illumination %.

    transit  = moon crossing the upper meridian (overhead)
    underfoot = moon crossing the lower meridian (anti-transit, ~transit + 12h25m)
    """
    obs = ephem.Observer()
    obs.lat = str(LAT)
    obs.lon = str(LON)
    obs.elevation = 90
    obs.pressure = 0  # ignore atmospheric refraction for repeatable geometry
    ref_utc = ref_local.astimezone(timezone.utc)
    moon = ephem.Moon()

    def at(method):
        obs.date = ephem.Date(ref_utc)
        try:
            return _ephem_to_local(method(moon))
        except (ephem.CircumpolarError, ValueError):
            return None

    majors = [
        ("transit", at(obs.previous_transit)),
        ("transit", at(obs.next_transit)),
        ("underfoot", at(obs.previous_antitransit)),
        ("underfoot", at(obs.next_antitransit)),
    ]
    minors = [
        ("moonrise", at(obs.previous_rising)),
        ("moonrise", at(obs.next_rising)),
        ("moonset", at(obs.previous_setting)),
        ("moonset", at(obs.next_setting)),
    ]

    obs.date = ephem.Date(ref_utc)
    moon.compute(obs)
    illumination = float(moon.phase)  # percent of disc illuminated, 0-100

    majors = [(n, t) for n, t in majors if t is not None]
    minors = [(n, t) for n, t in minors if t is not None]
    return majors, minors, illumination


def sun_events(ref_local: datetime):
    """Return a list of (name, datetime) sunrise/sunset events for the day
    bracketing the reference time (yesterday, today, tomorrow)."""
    loc = LocationInfo("Lake Louise", "WA", TZNAME, LAT, LON)
    events = []
    for offset in (-1, 0, 1):
        day = (ref_local + timedelta(days=offset)).date()
        try:
            s = sun(loc.observer, date=day, tzinfo=TZ)
            events.append(("sunrise", s["sunrise"]))
            events.append(("sunset", s["sunset"]))
        except Exception:
            continue
    return events


# --------------------------------------------------------------------------- #
# Period proximity helpers
# --------------------------------------------------------------------------- #
def active_window(now, events, half_window):
    """Return (name, center) of an event whose +/- half_window window contains
    `now`, choosing the closest center; else None."""
    hits = [(abs(now - center), name, center)
            for name, center in events
            if abs(now - center) <= half_window]
    if not hits:
        return None
    _, name, center = min(hits)
    return name, center


def next_event(now, events):
    """Return (name, center) of the soonest future event, or None."""
    upcoming = sorted((center, name) for name, center in events if center > now)
    if not upcoming:
        return None
    center, name = upcoming[0]
    return name, center


def near_period_start(now, events, half_window):
    """True if `now` is within PERIOD_START_GRACE after the start
    (center - half_window) of any period."""
    for _, center in events:
        start = center - half_window
        if timedelta(0) <= (now - start) <= PERIOD_START_GRACE:
            return True
    return False


# --------------------------------------------------------------------------- #
# 3. Pressure trend
# --------------------------------------------------------------------------- #
def pressure_trend(history, current_pressure, now):
    """Delta (hPa) between current pressure and the reading nearest
    PRESSURE_WINDOW_HRS ago. Negative = falling. Returns 0.0 if no baseline."""
    if current_pressure is None:
        return 0.0
    target = now - timedelta(hours=PRESSURE_WINDOW_HRS)
    candidates = []
    for entry in history:
        p = entry.get("pressure")
        ts = entry.get("timestamp")
        if p is None or not ts:
            continue
        try:
            t = datetime.fromisoformat(ts)
        except ValueError:
            continue
        candidates.append((t, float(p)))
    if not candidates:
        return 0.0
    # Prefer the entry closest to `target`; this normalizes the delta to ~3 hr
    # regardless of how many samples we actually have.
    _, baseline = min(candidates, key=lambda tp: abs(tp[0] - target))
    return round(current_pressure - baseline, 1)


# --------------------------------------------------------------------------- #
# 4. Scoring  (weather-driven model)
#
# Rebalanced to weight the factors with the strongest real-world support
# (barometric pressure trend, cloud cover, wind, low light) and to carry a
# higher baseline, so calm/stable/overcast conditions read as a decent bite
# rather than bottoming out. Solunar timing and dawn/dusk are kept as bonuses
# on top rather than as the dominant driver.
# --------------------------------------------------------------------------- #
def compute_score(in_major, in_minor, in_dawn_dusk, illumination, trend,
                  cloud_cover, wind_mph):
    score = 35  # baseline — "average day" floor
    breakdown = {"baseline": 35}

    # --- Pressure trend (strongest signal) ---
    if trend <= -3:                       # sharp fall, pre-front feeding
        breakdown["pressure"] = 25
    elif trend <= -1:                     # moderate fall
        breakdown["pressure"] = 18
    elif trend < 1:                       # stable — comfortable for fish
        breakdown["pressure"] = 12
    elif trend <= 3:                      # slight rise
        breakdown["pressure"] = 5
    else:                                 # sharp rise, post-front shutdown
        breakdown["pressure"] = -10
    score += breakdown["pressure"]

    # --- Cloud cover (overcast diffuses light, fish roam/feed longer) ---
    if cloud_cover is not None:
        if cloud_cover >= 70:
            breakdown["cloud_cover"] = 12
        elif cloud_cover >= 40:
            breakdown["cloud_cover"] = 8
        elif cloud_cover >= 20:
            breakdown["cloud_cover"] = 4
        else:
            breakdown["cloud_cover"] = 0
        score += breakdown["cloud_cover"]

    # --- Wind (a light breeze/ripple is ideal; dead calm or gale is worse) ---
    if wind_mph is not None:
        if 3 <= wind_mph <= 10:
            breakdown["wind"] = 12
        elif 1 <= wind_mph < 3 or 10 < wind_mph <= 15:
            breakdown["wind"] = 6
        elif wind_mph < 1:
            breakdown["wind"] = 3
        else:                              # > 15 mph
            breakdown["wind"] = -8
        score += breakdown["wind"]

    # --- Solunar bonus: higher of major vs minor, never both ---
    if in_major:
        score += 18
        breakdown["solunar_major"] = 18
    elif in_minor:
        score += 10
        breakdown["solunar_minor"] = 10

    # --- Dawn/dusk low-light bonus ---
    if in_dawn_dusk:
        score += 12
        breakdown["dawn_dusk"] = 12

    # --- Moon phase (new/full or first/last quarter) ---
    if illumination is not None and (illumination > 95 or illumination < 5
                                     or 45 <= illumination <= 55):
        score += 6
        breakdown["moon_phase"] = 6

    score = max(0, min(100, score))
    return score, breakdown


def build_factors(breakdown, trend, cloud_cover, wind_mph, in_major, in_minor,
                  in_dawn_dusk, illumination):
    """Human-readable positive/negative factor lists for the dashboard."""
    pos, neg = [], []

    p = breakdown.get("pressure", 0)
    if p >= 18:
        pos.append("Falling barometric pressure — fish often feed ahead of a front")
    elif p == 12:
        pos.append("Stable atmospheric pressure is comfortable for fish")
    elif p == 5:
        pos.append("Slightly rising pressure — neutral to mild")
    elif p < 0:
        neg.append("Sharply rising pressure tends to slow the bite")

    if cloud_cover is not None:
        if cloud_cover >= 70:
            pos.append("Overcast skies have a favorable impact on biting activity")
        elif cloud_cover >= 40:
            pos.append("Partly cloudy skies are mildly favorable")
        elif cloud_cover < 20:
            neg.append("Bright, clear skies can push fish deep and slow feeding")

    if wind_mph is not None:
        if 3 <= wind_mph <= 10:
            pos.append("A light breeze/ripple has a very favorable effect")
        elif wind_mph < 1:
            neg.append("Dead-calm water is less favorable than a light ripple")
        elif wind_mph > 15:
            neg.append("Strong winds make conditions tougher")

    if in_major:
        pos.append("Solunar major period active (moon overhead/underfoot)")
    elif in_minor:
        pos.append("Solunar minor period active (moonrise/moonset)")
    if in_dawn_dusk:
        pos.append("Low-light dawn/dusk window — prime feeding time")
    if illumination is not None and (illumination > 95 or illumination < 5
                                     or 45 <= illumination <= 55):
        pos.append("Moon phase is favorable")

    return pos, neg


def tier_for(score):
    if score >= 80:
        return "Excellent"
    if score >= 60:
        return "Good"
    if score >= 40:
        return "Fair"
    return "Slow"


# --------------------------------------------------------------------------- #
# 5. Species + message
# --------------------------------------------------------------------------- #
def species_and_message(score, tier, temp_f, active_major, active_minor,
                        in_dawn_dusk, now):
    warm = temp_f is not None and temp_f > 65
    if warm:
        species, fish = "bass", "Largemouth bass"
    else:
        species, fish = "trout", "Rainbow trout"

    # How long the current favorable solunar window lasts.
    hours_left = None
    active = active_major or active_minor
    if active:
        half = MAJOR_HALF_WINDOW if active_major else MINOR_HALF_WINDOW
        window_end = active[1] + half
        hours_left = max(0.0, (window_end - now).total_seconds() / 3600.0)

    def hrs(h):
        if h >= 1:
            return f"~{round(h * 2) / 2:g} hours"
        return f"~{int(round(h * 60))} min"

    if tier in ("Excellent", "Good"):
        if active and hours_left:
            species_note = f"{fish} biting"
            message = (f"{tier} {species} window right now — biting for the "
                       f"next {hrs(hours_left)}.")
        elif in_dawn_dusk:
            species_note = f"{fish} — dawn/dusk window"
            message = (f"{tier} {species} conditions during the low-light "
                       f"window. Good time to fish.")
        else:
            species_note = f"{fish} — {tier.lower()} window"
            message = f"{tier} conditions for {species} right now. Worth a cast."
    elif tier == "Fair":
        species_note = f"{fish} — fair conditions"
        message = f"Fair {species} conditions right now. Could go either way."
    else:  # Slow
        species_note = f"{fish} — slow"
        message = f"Slow bite. Marginal {species} conditions at the moment."

    return species, species_note, message, hours_left


# --------------------------------------------------------------------------- #
# Notifications (ntfy.sh)
# --------------------------------------------------------------------------- #
def maybe_notify(score, active_major, active_minor, all_events, now,
                 species_note, message, prev_latest):
    """Decide whether to fire an ntfy push, honoring the dedup rules, and return
    the new 'last_notified' state to persist."""
    topic = os.environ.get("NTFY_TOPIC")

    high_score = score >= 70
    near_start = score >= 55 and near_period_start(now, all_events,
                                                   MAJOR_HALF_WINDOW)
    near_start_minor = score >= 55 and near_period_start(now, all_events,
                                                         MINOR_HALF_WINDOW)
    should_consider = high_score or near_start or near_start_minor

    # Identify the active solunar period (for dedup) — major preferred.
    active = active_major or active_minor
    if active:
        period_key = f"{active[0]}@{iso(active[1])}"
    elif high_score:
        period_key = f"highscore@{now.strftime('%Y-%m-%dT%H')}"
    else:
        period_key = None

    prev = (prev_latest or {}).get("last_notified") or {}
    prev_key = prev.get("period_key")
    prev_high = bool(prev.get("score_ge_70"))

    should_notify = False
    if should_consider and period_key:
        if period_key != prev_key:
            should_notify = True
        elif high_score and not prev_high:
            # Threshold freshly crossed within the same period.
            should_notify = True

    new_state = {"period_key": period_key, "score_ge_70": high_score}

    if not should_notify:
        return new_state, False, "skipped (dedup or below threshold)"

    if not topic:
        # No topic configured yet (placeholder). Don't error — just report.
        return new_state, False, "would notify, but NTFY_TOPIC is unset"

    if os.environ.get("LLBT_DRY_RUN"):
        return new_state, True, "dry-run (POST skipped)"

    try:
        requests.post(
            f"{NTFY_BASE}/{topic}",
            data=message.encode("utf-8"),
            headers={
                "Title": species_note,
                "Priority": "default",
                "Tags": "fish",
            },
            timeout=30,
        )
        return new_state, True, "notification sent"
    except requests.RequestException as exc:
        return new_state, False, f"notify failed: {exc}"


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    now = now_local()

    weather = get_weather()
    cur = parse_current(weather)

    majors, minors, illumination = moon_events(now)
    suns = sun_events(now)

    active_major = active_window(now, majors, MAJOR_HALF_WINDOW)
    active_minor = active_window(now, minors, MINOR_HALF_WINDOW)
    in_major = active_major is not None
    in_minor = active_minor is not None
    in_dawn_dusk = active_window(now, suns, DAWN_DUSK_HALF_WINDOW) is not None

    history = load_json(HISTORY_PATH, [])
    if not isinstance(history, list):
        history = []
    trend = pressure_trend(history, cur["pressure"], now)

    score, breakdown = compute_score(in_major, in_minor, in_dawn_dusk,
                                     illumination, trend,
                                     cur["cloud_cover"], cur["wind_mph"])
    tier = tier_for(score)
    positive_factors, negative_factors = build_factors(
        breakdown, trend, cur["cloud_cover"], cur["wind_mph"],
        in_major, in_minor, in_dawn_dusk, illumination)
    species, species_note, message, hours_left = species_and_message(
        score, tier, cur["temp_f"], active_major, active_minor,
        in_dawn_dusk, now)

    nxt_major = next_event(now, majors)
    nxt_minor = next_event(now, minors)

    def fmt(ev):
        if not ev:
            return None
        return {"type": ev[0], "time": iso(ev[1])}

    prev_latest = load_json(LATEST_PATH, {})
    all_solunar = majors + minors
    new_notify_state, fired, notify_status = maybe_notify(
        score, active_major, active_minor, all_solunar, now,
        species_note, message, prev_latest)

    latest = {
        "timestamp": iso(now),
        "score": score,
        "tier": tier,
        "species_note": species_note,
        "message": message,
        "next_major_period": fmt(nxt_major),
        "next_minor_period": fmt(nxt_minor),
        "pressure_trend_hpa": trend,
        # --- extra context for the dashboard / debugging ---
        "species": species,
        "in_major_period": in_major,
        "in_minor_period": in_minor,
        "in_dawn_dusk": in_dawn_dusk,
        "moon_illumination_pct": round(illumination, 1) if illumination is not None else None,
        "temp_f": cur["temp_f"],
        "surface_pressure_hpa": cur["pressure"],
        "cloud_cover_pct": cur["cloud_cover"],
        "wind_mph": cur["wind_mph"],
        "precip_in": cur["precip_in"],
        "score_breakdown": breakdown,
        "positive_factors": positive_factors,
        "negative_factors": negative_factors,
        "notification": {"fired": fired, "status": notify_status},
        "last_notified": new_notify_state,
    }

    # 7. Append to history (pressure + score), prune to cap.
    history.append({
        "timestamp": latest["timestamp"],
        "score": score,
        "tier": tier,
        "pressure": cur["pressure"],
        "temp_f": cur["temp_f"],
    })
    if len(history) > HISTORY_CAP:
        history = history[-HISTORY_CAP:]

    save_json(LATEST_PATH, latest)
    save_json(HISTORY_PATH, history)
    # Mirror into docs/data/ so GitHub Pages (served from /docs) can read it.
    save_json(DOCS_LATEST_PATH, latest)
    save_json(DOCS_HISTORY_PATH, history)

    print(f"[{latest['timestamp']}] score={score} ({tier}) "
          f"species={species} trend={trend}hPa illum={latest['moon_illumination_pct']}% "
          f"| notify: {notify_status}")
    return latest


if __name__ == "__main__":
    main()
