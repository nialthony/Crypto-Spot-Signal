/**
 * Crypto Signal Generator
 */
const CoinGeckoSDK = require('@coingecko/coingecko-typescript');

const SYMBOL_MAP = {
  BTCUSDT: { name: 'Bitcoin', geckoId: 'bitcoin', keywords: ['bitcoin', 'btc'] },
  ETHUSDT: { name: 'Ethereum', geckoId: 'ethereum', keywords: ['ethereum', 'eth'] },
  SOLUSDT: { name: 'Solana', geckoId: 'solana', keywords: ['solana', 'sol'] },
  BNBUSDT: { name: 'BNB', geckoId: 'binancecoin', keywords: ['bnb', 'binance'] },
  XRPUSDT: { name: 'Ripple', geckoId: 'ripple', keywords: ['xrp', 'ripple'] },
  TRXUSDT: { name: 'TRON', geckoId: 'tron', keywords: ['tron', 'trx'] },
  TONUSDT: { name: 'Toncoin', geckoId: 'the-open-network', keywords: ['ton', 'toncoin'] },
  LINKUSDT: { name: 'Chainlink', geckoId: 'chainlink', keywords: ['link', 'chainlink'] },
  SUIUSDT: { name: 'Sui', geckoId: 'sui', keywords: ['sui'] },
  HYPEUSDT: { name: 'Hyperliquid', geckoId: 'hyperliquid', keywords: ['hype', 'hyperliquid'] },
  XLMUSDT: { name: 'Stellar', geckoId: 'stellar', keywords: ['xlm', 'stellar'] },
  DOTUSDT: { name: 'Polkadot', geckoId: 'polkadot', keywords: ['dot', 'polkadot'] },
  LTCUSDT: { name: 'Litecoin', geckoId: 'litecoin', keywords: ['ltc', 'litecoin'] },
  ADAUSDT: { name: 'Cardano', geckoId: 'cardano', keywords: ['ada', 'cardano'] },
  AVAXUSDT: { name: 'Avalanche', geckoId: 'avalanche-2', keywords: ['avax', 'avalanche'] },
  DOGEUSDT: { name: 'Dogecoin', geckoId: 'dogecoin', keywords: ['doge', 'dogecoin'] },
};

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || process.env.CG_API_KEY || process.env.NEXT_PUBLIC_COINGECKO_API_KEY || '';
const COINGECKO_DEMO_API_KEY = process.env.COINGECKO_DEMO_API_KEY || '';
const COINGECKO_PRO_API_KEY = process.env.COINGECKO_PRO_API_KEY || '';
const COINGECKO_API_ENV = String(process.env.COINGECKO_API_ENV || 'auto').toLowerCase();
const EXPLICIT_CG_ENV = COINGECKO_API_ENV === 'pro' || COINGECKO_API_ENV === 'demo';
const GECKO_RESOLVE_TTL_MS = 6 * 60 * 60 * 1000;
let coingeckoClient = null;
let coingeckoClientEnv = null;
const geckoResolveCache = new Map();

function avg(values) {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  return +value.toFixed(digits);
}

function stdDev(values) {
  if (!values.length) return null;
  const mean = avg(values);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function symbolBase(symbol) {
  return String(symbol || '').toUpperCase().replace(/USDT$/, '');
}

function normalizeTradingSymbol(raw) {
  const cleaned = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return 'BTCUSDT';
  if (cleaned.endsWith('USDT')) return cleaned;
  if (cleaned.endsWith('USD')) return `${cleaned}T`;
  return `${cleaned}USDT`;
}

function resolveInitialCoinGeckoEnvironment() {
  if (COINGECKO_API_ENV === 'pro') return 'pro';
  if (COINGECKO_API_ENV === 'demo') return 'demo';
  if (COINGECKO_PRO_API_KEY && !COINGECKO_DEMO_API_KEY) return 'pro';
  if (COINGECKO_DEMO_API_KEY && !COINGECKO_PRO_API_KEY) return 'demo';
  if (COINGECKO_API_KEY) return 'demo';
  return 'demo';
}

function buildCoinGeckoClient(environment) {
  const sharedKey = COINGECKO_API_KEY;
  const proKey = COINGECKO_PRO_API_KEY || (environment === 'pro' ? sharedKey : '');
  const demoKey = COINGECKO_DEMO_API_KEY || (environment === 'demo' ? sharedKey : '');
  const options = {
    environment,
    proAPIKey: proKey || null,
    demoAPIKey: demoKey || null,
    timeout: 10000,
    maxRetries: 2,
  };

  if (!proKey && !demoKey) {
    // Allow unauthenticated public access mode when env keys are not available.
    options.defaultHeaders = {
      'x-cg-demo-api-key': null,
      'x-cg-pro-api-key': null,
    };
  }

  coingeckoClientEnv = environment;
  coingeckoClient = new CoinGeckoSDK(options);
  return coingeckoClient;
}

function getCoinGeckoClient(forceEnv = null) {
  if (forceEnv) {
    return buildCoinGeckoClient(forceEnv);
  }
  if (coingeckoClient) return coingeckoClient;
  const initialEnv = resolveInitialCoinGeckoEnvironment();
  return buildCoinGeckoClient(initialEnv);
}

function shouldRetryWithAlternateEnv(err) {
  if (EXPLICIT_CG_ENV) return false;
  if (!COINGECKO_API_KEY && !COINGECKO_DEMO_API_KEY && !COINGECKO_PRO_API_KEY) return false;
  const status = Number(err?.status);
  if (![400, 401, 403].includes(status)) return false;
  const message = String(err?.message || '').toLowerCase();
  if (message.includes('change your root url')) return true;
  if (message.includes('limited to pro api subscribers')) return true;
  if (message.includes('invalid api key')) return true;
  if (message.includes('authentication')) return true;
  return false;
}

async function runCoinGeckoRequest(executor) {
  try {
    return await executor(getCoinGeckoClient());
  } catch (err) {
    if (!shouldRetryWithAlternateEnv(err)) throw err;
    const nextEnv = coingeckoClientEnv === 'pro' ? 'demo' : 'pro';
    return executor(getCoinGeckoClient(nextEnv));
  }
}

function sanitizeGeckoId(value) {
  const id = String(value || '').trim();
  return id || null;
}

function getResolvedGeckoIdFromCache(key) {
  const row = geckoResolveCache.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    geckoResolveCache.delete(key);
    return null;
  }
  return row.geckoId || null;
}

function setResolvedGeckoIdCache(key, geckoId) {
  geckoResolveCache.set(key, {
    geckoId: sanitizeGeckoId(geckoId),
    expiresAt: Date.now() + GECKO_RESOLVE_TTL_MS,
  });
  if (geckoResolveCache.size > 600) {
    const oldest = geckoResolveCache.keys().next().value;
    if (oldest) geckoResolveCache.delete(oldest);
  }
}

async function resolveGeckoId(symbol, geckoIdOverride = null) {
  const override = sanitizeGeckoId(geckoIdOverride);
  if (override) return override;

  const normalizedSymbol = normalizeTradingSymbol(symbol);
  const knownId = sanitizeGeckoId(SYMBOL_MAP[normalizedSymbol]?.geckoId);
  if (knownId) return knownId;

  const base = symbolBase(normalizedSymbol);
  const cacheKey = base.toUpperCase();
  const cached = getResolvedGeckoIdFromCache(cacheKey);
  if (cached) return cached;

  const baseLower = base.toLowerCase();
  const baseUpper = base.toUpperCase();

  try {
    const marketRows = await runCoinGeckoRequest((client) => client.coins.markets.get({
      vs_currency: 'usd',
      symbols: baseLower,
      include_tokens: 'all',
      order: 'market_cap_desc',
      per_page: 50,
      page: 1,
    }));

    const exactRows = (marketRows || []).filter((row) => String(row?.symbol || '').toUpperCase() === baseUpper);
    const exact = exactRows[0];
    if (exact?.id) {
      setResolvedGeckoIdCache(cacheKey, exact.id);
      return exact.id;
    }
  } catch {}

  try {
    const search = await runCoinGeckoRequest((client) => client.search.get({ query: baseUpper }));
    const coins = Array.isArray(search?.coins) ? search.coins : [];
    const exact = coins.find((row) => String(row?.symbol || '').toUpperCase() === baseUpper) || coins[0];
    const resolved = sanitizeGeckoId(exact?.id);
    if (resolved) {
      setResolvedGeckoIdCache(cacheKey, resolved);
      return resolved;
    }
  } catch {}

  return null;
}

async function fetchCoinGeckoSpotPrice(geckoId) {
  const safeId = sanitizeGeckoId(geckoId);
  if (!safeId) return null;
  const price = await runCoinGeckoRequest((client) => client.simple.price.get({
    ids: safeId,
    vs_currencies: 'usd',
    include_last_updated_at: true,
    include_24hr_change: true,
    include_24hr_vol: true,
    include_market_cap: true,
  }));
  return Number(price?.[safeId]?.usd ?? null);
}

function sentimentLabel(score) {
  if (score >= 35) return 'Strong Bullish';
  if (score >= 15) return 'Bullish';
  if (score <= -35) return 'Strong Bearish';
  if (score <= -15) return 'Bearish';
  return 'Neutral';
}

const POSITIVE_NEWS_TERMS = [
  'partnership',
  'integration',
  'launch',
  'upgrade',
  'mainnet',
  'listing',
  'adoption',
  'grant',
  'growth',
  'expand',
  'approval',
  'milestone',
];

const NEGATIVE_NEWS_TERMS = [
  'hack',
  'exploit',
  'breach',
  'lawsuit',
  'investigation',
  'bankrupt',
  'insolvent',
  'delist',
  'suspend',
  'warning',
  'vulnerability',
  'attack',
  'shutdown',
];

