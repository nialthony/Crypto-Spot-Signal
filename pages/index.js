import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';

const DEFAULT_COIN = {
  id: 'bitcoin',
  name: 'Bitcoin',
  symbol: 'BTC',
  pair: 'BTCUSDT',
};
const COIN_SEARCH_CACHE_TTL_MS = Math.max(
  60 * 1000,
  Number(process.env.NEXT_PUBLIC_COIN_SEARCH_CACHE_TTL_MS || 8 * 60 * 1000),
);

const TIMEFRAMES = [
  { value: '15m', label: '15 Min' },
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hour' },
  { value: '1d', label: '1 Day' },
];

const SIGNAL_TYPES = [
  { value: 'scalp', label: 'Scalp' },
  { value: 'intraday', label: 'Intraday' },
  { value: 'swing', label: 'Swing' },
];

const RISK_LEVELS = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'aggressive', label: 'Aggressive' },
];

const THEMES = [
  { value: 'chalkboard', label: 'Chalkboard Pixel' },
  { value: 'neon-grid', label: 'Neon Grid' },
  { value: 'amber-crt', label: 'Amber CRT' },
  { value: 'frost-byte', label: 'Frost Byte' },
];

function fmt(n, decimals) {
  if (n == null) return '-';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(decimals ?? 2);
  return n.toFixed(decimals ?? 4);
}

function fmtPct(n, decimals = 2) {
  if (n == null) return '-';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

function toneClass(n) {
  if (n == null) return '';
  if (n > 0) return 'pct-pos';
  if (n < 0) return 'pct-neg';
  return '';
}

function scoreTone(score) {
  if (score == null) return '';
  if (score >= 75) return 'pct-pos';
  if (score <= 40) return 'pct-neg';
  return '';
}

function liquidationBiasLabel(bias) {
  if (bias === 'LONGS_AT_RISK') return 'Longs At Risk';
  if (bias === 'SHORTS_AT_RISK') return 'Shorts At Risk';
  return 'Balanced';
}

function normalizeSymbolText(raw) {
  const cleaned = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return 'BTC';
  return cleaned.replace(/USDT$/, '');
}

function parseAnalyzeCommand(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^analyze\s+([a-z0-9._-]{1,24})$/i);
  if (!match) return null;
  return normalizeSymbolText(match[1]);
}

