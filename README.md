# 🚀 Crypto Futures Signal

**AI-powered cryptocurrency futures signal generator with technical + catalyst intelligence**

Live Demo: [Coming Soon - Deploy on Vercel]

Built for the [Avalon Vibe Hackathon 2026](https://avalon-vibe.devpost.com/)

---

## 📋 Overview

A sophisticated web application that analyzes cryptocurrency markets in real-time and generates actionable BUY/SELL/HOLD trading signals using multiple technical indicators. Built with Next.js and deployed serverlessly on Vercel.

### Why This Project?

- **Real Market Utility**: Provides objective, data-driven trading signals
- **DeFAI Integration**: Combines DeFi and AI - the hottest trend in crypto 2026
- **Serverless Architecture**: Runs entirely on Vercel's edge network
- **Beautiful UI**: Professional dark-themed interface with responsive design

---

## ✨ Features

### 🎯 Core Capabilities

- **Multi-Indicator Analysis**: RSI, MACD, Bollinger Bands, EMA20, EMA50, ATR, Momentum
- **8 Trading Pairs**: BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOGE
- **4 Timeframes**: 15-minute, 1-hour, 4-hour, daily charts
- **3 Trading Styles**: Scalp (1-2%), Intraday (2-4%), Swing (3-8%)
- **Risk Tolerance Levels**: Conservative, Moderate, Aggressive
- **Futures Pulse Layer**: Funding rate, long/short ratio, open interest trend
- **Catalyst Watch**: News sentiment + trending topic boost
- **Liquidity Heat Map**: High-liquidity support/resistance node detection
- **Signal Confluence Scoring**: Combines technical + derivatives + catalyst context
- **Real-time Data**: Binance Futures API with automatic CoinGecko fallback

### 📊 Signal Output

Each signal includes:
- **Signal Direction**: BUY, SELL, or HOLD with confidence percentage
- **Entry Zone**: Optimal price range to enter the trade
- **Take Profit Targets**: TP1 (50% exit) and TP2 (remaining 50%)
- **Stop Loss**: Risk management exit point
- **Risk/Reward Ratio**: Expected gain vs potential loss
- **Analysis Reasons**: Clear explanation of why the signal was generated
- **Full Indicators**: All technical indicator values displayed

---

## 🏗️ Architecture

### Technology Stack

- **Frontend**: Next.js 14 + React 18
- **API**: Serverless functions on Vercel
- **Styling**: Custom CSS with dark theme
- **Data Sources**: Binance Futures API → CoinGecko API → Demo data fallback
- **Deployment**: Vercel (zero-config deployment)

### Project Structure

```
crypto-futures-signal/
├── lib/
│   └── signalGenerator.js      # Core technical analysis engine
├── pages/
│   ├── _app.js                 # App wrapper with global styles
│   ├── _document.js            # HTML document structure
│   ├── index.js                # Main UI component
│   └── api/
│       └── signal.js           # Serverless API endpoint
├── styles/
│   └── globals.css             # Dark-themed global styles
├── package.json                # Dependencies
├── next.config.js              # Next.js configuration
└── vercel.json                 # Vercel deployment config
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm

### Local Development

```bash
# Clone the repository
git clone https://github.com/nialthony/Crypto-Spot-Signal.git
cd Crypto-Spot-Signal

# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000 in your browser
```

### Build for Production

```bash
npm run build
npm start
```

---

## 📈 How to Use

1. **Select Trading Pair**: Choose from 8 major cryptocurrencies
2. **Pick Timeframe**: Select analysis period (15m/1h/4h/1d)
3. **Choose Signal Type**: Scalp, Intraday, or Swing trading
4. **Set Risk Tolerance**: Conservative, Moderate, or Aggressive
5. **Generate Signal**: Click the button and get instant analysis!

### Signal Interpretation

#### BUY Signal (Green)
- Indicators suggest price will likely increase
- Enter within the entry zone
- Take 50% profit at TP1, move stop-loss to breakeven
- Take remaining 50% at TP2 or trail stop-loss
- Exit immediately if price hits stop-loss

#### SELL Signal (Red)
- Indicators suggest price will likely decrease
- For futures trading: consider short position or hedge long exposure
- Same exit strategy as BUY signal

#### HOLD Signal (Yellow)
- Insufficient confluence for clear direction
- Wait for stronger confirmation
- Monitor price action at key levels
- Don't force trades in unclear conditions

---

## 🎓 Technical Indicators Explained

### RSI (Relative Strength Index)
- **Range**: 0-100
- **Oversold**: < 30 (potential buy opportunity)
- **Overbought**: > 70 (potential sell opportunity)
- **Use**: Identifies momentum and reversal points

### MACD (Moving Average Convergence Divergence)
- **Bullish**: MACD line crosses above signal line
- **Bearish**: MACD line crosses below signal line
- **Use**: Trend direction and momentum changes

### Bollinger Bands
- **Components**: Upper band, Middle (20-day SMA), Lower band
- **Price at lower band**: Oversold condition
- **Price at upper band**: Overbought condition
- **Use**: Volatility measurement and price extremes

### EMA (Exponential Moving Averages)
- **EMA20**: Short-term trend
- **EMA50**: Medium-term trend
- **Bullish alignment**: Price > EMA20 > EMA50
- **Bearish alignment**: Price < EMA20 < EMA50

---

## 🌐 Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/nialthony/Crypto-Spot-Signal)

### Manual Deployment

1. Push this repo to your GitHub account
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Click "Deploy"
6. Done! Your app is live in ~60 seconds

No environment variables or configuration needed - it just works!

---

## 🎯 API Endpoint

### GET/POST `/api/signal`

Generate a trading signal programmatically.

**Query Parameters:**
- `symbol` (required): Trading pair (e.g., BTCUSDT)
- `timeframe` (required): Analysis period (15m/1h/4h/1d)
- `signalType` (required): Trading style (scalp/intraday/swing)
- `riskTolerance` (required): Risk level (conservative/moderate/aggressive)

**Example Request:**
```bash
curl "https://your-app.vercel.app/api/signal?symbol=BTCUSDT&timeframe=4h&signalType=swing&riskTolerance=moderate"
```

**Example Response:**
```json
{
  "signal": "BUY",
  "confidence": 78.5,
  "currentPrice": 96234.50,
  "entryRange": { "low": 96042, "high": 96427 },
  "takeProfit1": 99121,
  "takeProfit2": 103933,
  "stopLoss": 94790,
  "riskReward": 5.32,
  "reasons": [
    "RSI(28.4) in oversold zone - bullish reversal likely",
    "MACD bullish crossover - upward momentum",
    "Price at lower Bollinger Band ($94230) - oversold"
  ],
  "indicators": { ... }
}
```

---

## ⚠️ Risk Disclaimer

**IMPORTANT**: This tool provides technical analysis-based signals and is **NOT financial advice**.

- Always conduct your own research (DYOR)
- Never invest more than you can afford to lose
- Past performance does not guarantee future results
- Use proper risk management and position sizing
- Consider market conditions, news, and fundamentals
- This tool is for educational and informational purposes only

**Cryptocurrency trading involves substantial risk of loss.**

---

## 🔮 Future Enhancements

- [ ] **On-Chain Analysis**: Whale wallet tracking, exchange flow data
- [ ] **Sentiment Layer**: Social media and news sentiment scoring
- [ ] **Machine Learning**: Pattern recognition and signal performance prediction
- [ ] **Backtesting Engine**: Historical signal performance analysis
- [ ] **Portfolio Tracking**: Monitor signal performance over time
- [ ] **Real-time Alerts**: Telegram/Discord bot for instant notifications
- [ ] **Multi-Coin Dashboard**: Compare signals across all 8 pairs
- [ ] **Price Charts**: Candlestick charts with indicator overlays
- [ ] **Custom Indicators**: User-defined technical indicators
- [ ] **Signal History**: Track and analyze past signals

---

## 🏆 Hackathon Submission

**Built for**: Avalon Vibe Hackathon 2026 (Feb 14-17, 2026)

### Why This Project Stands Out

✅ **Real-World Utility** - Solves actual trader problems
✅ **Technical Depth** - 6+ indicators with confluence scoring
✅ **Production Quality** - Professional UI, error handling, fallbacks
✅ **Serverless** - Deployed on Vercel edge network
✅ **DeFAI Trend** - Combines DeFi + AI (2026's hottest narrative)
✅ **Extensible** - Easy to add ML, on-chain data, automation

---

## 📚 Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel Platform](https://vercel.com/docs)
- [Binance Futures API](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api)
- [CoinGecko API](https://www.coingecko.com/en/api)
- [Technical Analysis Education](https://www.tradingview.com/education/)

---

## 📄 License

MIT License - Free to use for educational and non-commercial purposes

---

## 🙏 Acknowledgments

- **Avalon Vibe Hackathon** for the opportunity
- **CREAO Platform** for agentapp infrastructure
- **Binance** and **CoinGecko** for free market data APIs
- **Vercel** for seamless serverless deployment
- **Crypto Trading Community** for inspiration

---

**Built with ❤️ for the Avalon Vibe Hackathon 2026**

*Generate smarter signals. Trade with confidence.*

---

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs or issues
- Suggest new features
- Submit pull requests
- Share feedback

---

**Questions?** Open an issue or contact the maintainer.

**Star this repo** if you find it useful! ⭐