function keywordSentiment(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return 0;
  const positives = POSITIVE_NEWS_TERMS.filter((term) => value.includes(term)).length;
  const negatives = NEGATIVE_NEWS_TERMS.filter((term) => value.includes(term)).length;
  if (!positives && !negatives) return 0;
  return clamp((positives - negatives) / Math.max(1, positives + negatives), -1, 1);
}

function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${round(value, digits)}%`;
}

// ── Market Data ─────────────────────────────────────────────────────────────

async function fetchFromCoinGecko(symbol, timeframe, limit = 120, geckoIdOverride = null) {
  const geckoId = await resolveGeckoId(symbol, geckoIdOverride);
  if (!geckoId) {
    throw new Error(`CoinGecko id not found for ${symbolBase(symbol)}`);
  }
  const daysMap = { '15m': 1, '1h': 3, '4h': 7, '1d': 90 };
  const days = daysMap[timeframe] || 7;
  const interval = ['15m', '1h', '4h'].includes(timeframe) ? 'hourly' : 'daily';
  const data = await runCoinGeckoRequest((client) => client.coins.marketChart.get(geckoId, {
    vs_currency: 'usd',
    days: String(days),
    interval,
  }));

  const pricesRaw = Array.isArray(data?.prices) ? data.prices : [];
  const volumesRaw = Array.isArray(data?.total_volumes) ? data.total_volumes : [];
  const fromIndex = Math.max(0, pricesRaw.length - limit);
  const prices = pricesRaw.slice(fromIndex);
  const volumes = volumesRaw.slice(fromIndex);

  const candles = prices.slice(-limit).map((p, i) => ({
    timestamp: p[0],
    open: p[1],
    high: p[1] * 1.005,
    low: p[1] * 0.995,
    close: p[1],
    volume: volumes[i] ? volumes[i][1] : 0,
  }));

  try {
    const spotPrice = await fetchCoinGeckoSpotPrice(geckoId);
    if (Number.isFinite(spotPrice) && candles.length) {
      const last = candles[candles.length - 1];
      last.close = spotPrice;
      last.high = Math.max(last.high, spotPrice);
      last.low = Math.min(last.low, spotPrice);
    }
  } catch {}

  candles.dataSource = 'coingecko_proxy';
  return candles;
}

async function fetchCoinGeckoCoinContext(symbol, geckoIdOverride = null, options = {}) {
  const geckoId = await resolveGeckoId(symbol, geckoIdOverride);
  if (!geckoId) {
    throw new Error(`CoinGecko context unavailable for ${symbolBase(symbol)}`);
  }
  const includeCommunityData = Boolean(options.communityData);
  const includeDeveloperData = Boolean(options.developerData);
  const includeTickers = Boolean(options.tickers);
  return runCoinGeckoRequest((client) => client.coins.getID(geckoId, {
    localization: false,
    tickers: includeTickers,
    market_data: true,
    community_data: includeCommunityData,
    developer_data: includeDeveloperData,
    sparkline: false,
  }));
}

function generateDemoData(symbol, timeframe, limit = 120, seedPrice = null) {
  const basePrices = {
    BTCUSDT: 96500, ETHUSDT: 2700, SOLUSDT: 195, BNBUSDT: 640,
    XRPUSDT: 2.65, ADAUSDT: 0.78, AVAXUSDT: 36, DOGEUSDT: 0.26, TRXUSDT: 0.12,
  };
  let price = Number.isFinite(seedPrice) && seedPrice > 0
    ? seedPrice
    : (basePrices[symbol] || 1.2);
  let seed = 0;
  for (const ch of symbol + timeframe) seed = ((seed << 5) - seed + ch.charCodeAt(0)) | 0;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed & 0x7fffffff) / 2147483647; };
  const trend = rand() > 0.5 ? 1 : -1;
  const volatility = 0.01 + rand() * 0.02;
  const msMap = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const intervalMs = msMap[timeframe] || 14400000;
  let ts = Date.now() - limit * intervalMs;

  const ohlcv = [];
  for (let i = 0; i < limit; i++) {
    const change = (rand() - 0.5 + trend * 0.002) * volatility;
    price *= 1 + change;
    const high = price * (1 + rand() * volatility * 0.5);
    const low = price * (1 - rand() * volatility * 0.5);
    const close = low + rand() * (high - low);
    ohlcv.push({ timestamp: ts, open: price, high, low, close, volume: 100000 + rand() * 400000 });
    ts += intervalMs;
    price = close;
  }
  ohlcv.dataSource = 'demo';
  return ohlcv;
}

async function fetchSpotPriceBySymbol(symbol, geckoIdOverride = null) {
  try {
    const geckoId = await resolveGeckoId(symbol, geckoIdOverride);
    if (geckoId) {
      const price = await fetchCoinGeckoSpotPrice(geckoId);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {}

  try {
    const base = symbolBase(symbol).toLowerCase();
    const rows = await runCoinGeckoRequest((client) => client.coins.markets.get({
      vs_currency: 'usd',
      symbols: base,
      include_tokens: 'all',
      order: 'market_cap_desc',
      per_page: 50,
      page: 1,
    }));
    const exact = (rows || []).find((row) => String(row?.symbol || '').toUpperCase() === symbolBase(symbol));
    const price = Number(exact?.current_price ?? null);
    if (Number.isFinite(price) && price > 0) return price;
  } catch {}

  return null;
}

async function fetchOHLCV(symbol, timeframe, limit = 120, options = {}) {
  const normalizedSymbol = normalizeTradingSymbol(symbol);
  const geckoId = options?.geckoId || null;
  try {
    return await fetchFromCoinGecko(normalizedSymbol, timeframe, limit, geckoId);
  } catch {
    const spotPrice = await fetchSpotPriceBySymbol(normalizedSymbol, geckoId);
    return generateDemoData(normalizedSymbol, timeframe, limit, spotPrice);
  }
}

// ── Futures Context ─────────────────────────────────────────────────────────

async function fetchFuturesContext(symbol, _timeframe, options = {}) {
  const normalizedSymbol = normalizeTradingSymbol(symbol);
  let coin = null;
  let volumeSeries = [];
  try {
    coin = await fetchCoinGeckoCoinContext(normalizedSymbol, options?.geckoId || null);
  } catch {}
  try {
    const geckoId = await resolveGeckoId(normalizedSymbol, options?.geckoId || null);
    if (geckoId) {
      const data = await runCoinGeckoRequest((client) => client.coins.marketChart.get(geckoId, {
        vs_currency: 'usd',
        days: '3',
        interval: 'hourly',
      }));
      volumeSeries = Array.isArray(data?.total_volumes) ? data.total_volumes : [];
    }
  } catch {}
  const market = coin?.market_data || {};
  const volumeUsd = Number(market?.total_volume?.usd);
  const volumePoints = volumeSeries
    .map((entry) => Number(entry?.[1]))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const recent24hVolume = volumePoints.length >= 24
    ? volumePoints.slice(-24).reduce((sum, value) => sum + value, 0)
    : null;
  const prev24hVolume = volumePoints.length >= 48
    ? volumePoints.slice(-48, -24).reduce((sum, value) => sum + value, 0)
    : null;
  const volumeChangePct = recent24hVolume != null && prev24hVolume != null && prev24hVolume > 0
    ? ((recent24hVolume - prev24hVolume) / prev24hVolume) * 100
    : null;

  return {
    fundingRate: {
      // CoinGecko has no futures funding endpoint on free market APIs.
      current: null,
      annualizedPct: null,
      nextFundingTime: null,
    },
    openInterest: {
      // Proxy: rolling 24h USD volume and its day-over-day change from CoinGecko.
      latest: recent24hVolume ?? (Number.isFinite(volumeUsd) ? volumeUsd : null),
      changePct: Number.isFinite(volumeChangePct) ? volumeChangePct : null,
    },
    longShortRatio: {
      ratio: null,
      changePct: null,
    },
    source: 'coingecko_proxy',
  };
}

// ── Catalyst Watch ──────────────────────────────────────────────────────────

async function searchCoins(query, limit = 10) {
  const q = String(query || '').trim();
  if (!q) return [];
  const safeLimit = clamp(Number(limit) || 10, 1, 20);
  const normalizedSymbolQuery = String(q).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  const bucket = new Map();
  let errorCount = 0;

  const pushSuggestion = (row) => {
    if (!row) return;
    const symbol = String(row.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!symbol) return;
    const id = String(row.id || '').trim();
    const key = id ? `id:${id}` : `sym:${symbol}`;
    if (bucket.has(key)) return;
    bucket.set(key, {
      id,
      name: row.name || symbol,
      symbol,
      pair: `${symbol}USDT`,
      marketCapRank: row.marketCapRank ?? null,
      thumb: row.thumb || '',
    });
  };

  try {
    const data = await runCoinGeckoRequest((client) => client.search.get({ query: q }));
    (data?.coins || []).forEach((coin) => {
      pushSuggestion({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        marketCapRank: coin.market_cap_rank,
        thumb: coin.thumb,
      });
    });
  } catch {
    errorCount += 1;
  }

  if (normalizedSymbolQuery) {
    try {
      const markets = await runCoinGeckoRequest((client) => client.coins.markets.get({
        vs_currency: 'usd',
        symbols: normalizedSymbolQuery.toLowerCase(),
        include_tokens: 'all',
        order: 'market_cap_desc',
        per_page: 50,
        page: 1,
      }));
      (markets || []).forEach((coin) => {
        pushSuggestion({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          marketCapRank: coin.market_cap_rank,
          thumb: coin.image,
        });
      });
    } catch {
      errorCount += 1;
    }
  }

  if (!bucket.size && normalizedSymbolQuery) {
    const knownPair = `${normalizedSymbolQuery}USDT`;
    const knownMeta = SYMBOL_MAP[knownPair];
    if (knownMeta) {
      pushSuggestion({
        id: knownMeta.geckoId,
        name: knownMeta.name,
        symbol: normalizedSymbolQuery,
        marketCapRank: null,
        thumb: '',
      });
    }
  }

  const rows = Array.from(bucket.values())
    .sort((a, b) => {
      const aRank = Number.isFinite(a.marketCapRank) ? a.marketCapRank : Number.MAX_SAFE_INTEGER;
      const bRank = Number.isFinite(b.marketCapRank) ? b.marketCapRank : Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    })
    .slice(0, safeLimit);

  if (!rows.length && errorCount > 0) {
    throw new Error('CoinGecko search unavailable');
  }

  return rows;
}

async function fetchCatalystWatch(symbol, options = {}) {
  const normalizedSymbol = normalizeTradingSymbol(symbol);
  const geckoId = options?.geckoId || SYMBOL_MAP[normalizedSymbol]?.geckoId || null;
  let trendingRows = [];
  let globalData = null;
  let coin = null;

  try {
    const data = await runCoinGeckoRequest((client) => client.search.trending.get());
    trendingRows = (data?.coins || []).map((entry, idx) => {
      const item = entry || {};
      const chg = item?.data?.price_change_percentage_24h?.usd;
      return {
        rank: idx + 1,
        name: item.name || '',
        symbol: (item.symbol || '').toUpperCase(),
        priceChange24h: typeof chg === 'number' ? chg : null,
        marketCapRank: item.market_cap_rank ?? null,
      };
    });
  } catch {}

  try {
    const payload = await runCoinGeckoRequest((client) => client.global.get());
    globalData = payload?.data || null;
  } catch {}

  try {
    coin = await fetchCoinGeckoCoinContext(normalizedSymbol, geckoId, {
      communityData: true,
      developerData: true,
      tickers: false,
    });
  } catch {}

  const market = coin?.market_data || {};
  const community = coin?.community_data || {};
  const developer = coin?.developer_data || {};
  const statusUpdates = Array.isArray(coin?.status_updates)
    ? coin.status_updates.map((row) => String(row || '').trim()).filter(Boolean)
    : [];
  const publicNotice = String(coin?.public_notice || '').trim();
  const announcementUrls = Array.isArray(coin?.links?.announcement_url)
    ? coin.links.announcement_url.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
  const coin24h = Number(
    market?.price_change_percentage_24h_in_currency?.usd
      ?? market?.price_change_percentage_24h
      ?? null,
  );
  const coin7d = Number(
    market?.price_change_percentage_7d_in_currency?.usd
      ?? market?.price_change_percentage_7d
      ?? null,
  );
  const globalMcap24h = Number(globalData?.market_cap_change_percentage_24h_usd ?? null);
  const weightedCoinMove = (Number.isFinite(coin24h) ? coin24h * 1.7 : 0) + (Number.isFinite(coin7d) ? coin7d * 0.8 : 0);
  const marketRegime = Number.isFinite(globalMcap24h) ? globalMcap24h * 3 : 0;
  const momentumScore = clamp(weightedCoinMove + marketRegime, -100, 100);

  const symbolTrend = trendingRows.find((x) => x.symbol === symbolBase(normalizedSymbol));
  const trendBoost = symbolTrend ? clamp(14 - symbolTrend.rank * 2, 2, 12) : 0;
  const newsSignals = [];
  const fundamentalSignals = [];
  const newsHighlights = [];

  let newsScoreRaw = 0;
  const votesUp = Number(coin?.sentiment_votes_up_percentage ?? null);
  const votesDown = Number(coin?.sentiment_votes_down_percentage ?? null);
  if (Number.isFinite(votesUp) && Number.isFinite(votesDown)) {
    const voteBias = votesUp - votesDown;
    const voteScore = clamp(voteBias * 0.55, -22, 22);
    newsScoreRaw += voteScore;
    newsSignals.push({
      label: `Crowd sentiment votes ${round(votesUp, 1)}% up / ${round(votesDown, 1)}% down`,
      score: round(voteScore, 2),
    });
  }

  if (publicNotice) {
    const tone = keywordSentiment(publicNotice);
    const noticeScore = tone * 28;
    newsScoreRaw += noticeScore;
    newsSignals.push({
      label: `Public notice tone (${tone >= 0 ? 'constructive' : 'risk'})`,
      score: round(noticeScore, 2),
    });
    newsHighlights.push({
      title: publicNotice.slice(0, 180),
      source: 'CoinGecko Public Notice',
      sentiment: noticeScore > 0 ? 'Bullish' : noticeScore < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(noticeScore), 2),
      publishedAt: new Date().toISOString(),
      url: '',
    });
  }

  statusUpdates.slice(0, 4).forEach((line) => {
    const tone = keywordSentiment(line);
    const itemScore = tone * 10;
    if (itemScore !== 0) {
      newsSignals.push({
        label: `Status update signal: ${line.slice(0, 80)}`,
        score: round(itemScore, 2),
      });
      newsScoreRaw += itemScore;
    }
    newsHighlights.push({
      title: line.slice(0, 180),
      source: 'CoinGecko Status Update',
      sentiment: itemScore > 0 ? 'Bullish' : itemScore < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(itemScore), 2),
      publishedAt: new Date().toISOString(),
      url: '',
    });
  });

  announcementUrls.slice(0, 2).forEach((url) => {
    newsHighlights.push({
      title: `Announcement link: ${url.slice(0, 110)}`,
      source: 'CoinGecko Links',
      sentiment: 'Neutral',
      impact: 2,
      publishedAt: new Date().toISOString(),
      url,
    });
  });

  if (symbolTrend) {
    const trendScore = clamp(15 - symbolTrend.rank * 1.6, 1, 10);
    newsScoreRaw += trendScore;
    newsSignals.push({
      label: `Trending buzz rank #${symbolTrend.rank}`,
      score: round(trendScore, 2),
    });
  }

  if (!newsSignals.length) {
    newsSignals.push({ label: 'No strong news signal available from source', score: 0 });
  }

  const marketCapRank = Number(coin?.market_cap_rank ?? market?.market_cap_rank ?? null);
  const marketCapUsd = Number(market?.market_cap?.usd ?? null);
  const fdvUsd = Number(market?.fully_diluted_valuation?.usd ?? null);
  const totalVolumeUsd = Number(market?.total_volume?.usd ?? null);
  const circulatingSupply = Number(market?.circulating_supply ?? null);
  const maxSupply = Number(market?.max_supply ?? market?.total_supply ?? null);
  const commits4w = Number(developer?.commit_count_4_weeks ?? null);
  const devStars = Number(developer?.stars ?? null);
  const redditUsers = Number(community?.reddit_subscribers ?? null);
  const telegramUsers = Number(community?.telegram_channel_user_count ?? null);
  const athChangePct = Number(market?.ath_change_percentage?.usd ?? null);

  let fundamentalScoreRaw = 0;

  if (Number.isFinite(marketCapRank)) {
    const rankScore = marketCapRank <= 20 ? 10 : marketCapRank <= 100 ? 6 : marketCapRank <= 300 ? 2 : -2;
    fundamentalScoreRaw += rankScore;
    fundamentalSignals.push({
      label: `Market cap rank #${marketCapRank}`,
      score: rankScore,
    });
  }

  if (Number.isFinite(fdvUsd) && Number.isFinite(marketCapUsd) && marketCapUsd > 0) {
    const fdvPremium = fdvUsd / marketCapUsd;
    const fdvScore = fdvPremium <= 1.4 ? 8 : fdvPremium <= 2.2 ? 3 : fdvPremium >= 3.2 ? -8 : -2;
    fundamentalScoreRaw += fdvScore;
    fundamentalSignals.push({
      label: `FDV/MCAP ratio ${round(fdvPremium, 2)}`,
      score: fdvScore,
    });
  }

  if (Number.isFinite(totalVolumeUsd) && Number.isFinite(marketCapUsd) && marketCapUsd > 0) {
    const volumeMcap = totalVolumeUsd / marketCapUsd;
    const liqScore = volumeMcap >= 0.08 ? 7 : volumeMcap >= 0.03 ? 3 : volumeMcap < 0.01 ? -4 : -1;
    fundamentalScoreRaw += liqScore;
    fundamentalSignals.push({
      label: `Volume/MCAP ratio ${round(volumeMcap * 100, 2)}%`,
      score: liqScore,
    });
  }

  if (Number.isFinite(circulatingSupply) && Number.isFinite(maxSupply) && maxSupply > 0) {
    const supplyRatio = circulatingSupply / maxSupply;
    const supplyScore = supplyRatio >= 0.65 ? 6 : supplyRatio >= 0.35 ? 2 : supplyRatio < 0.15 ? -4 : -1;
    fundamentalScoreRaw += supplyScore;
    fundamentalSignals.push({
      label: `Circulating/max supply ${round(supplyRatio * 100, 1)}%`,
      score: supplyScore,
    });
  }

  if (Number.isFinite(commits4w)) {
    const devScore = commits4w >= 40 ? 5 : commits4w >= 10 ? 2 : commits4w <= 1 ? -3 : 0;
    fundamentalScoreRaw += devScore;
    fundamentalSignals.push({
      label: `Developer commits 4w: ${commits4w}`,
      score: devScore,
    });
  }

  if (Number.isFinite(devStars)) {
    const starsScore = devStars >= 1500 ? 3 : devStars >= 200 ? 1 : 0;
    if (starsScore !== 0) {
      fundamentalScoreRaw += starsScore;
      fundamentalSignals.push({
        label: `Developer stars: ${devStars}`,
        score: starsScore,
      });
    }
  }

  if (Number.isFinite(redditUsers) || Number.isFinite(telegramUsers)) {
    const socialLoad = Math.max(0, (Number.isFinite(redditUsers) ? redditUsers : 0))
      + Math.max(0, (Number.isFinite(telegramUsers) ? telegramUsers * 0.65 : 0));
    const socialScore = clamp((Math.log10(1 + socialLoad) - 3.6) * 3.1, -5, 6);
    fundamentalScoreRaw += socialScore;
    fundamentalSignals.push({
      label: `Community reach proxy ${Math.round(socialLoad).toLocaleString('en-US')}`,
      score: round(socialScore, 2),
    });
  }

  if (Number.isFinite(athChangePct)) {
    const athScore = athChangePct >= -15 ? -2 : athChangePct <= -85 ? -2 : athChangePct <= -45 ? 2 : 0;
    if (athScore !== 0) {
      fundamentalScoreRaw += athScore;
      fundamentalSignals.push({
        label: `Distance from ATH ${formatPct(athChangePct, 1)}`,
        score: athScore,
      });
    }
  }

  if (!fundamentalSignals.length) {
    fundamentalSignals.push({ label: 'No deep fundamental metrics available from source', score: 0 });
  }

  const newsScore = clamp(newsScoreRaw, -100, 100);
  const fundamentalScore = clamp(fundamentalScoreRaw, -100, 100);
  const combinedScore = clamp(
    momentumScore * 0.55
    + newsScore * 0.25
    + fundamentalScore * 0.2
    + trendBoost,
    -100,
    100,
  );

  const catalysts = [];
  if (Number.isFinite(coin24h)) {
    catalysts.push({
      title: `${symbolBase(normalizedSymbol)} 24h change ${round(coin24h, 2)}%`,
      source: 'CoinGecko',
      url: '',
      publishedAt: new Date().toISOString(),
      sentiment: coin24h > 0 ? 'Bullish' : coin24h < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(coin24h), 2),
    });
  }
  if (Number.isFinite(coin7d)) {
    catalysts.push({
      title: `${symbolBase(normalizedSymbol)} 7d change ${round(coin7d, 2)}%`,
      source: 'CoinGecko',
      url: '',
      publishedAt: new Date().toISOString(),
      sentiment: coin7d > 0 ? 'Bullish' : coin7d < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(coin7d), 2),
    });
  }
  if (symbolTrend) {
    catalysts.push({
      title: `${symbolBase(normalizedSymbol)} is trending on CoinGecko (#${symbolTrend.rank})`,
      source: 'CoinGecko Trending',
      url: '',
      publishedAt: new Date().toISOString(),
      sentiment: symbolTrend.rank <= 5 ? 'Bullish' : 'Neutral',
      impact: round(clamp(14 - symbolTrend.rank * 2, 1, 12), 2),
    });
  }
  if (Number.isFinite(globalMcap24h)) {
    catalysts.push({
      title: `Global crypto market cap change 24h ${round(globalMcap24h, 2)}%`,
      source: 'CoinGecko Global',
      url: '',
      publishedAt: new Date().toISOString(),
      sentiment: globalMcap24h > 0 ? 'Bullish' : globalMcap24h < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(globalMcap24h), 2),
    });
  }
  newsSignals.slice(0, 2).forEach((item) => {
    catalysts.push({
      title: item.label,
      source: 'News Pulse',
      url: '',
      publishedAt: new Date().toISOString(),
      sentiment: item.score > 0 ? 'Bullish' : item.score < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(item.score), 2),
    });
  });
  fundamentalSignals.slice(0, 2).forEach((item) => {
    catalysts.push({
      title: item.label,
      source: 'Fundamental Pulse',
      url: '',
      publishedAt: new Date().toISOString(),
      sentiment: item.score > 0 ? 'Bullish' : item.score < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(item.score), 2),
    });
  });
  if (!catalysts.length) {
    catalysts.push({
      title: 'Catalyst data temporarily unavailable from CoinGecko',
      source: 'CoinGecko',
      url: '',
      publishedAt: new Date().toISOString(),
      sentiment: 'Neutral',
      impact: 0,
    });
  }

  return {
    sentimentScore: round(momentumScore, 1),
    trendBoost: round(trendBoost, 1),
    newsScore: round(newsScore, 1),
    fundamentalScore: round(fundamentalScore, 1),
    combinedScore: round(combinedScore, 1),
    sentimentLabel: sentimentLabel(combinedScore),
    symbolTrendingRank: symbolTrend ? symbolTrend.rank : null,
    newsSignals: newsSignals.slice(0, 6),
    fundamentalSignals: fundamentalSignals.slice(0, 6),
    newsHighlights: newsHighlights.slice(0, 6),
    fundamentalSnapshot: {
      marketCapUsd: Number.isFinite(marketCapUsd) ? round(marketCapUsd, 2) : null,
      fdvUsd: Number.isFinite(fdvUsd) ? round(fdvUsd, 2) : null,
      volume24hUsd: Number.isFinite(totalVolumeUsd) ? round(totalVolumeUsd, 2) : null,
      marketCapRank: Number.isFinite(marketCapRank) ? marketCapRank : null,
      commits4w: Number.isFinite(commits4w) ? commits4w : null,
      redditSubscribers: Number.isFinite(redditUsers) ? redditUsers : null,
      telegramUsers: Number.isFinite(telegramUsers) ? telegramUsers : null,
    },
    catalysts,
    trendingTopics: trendingRows.slice(0, 6),
  };
}

