import { searchCoins, SYMBOL_MAP } from '../../../lib/signalGenerator';
import { Redis } from '@upstash/redis';

const SEARCH_CACHE = new Map();
const INFLIGHT = new Map();
const MAX_CACHE_ITEMS = 400;
const DEFAULT_CACHE_TTL_MS = 20 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_EDGE_FRESH_S = 300;
const DEFAULT_EDGE_STALE_S = 1800;
const DEFAULT_EDGE_STALE_FALLBACK_S = 600;
const DEFAULT_EDGE_STALE_FALLBACK_REVALIDATE_S = 1800;
const REMOTE_CACHE_PREFIX = 'coin-search:v1:';
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

function readNumberEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const CACHE_TTL_MS = readNumberEnv('COIN_SEARCH_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS, 60 * 1000, 24 * 60 * 60 * 1000);
const STALE_TTL_MS = readNumberEnv('COIN_SEARCH_CACHE_STALE_TTL_MS', DEFAULT_STALE_TTL_MS, CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
const EDGE_FRESH_S = readNumberEnv('COIN_SEARCH_EDGE_FRESH_S', DEFAULT_EDGE_FRESH_S, 30, 3600);
const EDGE_STALE_S = readNumberEnv('COIN_SEARCH_EDGE_STALE_S', DEFAULT_EDGE_STALE_S, 60, 24 * 3600);
const EDGE_STALE_FALLBACK_S = readNumberEnv('COIN_SEARCH_EDGE_STALE_FALLBACK_S', DEFAULT_EDGE_STALE_FALLBACK_S, 30, 3600);
const EDGE_STALE_FALLBACK_REVALIDATE_S = readNumberEnv('COIN_SEARCH_EDGE_STALE_FALLBACK_REVALIDATE_S', DEFAULT_EDGE_STALE_FALLBACK_REVALIDATE_S, EDGE_STALE_FALLBACK_S, 24 * 3600);

function normalizeKeyword(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function cacheKey(keyword, limit) {
  return `${REMOTE_CACHE_PREFIX}${keyword}|${limit}`;
}

function buildStaticFallback(keyword, limit) {
  const q = String(keyword || '').toLowerCase();
  const typedSymbol = String(keyword || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  const rows = Object.entries(SYMBOL_MAP).map(([pair, meta]) => {
    const symbol = String(pair).replace(/USDT$/, '');
    return {
      id: meta.geckoId || symbol.toLowerCase(),
      name: meta.name || symbol,
      symbol,
      pair,
      marketCapRank: null,
      thumb: '',
    };
  });
  const merged = [];
  if (typedSymbol) {
    merged.push({
      id: '',
      name: typedSymbol,
      symbol: typedSymbol,
      pair: `${typedSymbol}USDT`,
      marketCapRank: null,
      thumb: '',
    });
  }
  merged.push(...rows);
  const uniq = [];
  const seen = new Set();
  for (const coin of merged) {
    const key = `${coin.id || ''}:${coin.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(coin);
  }
  return uniq
    .filter((coin) => {
      if (!q) return true;
      return coin.name.toLowerCase().includes(q)
        || coin.symbol.toLowerCase().includes(q)
        || String(coin.id || '').toLowerCase().includes(q);
    })
    .slice(0, limit);
}

function sanitizeCacheEntry(raw) {
  if (!raw) return null;
  let item = raw;
  if (typeof item === 'string') {
    try {
      item = JSON.parse(item);
    } catch {
      return null;
    }
  }
  if (!item || !Array.isArray(item.coins)) return null;
  const createdAt = Number(item.createdAt) || Date.now();
  const expiresAt = Number(item.expiresAt) || createdAt + CACHE_TTL_MS;
  const staleUntil = Number(item.staleUntil) || createdAt + STALE_TTL_MS;
  return {
    coins: item.coins,
    createdAt,
    expiresAt,
    staleUntil,
  };
}

function getLocalCacheEntry(key) {
  const item = SEARCH_CACHE.get(key);
  if (!item) return null;
  const now = Date.now();
  if (item.staleUntil <= now) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return item;
}

function setLocalCacheEntry(key, entry) {
  SEARCH_CACHE.set(key, entry);
  if (SEARCH_CACHE.size > MAX_CACHE_ITEMS) {
    const oldest = SEARCH_CACHE.keys().next().value;
    if (oldest) SEARCH_CACHE.delete(oldest);
  }
}

function buildCacheEntry(coins) {
  const now = Date.now();
  return {
    coins,
    createdAt: now,
    expiresAt: now + CACHE_TTL_MS,
    staleUntil: now + STALE_TTL_MS,
  };
}

async function getDistributedCacheEntry(key) {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    const item = sanitizeCacheEntry(raw);
    if (!item) return null;
    if (item.staleUntil <= Date.now()) return null;
    return item;
  } catch {
    return null;
  }
}

async function setDistributedCacheEntry(key, entry) {
  if (!redis) return;
  try {
    const ttlSeconds = Math.max(60, Math.ceil(STALE_TTL_MS / 1000));
    await redis.set(key, entry, { ex: ttlSeconds });
  } catch {}
}

function pickStaleFallback(primary, secondary) {
  const now = Date.now();
  const candidates = [primary, secondary]
    .map((item) => sanitizeCacheEntry(item))
    .filter((item) => item && item.staleUntil > now);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.createdAt - a.createdAt)[0];
}

async function searchCoinsWithDedup(key, keyword, limit) {
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const task = (async () => {
    try {
      return await searchCoins(keyword, limit);
    } finally {
      INFLIGHT.delete(key);
    }
  })();
  INFLIGHT.set(key, task);
  return task;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { q = '', query = '', limit = '10' } = req.query;
    const keyword = normalizeKeyword(q || query || '');
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
    const key = cacheKey(keyword, safeLimit);

    if (!keyword) {
      return res.status(200).json({ coins: [] });
    }

    const localCached = getLocalCacheEntry(key);
    if (localCached && localCached.expiresAt > Date.now()) {
      const cachedCoins = Array.isArray(localCached.coins) ? localCached.coins : [];
      if (cachedCoins.length > 0) {
        res.setHeader('X-Cache', 'HIT_LOCAL');
        res.setHeader('Cache-Control', `public, s-maxage=${EDGE_FRESH_S}, stale-while-revalidate=${EDGE_STALE_S}`);
        return res.status(200).json({ coins: cachedCoins, cached: true });
      }
      SEARCH_CACHE.delete(key);
    }

    const remoteCached = await getDistributedCacheEntry(key);
    if (remoteCached && remoteCached.expiresAt > Date.now()) {
      const cachedCoins = Array.isArray(remoteCached.coins) ? remoteCached.coins : [];
      if (cachedCoins.length > 0) {
        setLocalCacheEntry(key, remoteCached);
        res.setHeader('X-Cache', 'HIT_REMOTE');
        res.setHeader('Cache-Control', `public, s-maxage=${EDGE_FRESH_S}, stale-while-revalidate=${EDGE_STALE_S}`);
        return res.status(200).json({ coins: cachedCoins, cached: true });
      }
    }

    const staleCandidate = pickStaleFallback(localCached, remoteCached);
    const staleFallback = staleCandidate && Array.isArray(staleCandidate.coins) && staleCandidate.coins.length
      ? staleCandidate
      : null;
    const rawCoins = await searchCoinsWithDedup(key, keyword, safeLimit);
    const coins = Array.isArray(rawCoins) ? rawCoins : [];
    if (!coins.length) {
      const fallbackCoins = buildStaticFallback(keyword, safeLimit);
      if (fallbackCoins.length) {
        res.setHeader('X-Cache', 'EMPTY_RESULT_FALLBACK');
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
        return res.status(200).json({
          coins: fallbackCoins,
          cached: false,
          fallback: 'static-empty-upstream',
          degraded: true,
        });
      }
    }
    const nextCache = buildCacheEntry(coins);
    setLocalCacheEntry(key, nextCache);
    await setDistributedCacheEntry(key, nextCache);
    res.setHeader('X-Cache', staleFallback ? 'REFRESHED' : 'MISS');
    res.setHeader('Cache-Control', `public, s-maxage=${EDGE_FRESH_S}, stale-while-revalidate=${EDGE_STALE_S}`);
    return res.status(200).json({ coins, cached: false });
  } catch (err) {
    try {
      const { q = '', query = '', limit = '10' } = req.query;
      const keyword = normalizeKeyword(q || query || '');
      const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
      const key = cacheKey(keyword, safeLimit);
      const localCached = getLocalCacheEntry(key);
      const remoteCached = await getDistributedCacheEntry(key);
      const staleCandidate = pickStaleFallback(localCached, remoteCached);
      const staleFallback = staleCandidate && Array.isArray(staleCandidate.coins) && staleCandidate.coins.length
        ? staleCandidate
        : null;

      if (staleFallback) {
        setLocalCacheEntry(key, staleFallback);
        res.setHeader('X-Cache', 'STALE_FALLBACK');
        res.setHeader('Cache-Control', `public, s-maxage=${EDGE_STALE_FALLBACK_S}, stale-while-revalidate=${EDGE_STALE_FALLBACK_REVALIDATE_S}`);
        return res.status(200).json({ coins: staleFallback.coins, cached: true, stale: true });
      }

      const fallbackCoins = buildStaticFallback(keyword, safeLimit);
      res.setHeader('X-Cache', fallbackCoins.length ? 'STATIC_FALLBACK' : 'EMPTY_FALLBACK');
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.status(200).json({
        coins: fallbackCoins,
        cached: false,
        fallback: fallbackCoins.length ? 'static' : 'empty',
        degraded: true,
        warning: 'Coin search upstream unavailable',
        error: err.message,
      });
    } catch (fallbackError) {
      res.setHeader('X-Cache', 'EMPTY_FALLBACK');
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({
        coins: [],
        cached: false,
        fallback: 'empty',
        degraded: true,
        warning: 'Coin search degraded mode',
        error: fallbackError.message,
      });
    }
  }
}