export default function Home() {
  const coinSearchCacheRef = useRef(new Map());
  const [coinQuery, setCoinQuery] = useState(DEFAULT_COIN.name);
  const [commandInput, setCommandInput] = useState('analyze BTC');
  const [commandMessage, setCommandMessage] = useState('Run: analyze [symbol], then choose one result to auto analyze');
  const [selectedCoin, setSelectedCoin] = useState(DEFAULT_COIN);
  const [coinSuggestions, setCoinSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchingCoins, setSearchingCoins] = useState(false);
  const [timeframe, setTimeframe] = useState('4h');
  const [signalType, setSignalType] = useState('swing');
  const [riskTolerance, setRiskTolerance] = useState('moderate');
  const [theme, setTheme] = useState('chalkboard');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedTheme = window.localStorage.getItem('ui-theme');
    if (savedTheme && THEMES.some((t) => t.value === savedTheme)) {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ui-theme', theme);
    }
  }, [theme]);

  async function searchCoinSuggestions(rawKeyword, options = {}) {
    const keyword = String(rawKeyword || coinQuery || '').trim();
    if (!keyword) {
      setCoinSuggestions([]);
      setSearchingCoins(false);
      setShowSuggestions(false);
      return [];
    }

    const normalizedKeyword = keyword.toLowerCase();
    const cached = coinSearchCacheRef.current.get(normalizedKeyword);
    if (cached && cached.expiresAt > Date.now()) {
      const coins = (cached.coins || []).slice(0, 5);
      setCoinSuggestions(coins);
      setShowSuggestions(options.forceShow !== false);
      return coins;
    }

    setSearchingCoins(true);
    setShowSuggestions(options.forceShow !== false);
    try {
      const params = new URLSearchParams({ q: keyword, limit: '5' });
      const res = await fetch(`/api/coins/search?${params}`);
      if (!res.ok) throw new Error('Search request failed');
      const payload = await res.json();
      const coins = Array.isArray(payload.coins) ? payload.coins.slice(0, 5) : [];
      setCoinSuggestions(coins);
      coinSearchCacheRef.current.set(normalizedKeyword, {
        coins,
        expiresAt: Date.now() + COIN_SEARCH_CACHE_TTL_MS,
      });
      if (coinSearchCacheRef.current.size > 120) {
        const oldest = coinSearchCacheRef.current.keys().next().value;
        if (oldest) coinSearchCacheRef.current.delete(oldest);
      }
      return coins;
    } catch {
      setCoinSuggestions([]);
      return [];
    } finally {
      setSearchingCoins(false);
    }
  }

  async function runAnalyzeCommand(e) {
    if (e) e.preventDefault();
    if (loading || searchingCoins) return;
    const parsedSymbol = parseAnalyzeCommand(commandInput);
    if (!parsedSymbol) {
      setCommandMessage('Invalid command. Use: analyze BTC');
      setCoinSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setSelectedCoin(null);
    setCoinQuery(parsedSymbol);
    setCommandMessage(`Searching matches for ${parsedSymbol}...`);
    const results = await searchCoinSuggestions(parsedSymbol, { forceShow: true });
    if (!results.length) {
      setCommandMessage(`No coin found for ${parsedSymbol}. Try another symbol.`);
      return;
    }
    setCommandMessage(`Found ${results.length} matches for ${parsedSymbol}. Pick one to analyze.`);
  }

  async function generate(coinOverride = null, options = {}) {
    setLoading(true);
    setError(null);
    try {
      let coin = coinOverride || selectedCoin;
      const typed = coinQuery.trim();

      if (!coin && typed.length >= 2) {
        const searchParams = new URLSearchParams({ q: typed, limit: '1' });
        const searchRes = await fetch(`/api/coins/search?${searchParams}`);
        if (searchRes.ok) {
          const searchPayload = await searchRes.json();
          if (Array.isArray(searchPayload.coins) && searchPayload.coins.length) {
            [coin] = searchPayload.coins;
          }
        }
      }

      if (!coin) {
        const normalized = normalizeSymbolText(typed);
        coin = {
          id: '',
          name: typed || normalized,
          symbol: normalized,
          pair: `${normalized}USDT`,
        };
      }

      const params = new URLSearchParams({
        symbol: coin.pair || `${normalizeSymbolText(coin.symbol)}USDT`,
        geckoId: coin.id || '',
        symbolName: coin.name || '',
        symbolBase: coin.symbol || normalizeSymbolText(coin.name),
        timeframe,
        signalType,
        riskTolerance,
      });
      const res = await fetch(`/api/signal?${params}`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setData(await res.json());
      setSelectedCoin(coin);
      setCoinQuery(coin.name || coin.symbol);
      setShowSuggestions(false);
    } catch (e) {
      setError(e.message);
      if (options.rethrow) throw e;
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggestionSelect(coin) {
    setSelectedCoin(coin);
    setCoinQuery(coin.symbol);
    setShowSuggestions(false);
    setCommandMessage(`Analyzing ${coin.name} (${coin.symbol})...`);
    try {
      await generate(coin, { rethrow: true });
      setCommandMessage(`Analysis complete for ${coin.name} (${coin.symbol})`);
    } catch {
      setCommandMessage(`Analysis failed for ${coin.name} (${coin.symbol})`);
    }
  }

  const signalClass = data ? data.signal.toLowerCase() : '';

  return (
    <>
      <Head>
        <title>Catalyst8 Signal Terminal</title>
      </Head>

      <div className="terminal-shell">
        <div className="terminal-topbar">
          <div className="terminal-dots">
            <span className="dot dot-red" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </div>
          <div className="terminal-title">catalyst8@terminal:~</div>
        </div>
        <div className="terminal-screen">
          <div className="container">
            {/* Header */}
            <header className="header terminal-header">
              <div className="terminal-header-main">
                <p className="terminal-line">$ boot catalyst8-signal --mode futures</p>
                <h1>Catalyst8 Signal</h1>
                <p>Terminal market intelligence with confluence, catalyst watch, and liquidity heat map</p>
              </div>
              <div className="sponsor-bar">
                <a
                  className="sponsor-link"
                  href="https://creao.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="CREAO sponsor"
                >
                  <img
                    src="https://image.pitchbook.com/up3cCFiKSj2jIsAKxTNB3ligmx01754048047683_200x200"
                    alt="CREAO logo"
                    width="24"
                    height="24"
                  />
                </a>
              </div>
            </header>

            <div className="form-card terminal-command-panel">
              <div className="terminal-command-title">Command Panel</div>
              <form className="terminal-command-row" onSubmit={runAnalyzeCommand}>
                <span className="terminal-command-prompt">&gt;</span>
                <input
                  className="terminal-command-input"
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="analyze BTC"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="terminal-command-btn" type="submit" disabled={loading || searchingCoins}>
                  Run
                </button>
              </form>
              <div className="terminal-command-help">{commandMessage}</div>
              {showSuggestions && (
                <div className="terminal-command-suggestions">
                  {searchingCoins && <div className="coin-suggestion muted">Searching...</div>}
                  {!searchingCoins && coinSuggestions.length === 0 && (
                    <div className="coin-suggestion muted">No coin found</div>
                  )}
                  {!searchingCoins && coinSuggestions.map((coin) => (
                    <button
                      key={`${coin.id}-${coin.symbol}`}
                      type="button"
                      className="coin-suggestion"
                      onClick={() => handleSuggestionSelect(coin)}
                    >
                      <span className="coin-main">
                        <span className="coin-name">{coin.name}</span>
                        <span className="coin-symbol">{coin.symbol}</span>
                      </span>
                      <span className="coin-meta">{coin.marketCapRank ? `#${coin.marketCapRank}` : '-'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

        {/* Form */}
        <div className="form-card">
          <div className="form-grid">
            <div className="form-group">
              <label>Timeframe</label>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                {TIMEFRAMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Signal Type</label>
              <select value={signalType} onChange={(e) => setSignalType(e.target.value)}>
                {SIGNAL_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Risk Tolerance</label>
              <select value={riskTolerance} onChange={(e) => setRiskTolerance(e.target.value)}>
                {RISK_LEVELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Terminal Skin</label>
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {THEMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <button className="btn-generate" onClick={generate} disabled={loading}>
            {loading ? 'Running analysis...' : 'Run Analysis'}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="form-card">
            <div className="loader">
              <div className="spinner" />
              <span>Fetching market data & running technical analysis...</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="form-card" style={{ borderColor: 'var(--red)' }}>
            <p style={{ color: 'var(--red)' }}>Error: {error}</p>
          </div>
        )}

        {/* Results */}
        {data && !loading && (
          <div className="form-card">
            {/* Signal header */}
            <div className="signal-header">
              <div className="signal-badge" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`signal-badge ${signalClass}`}>
                  {data.signal === 'BUY' && '▲ '}{data.signal === 'SELL' && '▼ '}{data.signal === 'HOLD' && '◆ '}
                  {data.signal}
                </span>
              </div>
              <div className="signal-meta">
                <div>{data.symbolName} &middot; {data.timeframe.toUpperCase()} &middot; {data.signalType.charAt(0).toUpperCase() + data.signalType.slice(1)}</div>
                <div>{new Date(data.timestamp).toLocaleString()}</div>
              </div>
            </div>

            {/* Confidence */}
            <div className="confidence-section">
              <div className="confidence-label">
                <span>Confidence</span>
                <span>{data.confidence}%</span>
              </div>
              <div className="confidence-bar">
                <div className={`confidence-fill ${signalClass}`} style={{ width: `${data.confidence}%` }} />
              </div>
            </div>

            {/* Signal Quality */}
            {data.signalQuality && (
              <div className="quality-panel">
                <div className="quality-head">
                  <div>
                    <div className="quality-title">Signal Quality</div>
                    <div className="quality-sub">0-100 confluence score with factor breakdown</div>
                  </div>
                  <div className={`quality-score ${scoreTone(data.signalQuality.score)}`}>
                    {data.signalQuality.score} <span>{data.signalQuality.grade}</span>
                  </div>
                </div>
                <div className="quality-bar">
                  <div className="quality-fill" style={{ width: `${Math.min(100, data.signalQuality.score)}%` }} />
                </div>
                <div className="quality-metrics">
                  <div>Confluence: {data.signalQuality.confluencePoints}</div>
                  <div>Opposition: {data.signalQuality.oppositionPoints}</div>
                </div>
                {(data.signalQuality.breakdown || []).map((item) => (
                  <div className="quality-row" key={item.key}>
                    <span>{item.label}</span>
                    <span>{item.points} ({item.contributionPct}%)</span>
                  </div>
                ))}
              </div>
            )}

            {/* Price */}
            <div className="price-row">${fmt(data.currentPrice)}</div>

            {/* Trading Levels */}
            {data.signal !== 'HOLD' && (
              <table className="levels-table">
                <thead>
                  <tr><th>Level</th><th>Price</th><th>Change</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Entry Zone</td>
                    <td>${fmt(data.entryRange.low)} - ${fmt(data.entryRange.high)}</td>
                    <td style={{ color: 'var(--text-dim)' }}>Current</td>
                  </tr>
                  <tr>
                    <td>Take Profit 1</td>
                    <td>${fmt(data.takeProfit1)}</td>
                    <td className={data.takeProfit1Pct >= 0 ? 'pct-pos' : 'pct-neg'}>
                      {data.takeProfit1Pct >= 0 ? '+' : ''}{data.takeProfit1Pct}%
                    </td>
                  </tr>
                  <tr>
                    <td>Take Profit 2</td>
                    <td>${fmt(data.takeProfit2)}</td>
                    <td className={data.takeProfit2Pct >= 0 ? 'pct-pos' : 'pct-neg'}>
                      {data.takeProfit2Pct >= 0 ? '+' : ''}{data.takeProfit2Pct}%
                    </td>
                  </tr>
                  <tr>
                    <td>Stop Loss</td>
                    <td>${fmt(data.stopLoss)}</td>
                    <td className={data.stopLossPct >= 0 ? 'pct-pos' : 'pct-neg'}>
                      {data.stopLossPct >= 0 ? '+' : ''}{data.stopLossPct}%
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Risk/Reward */}
            {data.signal !== 'HOLD' && (
              <div style={{ marginBottom: 24 }}>
                <span className="rr-badge">Risk / Reward &nbsp; 1 : {data.riskReward}</span>
              </div>
            )}

            {/* Liquidation Risk Meter */}
            {data.liquidationRiskMeter && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', marginBottom: 10 }}>
                  Liquidation Risk Meter
                </h3>
                <div className="quality-panel">
                  <div className="quality-head">
                    <div>
                      <div className="quality-title">{data.liquidationRiskMeter.level}</div>
                      <div className="quality-sub">{liquidationBiasLabel(data.liquidationRiskMeter.bias)}</div>
                    </div>
                    <div className={`quality-score ${scoreTone(data.liquidationRiskMeter.score)}`}>
                      {data.liquidationRiskMeter.score}
                    </div>
                  </div>
                  <div className="quality-bar">
                    <div className="quality-fill" style={{ width: `${Math.min(100, data.liquidationRiskMeter.score)}%` }} />
                  </div>
                  <div className="quality-metrics">
                    <div>Long Risk: {data.liquidationRiskMeter.longRiskScore}</div>
                    <div>Short Risk: {data.liquidationRiskMeter.shortRiskScore}</div>
                  </div>
                  {(data.liquidationRiskMeter.factors || []).slice(0, 3).map((item, idx) => (
                    <div className="quality-row" key={`liq-${idx}`}>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Breakout vs Fakeout Detector */}
            {data.breakoutFakeoutDetector && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', marginBottom: 10 }}>
                  Breakout vs Fakeout Detector
                </h3>
                <div className="quality-panel">
                  <div className="quality-head">
                    <div>
                      <div className="quality-title">{data.breakoutFakeoutDetector.pattern.replace(/_/g, ' ')}</div>
                      <div className="quality-sub">{data.breakoutFakeoutDetector.summary}</div>
                    </div>
                    <div className={`quality-score ${scoreTone(data.breakoutFakeoutDetector.confidence)}`}>
                      {data.breakoutFakeoutDetector.confidence}
                    </div>
                  </div>
                  {data.breakoutFakeoutDetector.breakLevel && (
                    <div className="quality-metrics">
                      <div>Break Level: ${fmt(data.breakoutFakeoutDetector.breakLevel)}</div>
                      <div>Bias: {data.breakoutFakeoutDetector.bias}</div>
                    </div>
                  )}
                  {data.breakoutFakeoutDetector.metrics && (
                    <div className="quality-metrics">
                      <div>Body Ratio: {data.breakoutFakeoutDetector.metrics.bodyRatio ?? '-'}</div>
                      <div>Volume Ratio: {data.breakoutFakeoutDetector.metrics.volumeRatio ?? '-'}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Market Pulse */}
            {data.futuresContext && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', marginBottom: 10 }}>
                  Market Pulse
                </h3>
                <div className="indicators-grid">
                  <div className="indicator-card">
                    <div className="label">Funding Rate</div>
                    <div className={`value ${toneClass(data.futuresContext.fundingRate?.current)}`}>
                      {data.futuresContext.fundingRate?.current != null ? fmtPct(data.futuresContext.fundingRate.current * 100, 3) : '-'}
                    </div>
                  </div>
                  <div className="indicator-card">
                    <div className="label">Funding Annualized</div>
                    <div className={`value ${toneClass(data.futuresContext.fundingRate?.annualizedPct)}`}>
                      {data.futuresContext.fundingRate?.annualizedPct != null ? fmtPct(data.futuresContext.fundingRate.annualizedPct, 2) : '-'}
                    </div>
                  </div>
                  <div className="indicator-card">
                    <div className="label">Open Interest Change</div>
                    <div className={`value ${toneClass(data.futuresContext.openInterest?.changePct)}`}>
                      {data.futuresContext.openInterest?.changePct != null ? fmtPct(data.futuresContext.openInterest.changePct, 2) : '-'}
                    </div>
                  </div>
                  <div className="indicator-card">
                    <div className="label">Long/Short Ratio</div>
                    <div className="value">
                      {data.futuresContext.longShortRatio?.ratio != null ? data.futuresContext.longShortRatio.ratio.toFixed(2) : '-'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Catalyst Watch */}
            {data.catalystWatch && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', marginBottom: 10 }}>
                  Catalyst Watch
                </h3>
                <div className="indicators-grid" style={{ marginBottom: 10 }}>
                  <div className="indicator-card">
                    <div className="label">Catalyst Score</div>
                    <div className={`value ${toneClass(data.catalystWatch.combinedScore)}`}>
                      {data.catalystWatch.combinedScore ?? '-'}
                    </div>
                  </div>
                  <div className="indicator-card">
                    <div className="label">Sentiment Bias</div>
                    <div className="value">{data.catalystWatch.sentimentLabel || '-'}</div>
                  </div>
                  <div className="indicator-card">
                    <div className="label">Trend Boost</div>
                    <div className={`value ${toneClass(data.catalystWatch.trendBoost)}`}>
                      {data.catalystWatch.trendBoost != null ? fmtPct(data.catalystWatch.trendBoost, 1) : '-'}
                    </div>
                  </div>
                  <div className="indicator-card">
                    <div className="label">Symbol Trending Rank</div>
                    <div className="value">
                      {data.catalystWatch.symbolTrendingRank ? `#${data.catalystWatch.symbolTrendingRank}` : '-'}
                    </div>
                  </div>
                </div>
                {(data.catalystWatch.catalysts || []).slice(0, 4).map((item, idx) => (
                  <div className="reason-item" key={`cat-${idx}`}>
                    <span style={{ flexShrink: 0 }}>{idx + 1}.</span>
                    <span>
                      [{item.sentiment}] {item.title} {item.source ? `(${item.source})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Liquidity Heat Map */}
            {data.liquidityHeatmap && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', marginBottom: 10 }}>
                  Liquidity Heat Map
                </h3>
                <table className="levels-table">
                  <thead>
                    <tr><th>Zone</th><th>Price</th><th>Intensity</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Nearest Support</td>
                      <td>${fmt(data.liquidityHeatmap.supportZones?.[0]?.center)}</td>
                      <td>{data.liquidityHeatmap.supportZones?.[0]?.intensity != null ? `${data.liquidityHeatmap.supportZones[0].intensity}%` : '-'}</td>
                    </tr>
                    <tr>
                      <td>Nearest Resistance</td>
                      <td>${fmt(data.liquidityHeatmap.resistanceZones?.[0]?.center)}</td>
                      <td>{data.liquidityHeatmap.resistanceZones?.[0]?.intensity != null ? `${data.liquidityHeatmap.resistanceZones[0].intensity}%` : '-'}</td>
                    </tr>
                    <tr>
                      <td>Strongest Node</td>
                      <td>${fmt(data.liquidityHeatmap.hotspots?.[0]?.center)}</td>
                      <td>{data.liquidityHeatmap.hotspots?.[0]?.intensity != null ? `${data.liquidityHeatmap.hotspots[0].intensity}%` : '-'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Reasons */}
            <div className="reasons-section">
              <h3>Analysis</h3>
              {data.reasons.map((r, i) => (
                <div className="reason-item" key={i}>
                  <span style={{ flexShrink: 0 }}>{i + 1}.</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>

            {/* Indicators */}
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', marginBottom: 10 }}>Indicators</h3>
              <div className="indicators-grid">
                <div className="indicator-card">
                  <div className="label">RSI (14)</div>
                  <div className="value" style={{ color: data.indicators.rsi < 30 ? 'var(--green)' : data.indicators.rsi > 70 ? 'var(--red)' : 'var(--text)' }}>
                    {data.indicators.rsi ?? '-'}
                  </div>
                </div>
                <div className="indicator-card">
                  <div className="label">MACD Line</div>
                  <div className="value" style={{ color: data.indicators.macd.histogram > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {data.indicators.macd.line ?? '-'}
                  </div>
                </div>
                <div className="indicator-card">
                  <div className="label">MACD Histogram</div>
                  <div className="value" style={{ color: data.indicators.macd.histogram > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {data.indicators.macd.histogram ?? '-'}
                  </div>
                </div>
                <div className="indicator-card">
                  <div className="label">BB Upper</div>
                  <div className="value">${fmt(data.indicators.bollingerBands.upper)}</div>
                </div>
                <div className="indicator-card">
                  <div className="label">BB Middle</div>
                  <div className="value">${fmt(data.indicators.bollingerBands.middle)}</div>
                </div>
                <div className="indicator-card">
                  <div className="label">BB Lower</div>
                  <div className="value">${fmt(data.indicators.bollingerBands.lower)}</div>
                </div>
                <div className="indicator-card">
                  <div className="label">EMA 20</div>
                  <div className="value">${fmt(data.indicators.ema20)}</div>
                </div>
                <div className="indicator-card">
                  <div className="label">EMA 50</div>
                  <div className="value">${fmt(data.indicators.ema50)}</div>
                </div>
                <div className="indicator-card">
                  <div className="label">ATR 14</div>
                  <div className="value">{fmt(data.indicators.atr14, 4)}</div>
                </div>
                <div className="indicator-card">
                  <div className="label">Momentum 3</div>
                  <div className={`value ${toneClass(data.indicators.momentum3)}`}>
                    {data.indicators.momentum3 != null ? fmtPct(data.indicators.momentum3, 2) : '-'}
                  </div>
                </div>
                <div className="indicator-card">
                  <div className="label">Momentum 10</div>
                  <div className={`value ${toneClass(data.indicators.momentum10)}`}>
                    {data.indicators.momentum10 != null ? fmtPct(data.indicators.momentum10, 2) : '-'}
                  </div>
                </div>
                <div className="indicator-card">
                  <div className="label">Volume Ratio</div>
                  <div className="value">{data.indicators.volumeRatio ?? '-'}</div>
                </div>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="disclaimer">
              <strong>Disclaimer:</strong> This signal is generated using automated technical analysis and is not financial advice. Always DYOR and never invest more than you can afford to lose.
            </div>
          </div>
        )}

        {/* Footer */}
            <footer className="footer">
              catalyst8_signal::online | Built for{' '}
              <a href="https://avalon-vibe.devpost.com/" target="_blank" rel="noopener noreferrer">Avalon Vibe Hackathon 2026</a>
              {' '}&middot; Powered by <a href="https://creao.ai" target="_blank" rel="noopener noreferrer">CREAO</a>
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}
