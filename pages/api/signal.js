import {
  normalizeTradingSymbol,
  fetchOHLCV,
  fetchFuturesContext,
  fetchCatalystWatch,
  generateSignal,
  SYMBOL_MAP,
} from '../../lib/signalGenerator';

const SUPPORTED_TIMEFRAMES = ['15m', '1h', '4h', '1d'];
const SUPPORTED_SIGNAL_TYPES = ['scalp', 'intraday', 'swing'];
const SUPPORTED_RISK_TOLERANCE = ['conservative', 'moderate', 'aggressive'];
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return clampNumber(value, min, max);
}

const OPENAI_TIMEOUT_MS = numberEnv('OPENAI_TIMEOUT_MS', 6500, 1500, 15000);
const OPENAI_TEMPERATURE = numberEnv('OPENAI_TEMPERATURE', 0.2, 0, 1);
const OPENAI_MAX_OUTPUT_TOKENS = Math.round(numberEnv('OPENAI_MAX_OUTPUT_TOKENS', 500, 120, 1200));
const OPENAI_REASONING_ENABLED_BY_DEFAULT = String(process.env.OPENAI_REASONING_ENABLED || 'true').toLowerCase() !== 'false';

function parseBooleanLike(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function parseJsonFromText(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function cleanStringList(list, minItems, maxItems, maxLen = 180) {
  const rows = Array.isArray(list)
    ? list
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, maxItems)
      .map((item) => item.slice(0, maxLen))
    : [];
  return rows.length >= minItems ? rows : null;
}

async function enhanceReasoningWithOpenAI(result) {
  if (!OPENAI_API_KEY || !OPENAI_REASONING_ENABLED_BY_DEFAULT) {
    return { applied: false };
  }

  const payload = {
    signal: result.signal,
    confidence: result.confidence,
    symbol: result.symbol,
    symbolName: result.symbolName,
    timeframe: result.timeframe,
    signalType: result.signalType,
    riskTolerance: result.riskTolerance,
    currentPrice: result.currentPrice,
    entryRange: result.entryRange,
    takeProfit1: result.takeProfit1,
    takeProfit2: result.takeProfit2,
    stopLoss: result.stopLoss,
    riskReward: result.riskReward,
    signalQuality: result.signalQuality,
    liquidationRiskMeter: result.liquidationRiskMeter,
    breakoutFakeoutDetector: result.breakoutFakeoutDetector,
    indicators: {
      rsi: result.indicators?.rsi,
      macdHistogram: result.indicators?.macd?.histogram,
      ema20: result.indicators?.ema20,
      ema50: result.indicators?.ema50,
      sma200: result.indicators?.sma200,
      atr14: result.indicators?.atr14,
      momentum3: result.indicators?.momentum3,
      momentum10: result.indicators?.momentum10,
      volatility20: result.indicators?.volatility20,
      volumeRatio: result.indicators?.volumeRatio,
    },
    futuresContext: result.futuresContext,
    catalystWatch: {
      sentimentLabel: result.catalystWatch?.sentimentLabel,
      combinedScore: result.catalystWatch?.combinedScore,
      symbolTrendingRank: result.catalystWatch?.symbolTrendingRank,
      catalysts: Array.isArray(result.catalystWatch?.catalysts)
        ? result.catalystWatch.catalysts.slice(0, 4)
        : [],
    },
    liquidityHeatmap: result.liquidityHeatmap,
    baselineReasons: Array.isArray(result.reasons) ? result.reasons.slice(0, 10) : [],
  };

  const prompt = [
    'You are a strict crypto market analyst assistant.',
    'Task: improve explanation quality only; do not change signal direction.',
    'Rules:',
    '- Stay consistent with provided data.',
    '- No financial promises.',
    '- Output JSON only with keys: summary, reasons, riskWarnings, playbook.',
    '- reasons: 4 to 6 concise bullets.',
    '- riskWarnings: 2 to 3 concise bullets.',
    '- playbook: 2 to 3 actionable bullets aligned with signal and risk management.',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        max_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      return { applied: false, warning: `OpenAI reasoning skipped (${response.status}): ${detail.slice(0, 140)}` };
    }

    const json = await response.json();
    const rawContent = json?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonFromText(rawContent);
    const reasons = cleanStringList(parsed?.reasons, 4, 6);
    if (!reasons) {
      return { applied: false, warning: 'OpenAI reasoning skipped: invalid structured response' };
    }

    const summary = String(parsed?.summary || '').trim().slice(0, 240);
    const riskWarnings = cleanStringList(parsed?.riskWarnings, 1, 3, 160) || [];
    const playbook = cleanStringList(parsed?.playbook, 1, 3, 160) || [];

    return {
      applied: true,
      reasons,
      aiReasoning: {
        summary: summary || `${result.signal} setup generated from technical and market context`,
        riskWarnings,
        playbook,
        model: OPENAI_MODEL,
      },
    };
  } catch (err) {
    const reason = err?.name === 'AbortError'
      ? `OpenAI reasoning timed out after ${OPENAI_TIMEOUT_MS}ms`
      : `OpenAI reasoning skipped: ${String(err?.message || 'unknown error')}`;
    return { applied: false, warning: reason };
  } finally {
    clearTimeout(timeout);
  }
}

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function buildEmptyFuturesContext() {
  return {
    fundingRate: { current: null, annualizedPct: null, nextFundingTime: null },
    openInterest: { latest: null, changePct: null },
    longShortRatio: { ratio: null, changePct: null },
    source: 'fallback',
  };
}

