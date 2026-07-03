/* Inlined SunCalc (c) 2011-2015 Vladimir Agafonkin, BSD-2-Clause */
/*
 (c) 2011-2015, Vladimir Agafonkin
 SunCalc is a JavaScript library for calculating sun/moon position and light phases.
 https://github.com/mourner/suncalc
*/

const SunCalc = (function () { 'use strict';

// shortcuts for easier to read formulas

var PI   = Math.PI,
    sin  = Math.sin,
    cos  = Math.cos,
    tan  = Math.tan,
    asin = Math.asin,
    atan = Math.atan2,
    acos = Math.acos,
    rad  = PI / 180;

// sun calculations are based on http://aa.quae.nl/en/reken/zonpositie.html formulas


// date/time constants and conversions

var dayMs = 1000 * 60 * 60 * 24,
    J1970 = 2440588,
    J2000 = 2451545;

function toJulian(date) { return date.valueOf() / dayMs - 0.5 + J1970; }
function fromJulian(j)  { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date)   { return toJulian(date) - J2000; }


// general calculations for position

var e = rad * 23.4397; // obliquity of the Earth

function rightAscension(l, b) { return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l)); }
function declination(l, b)    { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }

function azimuth(H, phi, dec)  { return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)); }
function altitude(H, phi, dec) { return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)); }

function siderealTime(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }

function astroRefraction(h) {
    if (h < 0) // the following formula works for positive altitudes only.
        h = 0; // if h = -0.08901179 a div/0 would occur.

    // formula 16.4 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
    // 1.02 / tan(h + 10.26 / (h + 5.10)) h in degrees, result in arc minutes -> converted to rad:
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}

// general sun calculations

function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }

function eclipticLongitude(M) {

    var C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)), // equation of center
        P = rad * 102.9372; // perihelion of the Earth

    return M + C + P + PI;
}

function sunCoords(d) {

    var M = solarMeanAnomaly(d),
        L = eclipticLongitude(M);

    return {
        dec: declination(L, 0),
        ra: rightAscension(L, 0)
    };
}


var SunCalc = {};


// calculates sun position for a given date and latitude/longitude

SunCalc.getPosition = function (date, lat, lng) {

    var lw  = rad * -lng,
        phi = rad * lat,
        d   = toDays(date),

        c  = sunCoords(d),
        H  = siderealTime(d, lw) - c.ra;

    return {
        azimuth: azimuth(H, phi, c.dec),
        altitude: altitude(H, phi, c.dec)
    };
};


// sun times configuration (angle, morning name, evening name)

var times = SunCalc.times = [
    [-0.833, 'sunrise',       'sunset'      ],
    [  -0.3, 'sunriseEnd',    'sunsetStart' ],
    [    -6, 'dawn',          'dusk'        ],
    [   -12, 'nauticalDawn',  'nauticalDusk'],
    [   -18, 'nightEnd',      'night'       ],
    [     6, 'goldenHourEnd', 'goldenHour'  ]
];

// adds a custom time to the times config

SunCalc.addTime = function (angle, riseName, setName) {
    times.push([angle, riseName, setName]);
};


// calculations for sun times

var J0 = 0.0009;

function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * PI)); }

function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * PI) + n; }
function solarTransitJ(ds, M, L)  { return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L); }

function hourAngle(h, phi, d) { return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d))); }
function observerAngle(height) { return -2.076 * Math.sqrt(height) / 60; }

// returns set time for the given sun altitude
function getSetJ(h, lw, phi, dec, n, M, L) {

    var w = hourAngle(h, phi, dec),
        a = approxTransit(w, lw, n);
    return solarTransitJ(a, M, L);
}


// calculates sun times for a given date, latitude/longitude, and, optionally,
// the observer height (in meters) relative to the horizon

SunCalc.getTimes = function (date, lat, lng, height) {

    height = height || 0;

    var lw = rad * -lng,
        phi = rad * lat,

        dh = observerAngle(height),

        d = toDays(date),
        n = julianCycle(d, lw),
        ds = approxTransit(0, lw, n),

        M = solarMeanAnomaly(ds),
        L = eclipticLongitude(M),
        dec = declination(L, 0),

        Jnoon = solarTransitJ(ds, M, L),

        i, len, time, h0, Jset, Jrise;


    var result = {
        solarNoon: fromJulian(Jnoon),
        nadir: fromJulian(Jnoon - 0.5)
    };

    for (i = 0, len = times.length; i < len; i += 1) {
        time = times[i];
        h0 = (time[0] + dh) * rad;

        Jset = getSetJ(h0, lw, phi, dec, n, M, L);
        Jrise = Jnoon - (Jset - Jnoon);

        result[time[1]] = fromJulian(Jrise);
        result[time[2]] = fromJulian(Jset);
    }

    return result;
};