// ── Technical Indicators ────────────────────────────────────────────────────

function sma(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(prices) {
  if (prices.length < 26) return { line: null, signal: null, histogram: null };
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  if (ema12 === null || ema26 === null) return { line: null, signal: null, histogram: null };
  const line = ema12 - ema26;

  const history = [];
  const k12 = 2 / 13;
  const k26 = 2 / 27;
  let e12 = prices.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
  let e26 = prices.slice(0, 26).reduce((s, v) => s + v, 0) / 26;
  for (let i = 12; i < 26; i++) e12 = prices[i] * k12 + e12 * (1 - k12);
  for (let i = 26; i < prices.length; i++) {
    e12 = prices[i] * k12 + e12 * (1 - k12);
    e26 = prices[i] * k26 + e26 * (1 - k26);
    history.push(e12 - e26);
  }

  let signalLine = null;
  if (history.length >= 9) {
    const k9 = 2 / 10;
    signalLine = history.slice(0, 9).reduce((s, v) => s + v, 0) / 9;
    for (let i = 9; i < history.length; i++) signalLine = history[i] * k9 + signalLine * (1 - k9);
  }
  return { line, signal: signalLine, histogram: signalLine !== null ? line - signalLine : null };
}

function bollingerBands(prices, period = 20, stdMultiplier = 2) {
  if (prices.length < period) return { upper: null, middle: null, lower: null };
  const middle = sma(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: middle + stdMultiplier * sd, middle, lower: middle - stdMultiplier * sd };
}

function momentum(prices, period) {
  if (prices.length <= period) return null;
  const base = prices[prices.length - 1 - period];
  if (!base) return null;
  return (prices[prices.length - 1] - base) / base;
}

function atr(ohlcv, period = 14) {
  if (ohlcv.length < period + 1) return null;
  const trs = [];
  for (let i = ohlcv.length - period; i < ohlcv.length; i++) {
    const high = ohlcv[i].high;
    const low = ohlcv[i].low;
    const prevClose = ohlcv[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return avg(trs);
}

function adx(ohlcv, period = 14) {
  if (ohlcv.length < period * 2 + 1) return null;

  const tr = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < ohlcv.length; i++) {
    const curr = ohlcv[i];
    const prev = ohlcv[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    ));
  }

  let trSmooth = tr.slice(0, period).reduce((sum, value) => sum + value, 0);
  let plusSmooth = plusDM.slice(0, period).reduce((sum, value) => sum + value, 0);
  let minusSmooth = minusDM.slice(0, period).reduce((sum, value) => sum + value, 0);
  const dxSeries = [];

  for (let i = period; i < tr.length; i++) {
    trSmooth = trSmooth - (trSmooth / period) + tr[i];
    plusSmooth = plusSmooth - (plusSmooth / period) + plusDM[i];
    minusSmooth = minusSmooth - (minusSmooth / period) + minusDM[i];

    if (trSmooth <= 0) continue;
    const plusDI = (plusSmooth / trSmooth) * 100;
    const minusDI = (minusSmooth / trSmooth) * 100;
    const denominator = plusDI + minusDI;
    if (denominator <= 0) continue;
    dxSeries.push((Math.abs(plusDI - minusDI) / denominator) * 100);
  }

  if (dxSeries.length < period) return null;
  let adxValue = avg(dxSeries.slice(0, period));
  for (let i = period; i < dxSeries.length; i++) {
    adxValue = ((adxValue * (period - 1)) + dxSeries[i]) / period;
  }
  return adxValue;
}

function stochasticOscillator(ohlcv, kPeriod = 14, dPeriod = 3) {
  if (ohlcv.length < kPeriod + dPeriod) {
    return { k: null, d: null, prevK: null, prevD: null };
  }

  const rawK = [];
  for (let i = kPeriod - 1; i < ohlcv.length; i++) {
    const window = ohlcv.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...window.map((c) => c.high));
    const lowest = Math.min(...window.map((c) => c.low));
    const close = ohlcv[i].close;
    if (highest === lowest) {
      rawK.push(50);
    } else {
      rawK.push(((close - lowest) / (highest - lowest)) * 100);
    }
  }

  if (rawK.length < dPeriod + 1) {
    return { k: null, d: null, prevK: null, prevD: null };
  }

  const k = rawK[rawK.length - 1];
  const prevK = rawK[rawK.length - 2];
  const d = avg(rawK.slice(-dPeriod));
  const prevD = avg(rawK.slice(-dPeriod - 1, -1));
  return { k, d, prevK, prevD };
}

