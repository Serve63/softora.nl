import { fetchMarketData } from '../data/binanceProvider.js';
import { computeAssetScore, sma, ema, roc, atr } from '../core/indicators.js';
import { evaluateGate } from '../core/riskEngine.js';

function makeCandles(count = 260) {
  const candles = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    price *= 1 + 0.002 + Math.sin(index / 9) * 0.003;
    candles.push({
      time: Date.UTC(2020, 0, 1 + index),
      open: price * 0.99,
      high: price * 1.02,
      low: price * 0.98,
      close: price,
      volume: 1000 + index,
    });
  }
  return candles;
}

function baseGateInput(overrides = {}) {
  return {
    results: {
      strategyReturn: 0.8,
      benchmarkReturn: 0.4,
      oosReturn: 0.2,
      oosBenchmarkReturn: 0.1,
      maxDrawdown: 0.18,
      profitFactor: 2,
      walkForwardBeatRate: 0.66,
      ...overrides,
    },
    currentRisk: { exposure: 0.5 },
    config: {
      maxDrawdownTarget: 0.3,
      minProfitFactor: 1.65,
      minWalkForwardBeatRate: 0.55,
    },
  };
}

export function parityTestCases() {
  return [
    {
      name: 'Indicatoren geven geldige waarden',
      run(assert) {
        const candles = makeCandles();
        const closeValues = candles.map((candle) => candle.close);
        assert(Number.isFinite(sma(closeValues, 20).at(-1)), 'SMA geeft geen geldige waarde.');
        assert(Number.isFinite(ema(closeValues, 20).at(-1)), 'EMA geeft geen geldige waarde.');
        assert(Number.isFinite(roc(closeValues, 20).at(-1)), 'ROC geeft geen geldige waarde.');
        assert(Number.isFinite(atr(candles, 14).at(-1)), 'ATR geeft geen geldige waarde.');
        assert(Number.isFinite(computeAssetScore(candles).score), 'Asset score geeft geen geldige waarde.');
      },
    },
    {
      name: 'Gate sluit als max drawdown faalt',
      run(assert) {
        const drawdownGate = evaluateGate(baseGateInput({ maxDrawdown: 0.42 }));
        assert(drawdownGate.open === false, 'Gate sluit niet als max drawdown faalt.');
        assert(drawdownGate.failed.some((check) => check.id === 'max-drawdown'), 'Max drawdown failure ontbreekt.');
      },
    },
    {
      name: 'Gate sluit als profit factor faalt',
      run(assert) {
        const profitFactorGate = evaluateGate(baseGateInput({ profitFactor: 1.1 }));
        assert(profitFactorGate.open === false, 'Gate sluit niet als profit factor faalt.');
        assert(profitFactorGate.failed.some((check) => check.id === 'profit-factor'), 'Profit factor failure ontbreekt.');
      },
    },
    {
      name: 'Gate sluit als OOS benchmark niet verslagen wordt',
      run(assert) {
        const oosGate = evaluateGate(baseGateInput({ oosReturn: 0.05, oosBenchmarkReturn: 0.15 }));
        assert(oosGate.open === false, 'Gate sluit niet als OOS benchmark niet verslagen wordt.');
        assert(oosGate.failed.some((check) => check.id === 'oos-return'), 'OOS failure ontbreekt.');
      },
    },
    {
      name: 'App crasht niet als Binance tijdelijk geen data levert',
      async run(assert) {
        const unavailableFetch = async () => ({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          async json() {
            return [];
          },
        });
        const marketData = await fetchMarketData({
          assets: ['BTCUSDT'],
          timeframe: 'Daily',
          target: 10,
          fetchImpl: unavailableFetch,
        });
        assert(Array.isArray(marketData.candlesByAsset.BTCUSDT), 'Provider geeft geen veilige lege candles terug.');
        assert(marketData.errors.length === 1, 'Provider meldt tijdelijke Binance-fout niet netjes.');
      },
    },
  ];
}

export async function runParityTests(assert) {
  for (const testCase of parityTestCases()) {
    await testCase.run(assert);
  }
}