// moon calculations, based on http://aa.quae.nl/en/reken/hemelpositie.html formulas

function moonCoords(d) { // geocentric ecliptic coordinates of the moon

    var L = rad * (218.316 + 13.176396 * d), // ecliptic longitude
        M = rad * (134.963 + 13.064993 * d), // mean anomaly
        F = rad * (93.272 + 13.229350 * d),  // mean distance

        l  = L + rad * 6.289 * sin(M), // longitude
        b  = rad * 5.128 * sin(F),     // latitude
        dt = 385001 - 20905 * cos(M);  // distance to the moon in km

    return {
        ra: rightAscension(l, b),
        dec: declination(l, b),
        dist: dt
    };
}

SunCalc.getMoonPosition = function (date, lat, lng) {

    var lw  = rad * -lng,
        phi = rad * lat,
        d   = toDays(date),

        c = moonCoords(d),
        H = siderealTime(d, lw) - c.ra,
        h = altitude(H, phi, c.dec),
        // formula 14.1 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
        pa = atan(sin(H), tan(phi) * cos(c.dec) - sin(c.dec) * cos(H));

    h = h + astroRefraction(h); // altitude correction for refraction

    return {
        azimuth: azimuth(H, phi, c.dec),
        altitude: h,
        distance: c.dist,
        parallacticAngle: pa
    };
};


// calculations for illumination parameters of the moon,
// based on http://idlastro.gsfc.nasa.gov/ftp/pro/astro/mphase.pro formulas and
// Chapter 48 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.

SunCalc.getMoonIllumination = function (date) {

    var d = toDays(date || new Date()),
        s = sunCoords(d),
        m = moonCoords(d),

        sdist = 149598000, // distance from Earth to Sun in km

        phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)),
        inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi)),
        angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) -
                cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));

    return {
        fraction: (1 + cos(inc)) / 2,
        phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
        angle: angle
    };
};


function hoursLater(date, h) {
    return new Date(date.valueOf() + h * dayMs / 24);
}

// calculations for moon rise/set times are based on http://www.stargazing.net/kepler/moonrise.html article

SunCalc.getMoonTimes = function (date, lat, lng, inUTC) {
    var t = new Date(date);
    if (inUTC) t.setUTCHours(0, 0, 0, 0);
    else t.setHours(0, 0, 0, 0);

    var hc = 0.133 * rad,
        h0 = SunCalc.getMoonPosition(t, lat, lng).altitude - hc,
        h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;

    // go in 2-hour chunks, each time seeing if a 3-point quadratic curve crosses zero (which means rise or set)
    for (var i = 1; i <= 24; i += 2) {
        h1 = SunCalc.getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
        h2 = SunCalc.getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;

        a = (h0 + h2) / 2 - h1;
        b = (h2 - h0) / 2;
        xe = -b / (2 * a);
        ye = (a * xe + b) * xe + h1;
        d = b * b - 4 * a * h1;
        roots = 0;

        if (d >= 0) {
            dx = Math.sqrt(d) / (Math.abs(a) * 2);
            x1 = xe - dx;
            x2 = xe + dx;
            if (Math.abs(x1) <= 1) roots++;
            if (Math.abs(x2) <= 1) roots++;
            if (x1 < -1) x1 = x2;
        }

        if (roots === 1) {
            if (h0 < 0) rise = i + x1;
            else set = i + x1;

        } else if (roots === 2) {
            rise = i + (ye < 0 ? x2 : x1);
            set = i + (ye < 0 ? x1 : x2);
        }

        if (rise && set) break;

        h0 = h2;
    }

    var result = {};

    if (rise) result.rise = hoursLater(t, rise);
    if (set) result.set = hoursLater(t, set);

    if (!rise && !set) result[ye > 0 ? 'alwaysUp' : 'alwaysDown'] = true;

    return result;
};


return SunCalc;

}());

/* ===================================================================== *
 * Lake Louise Bite Tracker — look-ahead notifier (Cloudflare Cron)
 *
 * Runs on a Cron Trigger every 30 min. Fetches the Open-Meteo forecast,
 * scores every upcoming hour with the same model as the app (solunar via
 * the inlined SunCalc above + weather), finds upcoming "Excellent" windows,
 * and sends an advance ntfy push so you get a heads-up before great fishing.
 *
 * ntfy -> your phone -> mirrored to your Garmin Fenix 7 via Garmin Connect.
 *
 * Stateless by design (no database): a ~90-min heads-up and a ~30-min
 * reminder are fired using timing bands sized to the 30-min cron cadence,
 * so each window alerts about once. Windows are on the hour.
 *
 * VARS expected on this Worker:
 *   - NTFY_TOPIC  (plain text variable): your ntfy.sh topic
 * ===================================================================== */