function emaSlope(prices, period = 20, lookback = 4) {
  if (prices.length < period + lookback + 2) return null;
  const now = ema(prices, period);
  const prev = ema(prices.slice(0, -lookback), period);
  if (now == null || prev == null || prev === 0) return null;
  return (now - prev) / prev;
}

function buildLiquidityHeatmap(ohlcv, currentPrice, bucketCount = 24) {
  if (!ohlcv.length) return null;
  const minPrice = Math.min(...ohlcv.map((c) => c.low));
  const maxPrice = Math.max(...ohlcv.map((c) => c.high));
  const range = maxPrice - minPrice;
  if (range <= 0) return null;

  const bucketSize = range / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    low: minPrice + i * bucketSize,
    high: minPrice + (i + 1) * bucketSize,
    volume: 0,
  }));

  for (const candle of ohlcv) {
    const start = clamp(Math.floor((candle.low - minPrice) / bucketSize), 0, bucketCount - 1);
    const end = clamp(Math.floor((candle.high - minPrice) / bucketSize), 0, bucketCount - 1);
    const spread = Math.max(1, end - start + 1);
    const share = candle.volume / spread;
    for (let i = start; i <= end; i++) buckets[i].volume += share;
  }

  const maxVolume = Math.max(...buckets.map((b) => b.volume), 1);
  const nodes = buckets.map((b) => ({
    low: round(b.low, 2),
    high: round(b.high, 2),
    center: round((b.low + b.high) / 2, 2),
    intensity: round((b.volume / maxVolume) * 100, 1),
    volume: round(b.volume, 2),
  }));

  const hotspots = [...nodes].sort((a, b) => b.volume - a.volume).slice(0, 8).sort((a, b) => a.center - b.center);
  const supportZones = hotspots.filter((h) => h.center <= currentPrice).sort((a, b) => b.center - a.center).slice(0, 3);
  const resistanceZones = hotspots.filter((h) => h.center >= currentPrice).sort((a, b) => a.center - b.center).slice(0, 3);

  return {
    minPrice: round(minPrice, 2),
    maxPrice: round(maxPrice, 2),
    bucketCount,
    hotspots,
    supportZones,
    resistanceZones,
  };
}

