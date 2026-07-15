#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { runNextBarPortfolioBacktest } = require('../server/services/papertrader-research');
const { createV17CoreShieldStrategy } = require('../server/services/papertrader-v17-strategy');

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    args[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function numberArgument(args, key, fallback) {
  if (args[key] === undefined) return fallback;
  const value = Number(args[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} moet een getal zijn.`);
  return value;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.dataset) {
    console.error('Gebruik: npm run papertrader:v17 -- --dataset /absoluut/pad/candles.json');
    process.exit(2);
  }
  const datasetPath = path.resolve(args.dataset);
  const payload = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const candlesBySymbol = payload.candlesBySymbol || payload;
  const result = runNextBarPortfolioBacktest({
    candlesBySymbol,
    signalAt: createV17CoreShieldStrategy({
      rebalanceEveryBars: numberArgument(args, 'rebalance-bars', 9),
    }),
    startEquity: numberArgument(args, 'equity', 10_000),
    feeRate: numberArgument(args, 'fee', 0.001),
    slippageRate: numberArgument(args, 'slippage', 0.001),
    minimumTradeValue: numberArgument(args, 'minimum-trade', 5),
    rebalanceThreshold: numberArgument(args, 'rebalance-threshold', 0.01),
  });
  console.log(JSON.stringify(result, null, 2));
}

main();