const LAT = 47.161861;
const LON = -122.567972;
const TZ = 'America/Los_Angeles';

const THRESHOLD = 80;          // "Excellent". Lower to 70 for "Good or better".
const HEADS_BAND = [61, 110];  // minutes-to-start window for the advance alert (~90 min)
const SOON_BAND = [16, 45];    // minutes-to-start window for the reminder (~30 min)

// ---- scoring (identical weights to the dashboard) ----
function computeScore(inMajor, inMinor, inDawnDusk, illum, trend, cloud, wind) {
  let s = 35;
  if (trend <= -3) s += 25; else if (trend <= -1) s += 18; else if (trend < 1) s += 12; else if (trend <= 3) s += 5; else s -= 10;
  if (cloud != null) s += cloud >= 70 ? 12 : cloud >= 40 ? 8 : cloud >= 20 ? 4 : 0;
  if (wind != null) s += (wind >= 3 && wind <= 10) ? 12 : ((wind >= 1 && wind < 3) || (wind > 10 && wind <= 15)) ? 6 : wind < 1 ? 3 : -8;
  if (inMajor) s += 18; else if (inMinor) s += 10;
  if (inDawnDusk) s += 12;
  if (illum != null && (illum > 95 || illum < 5 || (illum >= 45 && illum <= 55))) s += 6;
  return Math.max(0, Math.min(100, s));
}

// ---- solunar helpers (SunCalc is defined in the block above) ----
function moonMajorCenters(startMs, endMs) {
  const step = 10 * 60000, centers = [], alts = [], times = [];
  for (let t = startMs - 2 * 3600e3; t <= endMs + 2 * 3600e3; t += step) {
    times.push(t);
    alts.push(SunCalc.getMoonPosition(new Date(t), LAT, LON).altitude);
  }
  for (let i = 1; i < alts.length - 1; i++) {
    if ((alts[i] > alts[i - 1] && alts[i] >= alts[i + 1]) || (alts[i] < alts[i - 1] && alts[i] <= alts[i + 1])) {
      centers.push(times[i]);
    }
  }
  return centers;
}
function minorAndSunEvents(startMs, endMs) {
  const minors = [], suns = [];
  for (let d = startMs - 24 * 3600e3; d <= endMs + 24 * 3600e3; d += 24 * 3600e3) {
    const date = new Date(d);
    const mt = SunCalc.getMoonTimes(date, LAT, LON, true);
    if (mt.rise) minors.push(mt.rise.getTime());
    if (mt.set) minors.push(mt.set.getTime());
    const st = SunCalc.getTimes(date, LAT, LON);
    if (st.sunrise && !isNaN(st.sunrise)) suns.push(st.sunrise.getTime());
    if (st.sunset && !isNaN(st.sunset)) suns.push(st.sunset.getTime());
  }
  return { minors, suns };
}
function near(t, arr, winMin) { const w = winMin * 60000; return arr.some((x) => Math.abs(t - x) <= w); }