function analyzeIndicators(ohlcv) {
  const closes = ohlcv.map((c) => c.close);
  const returns = closes.slice(1).map((price, i) => {
    const prev = closes[i];
    return prev ? (price - prev) / prev : 0;
  });
  const recentVols = ohlcv.slice(-20).map((c) => c.volume);
  const latestVolume = ohlcv[ohlcv.length - 1]?.volume ?? 0;
  const avgVolume = avg(recentVols) ?? 0;
  const price = closes[closes.length - 1];
  const rsiVal = rsi(closes);
  const macdVal = macd(closes);
  const bb = bollingerBands(closes);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const sma200 = closes.length >= 200 ? sma(closes, 200) : null;
  const atr14 = atr(ohlcv, 14);
  const adx14 = adx(ohlcv, 14);
  const stoch = stochasticOscillator(ohlcv, 14, 3);
  return {
    currentPrice: price,
    rsi: rsiVal,
    macd: macdVal,
    bollingerBands: bb,
    ema20,
    ema50,
    sma200,
    atr14,
    adx14,
    stochastic: stoch,
    ema20Slope: emaSlope(closes, 20, 4),
    ema50Slope: emaSlope(closes, 50, 6),
    momentum3: momentum(closes, 3),
    momentum10: momentum(closes, 10),
    volatility20: stdDev(returns.slice(-20)),
    latestVolume,
    avgVolume,
    volumeRatio: avgVolume > 0 ? latestVolume / avgVolume : null,
  };
}

function detectBreakoutFakeout(ohlcv, liquidity, volumeRatio, oiChangePct, atr14) {
  if (!ohlcv.length || !liquidity) {
    return {
      pattern: 'NO_CLEAR_PATTERN',
      bias: 'NEUTRAL',
      confidence: 32,
      breakLevel: null,
      summary: 'No strong breakout/fakeout structure detected',
      metrics: null,
    };
  }

  const last = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2] || last;
  const currentPrice = last.close;
  const resistance = liquidity.resistanceZones[0] || null;
  const support = liquidity.supportZones[0] || null;

  const range = Math.max(0.0000001, last.high - last.low);
  const bodyRatio = Math.abs(last.close - last.open) / range;
  const upperWickRatio = (last.high - Math.max(last.open, last.close)) / range;
  const lowerWickRatio = (Math.min(last.open, last.close) - last.low) / range;
  const atrPct = atr14 != null ? atr14 / currentPrice : 0.005;
  const oiBoost = oiChangePct != null ? clamp(oiChangePct / 12, -1, 1) : 0;
  const volBoost = volumeRatio != null ? clamp((volumeRatio - 1) / 1.2, -1, 1) : 0;

  const brokeUp = resistance && prev.close <= resistance.center && last.close > resistance.center;
  const brokeDown = support && prev.close >= support.center && last.close < support.center;

  if (brokeUp) {
    const quality = (bodyRatio > 0.55 ? 1 : 0) + (upperWickRatio < 0.22 ? 1 : 0) + (volBoost > 0.15 ? 1 : 0) + (oiBoost > 0.1 ? 1 : 0);
    const fakeoutFlags = (upperWickRatio > 0.38 ? 1 : 0) + (volBoost < -0.1 ? 1 : 0) + (oiBoost < -0.15 ? 1 : 0);
    if (quality >= 3 && fakeoutFlags <= 1) {
      return {
        pattern: 'BREAKOUT_UP',
        bias: 'BULLISH',
        confidence: round(clamp(56 + quality * 10 + volBoost * 8 + oiBoost * 8, 55, 95), 1),
        breakLevel: resistance.center,
        summary: `Clean upside breakout above ${resistance.center}`,
        metrics: { bodyRatio: round(bodyRatio, 2), upperWickRatio: round(upperWickRatio, 2), volumeRatio: round(volumeRatio, 2), oiChangePct: round(oiChangePct, 2), atrPct: round(atrPct * 100, 2) },
      };
    }
    return {
      pattern: 'FAKEOUT_UP',
      bias: 'BEARISH',
      confidence: round(clamp(50 + fakeoutFlags * 12 - quality * 3, 45, 90), 1),
      breakLevel: resistance.center,
      summary: `Upside break above ${resistance.center} lacks follow-through`,
      metrics: { bodyRatio: round(bodyRatio, 2), upperWickRatio: round(upperWickRatio, 2), volumeRatio: round(volumeRatio, 2), oiChangePct: round(oiChangePct, 2), atrPct: round(atrPct * 100, 2) },
    };
  }

  if (brokeDown) {
    const quality = (bodyRatio > 0.55 ? 1 : 0) + (lowerWickRatio < 0.22 ? 1 : 0) + (volBoost > 0.15 ? 1 : 0) + (oiBoost > 0.1 ? 1 : 0);
    const fakeoutFlags = (lowerWickRatio > 0.38 ? 1 : 0) + (volBoost < -0.1 ? 1 : 0) + (oiBoost < -0.15 ? 1 : 0);
    if (quality >= 3 && fakeoutFlags <= 1) {
      return {
        pattern: 'BREAKOUT_DOWN',
        bias: 'BEARISH',
        confidence: round(clamp(56 + quality * 10 + volBoost * 8 + oiBoost * 8, 55, 95), 1),
        breakLevel: support.center,
        summary: `Clean downside breakout below ${support.center}`,
        metrics: { bodyRatio: round(bodyRatio, 2), lowerWickRatio: round(lowerWickRatio, 2), volumeRatio: round(volumeRatio, 2), oiChangePct: round(oiChangePct, 2), atrPct: round(atrPct * 100, 2) },
      };
    }
    return {
      pattern: 'FAKEOUT_DOWN',
      bias: 'BULLISH',
      confidence: round(clamp(50 + fakeoutFlags * 12 - quality * 3, 45, 90), 1),
      breakLevel: support.center,
      summary: `Downside break below ${support.center} lacks follow-through`,
      metrics: { bodyRatio: round(bodyRatio, 2), lowerWickRatio: round(lowerWickRatio, 2), volumeRatio: round(volumeRatio, 2), oiChangePct: round(oiChangePct, 2), atrPct: round(atrPct * 100, 2) },
    };
  }

  return {
    pattern: 'NO_CLEAR_PATTERN',
    bias: 'NEUTRAL',
    confidence: round(clamp(32 + (volBoost > 0 ? 8 : 0), 30, 55), 1),
    breakLevel: null,
    summary: 'No confirmed breakout/fakeout at key liquidity nodes',
    metrics: { bodyRatio: round(bodyRatio, 2), volumeRatio: round(volumeRatio, 2), oiChangePct: round(oiChangePct, 2), atrPct: round(atrPct * 100, 2) },
  };
}

