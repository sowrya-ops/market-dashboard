/**
 * CoinSwitch Local Price Proxy
 * ────────────────────────────────────────────────
 * Zero dependencies — uses only Node.js built-ins
 *
 * HOW TO RUN (one command):
 *   node coinswitch_proxy_server.js
 *
 * Then open your dashboard HTML — CoinSwitch prices appear automatically.
 * Press Ctrl+C to stop.
 *
 * Runs on: http://localhost:3456/prices
 * Returns: { btc, eth, usdt, sol }  (INR prices as numbers)
 * ────────────────────────────────────────────────
 */

const http  = require('http');
const https = require('https');

const PORT      = 3456;
const CACHE_TTL = 20000; // ms — refresh every 20s

const COINS = [
  { id: 'btc',  url: 'https://coinswitch.co/coins/bitcoin',  minPrice: 100    },
  { id: 'eth',  url: 'https://coinswitch.co/coins/ethereum', minPrice: 100    },
  { id: 'usdt', url: 'https://coinswitch.co/coins/tether',   minPrice: 0.1    },
  { id: 'sol',  url: 'https://coinswitch.co/coins/solana',   minPrice: 1      },
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── fetch a URL, follow redirects ──────────────────────────────
function get(targetUrl, redirects) {
  redirects = redirects || 0;
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const opts = new URL(targetUrl);
    const req = https.request({
      hostname: opts.hostname,
      path:     opts.pathname + opts.search,
      method:   'GET',
      headers:  {
        'User-Agent':      UA,
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
      timeout: 12000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : opts.origin + res.headers.location;
        return resolve(get(next, redirects + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── parse ₹ price from SSR HTML ────────────────────────────────
function parsePrice(html, minPrice, coinId) {
  const RX = /(?:₹|&#x20B9;|Rs\.?\s*)/;

  // Strategy 1: title tag — supports both "₹66,44,903" and "₹8752.71" (no comma)
  let m = html.match(/<title>[^<]*?(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (v >= minPrice && v < 1e9) { console.log(`    [${coinId}] Strategy1 title: ${v}`); return v; }
  }

  // Strategy 2: JSON-LD or meta structured price
  m = html.match(/"price"\s*:\s*"([\d.]+)"/);
  if (m) {
    const v = parseFloat(m[1]);
    if (v >= minPrice && v < 1e9) { console.log(`    [${coinId}] Strategy2 JSON: ${v}`); return v; }
  }

  // Strategy 3: "SOL Price · ₹8574" or "Price Today · ₹94.93"
  m = html.match(/Price(?:\s+Today)?\s*[·•\-:]\s*(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/i);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (v >= minPrice && v < 1e9) { console.log(`    [${coinId}] Strategy3 price-bullet: ${v}`); return v; }
  }

  // Strategy 4: "Live SOL/INR Price ₹8574" or "Price Live is at ₹8574"
  m = html.match(/(?:Live|Price Live is at)[^<₹&#]{0,30}(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/i);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (v >= minPrice && v < 1e9) { console.log(`    [${coinId}] Strategy4 live-price: ${v}`); return v; }
  }

  // Strategy 5: scan ENTIRE html for ₹ amounts, collect all, pick most frequent range
  const allPrices = [];
  const re = /(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/g;
  let hit;
  while ((hit = re.exec(html)) !== null) {
    const v = parseFloat(hit[1].replace(/,/g, ''));
    if (v >= minPrice && v < 1e9) allPrices.push(v);
  }
  if (allPrices.length) {
    // Sort and find the cluster — the actual price tends to repeat
    // Take the median of the first 10 occurrences
    const first10 = allPrices.slice(0, 10);
    first10.sort((a, b) => a - b);
    const median = first10[Math.floor(first10.length / 2)];
    console.log(`    [${coinId}] Strategy5 scan (${allPrices.length} hits, median of first 10): ${median}`);
    return median;
  }

  console.log(`    [${coinId}] All strategies failed. HTML length: ${html.length}`);
  // Debug: show first 500 chars of HTML
  console.log(`    [${coinId}] HTML preview: ${html.slice(0, 500).replace(/\n/g,' ')}`);
  return null;
}

// ── cache ───────────────────────────────────────────────────────
let cache     = null;
let cacheTime = 0;

async function fetchAll() {
  const result = { _ts: Date.now() };
  await Promise.all(COINS.map(async coin => {
    try {
      const html  = await get(coin.url);
      const price = parsePrice(html, coin.minPrice, coin.id);
      result[coin.id] = price;
      console.log(`  ✓ ${coin.id.padEnd(4)} ₹${price != null ? Number(price).toLocaleString('en-IN') : 'null'}`);
    } catch (e) {
      result[coin.id] = null;
      console.log(`  ✗ ${coin.id.padEnd(4)} ${e.message}`);
    }
  }));
  return result;
}

async function getPrices() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;
  const t = new Date().toLocaleTimeString('en-IN');
  console.log(`\n[${t}] Refreshing CoinSwitch prices…`);
  cache     = await fetchAll();
  cacheTime = Date.now();
  return cache;
}

// ── HTTP server ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }

  if (req.url === '/prices' || req.url === '/') {
    try {
      const prices = await getPrices();
      res.end(JSON.stringify(prices));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found. Use /prices' }));
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is already in use.`);
    console.error(`   Kill the existing process and try again.\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

// Warm the cache immediately on startup
getPrices().then(() => {
  console.log('\n✅  Ready.\n');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('─────────────────────────────────────────');
  console.log(' CoinSwitch Price Proxy');
  console.log('─────────────────────────────────────────');
  console.log(` URL:    http://localhost:${PORT}/prices`);
  console.log(` Cache:  refreshes every ${CACHE_TTL/1000}s`);
  console.log(` Stop:   Ctrl+C`);
  console.log('─────────────────────────────────────────');
});