function fmtLocal(ms, opts) {
  return new Date(ms).toLocaleString('en-US', Object.assign({ timeZone: TZ }, opts));
}
function relTime(ms, now) {
  const m = Math.round((ms - now) / 60000);
  if (m <= 0) return 'now';
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

async function fetchForecast() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
    '&hourly=surface_pressure,cloud_cover,wind_speed_10m,precipitation,temperature_2m' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
    '&timezone=UTC&forecast_days=3&past_hours=6';
  const r = await fetch(url, { cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error('forecast ' + r.status);
  return r.json();
}

function scoreHours(w) {
  const H = w.hourly;
  const n = H.time.length;
  const ms = H.time.map((t) => Date.parse(t + ':00Z'));
  const majors = moonMajorCenters(ms[0], ms[n - 1]);
  const { minors, suns } = minorAndSunEvents(ms[0], ms[n - 1]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = ms[i];
    const pressure = H.surface_pressure[i];
    let trend = 0;
    for (let j = i; j >= 0; j--) {
      if (ms[i] - ms[j] >= 3 * 3600e3 || j === 0) {
        const p0 = H.surface_pressure[j];
        if (pressure != null && p0 != null) trend = Math.round((pressure - p0) * 10) / 10;
        break;
      }
    }
    const cloud = H.cloud_cover[i];
    const wind = H.wind_speed_10m[i];
    const inMajor = near(t, majors, 60);
    const inMinor = near(t, minors, 30);
    const inDawnDusk = near(t, suns, 60);
    const illum = SunCalc.getMoonIllumination(new Date(t)).fraction * 100;
    const score = computeScore(inMajor, inMinor, inDawnDusk, illum, trend, cloud, wind);
    out.push({ ms: t, score, trend, cloud, wind, temp: H.temperature_2m[i], inMajor, inMinor, inDawnDusk });
  }
  return out;
}

function reasonsFor(h) {
  const r = [];
  if (h.trend <= -1) r.push('falling pressure');
  else if (h.trend < 1) r.push('stable pressure');
  if (h.inDawnDusk) r.push('dawn/dusk');
  if (h.inMajor) r.push('solunar major');
  else if (h.inMinor) r.push('solunar minor');
  if (h.cloud != null && h.cloud >= 70) r.push('overcast');
  if (h.wind != null && h.wind >= 3 && h.wind <= 10) r.push('light wind');
  return r.slice(0, 3).join(' + ');
}

function findWindows(hours, now) {
  const wins = [];
  let cur = null;
  for (const h of hours) {
    if (h.score >= THRESHOLD) {
      if (!cur) cur = { startMs: h.ms, endMs: h.ms + 3600e3, peak: h.score, peakHour: h };
      else { cur.endMs = h.ms + 3600e3; if (h.score > cur.peak) { cur.peak = h.score; cur.peakHour = h; } }
    } else if (cur) { wins.push(cur); cur = null; }
  }
  if (cur) wins.push(cur);
  return wins.filter((w) => w.endMs > now).sort((a, b) => a.startMs - b.startMs);
}

async function ntfy(env, title, body, tags) {
  const topic = env.NTFY_TOPIC;
  if (!topic) return 'no-topic';
  const r = await fetch('https://ntfy.sh/' + topic, {
    method: 'POST',
    body,
    headers: { 'Title': title, 'Priority': 'high', 'Tags': tags || 'fish', 'Click': 'https://audaddy.github.io/lake-louise-bite-tracker/' },
  });
  return r.ok ? 'sent' : ('ntfy ' + r.status);
}

async function runCheck(env, opts) {
  opts = opts || {};
  const now = Date.now();
  const w = await fetchForecast();
  const hours = scoreHours(w);
  const windows = findWindows(hours, now);
  const next = windows[0] || null;

  const summary = {
    now: fmtLocal(now, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
    threshold: THRESHOLD,
    upcomingWindows: windows.slice(0, 6).map((wd) => ({
      start: fmtLocal(wd.startMs, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
      end: fmtLocal(wd.endMs, { hour: 'numeric', minute: '2-digit' }),
      peakScore: wd.peak,
      peakAt: fmtLocal(wd.peakHour.ms, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
      minsToStart: Math.round((wd.startMs - now) / 60000),
      reasons: reasonsFor(wd.peakHour),
    })),
    actions: [],
  };

  if (opts.testPing) {
    summary.actions.push(await ntfy(env, '🎣 Bite Tracker test', 'Test alert — if this reaches your watch, you are all set.', 'fish,white_check_mark'));
    return summary;
  }

  if (next) {
    const mins = (next.startMs - now) / 60000;
    const inBand = (b) => mins >= b[0] && mins < b[1];
    const peakLabel = fmtLocal(next.peakHour.ms, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const startLabel = fmtLocal(next.startMs, { hour: 'numeric', minute: '2-digit' });
    const endLabel = fmtLocal(next.endMs, { hour: 'numeric', minute: '2-digit' });
    const reasons = reasonsFor(next.peakHour);

    if (inBand(HEADS_BAND)) {
      const body = `Peak ~${peakLabel} (in ${relTime(next.peakHour.ms, now)}) · score ${next.peak}. Window ${startLabel}–${endLabel}. ${reasons}.`;
      summary.actions.push('headsup:' + (opts.dryRun ? 'would-send' : await ntfy(env, '🎣 Excellent bite window ahead', body, 'fish,calendar')));
    } else if (inBand(SOON_BAND)) {
      const body = `${startLabel}–${endLabel} · score ${next.peak}. ${reasons}. Get to the water.`;
      summary.actions.push('soon:' + (opts.dryRun ? 'would-send' : await ntfy(env, '🎣 Excellent bite starting soon', body, 'fish,rotating_light')));
    } else {
      summary.actions.push(`next excellent window in ${Math.round(mins)} min — outside alert bands`);
    }
  } else {
    summary.actions.push('no upcoming excellent window in the next 3 days');
  }
  return summary;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env, {}));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    let opts = { dryRun: true };
    if (url.searchParams.get('test') === '1') opts = { testPing: true };
    else if (url.searchParams.get('run') === '1') opts = { dryRun: false };
    const data = await runCheck(env, opts);
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  },
};
