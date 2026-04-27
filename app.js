const STORAGE_KEY = "projection-desk-draft-v1";

const LIFE_CYCLE_PROFILES = {
  gacha_ip: { label: "IP 抽卡", year2Download: 0.58, year3Download: 0.37, year2Rpd: 0.94, year3Rpd: 0.86 },
  shooter_liveops: { label: "长线射击", year2Download: 0.72, year3Download: 0.55, year2Rpd: 0.96, year3Rpd: 0.91 },
  casual_hybrid: { label: "轻中度混变", year2Download: 0.61, year3Download: 0.43, year2Rpd: 0.9, year3Rpd: 0.82 },
  roguelite_midcore: { label: "中核肉鸽", year2Download: 0.5, year3Download: 0.31, year2Rpd: 0.9, year3Rpd: 0.8 },
  premium_indie: { label: "买断独游", year2Download: 0.34, year3Download: 0.2, year2Rpd: 0.96, year3Rpd: 0.88 }
};

const UI = {
  productName: document.getElementById("productName"),
  backgroundInput: document.getElementById("backgroundInput"),
  marketOverride: document.getElementById("marketOverride"),
  monetizationOverride: document.getElementById("monetizationOverride"),
  lifecycleOverride: document.getElementById("lifecycleOverride"),
  analyzeButton: document.getElementById("analyzeButton"),
  resetButton: document.getElementById("resetButton"),
  exportButton: document.getElementById("exportButton"),
  analysisSummary: document.getElementById("analysisSummary"),
  resultCards: document.getElementById("resultCards"),
  explanation: document.getElementById("explanation"),
  lifecycleEditor: document.getElementById("lifecycleEditor"),
  downloadTableWrap: document.getElementById("downloadTableWrap"),
  monetizationTableWrap: document.getElementById("monetizationTableWrap"),
  catalogTableWrap: document.getElementById("catalogTableWrap")
};

const KEYWORD_MAP = {
  markets: [
    { value: "US", keywords: ["美国", "us", "north america", "na"] },
    { value: "SEA", keywords: ["东南亚", "sea", "id", "th", "sg", "my", "ph", "vn"] },
    { value: "LATAM", keywords: ["拉美", "latin america", "latam", "br", "brazil"] },
    { value: "WW", keywords: ["全球", "global", "worldwide", "ww"] }
  ],
  gameplay: [
    { tag: "sports", keywords: ["体育", "sports", "足球", "soccer", "football", "排球", "volleyball", "赛马", "horse"] },
    { tag: "training", keywords: ["养成", "training", "培养", "育成"] },
    { tag: "collector", keywords: ["角色收集", "collector", "collect", "角色养成", "收集"] },
    { tag: "gacha", keywords: ["抽卡", "gacha", "卡池"] },
    { tag: "rpg", keywords: ["rpg", "角色扮演"] },
    { tag: "card-battle", keywords: ["卡牌", "deck", "card battle"] },
    { tag: "music", keywords: ["音游", "music", "rhythm", "节奏"] },
    { tag: "shooter", keywords: ["射击", "shooter", "枪战", "fps"] },
    { tag: "battle-royale", keywords: ["战术竞技", "battle royale", "br", "吃鸡"] },
    { tag: "pvp", keywords: ["pvp", "对战", "竞技"] },
    { tag: "spinner", keywords: ["转盘", "spinner", "spin", "老虎机", "slot"] },
    { tag: "board", keywords: ["board", "棋盘", "大富翁", "建造"] },
    { tag: "social", keywords: ["社交", "guild", "raid", "掠夺"] },
    { tag: "roguelite", keywords: ["roguelite", "roguelike", "肉鸽", "幸存者"] },
    { tag: "survivor", keywords: ["survivor", "幸存者"] },
    { tag: "action", keywords: ["action", "动作"] }
  ],
  themes: [
    { tag: "anime", keywords: ["二次元", "anime", "动画", "动漫"] },
    { tag: "existing-ip", keywords: ["ip", "授权", "漫改", "动画改编", "正版", "联动"] },
    { tag: "military", keywords: ["军事", "军武", "modern warfare", "特种兵"] },
    { tag: "horse-racing", keywords: ["赛马", "horse"] },
    { tag: "football", keywords: ["足球", "soccer", "football"] },
    { tag: "volleyball", keywords: ["排球", "volleyball"] },
    { tag: "idol", keywords: ["偶像", "idol"] },
    { tag: "coin", keywords: ["coin", "金币", "老虎机"] },
    { tag: "retro", keywords: ["retro", "复古", "像素"] },
    { tag: "indie", keywords: ["indie", "独立游戏", "买断独游"] }
  ],
  monetization: [
    { value: "gacha_iap", keywords: ["抽卡", "gacha", "卡池", "月卡", "通行证", "礼包"] },
    { value: "cosmetic_iap", keywords: ["皮肤", "赛季", "cosmetic", "battle pass"] },
    { value: "hybrid_iap_ads", keywords: ["广告", "激励视频", "插屏", "混合变现", "hybrid"] },
    { value: "premium", keywords: ["买断", "premium", "付费下载", "一次付费"] }
  ],
  audience: [
    { value: "casual", keywords: ["休闲", "casual", "轻度"] },
    { value: "midcore", keywords: ["中核", "midcore", "深度养成", "长线运营"] }
  ]
};

