const express = require('express');
const fs = require('fs');
const https = require('https');
const dns = require('dns');
const path = require('path');

loadEnvFile(path.join(__dirname, '.env'));

const app = express();
const PORT = process.env.PORT || 3031;

const ST_TOKEN = process.env.SENSOR_TOWER_TOKEN || process.env.ST_TOKEN || '';
const ST_BASE  = process.env.SENSOR_TOWER_BASE_URL || 'https://api.sensortower.com';
const ST_HOST = new URL(ST_BASE).hostname;
const ST_PUBLIC_DNS = (process.env.SENSOR_TOWER_DNS_SERVERS || '1.1.1.1,8.8.8.8')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const ST_FALLBACK_IPS = (process.env.SENSOR_TOWER_FALLBACK_IPS || '34.232.205.177,34.205.101.123,35.172.54.240')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const CLAUDE_BASE = 'https://new-api.openclaw.ingarena.net';
const CLAUDE_KEY  = process.env.CLAUDE_API_KEY || process.env.OPENAI_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

// All countries to fetch (WW + regional)
const ALL_COUNTRIES = [
  'WW',
  'ID','VN','TH','MY','PH',          // Southeast Asia
  'JP','KR','TW',                    // Japan, Korea, Taiwan
  'US','GB','DE','IT','CA','FR','AU','NZ',  // Europe / North America / Oceania
  'IQ','SA','DZ','EG','MA',          // Middle East / North Africa
  'BR','MX','PE','CO','CL','AR',     // Latin America
].join(',');

const IOS_CATS = {
  6014:'Games',7001:'Action',7002:'Adventure',7003:'Arcade',
  7004:'Board',7005:'Card',7009:'Family',7012:'Puzzle',
  7013:'Racing',7014:'Role Playing',7015:'Simulation',
  7016:'Sports',7017:'Strategy',
};

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function describeFetchError(service, err) {
  const cause = err?.cause || {};
  const code = cause.code || err?.code || '';
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || err?.name === 'TimeoutError') {
    return `${service} 连接超时，请检查网络/VPN/代理`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `${service} 域名解析失败，请检查 DNS 或代理`;
  }
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED') {
    return `${service} 连接被重置/拒绝，请检查网络或代理`;
  }
  if (err?.message === 'fetch failed') {
    return `${service} 请求失败，请检查网络/VPN/代理`;
  }
  return err?.message || `${service} 请求失败`;
}

const stResolver = new dns.promises.Resolver();
stResolver.setServers(ST_PUBLIC_DNS);
let stResolvedIps = [];
let stResolvedAt = 0;

async function resolveSensorTowerIps() {
  const now = Date.now();
  if (stResolvedIps.length && now - stResolvedAt < 10 * 60 * 1000) return stResolvedIps;
  try {
    stResolvedIps = await stResolver.resolve4(ST_HOST);
    stResolvedAt = now;
  } catch (e) {
    console.warn('[st dns] public resolver failed:', e.message);
    stResolvedIps = [];
  }
  return stResolvedIps.length ? stResolvedIps : ST_FALLBACK_IPS;
}

