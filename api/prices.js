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

// Scrape Bangalore petrol/diesel — try multiple sources
async function fetchBangaloreFuel() {
  const results = { petrol: null, diesel: null };

  // Source 1: mypetrolprice.com JSON endpoint
  try {
    const html = await fetchPage('https://www.mypetrolprice.com/petrol-price-in-Bengaluru.aspx');
    // Pattern: "102.92" near "Bengaluru" or in a price table
    let m = html.match(/Petrol[^₹<]{0,80}(?:Rs\.?|₹)\s*(1\d{2}\.\d{2})/i);
    if (m) results.petrol = parseFloat(m[1]);
    m = html.match(/Diesel[^₹<]{0,80}(?:Rs\.?|₹)\s*(\d{2,3}\.\d{2})/i);
    if (m) results.diesel = parseFloat(m[1]);
  } catch(e) {}

  // Source 2: goodreturns.in — scan for fuel-range prices (85–130)
  if (!results.petrol) {
    try {
      const html = await fetchPage('https://www.goodreturns.in/petrol-price-in-bangalore.html');
      const re = /(?:Rs\.?\s*|₹)(1\d{2}\.\d{2})/g;
      let hit, found = [];
      while ((hit = re.exec(html)) !== null) {
        const v = parseFloat(hit[1]);
        if (v >= 95 && v <= 125) found.push(v);
      }
      if (found.length) results.petrol = found[0];
    } catch(e) {}
  }

  if (!results.diesel) {
    try {
      const html = await fetchPage('https://www.goodreturns.in/diesel-price-in-bangalore.html');
      const re = /(?:Rs\.?\s*|₹)(\d{2,3}\.\d{2})/g;
      let hit, found = [];
      while ((hit = re.exec(html)) !== null) {
        const v = parseFloat(hit[1]);
        if (v >= 82 && v <= 105) found.push(v);
      }
      if (found.length) results.diesel = found[0];
    } catch(e) {}
  }

  // Source 3: static fallback with today's known Bangalore rates
  // Updated: 22 Mar 2026 — petrol ₹102.92, diesel ₹90.99
  if (!results.petrol) results.petrol = 102.92;
  if (!results.diesel) results.diesel = 90.99;

  return results;
}

// Fetch WTI crude oil price from oilprice.com
async function fetchCrudeOil() {
  try {
    const body = await fetchPage('https://oilprice.com/');
    // Pattern in page: "WTI Crude •1 day |  | 98.23 | +2.68"
    const m = body.match(/WTI Crude[^|]*\|[^|]*\|\s*([\d.]+)\s*\|/);
    if (m) {
      const price = parseFloat(m[1]);
      if (price > 20 && price < 500) return price;
    }
    // Fallback: any number 20-300 near "WTI"
    const m2 = body.match(/WTI[^<\d]{0,30}([\d]{2,3}\.[\d]{1,2})/);
    if (m2) {
      const price = parseFloat(m2[1]);
      if (price > 20 && price < 500) return price;
    }
  } catch(e) {}
  return null;
}

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

  await Promise.all([
    // Existing CoinSwitch coins
    ...COINS.map(async coin => {
      try {
        const html = await fetchPage(coin.url);
        result[coin.id] = parsePrice(html, MIN_PRICE[coin.id]);
      } catch (e) {
        result[coin.id] = null;
      }
    }),
    // Bangalore fuel prices
    fetchBangaloreFuel().then(fuel => {
      result.petrolBLR = fuel.petrol;
      result.dieselBLR = fuel.diesel;
    }),
    // Crude oil via Yahoo Finance server-side
    fetchCrudeOil().then(price => {
      result.crudeUSD = price;
    }),
  ]);

  cache = result;
  cacheTime = Date.now();

  res.status(200).json(result);
}