const CATALOG = window.REFERENCE_CATALOG.map((item) => {
  const annualizedDownloads = item.observedDownloads * (12 / item.observedMonths);
  const annualizedRevenue = item.observedRevenue * (12 / item.observedMonths);
  const rpd = annualizedDownloads > 0 ? annualizedRevenue / annualizedDownloads : 0;
  return { ...item, annualizedDownloads, annualizedRevenue, rpd };
});

const SERIES_KEYWORDS = CATALOG.flatMap((item) => {
  const keys = new Set([item.name.toLowerCase(), ...(item.aliases || []).map((value) => value.toLowerCase())]);
  return Array.from(keys).map((keyword) => ({ series: item.series, keyword }));
});

const STATE = {
  targetName: "",
  background: "",
  overrides: { market: "auto", monetization: "auto", lifecycle: "auto" },
  analysis: null,
  lifecycle: null,
  overlap: { conservative: 0.16, optimistic: 0.08 },
  downloadRefs: [],
  monetizationRefs: [],
  result: null
};

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatInt(value) {
  return Math.round(value || 0).toLocaleString("en-US");
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "$0";
  if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatRpd(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function describeMonetization(value) {
  switch (value) {
    case "gacha_iap": return "抽卡 IAP";
    case "cosmetic_iap": return "皮肤 / 赛季 IAP";
    case "hybrid_iap_ads": return "混合变现";
    case "premium": return "买断";
    default: return value;
  }
}

function describeMarket(value) {
  return ["US", "SEA", "LATAM", "WW"].includes(value) ? value : value;
}

function collectMatches(text, rules, fieldName) {
  const result = new Set();
  rules.forEach((rule) => {
    if (rule.keywords.some((keyword) => text.includes(keyword))) result.add(rule[fieldName]);
  });
  return Array.from(result);
}

function pickFirstMatch(text, rules, fieldName, fallback) {
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) return rule[fieldName];
  }
  return fallback;
}

function detectSeries(text) {
  const match = SERIES_KEYWORDS.find((entry) => text.includes(entry.keyword));
  return match ? match.series : null;
}

function inferLifecycle(gameplayTags, monetization, existingIp) {
  if (monetization === "premium") return "premium_indie";
  if (gameplayTags.includes("battle-royale") || gameplayTags.includes("fps")) return "shooter_liveops";
  if (monetization === "hybrid_iap_ads" && gameplayTags.includes("spinner")) return "casual_hybrid";
  if (gameplayTags.includes("roguelite") || gameplayTags.includes("survivor")) return "roguelite_midcore";
  if (monetization === "gacha_iap" || existingIp) return "gacha_ip";
  return "casual_hybrid";
}

function overlapCount(left, right) {
  return left.filter((item) => right.includes(item)).length;
}

function analyzeBrief() {
  const targetName = UI.productName.value.trim() || "未命名项目";
  const background = UI.backgroundInput.value.trim();
  const text = normalizeText(`${targetName} ${background}`);
  const gameplayTags = collectMatches(text, KEYWORD_MAP.gameplay, "tag");
  const themeTags = collectMatches(text, KEYWORD_MAP.themes, "tag");
  const market = UI.marketOverride.value !== "auto" ? UI.marketOverride.value : pickFirstMatch(text, KEYWORD_MAP.markets, "value", "WW");
  const monetization = UI.monetizationOverride.value !== "auto"
    ? UI.monetizationOverride.value
    : pickFirstMatch(text, KEYWORD_MAP.monetization, "value", gameplayTags.includes("gacha") ? "gacha_iap" : "hybrid_iap_ads");
  const audience = pickFirstMatch(text, KEYWORD_MAP.audience, "value", gameplayTags.includes("spinner") ? "casual" : "midcore");
  const series = detectSeries(text);
  const existingIp = themeTags.includes("existing-ip") || Boolean(series);
  const lifecycle = UI.lifecycleOverride.value !== "auto" ? UI.lifecycleOverride.value : inferLifecycle(gameplayTags, monetization, existingIp);
  const signalCount = gameplayTags.length + themeTags.length + (series ? 2 : 0);
  const confidence = signalCount >= 4 ? "high" : signalCount >= 2 ? "medium" : "low";
  const digest = [];
  if (existingIp && series) digest.push(`识别到明确 IP：${series}`);
  else if (existingIp) digest.push("识别到这是一个依赖现成 IP 拉新的产品");
  else digest.push("没有识别到明确 IP，默认按玩法和题材找参考产品");
  digest.push(`目标市场默认按 ${market} 口径`);
  digest.push(`商业化默认按 ${describeMonetization(monetization)}`);
  digest.push(`生命周期默认按 ${LIFE_CYCLE_PROFILES[lifecycle].label}`);
  if (confidence === "low") {
    digest.push("当前描述命中的标签比较少，匹配可信度偏低");
  }
  return { targetName, background, gameplayTags, themeTags, market, monetization, audience, series, existingIp, lifecycle, digest, confidence };
}

