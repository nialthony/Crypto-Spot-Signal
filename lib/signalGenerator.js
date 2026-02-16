/**
 * Crypto Futures Signal Generator
 */

const SYMBOL_MAP = {
  BTCUSDT: { name: 'Bitcoin', geckoId: 'bitcoin', keywords: ['bitcoin', 'btc'] },
  ETHUSDT: { name: 'Ethereum', geckoId: 'ethereum', keywords: ['ethereum', 'eth'] },
  SOLUSDT: { name: 'Solana', geckoId: 'solana', keywords: ['solana', 'sol'] },
  BNBUSDT: { name: 'BNB', geckoId: 'binancecoin', keywords: ['bnb', 'binance'] },
  XRPUSDT: { name: 'Ripple', geckoId: 'ripple', keywords: ['xrp', 'ripple'] },
  ADAUSDT: { name: 'Cardano', geckoId: 'cardano', keywords: ['ada', 'cardano'] },
  AVAXUSDT: { name: 'Avalanche', geckoId: 'avalanche-2', keywords: ['avax', 'avalanche'] },
  DOGEUSDT: { name: 'Dogecoin', geckoId: 'dogecoin', keywords: ['doge', 'dogecoin'] },
};

const BULLISH_TERMS = ['bullish', 'breakout', 'surge', 'rally', 'adoption', 'inflow', 'approval', 'buy'];
const BEARISH_TERMS = ['bearish', 'selloff', 'dump', 'hack', 'exploit', 'ban', 'outflow', 'sell'];

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

function mapFuturesPeriod(timeframe) {
  const map = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
  return map[timeframe] || '4h';
}

function symbolBase(symbol) {
  return symbol.replace('USDT', '');
}

function sentimentLabel(score) {
  if (score >= 35) return 'Strong Bullish';
  if (score >= 15) return 'Bullish';
  if (score <= -35) return 'Strong Bearish';
  if (score <= -15) return 'Bearish';
  return 'Neutral';
}

// ── Market Data ─────────────────────────────────────────────────────────────

