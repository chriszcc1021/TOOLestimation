const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3031;

const ST_TOKEN = 'ST0_c6oDh4w8_r22kS9RabpZQ1F';
const ST_BASE  = 'https://api.sensortower.com';
const CLAUDE_BASE = 'https://new-api.openclaw.ingarena.net';
const CLAUDE_KEY  = 'sk-y5OvzZALUDqXBnSHcFKCdNcmBfvbD8r2NJG27EOAllObZonR';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// All countries to fetch (WW + regional)
const ALL_COUNTRIES = [
  'WW',
  'ID','VN','TH','MY','PH',          // SEA
  'JP','KR',                          // JPKR
  'US','GB','DE','CA','IT','FR','NZ','AU',  // West
  'MA','SA','IQ','IR',               // MENA
].join(',');

const IOS_CATS = {
  6014:'Games',7001:'Action',7002:'Adventure',7003:'Arcade',
  7004:'Board',7005:'Card',7009:'Family',7012:'Puzzle',
  7013:'Racing',7014:'Role Playing',7015:'Simulation',
  7016:'Sports',7017:'Strategy',
};

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── ST helpers ───────────────────────────────────────────────
async function stGet(endpoint, params = {}) {
  const url = new URL(ST_BASE + endpoint);
  url.searchParams.set('auth_token', ST_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`ST ${res.status}: ${(await res.text()).slice(0,100)}`);
  return res.json();
}

async function searchApp(name) {
  const data = await stGet('/v1/unified/search_entities', {
    entity_type: 'app', term: name, limit: 5,
  });
  return Array.isArray(data) && data.length ? data[0] : null;
}

// Returns { WW: [y1,y2,y3], ID: [y1,y2,y3], ... }
// Each yN = { year, startDate, endDate, downloads, revenue, rpd, months }
async function getYearlyByCountry(appId, releaseDate) {
  const release = new Date(releaseDate);

  // Pre-compute year date ranges
  const yearRanges = [0,1,2].map(y => {
    const s = new Date(release);
    s.setMonth(s.getMonth() + y * 12);
    const e = new Date(s);
    e.setMonth(e.getMonth() + 12);
    e.setDate(e.getDate() - 1);
    return {
      year: y + 1,
      startDate: s.toISOString().slice(0,7),
      endDate:   e.toISOString().slice(0,7),
    };
  });

  const startDate = release.toISOString().slice(0,10);
  const endDate3  = new Date(release);
  endDate3.setMonth(endDate3.getMonth() + 36);
  const endDate = endDate3.toISOString().slice(0,10);

  let rows = [];
  try {
    const data = await stGet('/v1/unified/sales_report_estimates', {
      app_ids:     appId,
      countries:   ALL_COUNTRIES,
      start_date:  startDate,
      end_date:    endDate,
      granularity: 'monthly',
    });
    rows = Array.isArray(data) ? data : [];
  } catch(e) {
    console.warn('[yearly] multi-country failed, fallback WW:', e.message);
    try {
      const data2 = await stGet('/v1/unified/sales_report_estimates', {
        app_ids: appId, countries: 'WW',
        start_date: startDate, end_date: endDate, granularity: 'monthly',
      });
      rows = Array.isArray(data2) ? data2 : [];
    } catch(e2) { console.warn('[yearly] WW fallback also failed'); }
  }

  // Bucket rows by country × year index
  const byCountry = {};
  for (const row of rows) {
    const c  = row.country || 'WW';
    const rd = new Date(row.date);
    const ms = (rd.getFullYear() - release.getFullYear()) * 12
             + (rd.getMonth()    - release.getMonth());
    const yi = Math.floor(ms / 12);
    if (yi < 0 || yi > 2) continue;

    if (!byCountry[c]) {
      byCountry[c] = yearRanges.map(r => ({
        ...r, downloads: 0, revenue: 0, months: 0
      }));
    }
    byCountry[c][yi].downloads += Number(row.unified_units   || 0);
    byCountry[c][yi].revenue   += Number(row.unified_revenue || 0);
    byCountry[c][yi].months    += 1;
  }

  // Compute RPD per cell
  for (const c in byCountry) {
    byCountry[c].forEach(y => {
      y.downloads = Math.round(y.downloads);
      y.revenue   = Math.round(y.revenue);
      y.rpd = y.downloads > 0
        ? parseFloat((y.revenue / y.downloads).toFixed(4)) : 0;
    });
  }

  return { yearRanges, byCountry };
}