function scoreDownloadReference(product, analysis) {
  if (product.annualizedDownloads <= 0) return null;
  let score = 0;
  const evidence = [];
  const gameplayHit = overlapCount(product.gameplayTags, analysis.gameplayTags);
  const themeHit = overlapCount(product.themeTags, analysis.themeTags);
  const exactSeries = Boolean(analysis.series && product.series === analysis.series);
  const hasCoreSignal = exactSeries || gameplayHit > 0 || themeHit > 0;
  if (!hasCoreSignal) return null;
  if (exactSeries) {
    score += 78;
    evidence.push("同 IP");
  } else if (analysis.existingIp && product.themeTags.includes("existing-ip")) {
    score += 16;
    evidence.push("同样依赖 IP 拉新");
  }
  if (gameplayHit > 0) {
    score += gameplayHit * 18;
    evidence.push(`玩法重合 ${gameplayHit}`);
  }
  if (themeHit > 0) {
    score += themeHit * 9;
    evidence.push(`题材重合 ${themeHit}`);
  }
  if (product.monetization === analysis.monetization) {
    score += 8;
    evidence.push("商业化兼容");
  }
  if (product.audience === analysis.audience) {
    score += 6;
    evidence.push("目标受众接近");
  }
  if (analysis.market !== "WW" && product.market === analysis.market) {
    score += 12;
    evidence.push(`市场口径 ${product.market}`);
  } else if (analysis.market !== "WW" && analysis.market !== "auto") {
    score -= 4;
  }
  if (score <= 0) return null;

  const relation = exactSeries ? "同 IP" : gameplayHit >= 2 ? "核心玩法" : gameplayHit >= 1 ? "玩法近似" : themeHit >= 1 ? "题材近似" : "宽口径";
  const factor = clamp(0.8, score / 60, 1.25);
  let conservative = 0.015;
  let optimistic = 0.04;
  if (exactSeries) {
    conservative = 0.18;
    optimistic = 0.34;
  } else if (analysis.existingIp && product.themeTags.includes("existing-ip") && gameplayHit >= 1) {
    conservative = 0.08;
    optimistic = 0.18;
  } else if (gameplayHit >= 2) {
    conservative = 0.05;
    optimistic = 0.11;
  } else if (gameplayHit >= 1) {
    conservative = 0.03;
    optimistic = 0.07;
  } else if (themeHit >= 1) {
    conservative = 0.018;
    optimistic = 0.045;
  }
  return {
    id: product.id,
    name: product.name,
    market: product.market,
    annualizedDownloads: product.annualizedDownloads,
    evidence,
    relation,
    sourceFile: product.sourceFile,
    score,
    conservative: round(clamp(0.005, conservative * factor, 0.4), 3),
    optimistic: round(clamp(0.01, optimistic * factor, 0.55), 3)
  };
}

