// V1.9.2 — LIQUID UNIVERSE preserved + HIGH ACCURACY LAB
// O scheduler aprende o volume 24h de cada ativo conforme os lotes normais
// são escaneados. Assim não adicionamos chamadas extras de OHLCV e evitamos
// pressionar o rate limit da Coinalyze.

export const DEFAULT_LIQUID_UNIVERSE_BASES = [
  'BTC','ETH','SOL','XRP','BNB','DOGE','ADA','TRX','SUI','LINK',
  'BCH','LTC','AVAX','HBAR','DOT','XLM','NEAR','UNI','AAVE','ETC',
  'ATOM','ICP','FIL','INJ','APT','ARB','OP','TIA','SEI','PEPE',
  'WIF','FET','RENDER','TAO','ENA','WLD','RUNE','POL','VET','ALGO',
  'LDO','CRV','DYDX','GALA','SAND','MANA','APE','JUP','STX','IMX',
  'PENDLE','MKR','GRT','TON','FLOKI','BONK','SHIB'
];

export function normalizeUniverseBase(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[-_/]/g, '')
    .replace(/USDT.*$/, '')
    .replace(/PERP.*$/, '')
    .trim();
}

function unique(values) {
  return [...new Set(values.map(normalizeUniverseBase).filter(Boolean))];
}

function takeRotating(items, cursor, count, blocked = new Set()) {
  const out = [];
  if (!items.length || count <= 0) return { values: out, nextCursor: cursor };
  let checked = 0;
  let idx = ((cursor % items.length) + items.length) % items.length;
  while (out.length < count && checked < items.length * 2) {
    const value = items[idx];
    if (value && !blocked.has(value) && !out.includes(value)) out.push(value);
    idx = (idx + 1) % items.length;
    checked += 1;
  }
  return { values: out, nextCursor: idx };
}

export class LiquidUniverseManager {
  constructor({
    seedBases = DEFAULT_LIQUID_UNIVERSE_BASES,
    maxSize = 50,
    minQuoteVolume = 20_000_000,
    observationMaxAgeMin = 360,
    coreEveryScans = 4,
    hotEveryScans = 4,
    hotSize = 12
  } = {}) {
    this.seedBases = unique(seedBases);
    this.maxSize = Math.max(20, Math.min(70, Number(maxSize) || 50));
    this.minQuoteVolume = Math.max(0, Number(minQuoteVolume) || 0);
    this.observationMaxAgeMs = Math.max(30, Number(observationMaxAgeMin) || 360) * 60_000;
    this.coreEveryScans = Math.max(2, Math.min(10, Number(coreEveryScans) || 4));
    this.hotEveryScans = Math.max(2, Math.min(10, Number(hotEveryScans) || 4));
    this.hotSize = Math.max(5, Math.min(20, Number(hotSize) || 12));
    this.availableBases = [...this.seedBases];
    this.stats = new Map();
    this.rotationCursor = 0;
    this.coreCursor = 0;
    this.hotCursor = 0;
    this.scanCounter = 0;
    this.lastBatch = [];
    this.lastAvailabilityRefreshAt = 0;
  }

  setAvailableMarkets(markets = []) {
    const available = new Set(
      (markets || [])
        .filter(m =>
          String(m?.quote_asset || '').toUpperCase() === 'USDT' &&
          m?.is_perpetual === true &&
          m?.has_ohlcv_data === true
        )
        .map(m => normalizeUniverseBase(m?.base_asset))
        .filter(Boolean)
    );

    if (available.size) {
      const filtered = this.seedBases.filter(base => available.has(base));
      // Se alguma corretora usa um ticker recente que não estava no seed,
      // só aceita quando é um ticker USDT perp com OHLCV e o seed não completou 50.
      if (filtered.length < this.maxSize) {
        for (const base of available) {
          if (!filtered.includes(base) && /^[A-Z0-9]{2,12}$/.test(base)) {
            filtered.push(base);
          }
          if (filtered.length >= this.maxSize + 10) break;
        }
      }
      this.availableBases = unique(filtered);
    }

    this.lastAvailabilityRefreshAt = Date.now();
    return this.availableBases;
  }

  observeSnapshots(snapshots = []) {
    const now = Date.now();
    for (const snap of snapshots || []) {
      const base = normalizeUniverseBase(snap?.symbol || snap?.dataSymbol);
      if (!base || base === 'USDT') continue;
      const quoteVolume = Number(snap?.quoteVolume || 0);
      const volumeRatio = Number(snap?.t5?.volumeRatio || 0);
      const score = Number(snap?.score || 0);
      const previous = this.stats.get(base) || {};
      this.stats.set(base, {
        ...previous,
        base,
        quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0,
        volumeRatio: Number.isFinite(volumeRatio) ? volumeRatio : 0,
        score: Number.isFinite(score) ? score : 0,
        seenAt: now
      });
    }
  }