async function fetchFromBinanceFutures(symbol, timeframe, limit = 120) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Binance Futures ${res.status}`);
  const data = await res.json();
  const candles = data.map((c) => ({
    timestamp: c[0],
    open: +c[1],
    high: +c[2],
    low: +c[3],
    close: +c[4],
    volume: +c[5],
  }));
  candles.dataSource = 'binance_futures';
  return candles;
}

async function fetchFromCoinGecko(symbol, timeframe, limit = 120) {
  const geckoId = SYMBOL_MAP[symbol]?.geckoId || 'bitcoin';
  const daysMap = { '15m': 1, '1h': 3, '4h': 7, '1d': 90 };
  const days = daysMap[timeframe] || 7;
  const interval = ['15m', '1h', '4h'].includes(timeframe) ? 'hourly' : 'daily';
  const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const prices = data.prices || [];
  const volumes = data.total_volumes || [];
  const candles = prices.slice(-limit).map((p, i) => ({
    timestamp: p[0],
    open: p[1],
    high: p[1] * 1.005,
    low: p[1] * 0.995,
    close: p[1],
    volume: volumes[i] ? volumes[i][1] : 0,
  }));
  candles.dataSource = 'coingecko_proxy';
  return candles;
}

function generateDemoData(symbol, timeframe, limit = 120) {
  const basePrices = {
    BTCUSDT: 96500, ETHUSDT: 2700, SOLUSDT: 195, BNBUSDT: 640,
    XRPUSDT: 2.65, ADAUSDT: 0.78, AVAXUSDT: 36, DOGEUSDT: 0.26,
  };
  let price = basePrices[symbol] || 50000;
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

async function fetchOHLCV(symbol, timeframe, limit = 120) {
  try {
    return await fetchFromBinanceFutures(symbol, timeframe, limit);
  } catch {
    try {
      return await fetchFromCoinGecko(symbol, timeframe, limit);
    } catch {
      return generateDemoData(symbol, timeframe, limit);
    }
  }
}

// ── Futures Context ─────────────────────────────────────────────────────────

async function fetchFuturesContext(symbol, timeframe) {
  const period = mapFuturesPeriod(timeframe);
  let premium = null;
  let openInterestHist = [];
  let longShortHist = [];

  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) premium = await res.json();
  } catch {}

  try {
    const res = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=12`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) openInterestHist = await res.json();
  } catch {}

  try {
    const res = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=12`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) longShortHist = await res.json();
  } catch {}

  const oiSeries = (openInterestHist || [])
    .map((x) => +x.sumOpenInterestValue || +x.sumOpenInterest)
    .filter((x) => Number.isFinite(x));

  const lsSeries = (longShortHist || [])
    .map((x) => +x.longShortRatio)
    .filter((x) => Number.isFinite(x));

  const oiChangePct = oiSeries.length >= 2
    ? ((oiSeries[oiSeries.length - 1] - oiSeries[0]) / oiSeries[0]) * 100
    : null;

  const lsChangePct = lsSeries.length >= 2
    ? ((lsSeries[lsSeries.length - 1] - lsSeries[0]) / lsSeries[0]) * 100
    : null;

  return {
    fundingRate: {
      current: premium?.lastFundingRate != null ? +premium.lastFundingRate : null,
      annualizedPct: premium?.lastFundingRate != null ? +premium.lastFundingRate * 3 * 365 * 100 : null,
      nextFundingTime: premium?.nextFundingTime ? new Date(+premium.nextFundingTime).toISOString() : null,
    },
    openInterest: {
      latest: oiSeries.length ? oiSeries[oiSeries.length - 1] : null,
      changePct: oiChangePct,
    },
    longShortRatio: {
      ratio: lsSeries.length ? lsSeries[lsSeries.length - 1] : null,
      changePct: lsChangePct,
    },
  };
}

// ── Catalyst Watch ──────────────────────────────────────────────────────────

function scoreSentiment(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of BULLISH_TERMS) if (lower.includes(term)) score += 1;
  for (const term of BEARISH_TERMS) if (lower.includes(term)) score -= 1;
  return score;
}

async function fetchCatalystWatch(symbol) {
  const base = symbolBase(symbol).toLowerCase();
  const keywords = SYMBOL_MAP[symbol]?.keywords || [base];
  const macroTerms = ['bitcoin', 'crypto', 'market', 'futures', 'etf', 'regulation', 'fed'];

  let rows = [];
  let trendingRows = [];

  try {
    const res = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH,Market,Regulation&excludeCategories=Sponsored&limit=40', {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      rows = data?.Data || [];
    }
  } catch {}

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      trendingRows = (data?.coins || []).map((entry, idx) => {
        const item = entry.item || {};
        const chg = item?.data?.price_change_percentage_24h?.usd;
        return {
          rank: idx + 1,
          name: item.name || '',
          symbol: (item.symbol || '').toUpperCase(),
          priceChange24h: typeof chg === 'number' ? chg : null,
          marketCapRank: item.market_cap_rank ?? null,
        };
      });
    }
  } catch {}

  const parsed = rows.map((item) => {
    const title = item.title || '';
    const body = item.body || '';
    const text = `${title} ${body}`;
    const lower = text.toLowerCase();
    const direct = keywords.some((k) => lower.includes(k));
    const macro = macroTerms.some((k) => lower.includes(k));
    const relevance = direct ? 1 : (macro ? 0.45 : 0);
    return {
      title,
      source: item?.source_info?.name || item?.source || 'Unknown',
      url: item.url || '',
      publishedAt: item.published_on ? new Date(item.published_on * 1000).toISOString() : null,
      relevance,
      sentimentRaw: scoreSentiment(text),
    };
  }).filter((x) => x.relevance > 0);

  const weightedSum = parsed.reduce((sum, x) => sum + x.sentimentRaw * x.relevance, 0);
  const weightTotal = parsed.reduce((sum, x) => sum + x.relevance, 0);
  const newsScore = weightTotal > 0 ? clamp((weightedSum / weightTotal) * 16, -100, 100) : 0;

  const symbolTrend = trendingRows.find((x) => x.symbol === symbolBase(symbol));
  const trendBoost = symbolTrend ? clamp(14 - symbolTrend.rank * 2, 2, 12) : 0;
  const combinedScore = clamp(newsScore + trendBoost, -100, 100);

  const catalysts = parsed
    .sort((a, b) => Math.abs(b.sentimentRaw * b.relevance) - Math.abs(a.sentimentRaw * a.relevance))
    .slice(0, 6)
    .map((x) => ({
      title: x.title,
      source: x.source,
      url: x.url,
      publishedAt: x.publishedAt,
      sentiment: x.sentimentRaw > 0 ? 'Bullish' : x.sentimentRaw < 0 ? 'Bearish' : 'Neutral',
      impact: round(Math.abs(x.sentimentRaw * x.relevance), 2),
    }));

  return {
    sentimentScore: round(newsScore, 1),
    trendBoost: round(trendBoost, 1),
    combinedScore: round(combinedScore, 1),
    sentimentLabel: sentimentLabel(combinedScore),
    symbolTrendingRank: symbolTrend ? symbolTrend.rank : null,
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
  return {
    currentPrice: price,
    rsi: rsiVal,
    macd: macdVal,
    bollingerBands: bb,
    ema20,
    ema50,
    sma200,
    atr14,
    momentum3: momentum(closes, 3),
    momentum10: momentum(closes, 10),
    volatility20: stdDev(returns.slice(-20)),
    latestVolume,
    avgVolume,
    volumeRatio: avgVolume > 0 ? latestVolume / avgVolume : null,
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
    momentum3,
    momentum10,
    volatility20,
    volumeRatio,
  } = ind;

  const prevMacd = closes.length > 30 ? macd(closes.slice(0, -1)) : { line: null, signal: null, histogram: null };
  const liquidity = buildLiquidityHeatmap(ohlcv, price, 24);

  let buyScore = 0;
  let sellScore = 0;
  let buyEvidence = 0;
  let sellEvidence = 0;
  const reasons = [];
  const addBuy = (points, reason) => { buyScore += points; buyEvidence += 1; reasons.push(reason); };
  const addSell = (points, reason) => { sellScore += points; sellEvidence += 1; reasons.push(reason); };

  const trendBias = ema20 !== null && ema50 !== null ? (ema20 - ema50) / price : 0;
  const strongTrend = Math.abs(trendBias) >= 0.012;
  const regime = strongTrend ? (trendBias > 0 ? 'uptrend' : 'downtrend') : 'range';
  reasons.push(
    regime === 'range'
      ? 'Market regime: ranging - mean reversion signals weighted higher'
      : `Market regime: ${regime} - trend-following signals weighted higher`,
  );

  // RSI
  if (rsiVal !== null) {
    if (regime === 'uptrend') {
      if (rsiVal < 38) addBuy(1.6, `RSI(${rsiVal.toFixed(1)}) pullback in uptrend - dip-buy setup`);
      else if (rsiVal > 78) addSell(1.2, `RSI(${rsiVal.toFixed(1)}) extended in uptrend - exhaustion risk`);
      else reasons.push(`RSI(${rsiVal.toFixed(1)}) healthy for uptrend continuation`);
    } else if (regime === 'downtrend') {
      if (rsiVal > 62) addSell(1.6, `RSI(${rsiVal.toFixed(1)}) bounce in downtrend - sell-the-rally setup`);
      else if (rsiVal < 22) addBuy(1.1, `RSI(${rsiVal.toFixed(1)}) deeply oversold - relief bounce possible`);
      else reasons.push(`RSI(${rsiVal.toFixed(1)}) neutral within downtrend`);
    } else if (rsiVal < 30) addBuy(1.8, `RSI(${rsiVal.toFixed(1)}) oversold in range - bullish mean reversion`);
    else if (rsiVal > 70) addSell(1.8, `RSI(${rsiVal.toFixed(1)}) overbought in range - bearish mean reversion`);
    else reasons.push(`RSI(${rsiVal.toFixed(1)}) neutral in ranging market`);
  }

  // MACD
  if (macdVal.histogram !== null) {
    const histNow = macdVal.histogram;
    const histPrev = prevMacd.histogram;
    if (histNow > 0 && macdVal.line > macdVal.signal) {
      if (histPrev !== null && histPrev <= 0) addBuy(1.9, 'MACD fresh bullish crossover - momentum shift upward');
      else if (histPrev !== null && histNow > histPrev) addBuy(1.4, 'MACD bullish momentum is strengthening');
      else addBuy(1.1, 'MACD remains bullish');
    } else if (histNow < 0 && macdVal.line < macdVal.signal) {
      if (histPrev !== null && histPrev >= 0) addSell(1.9, 'MACD fresh bearish crossover - momentum shift downward');
      else if (histPrev !== null && histNow < histPrev) addSell(1.4, 'MACD bearish momentum is strengthening');
      else addSell(1.1, 'MACD remains bearish');
    }
  }

  // Bollinger + trend
  if (bb.lower !== null && bb.middle !== null && bb.upper !== null) {
    const bandWidth = (bb.upper - bb.lower) / bb.middle;
    if (price <= bb.lower) addBuy(regime === 'downtrend' ? 0.8 : 1.4, `Price touched lower Bollinger Band ($${bb.lower.toFixed(2)})`);
    else if (price >= bb.upper) addSell(regime === 'uptrend' ? 0.8 : 1.4, `Price touched upper Bollinger Band ($${bb.upper.toFixed(2)})`);
    if (bandWidth < 0.04) {
      reasons.push('Bollinger bandwidth compressed - breakout risk rising');
      buyScore *= 0.95;
      sellScore *= 0.95;
    }
  }

  if (ema20 !== null && ema50 !== null) {
    if (price > ema20 && ema20 > ema50) addBuy(1.5, 'Price above EMA20 > EMA50 - bullish structure intact');
    else if (price < ema20 && ema20 < ema50) addSell(1.5, 'Price below EMA20 < EMA50 - bearish structure intact');
    else reasons.push('EMA structure mixed - trend conviction reduced');
  }

  if (sma200 !== null) {
    if (price > sma200) addBuy(0.7, 'Price above SMA200 - long-term support');
    else addSell(0.7, 'Price below SMA200 - long-term pressure');
  }

  // Momentum + volume
  if (momentum3 !== null && momentum10 !== null) {
    if (momentum3 > 0 && momentum10 > 0) addBuy(1.1, 'Short and medium momentum aligned upward');
    else if (momentum3 < 0 && momentum10 < 0) addSell(1.1, 'Short and medium momentum aligned downward');
    else reasons.push('Momentum mixed across windows - transition risk');
  }

  if (volumeRatio !== null) {
    if (volumeRatio > 1.6) {
      reasons.push(`Volume spike (${volumeRatio.toFixed(2)}x avg) - stronger move conviction`);
      if (buyScore > sellScore) buyScore += 0.6;
      else if (sellScore > buyScore) sellScore += 0.6;
    } else if (volumeRatio < 0.75) {
      reasons.push(`Volume below average (${volumeRatio.toFixed(2)}x) - weaker breakout quality`);
      buyScore *= 0.93;
      sellScore *= 0.93;
    }
  }

  // Liquidity heat map
  if (liquidity) {
    const support = liquidity.supportZones[0];
    const resistance = liquidity.resistanceZones[0];
    const atrPct = atr14 !== null ? atr14 / price : 0.006;
    const proximityLimit = Math.max(0.008, atrPct * 1.4);
    if (support) {
      const dist = (price - support.center) / price;
      if (dist >= 0 && dist <= proximityLimit) addBuy(0.9, `Near high-liquidity support zone ($${support.center})`);
    }
    if (resistance) {
      const dist = (resistance.center - price) / price;
      if (dist >= 0 && dist <= proximityLimit) addSell(0.9, `Near high-liquidity resistance zone ($${resistance.center})`);
    }
  }

  // Futures pulse
  const funding = futuresContext?.fundingRate || {};
  const oi = futuresContext?.openInterest || {};
  const longShort = futuresContext?.longShortRatio || {};

  if (funding.current != null && longShort.ratio != null) {
    if (funding.current > 0.0008 && longShort.ratio > 1.1) addSell(1.2, `Funding positive ${(funding.current * 100).toFixed(3)}% with crowded longs`);
    else if (funding.current < -0.0008 && longShort.ratio < 0.9) addBuy(1.2, `Funding negative ${(funding.current * 100).toFixed(3)}% with crowded shorts`);
    else reasons.push(`Funding neutral at ${(funding.current * 100).toFixed(3)}%`);
  }

  if (longShort.ratio != null) {
    if (longShort.ratio > 1.35) addSell(0.7, `Long/Short ratio ${longShort.ratio.toFixed(2)} indicates long crowding`);
    else if (longShort.ratio < 0.75) addBuy(0.7, `Long/Short ratio ${longShort.ratio.toFixed(2)} indicates short crowding`);
  }

  if (oi.changePct != null) {
    if (oi.changePct > 5 && momentum10 != null && momentum10 > 0) addBuy(0.8, `Open interest rising ${oi.changePct.toFixed(1)}% with bullish momentum`);
    else if (oi.changePct > 5 && momentum10 != null && momentum10 < 0) addSell(0.8, `Open interest rising ${oi.changePct.toFixed(1)}% with bearish momentum`);
    else if (oi.changePct < -8) {
      reasons.push(`Open interest dropped ${oi.changePct.toFixed(1)}% - deleveraging phase`);
      buyScore *= 0.96;
      sellScore *= 0.96;
    }
  }

  // Catalyst watch
  const catalystScore = catalystWatch?.combinedScore;
  if (catalystScore != null) {
    if (catalystScore >= 25) addBuy(1.2, `Catalyst watch bullish (${catalystScore.toFixed(1)})`);
    else if (catalystScore <= -25) addSell(1.2, `Catalyst watch bearish (${catalystScore.toFixed(1)})`);
    else reasons.push(`Catalyst watch neutral (${catalystScore.toFixed(1)})`);
  }

  if (catalystWatch?.symbolTrendingRank != null && catalystWatch.symbolTrendingRank <= 5) {
    if (momentum10 != null && momentum10 >= 0) addBuy(0.5, `Asset ranks #${catalystWatch.symbolTrendingRank} on trending topics`);
    else addBuy(0.2, `Asset trending #${catalystWatch.symbolTrendingRank} but momentum still mixed`);
  }

  if (buyScore > 0 && sellScore > 0) {
    const overlap = Math.min(buyScore, sellScore) * 0.35;
    buyScore -= overlap;
    sellScore -= overlap;
    reasons.push('Bullish and bearish evidence both present - applied contradiction penalty');
  }

  const thresholds = { conservative: 5.1, moderate: 3.8, aggressive: 2.8 };
  let threshold = thresholds[riskTolerance] || 3.8;
  if (regime === 'range') threshold += 0.2;
  if (volatility20 !== null && volatility20 > 0.025) threshold += 0.2;

  const edge = Math.abs(buyScore - sellScore);
  const dominantScore = Math.max(buyScore, sellScore);
  let signal = 'HOLD';
  if (buyScore >= threshold && buyScore > sellScore && edge >= 0.9) signal = 'BUY';
  else if (sellScore >= threshold && sellScore > buyScore && edge >= 0.9) signal = 'SELL';
  else reasons.push('Insufficient directional edge after confluence check - wait for confirmation');

  let confidence;
  if (signal === 'HOLD') confidence = clamp(42 + edge * 6, 40, 68);
  else {
    const evidence = signal === 'BUY' ? buyEvidence : sellEvidence;
    confidence = clamp(dominantScore * 12 + edge * 15 + evidence * 1.8, 55, 95);
  }

  const targets = { scalp: [0.01, 0.02, 0.005], swing: [0.03, 0.08, 0.015], position: [0.10, 0.20, 0.03] };
  const [tp1Pct, tp2Pct, slPct] = targets[signalType] || targets.swing;
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
    marketType: 'futures_perpetual',
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
    indicators: {
      rsi: round(rsiVal, 2),
      macd: { line: round(macdVal.line, 4), signal: round(macdVal.signal, 4), histogram: round(macdVal.histogram, 4) },
      bollingerBands: { upper: round(bb.upper, 2), middle: round(bb.middle, 2), lower: round(bb.lower, 2) },
      ema20: round(ema20, 2),
      ema50: round(ema50, 2),
      sma200: round(sma200, 2),
      atr14: round(atr14, 4),
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
      combinedScore: round(catalystWatch.combinedScore, 1),
      sentimentLabel: catalystWatch.sentimentLabel || 'Neutral',
      symbolTrendingRank: catalystWatch.symbolTrendingRank ?? null,
      catalysts: Array.isArray(catalystWatch.catalysts) ? catalystWatch.catalysts.slice(0, 6) : [],
      trendingTopics: Array.isArray(catalystWatch.trendingTopics) ? catalystWatch.trendingTopics.slice(0, 6) : [],
    },
    liquidityHeatmap: liquidity,
    timestamp: new Date().toISOString(),
    dataSource: ohlcv.dataSource || 'live',
  };
}

module.exports = {
  fetchOHLCV,
  fetchFuturesContext,
  fetchCatalystWatch,
  generateSignal,
  SYMBOL_MAP,
};