function scoreMonetizationReference(product, analysis) {
  if (product.rpd <= 0) return null;
  let score = 0;
  const evidence = [];
  const gameplayHit = overlapCount(product.gameplayTags, analysis.gameplayTags);
  const themeHit = overlapCount(product.themeTags, analysis.themeTags);
  const exactSeries = Boolean(analysis.series && product.series === analysis.series);
  const hasCoreSignal = exactSeries || gameplayHit > 0 || themeHit > 0 || product.monetization === analysis.monetization;
  if (!hasCoreSignal) return null;
  if (product.monetization === analysis.monetization) {
    score += 46;
    evidence.push("商业化完全一致");
  } else if (analysis.monetization === "gacha_iap" && product.monetization === "cosmetic_iap") {
    score += 10;
    evidence.push("同为 IAP 驱动");
  } else if (analysis.monetization === "hybrid_iap_ads" && product.monetization === "premium") {
    score -= 12;
  }
  if (gameplayHit > 0) {
    score += gameplayHit * 10;
    evidence.push(`玩法重合 ${gameplayHit}`);
  }
  if (themeHit > 0) {
    score += themeHit * 6;
    evidence.push(`题材重合 ${themeHit}`);
  }
  if (product.audience === analysis.audience) {
    score += 8;
    evidence.push("受众接近");
  }
  if (exactSeries) {
    score += 10;
    evidence.push("同 IP 付费心智");
  }
  if (analysis.market !== "WW" && product.market === analysis.market) {
    score += 6;
    evidence.push(`市场口径 ${product.market}`);
  }
  if (score <= 0) return null;
  const weight = score >= 70 ? 1.35 : score >= 55 ? 1.05 : score >= 35 ? 0.8 : 0.55;
  return {
    id: product.id,
    name: product.name,
    market: product.market,
    annualizedRevenue: product.annualizedRevenue,
    annualizedDownloads: product.annualizedDownloads,
    rpd: product.rpd,
    evidence,
    sourceFile: product.sourceFile,
    score,
    weight: round(weight, 2)
  };
}