async function fetchComp(name) {
  try {
    const app = await searchApp(name);
    if (!app) return { inputName: name, found: false };

    const appId       = app.app_id;
    const releaseDate = (app.release_date || '').slice(0,10);
    const catNames    = (app.categories||[]).map(c=>IOS_CATS[c]).filter(Boolean);

    let yearRanges = [], byCountry = {};
    if (releaseDate) {
      const res = await getYearlyByCountry(appId, releaseDate);
      yearRanges = res.yearRanges;
      byCountry  = res.byCountry;
    }

    const ww = byCountry['WW'] || [];
    const totalDownloads = ww.reduce((s,y)=>s+y.downloads, 0);
    const totalRevenue   = ww.reduce((s,y)=>s+y.revenue,   0);

    return {
      inputName: name,
      found: true,
      appId,
      name:        app.name || name,
      publisher:   app.publisher_name || '',
      iconUrl:     app.icon_url || '',
      releaseDate,
      categories:  catNames,
      yearRanges,
      byCountry,
      totalDownloads,
      totalRevenue,
      monthCount: ww.reduce((s,y)=>s+y.months, 0),
      arpu: totalDownloads > 0
        ? parseFloat((totalRevenue / totalDownloads).toFixed(4)) : 0,
    };
  } catch(e) {
    console.warn('[fetchComp]', name, e.message);
    return { inputName: name, found: false, error: e.message };
  }
}

// ── Claude ───────────────────────────────────────────────────
async function callClaude(prompt) {
  const res = await fetch(`${CLAUDE_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${CLAUDE_KEY}` },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 2000,
      messages: [{ role:'user', content:prompt }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content || '';
}

// ── Routes ───────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.post('/api/analyze', async (req, res) => {
  const description = String(req.body?.description || '').trim();
  if (!description) return res.status(400).json({ ok:false, error:'description required' });

  let stContext = '', stAppFound = null;
  try {
    const results = await stGet('/v1/unified/search_entities', {
      entity_type:'app', term:description, limit:3,
    });
    if (Array.isArray(results) && results.length) {
      const app = results[0];
      stAppFound = app;
      const cats = (app.categories||[]).map(c=>IOS_CATS[c]).filter(Boolean).join(', ');
      stContext = `\nST: App="${app.name}" Publisher="${app.publisher_name}" Categories="${cats}" Released="${(app.release_date||'').slice(0,10)}"`;
    }
  } catch(e) { console.warn('[analyze] ST:', e.message); }

  const prompt = `You are a mobile game market analyst. Return ONLY valid JSON.
${stContext}
Product: "${description}"

Steps:
1. Identify exact core gameplay loop (≤15 words)
2. Only pick comps that share that loop (not just same genre label)

Return:
{
  "reasoning": {
    "core_loop": "≤15 words",
    "audience": "target audience",
    "excluded_games": ["Game - reason"]
  },
  "summary": "2-3 sentences in Chinese",
  "category": "specific genre in Chinese",
  "monetization_type": "model in Chinese",
  "download_comps": [
    { "name": "exact App Store name", "reason": "one sentence in Chinese", "relation": "same_ip or same_gameplay" }
  ],
  "monetization_comps": [
    { "name": "exact App Store name", "reason": "one sentence in Chinese" }
  ]
}
Rules: 3-5 download_comps, 2-3 monetization_comps, real published games only.`;

  try {
    const raw = await callClaude(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const parsed = JSON.parse(match[0]);
    if (stAppFound) parsed.st_target = {
      name:       stAppFound.name,
      publisher:  stAppFound.publisher_name,
      releaseDate:(stAppFound.release_date||'').slice(0,10),
      categories: (stAppFound.categories||[]).map(c=>IOS_CATS[c]||c).filter(Boolean),
    };
    res.json({ ok:true, ...parsed });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/fetch-comp', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok:false, error:'name required' });
  try {
    const result = await fetchComp(name);
    res.json({ ok:true, result });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/fetch-comps', async (req, res) => {
  const comps = req.body?.comps || [];
  const results = [];
  for (const c of comps) {
    console.log('[fetch-comps]', c.name);
    results.push(await fetchComp(c.name));
    await new Promise(x => setTimeout(x, 400));
  }
  res.json({ ok:true, results });
});

app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
