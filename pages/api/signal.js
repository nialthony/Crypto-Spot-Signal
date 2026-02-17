import {
  normalizeTradingSymbol,
  fetchOHLCV,
  fetchFuturesContext,
  fetchCatalystWatch,
  generateSignal,
  SYMBOL_MAP,
} from '../../lib/signalGenerator';

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

  // Validate inputs
  if (!['15m', '1h', '4h', '1d'].includes(timeframe)) {
    return res.status(400).json({ error: 'Invalid timeframe. Supported: 15m, 1h, 4h, 1d' });
  }
  if (!['scalp', 'intraday', 'swing'].includes(signalType)) {
    return res.status(400).json({ error: 'Invalid signalType. Supported: scalp, intraday, swing' });
  }
  if (!['conservative', 'moderate', 'aggressive'].includes(riskTolerance)) {
    return res.status(400).json({ error: 'Invalid riskTolerance. Supported: conservative, moderate, aggressive' });
  }

  try {
    const [ohlcv, futuresContext, catalystWatch] = await Promise.all([
      fetchOHLCV(normalizedSymbol, timeframe, 120, { geckoId }),
      fetchFuturesContext(normalizedSymbol, timeframe, { geckoId }),
      fetchCatalystWatch(normalizedSymbol, {
        geckoId,
        coinName: symbolName,
        coinSymbol: symbolBase || normalizedSymbol.replace(/USDT$/, ''),
      }),
    ]);

    if (!ohlcv.length) {
      return res.status(500).json({ error: 'Failed to fetch market data' });
    }

    const result = generateSignal(ohlcv, signalType, riskTolerance, {
      futuresContext,
      catalystWatch,
    });
    const knownCoin = SYMBOL_MAP[normalizedSymbol];
    result.symbol = normalizedSymbol;
    result.symbolName = symbolName || knownCoin?.name || (symbolBase || normalizedSymbol.replace(/USDT$/, '')).toUpperCase();
    result.geckoId = geckoId || knownCoin?.geckoId || null;
    result.timeframe = timeframe;
    result.signalType = signalType;
    result.riskTolerance = riskTolerance;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Signal generation failed', details: err.message });
  }
}