function buildReferencePools(analysis) {
  const minDownloadScore = analysis.confidence === "low" ? 22 : 12;
  const minMonetizationScore = analysis.confidence === "low" ? 28 : 16;
  const downloads = CATALOG
    .map((item) => scoreDownloadReference(item, analysis))
    .filter((item) => item && item.score >= minDownloadScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const monetization = CATALOG
    .map((item) => scoreMonetizationReference(item, analysis))
    .filter((item) => item && item.score >= minMonetizationScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  return { downloads, monetization };
}

function buildLifecycle(analysis) {
  const preset = LIFE_CYCLE_PROFILES[analysis.lifecycle];
  return { profile: analysis.lifecycle, year2Download: preset.year2Download, year3Download: preset.year3Download, year2Rpd: preset.year2Rpd, year3Rpd: preset.year3Rpd };
}

function inferOverlap(downloadRefs) {
  const hasExactIp = downloadRefs.some((item) => item.relation === "同 IP");
  const base = hasExactIp ? 0.18 : 0.14;
  const extra = Math.max(0, downloadRefs.length - 2) * 0.02;
  return { conservative: round(clamp(0.05, base + extra, 0.32), 3), optimistic: round(clamp(0.03, (base + extra) * 0.52, 0.18), 3) };
}

function weightedRpd() {
  const totalWeight = STATE.monetizationRefs.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  if (totalWeight <= 0) return 0;
  const total = STATE.monetizationRefs.reduce((sum, item) => sum + item.rpd * Number(item.weight || 0), 0);
  return total / totalWeight;
}

function computeScenario(captureKey, overlapKey, sharedRpd) {
  const grossDownloads = STATE.downloadRefs.reduce((sum, item) => sum + item.annualizedDownloads * Number(item[captureKey] || 0), 0);
  const year1Downloads = grossDownloads * (1 - Number(STATE.overlap[overlapKey] || 0));
  const year2Downloads = year1Downloads * Number(STATE.lifecycle.year2Download || 0);
  const year3Downloads = year1Downloads * Number(STATE.lifecycle.year3Download || 0);
  const year1Revenue = year1Downloads * sharedRpd;
  const year2Revenue = year2Downloads * sharedRpd * Number(STATE.lifecycle.year2Rpd || 0);
  const year3Revenue = year3Downloads * sharedRpd * Number(STATE.lifecycle.year3Rpd || 0);
  return { grossDownloads, year1Downloads, year2Downloads, year3Downloads, year1Revenue, year2Revenue, year3Revenue, totalRevenue: year1Revenue + year2Revenue + year3Revenue };
}

function computeResult() {
  const sharedRpd = weightedRpd();
  STATE.result = {
    sharedRpd,
    conservative: computeScenario("conservative", "conservative", sharedRpd),
    optimistic: computeScenario("optimistic", "optimistic", sharedRpd)
  };
}

function renderAnalysis() {
  if (!STATE.analysis) {
    UI.analysisSummary.innerHTML = '<div class="empty-state">先输入一句产品背景，再开始预估。</div>';
    return;
  }
  const analysis = STATE.analysis;
  const tags = [
    ...analysis.gameplayTags.map((tag) => ({ label: tag, strong: true })),
    ...analysis.themeTags.map((tag) => ({ label: tag, strong: false }))
  ];
  UI.analysisSummary.innerHTML = `
    <p>${escapeHtml(analysis.digest.join("；"))}。</p>
    <div class="tag-row">
      <span class="tag strong">${escapeHtml(describeMarket(analysis.market))}</span>
      <span class="tag strong">${escapeHtml(describeMonetization(analysis.monetization))}</span>
      <span class="tag strong">${escapeHtml(LIFE_CYCLE_PROFILES[analysis.lifecycle].label)}</span>
      <span class="tag ${analysis.confidence === "low" ? "" : "strong"}">匹配置信度 ${escapeHtml(analysis.confidence)}</span>
      ${tags.map((item) => `<span class="tag ${item.strong ? "strong" : ""}">${escapeHtml(item.label)}</span>`).join("")}
    </div>
    <div class="status-callout">当前版本是本地样本库规则匹配，不是联网全网搜索。只有命中本地样本标签，参考产品才会切换。</div>
  `;
}

function renderResults() {
  if (!STATE.result) {
    UI.resultCards.innerHTML = '<div class="empty-state">暂无结果。</div>';
    UI.explanation.innerHTML = "";
    return;
  }
  const { conservative, optimistic, sharedRpd } = STATE.result;
  UI.resultCards.innerHTML = `
    <article class="result-card">
      <span class="k">首年收入 / 保守</span>
      <span class="v">${formatMoney(conservative.year1Revenue)}</span>
      <span class="hint">首年下载 ${formatInt(conservative.year1Downloads)} · RPD ${formatRpd(sharedRpd)}</span>
    </article>
    <article class="result-card">
      <span class="k">首年收入 / 乐观</span>
      <span class="v">${formatMoney(optimistic.year1Revenue)}</span>
      <span class="hint">首年下载 ${formatInt(optimistic.year1Downloads)} · RPD ${formatRpd(sharedRpd)}</span>
    </article>
    <article class="result-card">
      <span class="k">前三年收入 / 保守</span>
      <span class="v">${formatMoney(conservative.totalRevenue)}</span>
      <span class="hint">Y2 ${formatMoney(conservative.year2Revenue)} · Y3 ${formatMoney(conservative.year3Revenue)}</span>
    </article>
    <article class="result-card">
      <span class="k">前三年收入 / 乐观</span>
      <span class="v">${formatMoney(optimistic.totalRevenue)}</span>
      <span class="hint">Y2 ${formatMoney(optimistic.year2Revenue)} · Y3 ${formatMoney(optimistic.year3Revenue)}</span>
    </article>
  `;
  UI.explanation.innerHTML = `
    <p><span class="metric-kicker">How it was built</span></p>
    <p>下载侧先取 ${STATE.downloadRefs.length} 个参考产品的年化下载，再乘每个产品的捕获率。保守版用 ${formatPct(STATE.overlap.conservative)} 的重叠扣减，乐观版用 ${formatPct(STATE.overlap.optimistic)}。</p>
    <p>变现侧共用一套 RPD 参考池，当前加权 RPD 为 <strong>${formatRpd(sharedRpd)}</strong>。这意味着保守版和乐观版的差异，主要来自下载捕获率，而不是 RPD。</p>
  `;
}

function lifecycleSafe(value) {
  return Number(value || 0).toFixed(2);
}

function renderLifecycleEditor() {
  if (!STATE.lifecycle) {
    UI.lifecycleEditor.innerHTML = '<div class="empty-state">暂无生命周期参数。</div>';
    return;
  }
  UI.lifecycleEditor.innerHTML = `
    <div class="mini-field"><label>重叠扣减 / 保守</label><input class="cell-input" id="overlap-conservative" type="number" min="0" max="0.8" step="0.01" value="${lifecycleSafe(STATE.overlap.conservative)}" /></div>
    <div class="mini-field"><label>重叠扣减 / 乐观</label><input class="cell-input" id="overlap-optimistic" type="number" min="0" max="0.8" step="0.01" value="${lifecycleSafe(STATE.overlap.optimistic)}" /></div>
    <div class="mini-field"><label>第二年下载系数</label><input class="cell-input" id="year2Download" type="number" min="0" max="1.4" step="0.01" value="${lifecycleSafe(STATE.lifecycle.year2Download)}" /></div>
    <div class="mini-field"><label>第三年下载系数</label><input class="cell-input" id="year3Download" type="number" min="0" max="1.4" step="0.01" value="${lifecycleSafe(STATE.lifecycle.year3Download)}" /></div>
    <div class="mini-field"><label>第二年 RPD 系数</label><input class="cell-input" id="year2Rpd" type="number" min="0" max="1.4" step="0.01" value="${lifecycleSafe(STATE.lifecycle.year2Rpd)}" /></div>
    <div class="mini-field"><label>第三年 RPD 系数</label><input class="cell-input" id="year3Rpd" type="number" min="0" max="1.4" step="0.01" value="${lifecycleSafe(STATE.lifecycle.year3Rpd)}" /></div>
  `;
  ["overlap-conservative", "overlap-optimistic", "year2Download", "year3Download", "year2Rpd", "year3Rpd"].forEach((id) => {
    document.getElementById(id).addEventListener("input", handleLifecycleChange);
  });
}

function renderDownloadTable() {
  if (STATE.downloadRefs.length === 0) {
    UI.downloadTableWrap.innerHTML = '<div class="empty-state">当前描述没有命中足够强的“下载相似性”信号，所以我没有硬塞默认竞品。把玩法、IP、题材、市场写得更具体一点，再试一次。</div>';
    return;
  }
  const rows = STATE.downloadRefs.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><div class="muted-inline">${escapeHtml(item.relation)} · ${escapeHtml(item.market)}</div></td>
      <td><div class="evidence-list">${item.evidence.map((tag) => `<span class="evidence-chip">${escapeHtml(tag)}</span>`).join("")}</div></td>
      <td>${item.score}</td>
      <td>${formatInt(item.annualizedDownloads)}</td>
      <td><input class="cell-input download-input" data-id="${item.id}" data-key="conservative" type="number" min="0" max="0.8" step="0.01" value="${Number(item.conservative).toFixed(2)}" /></td>
      <td><input class="cell-input download-input" data-id="${item.id}" data-key="optimistic" type="number" min="0" max="0.8" step="0.01" value="${Number(item.optimistic).toFixed(2)}" /></td>
      <td>${formatInt(item.annualizedDownloads * Number(item.conservative || 0))}</td>
      <td>${formatInt(item.annualizedDownloads * Number(item.optimistic || 0))}</td>
      <td><a href="${encodeURI(item.sourceFile)}" target="_blank" rel="noreferrer">来源</a></td>
    </tr>
  `).join("");
  UI.downloadTableWrap.innerHTML = `<div class="table-wrap"><table><thead><tr><th>参考产品</th><th>为何入池</th><th>匹配分</th><th>年化下载</th><th>捕获率 / 保守</th><th>捕获率 / 乐观</th><th>下载贡献 / 保守</th><th>下载贡献 / 乐观</th><th>来源</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.querySelectorAll(".download-input").forEach((input) => input.addEventListener("input", handleDownloadInputChange));
}

function renderMonetizationTable() {
  if (STATE.monetizationRefs.length === 0) {
    UI.monetizationTableWrap.innerHTML = '<div class="empty-state">当前描述没有命中足够强的“变现相似性”信号，所以我没有硬塞默认 RPD 样本。把商业化模式写清楚，例如抽卡、买断、广告、通行证。</div>';
    return;
  }
  const rows = STATE.monetizationRefs.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><div class="muted-inline">${escapeHtml(item.market)}</div></td>
      <td><div class="evidence-list">${item.evidence.map((tag) => `<span class="evidence-chip">${escapeHtml(tag)}</span>`).join("")}</div></td>
      <td>${item.score}</td>
      <td>${formatMoney(item.annualizedRevenue)}</td>
      <td>${formatInt(item.annualizedDownloads)}</td>
      <td>${formatRpd(item.rpd)}</td>
      <td><input class="cell-input monetization-input" data-id="${item.id}" type="number" min="0" max="3" step="0.05" value="${Number(item.weight).toFixed(2)}" /></td>
      <td><a href="${encodeURI(item.sourceFile)}" target="_blank" rel="noreferrer">来源</a></td>
    </tr>
  `).join("");
  UI.monetizationTableWrap.innerHTML = `<div class="table-wrap"><table><thead><tr><th>参考产品</th><th>为何入池</th><th>匹配分</th><th>年化收入</th><th>年化下载</th><th>RPD</th><th>权重</th><th>来源</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.querySelectorAll(".monetization-input").forEach((input) => input.addEventListener("input", handleMonetizationInputChange));
}

function renderCatalog() {
  const rows = CATALOG.sort((a, b) => b.annualizedRevenue - a.annualizedRevenue).map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><div class="muted-inline">${escapeHtml(item.market)} · ${escapeHtml(item.lifecycle)}</div></td>
      <td>${item.observedMonths} 个月</td>
      <td>${formatInt(item.observedDownloads)}</td>
      <td>${formatMoney(item.observedRevenue)}</td>
      <td>${formatInt(item.annualizedDownloads)}</td>
      <td>${formatMoney(item.annualizedRevenue)}</td>
      <td>${formatRpd(item.rpd)}</td>
      <td>${escapeHtml(describeMonetization(item.monetization))}</td>
      <td>${escapeHtml(item.gameplayTags.join(" / "))}</td>
      <td><a href="${encodeURI(item.sourceFile)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceLabel)}</a></td>
    </tr>
  `).join("");
  UI.catalogTableWrap.innerHTML = `<div class="table-wrap"><table><thead><tr><th>产品</th><th>观测窗口</th><th>观测下载</th><th>观测收入</th><th>年化下载</th><th>年化收入</th><th>RPD</th><th>商业化</th><th>玩法标签</th><th>样本来源</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function syncStateFromInputs() {
  STATE.targetName = UI.productName.value.trim();
  STATE.background = UI.backgroundInput.value.trim();
  STATE.overrides.market = UI.marketOverride.value;
  STATE.overrides.monetization = UI.monetizationOverride.value;
  STATE.overrides.lifecycle = UI.lifecycleOverride.value;
}

function saveDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    targetName: STATE.targetName,
    background: STATE.background,
    overrides: STATE.overrides,
    analysis: STATE.analysis,
    lifecycle: STATE.lifecycle,
    overlap: STATE.overlap,
    downloadRefs: STATE.downloadRefs,
    monetizationRefs: STATE.monetizationRefs
  }));
}