function httpsJsonGet(url, headers = {}, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers,
      timeout: timeoutMs,
      lookup: async (hostname, options, callback) => {
        if (hostname !== ST_HOST) {
          dns.lookup(hostname, options, callback);
          return;
        }
        try {
          const ips = await resolveSensorTowerIps();
          const addresses = ips.map(address => ({ address, family: 4 }));
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, 4);
        } catch (e) {
          callback(e);
        }
      },
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`ST ${res.statusCode}: ${body.slice(0, 100)}`));
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch (e) {
          reject(new Error(`ST invalid JSON: ${e.message}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Sensor Tower request timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ── ST helpers ───────────────────────────────────────────────
async function stGet(endpoint, params = {}, options = {}) {
  if (!ST_TOKEN) throw new Error('Sensor Tower token missing. Set SENSOR_TOWER_TOKEN in .env.');
  const url = new URL(ST_BASE + endpoint);
  if (options.authQuery === true) url.searchParams.set('auth_token', ST_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  try {
    return await httpsJsonGet(url, { Authorization: `Bearer ${ST_TOKEN}` }, 45000);
  } catch (e) {
    throw new Error(describeFetchError('Sensor Tower', e));
  }
}

async function searchApp(name) {
  const data = await stGet('/v1/unified/search_entities', {
    entity_type: 'app', term: name, limit: 5,
  }, { authQuery: false });
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  const apps = rows.filter(row => !row.entity_type || row.entity_type === 'unified_app' || row.entity_type === 'app');
  return apps.length ? apps[0] : null;
}

function appIdOf(app) {
  return app?.app_id || app?.unified_app_id || app?.id || '';
}

function appNameOf(app, fallback = '') {
  return app?.name || app?.unified_app_name || app?.app_name || fallback;
}

function publisherNameOf(app) {
  return app?.publisher_name || app?.unified_publisher_name || app?.developer || '';
}

function releaseDateOf(app) {
  return String(app?.release_date || app?.earliest_release_date || app?.release_date_ww || app?.release_date_us || '').slice(0, 10);
}

function categoryNamesOf(app) {
  if (Array.isArray(app?.category_details)) {
    return app.category_details.map(c => c.category_name || c.name).filter(Boolean);
  }
  return (app?.categories || []).map(c => IOS_CATS[c] || c?.category_name || c?.name).filter(Boolean);
}

function monthDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function monthDiff(from, to) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12
       + (to.getUTCMonth() - from.getUTCMonth());
}

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function countryYearRanges(firstMonth) {
  return [0, 1, 2].map(y => {
    const s = addMonths(firstMonth, y * 12);
    const e = addMonths(s, 11);
    return {
      year: y + 1,
      startDate: monthKey(s),
      endDate: monthKey(e),
    };
  });
}

// Returns { WW: [y1,y2,y3], ID: [y1,y2,y3], ... }
// Each country is bucketed from that country's first month with downloads or revenue.
// Each yN = { year, startDate, endDate, downloads, revenue, rpd, months }
async function getYearlyByCountry(appId, releaseDate) {
  const release = monthDate(releaseDate) || new Date(releaseDate);
  const startDate = release.toISOString().slice(0,10);
  const endDate = new Date().toISOString().slice(0,10);

  let rows = [];
  try {
    const data = await stGet('/v1/unified/sales_report_estimates', {
      app_ids:     appId,
      countries:   ALL_COUNTRIES,
      start_date:  startDate,
      end_date:    endDate,
      date_granularity: 'monthly',
    });
    rows = Array.isArray(data) ? data : [];
  } catch(e) {
    console.warn('[yearly] multi-country failed, fallback WW:', e.message);
    try {
      const data2 = await stGet('/v1/unified/sales_report_estimates', {
        app_ids: appId, countries: 'WW',
        start_date: startDate, end_date: endDate, date_granularity: 'monthly',
      });
      rows = Array.isArray(data2) ? data2 : [];
    } catch(e2) { console.warn('[yearly] WW fallback also failed'); }
  }

  // Each country finds its own first active month before the three yearly buckets are built.
  const rowsByCountry = {};
  for (const row of rows) {
    const c  = row.country || 'WW';
    const rd = monthDate(row.date);
    if (!rd) continue;
    const downloads = Number(row.unified_units || 0);
    const revenue = Number(row.revenue ?? (row.unified_revenue != null ? row.unified_revenue / 100 : 0));
    if (!rowsByCountry[c]) rowsByCountry[c] = [];
    rowsByCountry[c].push({ date: rd, downloads, revenue });
  }

  const byCountry = {};
  for (const c in rowsByCountry) {
    const countryRows = rowsByCountry[c].sort((a, b) => a.date - b.date);
    const firstEffective = countryRows.find(row => row.downloads > 0 || row.revenue > 0)?.date;
    if (!firstEffective) continue;

    byCountry[c] = countryYearRanges(firstEffective).map(r => ({
      ...r, downloads: 0, revenue: 0, months: 0
    }));

    for (const row of countryRows) {
      const yi = Math.floor(monthDiff(firstEffective, row.date) / 12);
      if (yi < 0 || yi > 2) continue;
      byCountry[c][yi].downloads += row.downloads;
      byCountry[c][yi].revenue += row.revenue;
      byCountry[c][yi].months += 1;
    }
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

  return { yearRanges: countryYearRanges(release), byCountry };
}

async function fetchComp(name) {
  try {
    const app = await searchApp(name);
    if (!app) return { inputName: name, found: false };

    const appId       = appIdOf(app);
    const releaseDate = releaseDateOf(app);
    const catNames    = categoryNamesOf(app);
    if (!appId) return { inputName: name, found: false, error: 'Sensor Tower search result missing app id' };

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
      name:        appNameOf(app, name),
      publisher:   publisherNameOf(app),
      iconUrl:     app.icon_url || app.icon || '',
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
  if (!CLAUDE_KEY) throw new Error('Claude API key missing. Set CLAUDE_API_KEY in .env.');
  let res;
  try {
    res = await fetch(`${CLAUDE_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${CLAUDE_KEY}` },
      body: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: 2000,
        messages: [{ role:'user', content:prompt }],
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new Error(describeFetchError('Claude', e));
  }
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content || '';
}

// ── Routes ───────────────────────────────────────────────────
function normalizeGameNames(body) {
  const raw = Array.isArray(body?.names) ? body.names : (Array.isArray(body?.comps) ? body.comps : []);
  return raw
    .map(item => typeof item === 'string' ? item : item?.name)
    .map(name => String(name || '').trim())
    .filter(Boolean);
}

async function fetchGameNames(names, delayMs = 400) {
  const results = [];
  for (const name of names) {
    console.log('[fetch-games]', name);
    results.push(await fetchComp(name));
    if (delayMs > 0) await new Promise(x => setTimeout(x, delayMs));
  }
  return results;
}

app.get('/api/health', (_, res) => res.json({
  ok: true,
  sensorTowerConfigured: Boolean(ST_TOKEN),
  claudeConfigured: Boolean(CLAUDE_KEY),
}));

app.post('/api/analyze', async (req, res) => {
  const description = String(req.body?.description || '').trim();
  if (!description) return res.status(400).json({ ok:false, error:'description required' });

  let stContext = '', stAppFound = null;
  try {
    const app = await searchApp(description);
    if (app) {
      stAppFound = app;
      const cats = categoryNamesOf(app).join(', ');
      stContext = `\nST: App="${appNameOf(app)}" Publisher="${publisherNameOf(app)}" Categories="${cats}" Released="${releaseDateOf(app)}"`;
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
      name:       appNameOf(stAppFound),
      publisher:  publisherNameOf(stAppFound),
      releaseDate:releaseDateOf(stAppFound),
      categories: categoryNamesOf(stAppFound),
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
  const names = normalizeGameNames(req.body);
  if (!names.length) return res.status(400).json({ ok:false, error:'names or comps required' });
  const results = await fetchGameNames(names);
  res.json({ ok:true, results });
});

app.post('/api/sensor-tower/games', async (req, res) => {
  const names = normalizeGameNames(req.body);
  if (!names.length) return res.status(400).json({ ok:false, error:'names required' });
  try {
    const delayMs = Number.isFinite(Number(req.body?.delayMs)) ? Math.max(0, Number(req.body.delayMs)) : 400;
    const results = await fetchGameNames(names, delayMs);
    res.json({ ok:true, results });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/save-estimate', (req, res) => {
  const html = String(req.body?.html || '');
  const requestedName = String(req.body?.filename || 'estimate.html');
  if (!html.trim()) return res.status(400).json({ ok:false, error:'html required' });
  const safeName = requestedName
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'estimate.html';
  const filename = safeName.toLowerCase().endsWith('.html') ? safeName : `${safeName}.html`;
  const dir = path.join(__dirname, 'public', 'estimates');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), html, 'utf8');
  res.json({ ok:true, filename, url:`/estimates/${filename}` });
});

app.get(['/mobile-legends.html', '/brawl-stars.html'], (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
