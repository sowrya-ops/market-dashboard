# Market Dashboard

Live crypto & market prices — BTC, ETH, SOL, BNB, USDT, USDC, Gold, Silver, Crude Oil, USD/INR, USD/PHP, USD/IDR across CoinDCX, ZebPay, CoinSwitch, WazirX.

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/market-dashboard.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repo
3. Click **Deploy** — no environment variables needed

That's it. Your dashboard will be live at `https://market-dashboard.vercel.app`

## Project Structure

```
market-dashboard/
├── index.html          # Main dashboard (static)
├── api/
│   └── prices.js       # Serverless function — fetches CoinSwitch prices
├── vercel.json         # Vercel routing config
├── package.json
└── proxy-server.js     # Local dev only (optional)
```

## Data Sources

| Data | Source | Auth |
|---|---|---|
| Crypto USD prices | CoinGecko | None |
| Exchange INR prices | CoinDCX REST API | None |
| Exchange INR prices | ZebPay WebSocket | None |
| Exchange INR prices | WazirX REST API | None |
| CoinSwitch prices | Vercel serverless scraper | None |
| Gold / Silver | gold-api.com | None |
| USD/INR, PHP, IDR | open.er-api.com | None |
| Crude Oil | Yahoo Finance | None |

## Local Development

```bash
node proxy-server.js   # Start CoinSwitch proxy on localhost:3456
# Then open index.html in browser
# Note: change /api/prices back to http://localhost:3456/prices in index.html for local dev
```