function syncAndRender() {
  computeResult();
  renderResults();
  renderDownloadTable();
  renderMonetizationTable();
  saveDraft();
}

function runEstimation(useExistingEdits = false) {
  syncStateFromInputs();
  STATE.analysis = analyzeBrief();
  if (!useExistingEdits) {
    const pools = buildReferencePools(STATE.analysis);
    STATE.downloadRefs = pools.downloads;
    STATE.monetizationRefs = pools.monetization;
    STATE.lifecycle = buildLifecycle(STATE.analysis);
    STATE.overlap = inferOverlap(STATE.downloadRefs);
  }
  renderAnalysis();
  renderLifecycleEditor();
  syncAndRender();
}

function resetRecommendedCoefficients() {
  if (!STATE.analysis) return;
  const pools = buildReferencePools(STATE.analysis);
  STATE.downloadRefs = pools.downloads;
  STATE.monetizationRefs = pools.monetization;
  STATE.lifecycle = buildLifecycle(STATE.analysis);
  STATE.overlap = inferOverlap(STATE.downloadRefs);
  renderLifecycleEditor();
  syncAndRender();
}

function handleDownloadInputChange(event) {
  const item = STATE.downloadRefs.find((entry) => entry.id === event.target.dataset.id);
  if (!item) return;
  item[event.target.dataset.key] = clamp(0, Number(event.target.value || 0), 0.8);
  syncAndRender();
}

