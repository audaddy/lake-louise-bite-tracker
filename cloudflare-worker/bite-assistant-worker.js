/**
 * Lake Louise Bite Tracker — AI assistant Worker (Cloudflare Workers AI)
 *
 * Powers three features on the dashboard, all free via Workers AI:
 *   - mode "lure": photograph a lure/fly -> is it a good choice right now?
 *   - mode "fish": photograph a fish   -> what species is it (likely)?
 *   - mode "chat": ask the guide a fishing question, aware of live conditions
 *
 * Vision runs on LLaVA, then a Llama text model reasons over the description
 * plus the live conditions the app sends. No API key required — the AI binding
 * (env.AI) is provided by Cloudflare. Cost stays inside the free daily allowance.
 *
 * SETUP: bind Workers AI to this Worker with the variable name `AI`
 * (Worker → Settings → Bindings → Add → Workers AI → variable name: AI).
 */

const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const CHAT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Lock browser access to your dashboard's origin (basic abuse protection).
// If you use a custom domain later, add it to this list.
const ALLOWED_ORIGINS = [
  'https://audaddy.github.io',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function base64ToBytes(b64) {
  // Strip any data: URL prefix.
  const clean = b64.includes(',') ? b64.split(',')[1] : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function conditionsText(c) {
  if (!c) return 'No live conditions were provided.';
  const parts = [];
  if (c.score != null) parts.push(`bite score ${c.score} (${c.tier || '—'})`);
  if (c.temp_f != null) parts.push(`air/water proxy ${Math.round(c.temp_f)}°F`);
  if (c.light_phase) parts.push(`light: ${c.light_phase}`);
  if (c.cloud_cover_pct != null) parts.push(`${Math.round(c.cloud_cover_pct)}% cloud`);
  if (c.wind_mph != null) parts.push(`wind ${Math.round(c.wind_mph)} mph`);
  if (c.pressure_trend_hpa != null) parts.push(`pressure ${c.pressure_trend_hpa} hPa/3h`);
  if (c.moon_illumination_pct != null) parts.push(`moon ${c.moon_illumination_pct}% lit`);
  let s = 'Live conditions at Lake Louise (Lakewood, WA): ' + parts.join(', ') + '.';
  const t = c.tactics;
  if (t) {
    s += ` The app currently suggests: target ${t.species_pick}; ${t.where}; ${t.depth}; method lean ${t.method_lean}.`;
  }
  return s;
}

const GUIDE_INTRO =
  'You are a friendly, practical fishing guide built into the "Lake Louise Bite Tracker" app. ' +
  'Lake Louise is a small lowland lake in Lakewood, Washington holding rainbow trout and largemouth bass. ' +
  'Give concise, specific, real-world advice. Prefer 2–4 short sentences unless asked for more. ' +
  'Use the live conditions provided. Do not invent facts you cannot infer.';

async function runChat(env, system, user, history) {
  const messages = [{ role: 'system', content: system }];
  if (Array.isArray(history)) {
    for (const m of history.slice(-8)) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({ role: 'user', content: String(user || '') });
  const r = await env.AI.run(CHAT_MODEL, { messages, max_tokens: 500 });
  return r.response || '';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') {
      return json({ ok: true, service: 'lake-louise-bite-assistant', modes: ['lure', 'fish', 'chat'] }, 200, cors);
    }
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON body.' }, 400, cors); }
    const { mode, image, question, conditions, history } = body || {};
    const cond = conditionsText(conditions);

    try {
      if (mode === 'chat') {
        const system = `${GUIDE_INTRO}\n\n${cond}`;
        const answer = await runChat(env, system, question || 'What should I throw right now?', history);
        return json({ answer }, 200, cors);
      }

      if (mode === 'lure' || mode === 'fish') {
        if (!image) return json({ error: 'No image provided.' }, 400, cors);
        const bytes = base64ToBytes(image);

        const visionPrompt = mode === 'fish'
          ? 'Look at this fish. Describe its species (best guess), body shape, coloration, spots or stripes, and fin shape. Be specific and concise.'
          : 'Look at this fishing lure or fly. Identify what type it is (for example: woolly bugger, streamer, dry fly, nymph, popper, inline spinner, spinnerbait, spoon, jig, soft plastic, crankbait, topwater). Note its color and rough size. Be concise.';

        const v = await env.AI.run(VISION_MODEL, {
          image: Array.from(bytes),
          prompt: visionPrompt,
          max_tokens: 256,
        });
        const desc = (v && v.description) ? v.description.trim() : '';

        let system, user;
        if (mode === 'fish') {
          system = `${GUIDE_INTRO}\n\n${cond}\n\n` +
            'The user photographed a fish. Based on the image description, tell them the most likely species ' +
            '(rainbow trout and largemouth bass are most common here; it could be something else like a perch, ' +
            'crappie, or cutthroat). Give the 1–2 key features that support your guess, note your uncertainty, ' +
            'and add one quick handling or ID tip.';
          user = `Image description of the fish: "${desc}". The user asks: ${question || 'What kind of fish is this?'}`;
        } else {
          system = `${GUIDE_INTRO}\n\n${cond}\n\n` +
            'The user photographed a lure or fly they are considering. Based on the image description and the ' +
            'live conditions, tell them plainly whether it is a GOOD choice right now and why, and how to fish it ' +
            '(depth, retrieve speed, any color tweak). If it is a poor match for current conditions, say so and ' +
            'suggest what to switch to.';
          user = `Image description of the lure/fly: "${desc}". The user asks: ${question || 'Is this a good one to use right now?'}`;
        }

        const answer = await runChat(env, system, user, null);
        return json({ answer, vision: desc }, 200, cors);
      }

      return json({ error: 'Unknown mode. Use "lure", "fish", or "chat".' }, 400, cors);
    } catch (err) {
      return json({ error: 'AI request failed: ' + (err && err.message ? err.message : String(err)) }, 500, cors);
    }
  },
};
