// api/prices.js  — Vercel Serverless Function
// Deployed at: https://your-app.vercel.app/api/prices
// Returns: { btc, eth, usdt, sol, _ts }

const https = require('https');

const COINS = [
  { id: 'btc',  url: 'https://coinswitch.co/coins/bitcoin'  },
  { id: 'eth',  url: 'https://coinswitch.co/coins/ethereum' },
  { id: 'usdt', url: 'https://coinswitch.co/coins/tether'   },
  { id: 'sol',  url: 'https://coinswitch.co/coins/solana'   },
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function fetchPage(targetUrl, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const opts = new URL(targetUrl);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      timeout: 12000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : opts.origin + res.headers.location;
        return resolve(fetchPage(next, redirects + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function parsePrice(html, minPrice) {
  // Strategy 1: title tag
  let m = html.match(/<title>[^<]*?(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/);
  if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v >= minPrice && v < 1e9) return v; }

  // Strategy 2: JSON-LD price field
  m = html.match(/"price"\s*:\s*"([\d.]+)"/);
  if (m) { const v = parseFloat(m[1]); if (v >= minPrice && v < 1e9) return v; }

  // Strategy 3: "Price · ₹94.93" pattern
  m = html.match(/Price(?:\s+Today)?\s*[·•\-:]\s*(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/i);
  if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v >= minPrice && v < 1e9) return v; }

  // Strategy 4: "Price Live is at ₹8752" or "Live ... ₹..."
  m = html.match(/(?:Live|Price Live is at)[^<₹&#]{0,30}(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/i);
  if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v >= minPrice && v < 1e9) return v; }

  // Strategy 5: scan full HTML, take median of first 10 hits
  const all = [];
  const re = /(?:₹|&#x20B9;)([\d,]+(?:\.\d+)?)/g;
  let hit;
  while ((hit = re.exec(html)) !== null) {
    const v = parseFloat(hit[1].replace(/,/g, ''));
    if (v >= minPrice && v < 1e9) all.push(v);
  }
  if (all.length) {
    const first10 = all.slice(0, 10).sort((a, b) => a - b);
    return first10[Math.floor(first10.length / 2)];
  }
  return null;
}

const MIN_PRICE = { btc: 100, eth: 100, usdt: 0.1, sol: 1 };

// Simple in-memory cache (survives within the same serverless instance)
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // 30s

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Return cached result if fresh
  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    res.status(200).json(cache);
    return;
  }

  const result = { _ts: Date.now() };

  await Promise.all(COINS.map(async coin => {
    try {
      const html = await fetchPage(coin.url);
      result[coin.id] = parsePrice(html, MIN_PRICE[coin.id]);
    } catch (e) {
      result[coin.id] = null;
    }
  }));

  cache = result;
  cacheTime = Date.now();

  res.status(200).json(result);
}