function handleMonetizationInputChange(event) {
  const item = STATE.monetizationRefs.find((entry) => entry.id === event.target.dataset.id);
  if (!item) return;
  item.weight = clamp(0, Number(event.target.value || 0), 3);
  syncAndRender();
}

function handleLifecycleChange() {
  STATE.overlap.conservative = clamp(0, Number(document.getElementById("overlap-conservative").value || 0), 0.8);
  STATE.overlap.optimistic = clamp(0, Number(document.getElementById("overlap-optimistic").value || 0), 0.8);
  STATE.lifecycle.year2Download = clamp(0, Number(document.getElementById("year2Download").value || 0), 1.4);
  STATE.lifecycle.year3Download = clamp(0, Number(document.getElementById("year3Download").value || 0), 1.4);
  STATE.lifecycle.year2Rpd = clamp(0, Number(document.getElementById("year2Rpd").value || 0), 1.4);
  STATE.lifecycle.year3Rpd = clamp(0, Number(document.getElementById("year3Rpd").value || 0), 1.4);
  syncAndRender();
}

function buildSnapshotHtml() {
  const time = new Date();
  const { conservative, optimistic } = STATE.result;
  const analysis = STATE.analysis;
  const stateJson = escapeHtml(JSON.stringify({
    targetName: analysis.targetName,
    background: analysis.background,
    market: analysis.market,
    monetization: analysis.monetization,
    lifecycle: analysis.lifecycle,
    overlap: STATE.overlap,
    lifecycleInputs: STATE.lifecycle,
    sharedRpd: STATE.result.sharedRpd,
    conservative,
    optimistic,
    downloadRefs: STATE.downloadRefs,
    monetizationRefs: STATE.monetizationRefs
  }, null, 2));
  const dlRows = STATE.downloadRefs.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.relation)}</td><td>${formatInt(item.annualizedDownloads)}</td><td>${formatPct(item.conservative)}</td><td>${formatPct(item.optimistic)}</td></tr>`).join("");
  const rpdRows = STATE.monetizationRefs.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatMoney(item.annualizedRevenue)}</td><td>${formatInt(item.annualizedDownloads)}</td><td>${formatRpd(item.rpd)}</td><td>${Number(item.weight).toFixed(2)}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${escapeHtml(analysis.targetName)} - Projection Snapshot</title><style>body{margin:0;padding:28px;font-family:Georgia,"Times New Roman",serif;background:#14161b;color:#f3efe4}.wrap{max-width:1180px;margin:0 auto}h1,h2{margin:0 0 12px}h1{font-size:38px;line-height:1}h2{font-size:22px;color:#f6c77a}p{color:#d8d2c5;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0 24px}.card{background:#1d2128;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px}.k{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9eaa9d}.v{display:block;margin-top:10px;font-size:30px}table{width:100%;border-collapse:collapse;background:#1d2128;border-radius:18px;overflow:hidden}th,td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;font-size:13px}th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9eaa9d;background:#20252e}.block{margin-top:22px}pre{white-space:pre-wrap;background:#111318;padding:14px;border-radius:14px;color:#b5c0b5}@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}}@media (max-width:640px){.grid{grid-template-columns:1fr}}</style></head><body><div class="wrap"><p>${escapeHtml(time.toLocaleString())}</p><h1>${escapeHtml(analysis.targetName)}</h1><p>${escapeHtml(analysis.background)}</p><div class="grid"><div class="card"><span class="k">首年收入 / 保守</span><span class="v">${formatMoney(conservative.year1Revenue)}</span></div><div class="card"><span class="k">首年收入 / 乐观</span><span class="v">${formatMoney(optimistic.year1Revenue)}</span></div><div class="card"><span class="k">前三年收入 / 保守</span><span class="v">${formatMoney(conservative.totalRevenue)}</span></div><div class="card"><span class="k">前三年收入 / 乐观</span><span class="v">${formatMoney(optimistic.totalRevenue)}</span></div></div><div class="block"><h2>下载参考池</h2><table><thead><tr><th>产品</th><th>关系</th><th>年化下载</th><th>保守</th><th>乐观</th></tr></thead><tbody>${dlRows}</tbody></table></div><div class="block"><h2>变现参考池</h2><table><thead><tr><th>产品</th><th>年化收入</th><th>年化下载</th><th>RPD</th><th>权重</th></tr></thead><tbody>${rpdRows}</tbody></table></div><div class="block"><h2>状态 JSON</h2><pre>${stateJson}</pre></div></div></body></html>`;
}