function buildEmptyCatalystWatch() {
  return {
    sentimentScore: 0,
    trendBoost: 0,
    combinedScore: 0,
    sentimentLabel: 'Neutral',
    symbolTrendingRank: null,
    catalysts: [],
    trendingTopics: [],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const params = req.method === 'POST' ? req.body : req.query;
  const {
    symbol = 'BTCUSDT',
    geckoId = '',
    symbolName = '',
    symbolBase = '',
    timeframe = '4h',
    signalType = 'swing',
    riskTolerance = 'moderate',
  } = params;
  const normalizedSymbol = normalizeTradingSymbol(symbol || symbolBase || 'BTCUSDT');
  const safeTimeframe = pickAllowed(String(timeframe || '4h'), SUPPORTED_TIMEFRAMES, '4h');
  const safeSignalType = pickAllowed(String(signalType || 'swing'), SUPPORTED_SIGNAL_TYPES, 'swing');
  const safeRiskTolerance = pickAllowed(String(riskTolerance || 'moderate'), SUPPORTED_RISK_TOLERANCE, 'moderate');
  const useAiReasoning = parseBooleanLike(params?.useAI ?? params?.useAi ?? params?.aiReasoning, OPENAI_REASONING_ENABLED_BY_DEFAULT);
  const warnings = [];

  if (safeTimeframe !== timeframe) warnings.push('Invalid timeframe normalized to 4h');
  if (safeSignalType !== signalType) warnings.push('Invalid signalType normalized to swing');
  if (safeRiskTolerance !== riskTolerance) warnings.push('Invalid riskTolerance normalized to moderate');

  try {
    const [ohlcvResult, futuresContextResult, catalystWatchResult] = await Promise.allSettled([
      fetchOHLCV(normalizedSymbol, safeTimeframe, 120, { geckoId }),
      fetchFuturesContext(normalizedSymbol, safeTimeframe, { geckoId }),
      fetchCatalystWatch(normalizedSymbol, {
        geckoId,
        coinName: symbolName,
        coinSymbol: symbolBase || normalizedSymbol.replace(/USDT$/, ''),
      }),
    ]);

    let ohlcv = ohlcvResult.status === 'fulfilled' && Array.isArray(ohlcvResult.value)
      ? ohlcvResult.value
      : [];
    if (!ohlcv.length) {
      warnings.push('Primary OHLCV unavailable, switched to demo fallback');
      ohlcv = await fetchOHLCV('BTCUSDT', safeTimeframe, 120, { geckoId: 'bitcoin' });
    }

    const futuresContext = futuresContextResult.status === 'fulfilled'
      ? futuresContextResult.value
      : buildEmptyFuturesContext();
    if (futuresContextResult.status !== 'fulfilled') {
      warnings.push('Futures context unavailable, served neutral values');
    }

    const catalystWatch = catalystWatchResult.status === 'fulfilled'
      ? catalystWatchResult.value
      : buildEmptyCatalystWatch();
    if (catalystWatchResult.status !== 'fulfilled') {
      warnings.push('Catalyst watch unavailable, served neutral values');
    }

    if (!ohlcv.length) {
      warnings.push('OHLCV fallback still unavailable, generated last-resort demo');
      ohlcv = await fetchOHLCV('BTCUSDT', '4h', 120, { geckoId: 'bitcoin' });
    }

    const result = generateSignal(ohlcv, safeSignalType, safeRiskTolerance, {
      futuresContext,
      catalystWatch,
    });
    const knownCoin = SYMBOL_MAP[normalizedSymbol];
    result.symbol = normalizedSymbol;
    result.symbolName = symbolName || knownCoin?.name || (symbolBase || normalizedSymbol.replace(/USDT$/, '')).toUpperCase();
    result.geckoId = geckoId || knownCoin?.geckoId || null;
    result.timeframe = safeTimeframe;
    result.signalType = safeSignalType;
    result.riskTolerance = safeRiskTolerance;
    result.reasoningSource = 'rules';

    if (useAiReasoning) {
      const aiEnhancement = await enhanceReasoningWithOpenAI(result);
      if (aiEnhancement.applied) {
        result.reasons = aiEnhancement.reasons;
        result.aiReasoning = aiEnhancement.aiReasoning;
        result.reasoningSource = 'openai';
      } else if (aiEnhancement.warning) {
        warnings.push(aiEnhancement.warning);
      }
    }

    result.degraded = warnings.length > 0;
    result.warnings = warnings;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (err) {
    try {
      const fallbackOHLCV = await fetchOHLCV('BTCUSDT', '4h', 120, { geckoId: 'bitcoin' });
      const fallback = generateSignal(fallbackOHLCV, 'swing', 'moderate', {
        futuresContext: buildEmptyFuturesContext(),
        catalystWatch: buildEmptyCatalystWatch(),
      });
      fallback.symbol = 'BTCUSDT';
      fallback.symbolName = 'Bitcoin';
      fallback.geckoId = 'bitcoin';
      fallback.timeframe = '4h';
      fallback.signalType = 'swing';
      fallback.riskTolerance = 'moderate';
      fallback.degraded = true;
      fallback.warnings = ['Signal generation failed, fallback payload returned'];
      fallback.error = err.message;
      return res.status(200).json(fallback);
    } catch {
      return res.status(200).json({
        signal: 'HOLD',
        confidence: 0,
        symbol: 'BTCUSDT',
        symbolName: 'Bitcoin',
        geckoId: 'bitcoin',
        timeframe: '4h',
        signalType: 'swing',
        riskTolerance: 'moderate',
        reasons: ['Temporary API issue, no analysis data available.'],
        indicators: {
          rsi: null,
          macd: { line: null, signal: null, histogram: null },
          bollingerBands: { upper: null, middle: null, lower: null },
          ema20: null,
          ema50: null,
          sma200: null,
          atr14: null,
          momentum3: null,
          momentum10: null,
          volatility20: null,
          volumeRatio: null,
        },
        currentPrice: null,
        entryRange: { low: null, high: null },
        takeProfit1: null,
        takeProfit1Pct: null,
        takeProfit2: null,
        takeProfit2Pct: null,
        stopLoss: null,
        stopLossPct: null,
        riskReward: null,
        futuresContext: buildEmptyFuturesContext(),
        catalystWatch: buildEmptyCatalystWatch(),
        liquidityHeatmap: null,
        liquidationRiskMeter: null,
        breakoutFakeoutDetector: null,
        signalQuality: null,
        marketType: 'fallback',
        dataSource: 'fallback',
        degraded: true,
        warnings: ['Signal endpoint degraded mode response'],
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