function buildLiquidationRiskMeter(fundingRate, longShortRatio, oiChangePct, volatility20, catalystScore) {
  const volPct = volatility20 != null ? volatility20 * 100 : 0;
  const crowdLong = clamp(((longShortRatio ?? 1) - 1.02) / 0.6, 0, 1);
  const crowdShort = clamp((0.98 - (longShortRatio ?? 1)) / 0.5, 0, 1);
  const fundingLong = clamp(((fundingRate ?? 0) - 0.00025) / 0.0012, 0, 1);
  const fundingShort = clamp(((-fundingRate ?? 0) - 0.00025) / 0.0012, 0, 1);
  const leverageBuild = clamp((oiChangePct ?? 0) / 18, 0, 1);
  const volStress = clamp((volPct - 1.6) / 3.6, 0, 1);
  const catalystStress = clamp(Math.abs(catalystScore ?? 0) / 100, 0, 1) * 0.35;

  const longRiskRaw = (crowdLong * 30 + fundingLong * 30 + leverageBuild * 20 + volStress * 20) * (1 + catalystStress);
  const shortRiskRaw = (crowdShort * 30 + fundingShort * 30 + leverageBuild * 20 + volStress * 20) * (1 + catalystStress);
  const score = clamp(Math.max(longRiskRaw, shortRiskRaw), 0, 100);

  const bias = longRiskRaw > shortRiskRaw + 6
    ? 'LONGS_AT_RISK'
    : shortRiskRaw > longRiskRaw + 6
      ? 'SHORTS_AT_RISK'
      : 'BALANCED';

  const level = score >= 80 ? 'EXTREME' : score >= 65 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW';
  const factors = [];
  if ((oiChangePct ?? 0) > 8) factors.push('Open interest expanding quickly');
  if ((volatility20 ?? 0) > 0.028) factors.push('Volatility regime elevated');
  if ((fundingRate ?? 0) > 0.001) factors.push('Funding heavily favors longs');
  if ((fundingRate ?? 0) < -0.001) factors.push('Funding heavily favors shorts');
  if ((longShortRatio ?? 1) > 1.35) factors.push('Long crowding in accounts');
  if ((longShortRatio ?? 1) < 0.72) factors.push('Short crowding in accounts');
  if (!factors.length) factors.push('Positioning currently balanced');

  return {
    score: round(score, 1),
    level,
    bias,
    longRiskScore: round(clamp(longRiskRaw, 0, 100), 1),
    shortRiskScore: round(clamp(shortRiskRaw, 0, 100), 1),
    factors,
  };
}

// ── Signal Scoring ──────────────────────────────────────────────────────────