function exportSnapshot() {
  if (!STATE.result || !STATE.analysis) return;
  const html = buildSnapshotHtml();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const name = (STATE.analysis.targetName || "projection").replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}-${stamp}.html`;
  anchor.click();
  URL.revokeObjectURL(url);
}

let autoAnalyzeTimer = null;

function scheduleAutoAnalyze() {
  clearTimeout(autoAnalyzeTimer);
  autoAnalyzeTimer = setTimeout(() => {
    if (!UI.backgroundInput.value.trim() && !UI.productName.value.trim()) return;
    runEstimation(false);
  }, 350);
}

function loadDraft() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw);
    UI.productName.value = draft.targetName || "";
    UI.backgroundInput.value = draft.background || "";
    UI.marketOverride.value = draft.overrides?.market || "auto";
    UI.monetizationOverride.value = draft.overrides?.monetization || "auto";
    UI.lifecycleOverride.value = draft.overrides?.lifecycle || "auto";
    STATE.targetName = draft.targetName || "";
    STATE.background = draft.background || "";
    STATE.overrides = draft.overrides || STATE.overrides;
    STATE.analysis = draft.analysis || null;
    STATE.lifecycle = draft.lifecycle || null;
    STATE.overlap = draft.overlap || STATE.overlap;
    STATE.downloadRefs = draft.downloadRefs || [];
    STATE.monetizationRefs = draft.monetizationRefs || [];
    if (STATE.analysis && STATE.lifecycle) {
      renderAnalysis();
      renderLifecycleEditor();
      syncAndRender();
      return true;
    }
  } catch (error) {
    console.warn("Unable to load draft", error);
  }
  return false;
}

function primeExample() {
  UI.productName.value = "Project Volley Girls";
  UI.backgroundInput.value = "一款面向美国和东南亚市场的二次元排球 IP 手游，核心是角色养成 + 卡牌策略战斗，商业化以抽卡、月卡和通行证为主。";
}

UI.analyzeButton.addEventListener("click", () => runEstimation(false));
UI.resetButton.addEventListener("click", resetRecommendedCoefficients);
UI.exportButton.addEventListener("click", exportSnapshot);
UI.productName.addEventListener("input", scheduleAutoAnalyze);
UI.backgroundInput.addEventListener("input", scheduleAutoAnalyze);
UI.marketOverride.addEventListener("change", scheduleAutoAnalyze);
UI.monetizationOverride.addEventListener("change", scheduleAutoAnalyze);
UI.lifecycleOverride.addEventListener("change", scheduleAutoAnalyze);

renderCatalog();
if (!loadDraft()) {
  primeExample();
  runEstimation(false);
}