  freshStat(base, now = Date.now()) {
    const stat = this.stats.get(base);
    if (!stat) return null;
    if (now - Number(stat.seenAt || 0) > this.observationMaxAgeMs) return null;
    return stat;
  }

  rankedBases(now = Date.now()) {
    const source = this.availableBases.length ? this.availableBases : this.seedBases;
    const liquid = [];
    const unseen = [];
    const low = [];

    for (const base of source) {
      const stat = this.freshStat(base, now);
      if (!stat) {
        unseen.push(base);
      } else if (stat.quoteVolume >= this.minQuoteVolume) {
        liquid.push({ base, ...stat });
      } else {
        low.push({ base, ...stat });
      }
    }

    // Volume 24h é o ranking principal. Volume relativo e score só desempatarão.
    liquid.sort((a, b) =>
      (b.quoteVolume - a.quoteVolume) ||
      (b.volumeRatio - a.volumeRatio) ||
      (b.score - a.score)
    );
    low.sort((a, b) => (b.quoteVolume - a.quoteVolume));

    const ranked = [
      ...liquid.map(x => x.base),
      ...unseen,
      ...low.map(x => x.base)
    ];

    return unique(ranked).slice(0, this.maxSize);
  }

  hotBases(now = Date.now()) {
    return this.rankedBases(now)
      .filter(base => {
        const stat = this.freshStat(base, now);
        return stat && stat.quoteVolume >= this.minQuoteVolume;
      })
      .slice(0, this.hotSize);
  }

  nextBatch({ size = 4, urgentBases = [] } = {}) {
    const batchSize = Math.max(2, Math.min(6, Number(size) || 4));
    const batch = [];
    const blocked = new Set();
    const ranked = this.rankedBases();
    const core = ['BTC', 'ETH', 'SOL'].filter(x => ranked.includes(x));
    const hot = this.hotBases();

    const push = base => {
      const normalized = normalizeUniverseBase(base);
      if (!normalized || blocked.has(normalized) || !ranked.includes(normalized)) return false;
      batch.push(normalized);
      blocked.add(normalized);
      return true;
    };

    // Urgentes (posição PAPER / WAIT / IA pendente) têm prioridade,
    // mas consomem no máximo 1 slot para não congelar a descoberta do universo.
    for (const urgent of unique(urgentBases)) {
      if (push(urgent)) break;
    }

    // BTC/ETH/SOL reaparecem periodicamente para manter contexto macro fresco,
    // sem roubar um slot em todos os scans.
    if (
      batch.length < batchSize &&
      core.length &&
      this.scanCounter % this.coreEveryScans === 0
    ) {
      const pick = takeRotating(core, this.coreCursor, 1, blocked);
      pick.values.forEach(push);
      this.coreCursor = pick.nextCursor;
    }

    // A cada alguns scans, revisita um dos top líquidos já observados.
    if (
      batch.length < batchSize &&
      hot.length &&
      this.scanCounter % this.hotEveryScans === 0
    ) {
      const pick = takeRotating(hot, this.hotCursor, 1, blocked);
      pick.values.forEach(push);
      this.hotCursor = pick.nextCursor;
    }

    // O restante percorre o top-50 dinâmico. Com lote 4/min,
    // todo o universo tende a ser revisto em ~13–18 minutos.
    if (batch.length < batchSize) {
      const pick = takeRotating(
        ranked,
        this.rotationCursor,
        batchSize - batch.length,
        blocked
      );
      pick.values.forEach(push);
      this.rotationCursor = pick.nextCursor;
    }

    this.scanCounter += 1;
    this.lastBatch = batch;
    return batch;
  }

  status() {
    const ranked = this.rankedBases();
    const observed = ranked.filter(base => this.freshStat(base));
    const liquid = observed.filter(base => {
      const stat = this.freshStat(base);
      return stat && stat.quoteVolume >= this.minQuoteVolume;
    });
    const top = liquid.slice(0, 10).map(base => {
      const s = this.freshStat(base);
      return `${base} $${(s.quoteVolume / 1e6).toFixed(0)}M`;
    });
    return {
      size: ranked.length,
      ranked,
      observed: observed.length,
      liquid: liquid.length,
      top,
      lastBatch: [...this.lastBatch],
      lastAvailabilityRefreshAt: this.lastAvailabilityRefreshAt
    };
  }
}
