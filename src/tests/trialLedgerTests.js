import { runTrialLedgerValidation } from '../core/trialLedger.js';

function curveFromReturns(returns, start = 10000) {
  let value = start;
  const curve = [{ time: Date.UTC(2026, 0, 1), value }];
  returns.forEach((entryReturn, index) => {
    value *= 1 + entryReturn;
    curve.push({
      time: Date.UTC(2026, 0, 2 + index),
      value,
    });
  });
  return curve;
}

function makeResult(strategyReturns, benchmarkReturns) {
  return {
    ok: true,
    equityCurve: curveFromReturns(strategyReturns),
    benchmarkCurve: curveFromReturns(benchmarkReturns),
  };
}

export function trialLedgerTestCases() {
  return [
    {
      name: 'Trial Ledger accepteert sterke edge na meerdere pogingen',
      run(assert) {
        const strategyReturns = Array.from({ length: 260 }, (_, index) => (
          0.003 + Math.sin(index / 9) * 0.001
        ));
        const benchmarkReturns = Array.from({ length: 260 }, () => 0.0004);
        const review = runTrialLedgerValidation({
          result: makeResult(strategyReturns, benchmarkReturns),
          trialCount: 32,
          timeframe: 'Daily',
        });

        assert(review.verdict === 'PASS', 'Sterke edge moet de trial-ledger halen.');
        assert(review.deflatedSharpe > 0, 'Deflated Sharpe moet positief blijven.');
        assert(review.checks.some((check) => check.id === 'trial-deflated-sharpe'), 'Deflated Sharpe check ontbreekt.');
      },
    },
    {
      name: 'Trial Ledger faalt als trial-penalty een zwakke edge wegdrukt',
      run(assert) {
        const strategyReturns = Array.from({ length: 180 }, (_, index) => (
          0.0001 + Math.sin(index / 2) * 0.01
        ));
        const benchmarkReturns = Array.from({ length: 180 }, () => 0.00008);
        const review = runTrialLedgerValidation({
          result: makeResult(strategyReturns, benchmarkReturns),
          trialCount: 500,
          timeframe: 'Daily',
        });

        assert(review.verdict === 'FAIL', 'Zwakke edge na veel pogingen moet falen.');
        assert(review.failed.some((check) => check.id === 'trial-deflated-sharpe'), 'Trial penalty failure ontbreekt.');
      },
    },
    {
      name: 'Trial Ledger crasht niet zonder equity curves',
      run(assert) {
        const review = runTrialLedgerValidation({
          result: { ok: false, error: 'Geen data.' },
          trialCount: 10,
        });

        assert(review.verdict === 'FAIL', 'Ongeldige data mag geen pass geven.');
        assert(review.failed.some((check) => check.id === 'trial-observations'), 'Observatie-failure ontbreekt.');
      },
    },
  ];
}