function generateSignal(ohlcv, signalType, riskTolerance, context = {}) {
  const closes = ohlcv.map((c) => c.close);
  const ind = analyzeIndicators(ohlcv);
  const futuresContext = context.futuresContext || {};
  const catalystWatch = context.catalystWatch || {};

  const {
    currentPrice: price,
    rsi: rsiVal,
    macd: macdVal,
    bollingerBands: bb,
    ema20,
    ema50,
    sma200,
    atr14,
    adx14,
    stochastic,
    ema20Slope,
    ema50Slope,
    momentum3,
    momentum10,
    volatility20,
    volumeRatio,
  } = ind;

  const prevMacd = closes.length > 30 ? macd(closes.slice(0, -1)) : { line: null, signal: null, histogram: null };
  const liquidity = buildLiquidityHeatmap(ohlcv, price, 24);

  const categoryScores = {
    technical: { label: 'Technical Confluence', buy: 0, sell: 0 },
    trend: { label: 'Trend Structure', buy: 0, sell: 0 },
    liquidity: { label: 'Liquidity + Price Action', buy: 0, sell: 0 },
    derivatives: { label: 'Derivatives Positioning', buy: 0, sell: 0 },
    news: { label: 'News Flow', buy: 0, sell: 0 },
    fundamental: { label: 'Fundamental Quality', buy: 0, sell: 0 },
    catalyst: { label: 'Composite Catalyst', buy: 0, sell: 0 },
  };

  let buyScore = 0;
  let sellScore = 0;
  let buyEvidence = 0;
  let sellEvidence = 0;
  let contradictionPenalty = 0;
  let softPenalty = 0;
  const reasons = [];

  const addContribution = (side, category, points) => {
    if (categoryScores[category]) categoryScores[category][side] += points;
  };
  const addBuy = (points, reason, category = 'technical') => {
    buyScore += points;
    buyEvidence += 1;
    addContribution('buy', category, points);
    reasons.push(reason);
  };
  const addSell = (points, reason, category = 'technical') => {
    sellScore += points;
    sellEvidence += 1;
    addContribution('sell', category, points);
    reasons.push(reason);
  };

  const trendBias = ema20 !== null && ema50 !== null ? (ema20 - ema50) / price : 0;
  const trendStrength = adx14 ?? (Math.abs(trendBias) >= 0.012 ? 23 : 16);
  const strongTrend = Math.abs(trendBias) >= 0.009 && trendStrength >= 22;
  const weakTrend = trendStrength < 18;
  const regime = strongTrend
    ? (trendBias > 0 ? 'uptrend' : 'downtrend')
    : weakTrend
      ? 'range'
      : (Math.abs(trendBias) >= 0.009 ? (trendBias > 0 ? 'uptrend' : 'downtrend') : 'range');
  reasons.push(
    regime === 'range'
      ? 'Market regime: ranging/choppy - mean reversion signals weighted higher'
      : `Market regime: ${regime} with ADX ${round(trendStrength, 1)} - trend-following signals weighted higher`,
  );

  if (adx14 != null) {
    if (adx14 >= 28) {
      if (trendBias > 0) addBuy(1.0, `ADX(${adx14.toFixed(1)}) confirms strong bullish trend strength`, 'trend');
      else if (trendBias < 0) addSell(1.0, `ADX(${adx14.toFixed(1)}) confirms strong bearish trend strength`, 'trend');
    } else if (adx14 <= 17) {
      reasons.push(`ADX(${adx14.toFixed(1)}) low - trend conviction weak, breakout risk lower`);
      buyScore *= 0.95;
      sellScore *= 0.95;
      softPenalty += 0.08;
    }
  }

  if (rsiVal !== null) {
    if (regime === 'uptrend') {
      if (rsiVal < 38) addBuy(1.6, `RSI(${rsiVal.toFixed(1)}) pullback in uptrend - dip-buy setup`, 'technical');
      else if (rsiVal > 78) addSell(1.2, `RSI(${rsiVal.toFixed(1)}) extended in uptrend - exhaustion risk`, 'technical');
      else reasons.push(`RSI(${rsiVal.toFixed(1)}) healthy for uptrend continuation`);
    } else if (regime === 'downtrend') {
      if (rsiVal > 62) addSell(1.6, `RSI(${rsiVal.toFixed(1)}) bounce in downtrend - sell-the-rally setup`, 'technical');
      else if (rsiVal < 22) addBuy(1.1, `RSI(${rsiVal.toFixed(1)}) deeply oversold - relief bounce possible`, 'technical');
      else reasons.push(`RSI(${rsiVal.toFixed(1)}) neutral within downtrend`);
    } else if (rsiVal < 30) addBuy(1.8, `RSI(${rsiVal.toFixed(1)}) oversold in range - bullish mean reversion`, 'technical');
    else if (rsiVal > 70) addSell(1.8, `RSI(${rsiVal.toFixed(1)}) overbought in range - bearish mean reversion`, 'technical');
    else reasons.push(`RSI(${rsiVal.toFixed(1)}) neutral in ranging market`);
  }

  if (macdVal.histogram !== null) {
    const histNow = macdVal.histogram;
    const histPrev = prevMacd.histogram;
    if (histNow > 0 && macdVal.line > macdVal.signal) {
      if (histPrev !== null && histPrev <= 0) addBuy(1.9, 'MACD fresh bullish crossover - momentum shift upward', 'technical');
      else if (histPrev !== null && histNow > histPrev) addBuy(1.4, 'MACD bullish momentum is strengthening', 'technical');
      else addBuy(1.1, 'MACD remains bullish', 'technical');
    } else if (histNow < 0 && macdVal.line < macdVal.signal) {
      if (histPrev !== null && histPrev >= 0) addSell(1.9, 'MACD fresh bearish crossover - momentum shift downward', 'technical');
      else if (histPrev !== null && histNow < histPrev) addSell(1.4, 'MACD bearish momentum is strengthening', 'technical');
      else addSell(1.1, 'MACD remains bearish', 'technical');
    }
  }

  if (bb.lower !== null && bb.middle !== null && bb.upper !== null) {
    const bandWidth = (bb.upper - bb.lower) / bb.middle;
    if (price <= bb.lower) addBuy(regime === 'downtrend' ? 0.8 : 1.4, `Price touched lower Bollinger Band ($${bb.lower.toFixed(2)})`, 'technical');
    else if (price >= bb.upper) addSell(regime === 'uptrend' ? 0.8 : 1.4, `Price touched upper Bollinger Band ($${bb.upper.toFixed(2)})`, 'technical');
    if (bandWidth < 0.04) {
      reasons.push('Bollinger bandwidth compressed - breakout risk rising');
      buyScore *= 0.95;
      sellScore *= 0.95;
      softPenalty += 0.08;
    }
  }

  if (ema20 !== null && ema50 !== null) {
    if (price > ema20 && ema20 > ema50) addBuy(1.5, 'Price above EMA20 > EMA50 - bullish structure intact', 'trend');
    else if (price < ema20 && ema20 < ema50) addSell(1.5, 'Price below EMA20 < EMA50 - bearish structure intact', 'trend');
    else reasons.push('EMA structure mixed - trend conviction reduced');
  }

  if (sma200 !== null) {
    if (price > sma200) addBuy(0.7, 'Price above SMA200 - long-term support', 'trend');
    else addSell(0.7, 'Price below SMA200 - long-term pressure', 'trend');
  }

  if (ema20Slope != null && ema50Slope != null) {
    const slopeAlignedUp = ema20Slope > 0 && ema50Slope > 0;
    const slopeAlignedDown = ema20Slope < 0 && ema50Slope < 0;
    if (slopeAlignedUp) {
      addBuy(0.8, `EMA slopes rising (20:${(ema20Slope * 100).toFixed(2)}%, 50:${(ema50Slope * 100).toFixed(2)}%)`, 'trend');
    } else if (slopeAlignedDown) {
      addSell(0.8, `EMA slopes falling (20:${(ema20Slope * 100).toFixed(2)}%, 50:${(ema50Slope * 100).toFixed(2)}%)`, 'trend');
    } else {
      reasons.push('EMA slope disagreement - trend acceleration unclear');
    }
  }

  if (momentum3 !== null && momentum10 !== null) {
    if (momentum3 > 0 && momentum10 > 0) addBuy(1.1, 'Short and medium momentum aligned upward', 'technical');
    else if (momentum3 < 0 && momentum10 < 0) addSell(1.1, 'Short and medium momentum aligned downward', 'technical');
    else reasons.push('Momentum mixed across windows - transition risk');
  }

  if (stochastic?.k != null && stochastic?.d != null) {
    const k = stochastic.k;
    const d = stochastic.d;
    const bullCross = stochastic.prevK != null && stochastic.prevD != null && stochastic.prevK <= stochastic.prevD && k > d;
    const bearCross = stochastic.prevK != null && stochastic.prevD != null && stochastic.prevK >= stochastic.prevD && k < d;

    if (k <= 20 && bullCross) {
      addBuy(1.1, `Stochastic bullish cross in oversold zone (K:${k.toFixed(1)} D:${d.toFixed(1)})`, 'technical');
    } else if (k >= 80 && bearCross) {
      addSell(1.1, `Stochastic bearish cross in overbought zone (K:${k.toFixed(1)} D:${d.toFixed(1)})`, 'technical');
    } else if (k < 15 && regime !== 'downtrend') {
      addBuy(0.5, `Stochastic deeply oversold (K:${k.toFixed(1)})`, 'technical');
    } else if (k > 85 && regime !== 'uptrend') {
      addSell(0.5, `Stochastic deeply overbought (K:${k.toFixed(1)})`, 'technical');
    }
  }

  if (volumeRatio !== null) {
    if (volumeRatio > 1.6) {
      reasons.push(`Volume spike (${volumeRatio.toFixed(2)}x avg) - stronger move conviction`);
      if (buyScore > sellScore) {
        buyScore += 0.6;
        addContribution('buy', 'technical', 0.6);
      } else if (sellScore > buyScore) {
        sellScore += 0.6;
        addContribution('sell', 'technical', 0.6);
      }
    } else if (volumeRatio < 0.75) {
      reasons.push(`Volume below average (${volumeRatio.toFixed(2)}x) - weaker breakout quality`);
      buyScore *= 0.93;
      sellScore *= 0.93;
      softPenalty += 0.1;
    }
  }

  if (volumeRatio != null && adx14 != null && adx14 >= 25 && volumeRatio >= 1.2) {
    if (trendBias > 0) addBuy(0.4, 'Volume + ADX confirm bullish trend continuation', 'trend');
    if (trendBias < 0) addSell(0.4, 'Volume + ADX confirm bearish trend continuation', 'trend');
  }

  if (liquidity) {
    const support = liquidity.supportZones[0];
    const resistance = liquidity.resistanceZones[0];
    const atrPct = atr14 !== null ? atr14 / price : 0.006;
    const proximityLimit = Math.max(0.008, atrPct * 1.4);
    if (support) {
      const dist = (price - support.center) / price;
      if (dist >= 0 && dist <= proximityLimit) addBuy(0.9, `Near high-liquidity support zone ($${support.center})`, 'liquidity');
    }
    if (resistance) {
      const dist = (resistance.center - price) / price;
      if (dist >= 0 && dist <= proximityLimit) addSell(0.9, `Near high-liquidity resistance zone ($${resistance.center})`, 'liquidity');
    }
  }

  const funding = futuresContext?.fundingRate || {};
  const oi = futuresContext?.openInterest || {};
  const longShort = futuresContext?.longShortRatio || {};

  if (funding.current != null && longShort.ratio != null) {
    if (funding.current > 0.0008 && longShort.ratio > 1.1) addSell(1.2, `Funding positive ${(funding.current * 100).toFixed(3)}% with crowded longs`, 'derivatives');
    else if (funding.current < -0.0008 && longShort.ratio < 0.9) addBuy(1.2, `Funding negative ${(funding.current * 100).toFixed(3)}% with crowded shorts`, 'derivatives');
    else reasons.push(`Funding neutral at ${(funding.current * 100).toFixed(3)}%`);
  }

  if (longShort.ratio != null) {
    if (longShort.ratio > 1.35) addSell(0.7, `Long/Short ratio ${longShort.ratio.toFixed(2)} indicates long crowding`, 'derivatives');
    else if (longShort.ratio < 0.75) addBuy(0.7, `Long/Short ratio ${longShort.ratio.toFixed(2)} indicates short crowding`, 'derivatives');
  }

  if (oi.changePct != null) {
    if (oi.changePct > 5 && momentum10 != null && momentum10 > 0) addBuy(0.8, `Open interest rising ${oi.changePct.toFixed(1)}% with bullish momentum`, 'derivatives');
    else if (oi.changePct > 5 && momentum10 != null && momentum10 < 0) addSell(0.8, `Open interest rising ${oi.changePct.toFixed(1)}% with bearish momentum`, 'derivatives');
    else if (oi.changePct < -8) {
      reasons.push(`Open interest dropped ${oi.changePct.toFixed(1)}% - deleveraging phase`);
      buyScore *= 0.96;
      sellScore *= 0.96;
      softPenalty += 0.06;
    }
  }

  const catalystScore = catalystWatch?.combinedScore;
  const newsScore = catalystWatch?.newsScore;
  const fundamentalScore = catalystWatch?.fundamentalScore;

  if (newsScore != null) {
    if (newsScore >= 22) addBuy(1.0, `News flow supportive (${newsScore.toFixed(1)})`, 'news');
    else if (newsScore <= -22) addSell(1.0, `News flow risk-off (${newsScore.toFixed(1)})`, 'news');
    else reasons.push(`News flow neutral (${newsScore.toFixed(1)})`);
  }

  if (fundamentalScore != null) {
    if (fundamentalScore >= 16) addBuy(1.0, `Fundamental quality strong (${fundamentalScore.toFixed(1)})`, 'fundamental');
    else if (fundamentalScore <= -16) addSell(1.0, `Fundamental quality weak (${fundamentalScore.toFixed(1)})`, 'fundamental');
    else reasons.push(`Fundamental quality neutral (${fundamentalScore.toFixed(1)})`);
  }

  if (catalystScore != null) {
    if (catalystScore >= 25) addBuy(1.2, `Catalyst watch bullish (${catalystScore.toFixed(1)})`, 'catalyst');
    else if (catalystScore <= -25) addSell(1.2, `Catalyst watch bearish (${catalystScore.toFixed(1)})`, 'catalyst');
    else reasons.push(`Catalyst watch neutral (${catalystScore.toFixed(1)})`);
  }

  if (newsScore != null && fundamentalScore != null) {
    if (newsScore >= 18 && fundamentalScore >= 12) {
      addBuy(0.6, 'News and fundamentals aligned bullish', 'catalyst');
    } else if (newsScore <= -18 && fundamentalScore <= -12) {
      addSell(0.6, 'News and fundamentals aligned bearish', 'catalyst');
    }
  }

  if (newsScore != null) {
    if (newsScore <= -30 && buyScore > sellScore) {
      reasons.push('Negative news pressure against bullish setup - reducing confidence');
      buyScore *= 0.94;
      softPenalty += 0.07;
    } else if (newsScore >= 30 && sellScore > buyScore) {
      reasons.push('Positive news pressure against bearish setup - reducing confidence');
      sellScore *= 0.94;
      softPenalty += 0.07;
    }
  }

  if (fundamentalScore != null) {
    if (fundamentalScore <= -20 && buyScore > sellScore) {
      reasons.push('Weak fundamentals cap upside conviction');
      buyScore *= 0.95;
      softPenalty += 0.06;
    } else if (fundamentalScore >= 20 && sellScore > buyScore) {
      reasons.push('Strong fundamentals reduce bearish conviction');
      sellScore *= 0.95;
      softPenalty += 0.06;
    }
  }

  if (catalystWatch?.symbolTrendingRank != null && catalystWatch.symbolTrendingRank <= 5) {
    if (momentum10 != null && momentum10 >= 0) addBuy(0.5, `Asset ranks #${catalystWatch.symbolTrendingRank} on trending topics`, 'catalyst');
    else addBuy(0.2, `Asset trending #${catalystWatch.symbolTrendingRank} but momentum still mixed`, 'catalyst');
  }

  const breakoutFakeoutDetector = detectBreakoutFakeout(ohlcv, liquidity, volumeRatio, oi.changePct, atr14);
  if (breakoutFakeoutDetector.pattern === 'BREAKOUT_UP') addBuy(1.1, `${breakoutFakeoutDetector.summary} - breakout confirmation`, 'liquidity');
  if (breakoutFakeoutDetector.pattern === 'BREAKOUT_DOWN') addSell(1.1, `${breakoutFakeoutDetector.summary} - breakout confirmation`, 'liquidity');
  if (breakoutFakeoutDetector.pattern === 'FAKEOUT_UP') addSell(0.9, `${breakoutFakeoutDetector.summary} - possible bull trap`, 'liquidity');
  if (breakoutFakeoutDetector.pattern === 'FAKEOUT_DOWN') addBuy(0.9, `${breakoutFakeoutDetector.summary} - possible bear trap`, 'liquidity');

  const liquidationRiskMeter = buildLiquidationRiskMeter(
    funding.current,
    longShort.ratio,
    oi.changePct,
    volatility20,
    catalystScore,
  );
  if (liquidationRiskMeter.bias === 'LONGS_AT_RISK' && liquidationRiskMeter.score >= 45) {
    addSell(liquidationRiskMeter.score >= 75 ? 1.2 : 0.7, `Liquidation risk meter: ${liquidationRiskMeter.level} (${liquidationRiskMeter.score}) with longs vulnerable`, 'derivatives');
  } else if (liquidationRiskMeter.bias === 'SHORTS_AT_RISK' && liquidationRiskMeter.score >= 45) {
    addBuy(liquidationRiskMeter.score >= 75 ? 1.2 : 0.7, `Liquidation risk meter: ${liquidationRiskMeter.level} (${liquidationRiskMeter.score}) with shorts vulnerable`, 'derivatives');
  } else {
    reasons.push(`Liquidation risk meter: ${liquidationRiskMeter.level} (${liquidationRiskMeter.score})`);
  }

  if (buyScore > 0 && sellScore > 0) {
    contradictionPenalty = Math.min(buyScore, sellScore) * 0.35;
    buyScore -= contradictionPenalty;
    sellScore -= contradictionPenalty;
    reasons.push('Bullish and bearish evidence both present - applied contradiction penalty');
  }

  const thresholds = { conservative: 5.1, moderate: 3.8, aggressive: 2.8 };
  let threshold = thresholds[riskTolerance] || 3.8;
  if (regime === 'range') threshold += 0.25;
  if (weakTrend) threshold += 0.15;
  if (adx14 != null && adx14 >= 30) threshold -= 0.15;
  if (volatility20 !== null && volatility20 > 0.025) threshold += 0.2;
  if (volatility20 !== null && volatility20 > 0.04) threshold += 0.15;

  const edge = Math.abs(buyScore - sellScore);
  const dominantScore = Math.max(buyScore, sellScore);
  let signal = 'HOLD';
  if (buyScore >= threshold && buyScore > sellScore && edge >= 0.9) signal = 'BUY';
  else if (sellScore >= threshold && sellScore > buyScore && edge >= 0.9) signal = 'SELL';
  else reasons.push('Insufficient directional edge after confluence check - wait for confirmation');

  const dominantSide = signal === 'BUY' ? 'buy' : signal === 'SELL' ? 'sell' : (buyScore >= sellScore ? 'buy' : 'sell');
  const opposingSide = dominantSide === 'buy' ? 'sell' : 'buy';
  const dominantEvidence = signal === 'BUY' ? buyEvidence : signal === 'SELL' ? sellEvidence : Math.max(buyEvidence, sellEvidence);
  const alignmentBonus =
    (signal === 'BUY' && breakoutFakeoutDetector.pattern === 'BREAKOUT_UP') ||
    (signal === 'SELL' && breakoutFakeoutDetector.pattern === 'BREAKOUT_DOWN')
      ? 8
      : (signal === 'BUY' && breakoutFakeoutDetector.pattern === 'FAKEOUT_DOWN') ||
        (signal === 'SELL' && breakoutFakeoutDetector.pattern === 'FAKEOUT_UP')
        ? 5
        : 0;
  const conflictPenalty =
    (signal === 'BUY' && liquidationRiskMeter.bias === 'LONGS_AT_RISK' && liquidationRiskMeter.score >= 65) ||
    (signal === 'SELL' && liquidationRiskMeter.bias === 'SHORTS_AT_RISK' && liquidationRiskMeter.score >= 65)
      ? 8
      : 0;

  let qualityScore = clamp(
    28 + dominantScore * 8 + edge * 10 + dominantEvidence * 1.9 + alignmentBonus
    - contradictionPenalty * 10 - softPenalty * 18 - conflictPenalty,
    10,
    99,
  );
  if (signal === 'HOLD') qualityScore = clamp(qualityScore - 12, 15, 62);

  const qualityGrade = qualityScore >= 90 ? 'A+' : qualityScore >= 80 ? 'A' : qualityScore >= 70 ? 'B' : qualityScore >= 60 ? 'C' : 'D';
  const breakdownRaw = Object.entries(categoryScores).map(([key, item]) => ({
    key,
    label: item.label,
    points: item[dominantSide],
  }));
  const totalBreakdownPoints = breakdownRaw.reduce((sum, item) => sum + item.points, 0);
  const qualityBreakdown = breakdownRaw
    .map((item) => ({
      key: item.key,
      label: item.label,
      points: round(item.points, 2),
      contributionPct: totalBreakdownPoints > 0 ? round((item.points / totalBreakdownPoints) * 100, 1) : 0,
    }))
    .sort((a, b) => b.points - a.points);

  let confidence;
  if (signal === 'HOLD') confidence = clamp(35 + edge * 7 + qualityScore * 0.2, 40, 68);
  else confidence = clamp(qualityScore * 0.72 + edge * 8.5, 55, 97);

  const targets = {
    scalp: [0.01, 0.02, 0.005],
    intraday: [0.018, 0.04, 0.01],
    swing: [0.03, 0.08, 0.015],
  };
  let [tp1Pct, tp2Pct, slPct] = targets[signalType] || targets.swing;
  if (trendStrength >= 30) {
    tp1Pct *= 1.1;
    tp2Pct *= 1.18;
    slPct *= 1.05;
  } else if (regime === 'range') {
    tp1Pct *= 0.9;
    tp2Pct *= 0.82;
    slPct *= 0.92;
  }
  if (volatility20 != null && volatility20 > 0.04) {
    slPct *= 1.12;
  }
  const dir = signal === 'SELL' ? -1 : 1;
  const atrPct = atr14 !== null ? atr14 / price : null;
  const entryPadPct = clamp(atrPct !== null ? atrPct * 0.3 : 0.002, 0.0015, 0.008);
  const dynamicSlPct = clamp(atrPct !== null ? Math.max(slPct, atrPct * 1.1) : slPct, slPct * 0.85, slPct * 1.9);
  const entryLow = round(price * (1 - entryPadPct), 2);
  const entryHigh = round(price * (1 + entryPadPct), 2);
  const tp1 = round(price * (1 + dir * tp1Pct), 2);
  const tp2 = round(price * (1 + dir * tp2Pct), 2);
  const sl = round(price * (1 - dir * dynamicSlPct), 2);
  const riskReward = signal !== 'HOLD' ? round((Math.abs(tp2 - price) / Math.abs(price - sl)) || 0, 2) : 0;

  return {
    signal,
    confidence: round(confidence, 1),
    marketType: 'coingecko_spot_proxy',
    currentPrice: round(price, 2),
    entryRange: { low: entryLow, high: entryHigh },
    takeProfit1: tp1,
    takeProfit1Pct: round(dir * tp1Pct * 100, 2),
    takeProfit2: tp2,
    takeProfit2Pct: round(dir * tp2Pct * 100, 2),
    stopLoss: sl,
    stopLossPct: round(-dir * dynamicSlPct * 100, 2),
    riskReward,
    reasons,
    signalQuality: {
      score: round(qualityScore, 1),
      grade: qualityGrade,
      confluencePoints: round(dominantScore, 2),
      oppositionPoints: round(dominantSide === 'buy' ? sellScore : buyScore, 2),
      dominantSide,
      breakdown: qualityBreakdown,
    },
    liquidationRiskMeter,
    breakoutFakeoutDetector,
    indicators: {
      rsi: round(rsiVal, 2),
      macd: { line: round(macdVal.line, 4), signal: round(macdVal.signal, 4), histogram: round(macdVal.histogram, 4) },
      bollingerBands: { upper: round(bb.upper, 2), middle: round(bb.middle, 2), lower: round(bb.lower, 2) },
      ema20: round(ema20, 2),
      ema50: round(ema50, 2),
      sma200: round(sma200, 2),
      atr14: round(atr14, 4),
      adx14: round(adx14, 2),
      stochastic: {
        k: round(stochastic?.k, 2),
        d: round(stochastic?.d, 2),
      },
      ema20SlopePct: ema20Slope != null ? round(ema20Slope * 100, 2) : null,
      ema50SlopePct: ema50Slope != null ? round(ema50Slope * 100, 2) : null,
      momentum3: momentum3 != null ? round(momentum3 * 100, 2) : null,
      momentum10: momentum10 != null ? round(momentum10 * 100, 2) : null,
      volatility20: volatility20 != null ? round(volatility20 * 100, 2) : null,
      volumeRatio: round(volumeRatio, 2),
    },
    futuresContext: {
      fundingRate: {
        current: round(funding.current, 6),
        annualizedPct: round(funding.annualizedPct, 2),
        nextFundingTime: funding.nextFundingTime || null,
      },
      openInterest: { latest: round(oi.latest, 2), changePct: round(oi.changePct, 2) },
      longShortRatio: { ratio: round(longShort.ratio, 2), changePct: round(longShort.changePct, 2) },
    },
    catalystWatch: {
      sentimentScore: round(catalystWatch.sentimentScore, 1),
      trendBoost: round(catalystWatch.trendBoost, 1),
      newsScore: round(catalystWatch.newsScore, 1),
      fundamentalScore: round(catalystWatch.fundamentalScore, 1),
      combinedScore: round(catalystWatch.combinedScore, 1),
      sentimentLabel: catalystWatch.sentimentLabel || 'Neutral',
      symbolTrendingRank: catalystWatch.symbolTrendingRank ?? null,
      newsSignals: Array.isArray(catalystWatch.newsSignals) ? catalystWatch.newsSignals.slice(0, 6) : [],
      fundamentalSignals: Array.isArray(catalystWatch.fundamentalSignals) ? catalystWatch.fundamentalSignals.slice(0, 6) : [],
      newsHighlights: Array.isArray(catalystWatch.newsHighlights) ? catalystWatch.newsHighlights.slice(0, 6) : [],
      fundamentalSnapshot: catalystWatch.fundamentalSnapshot || null,
      catalysts: Array.isArray(catalystWatch.catalysts) ? catalystWatch.catalysts.slice(0, 6) : [],
      trendingTopics: Array.isArray(catalystWatch.trendingTopics) ? catalystWatch.trendingTopics.slice(0, 6) : [],
    },
    liquidityHeatmap: liquidity,
    timestamp: new Date().toISOString(),
    dataSource: ohlcv.dataSource || 'live',
  };
}

module.exports = {
  normalizeTradingSymbol,
  searchCoins,
  fetchOHLCV,
  fetchFuturesContext,
  fetchCatalystWatch,
  generateSignal,
  SYMBOL_MAP,
};
