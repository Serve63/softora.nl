'use strict';

function createQueryDiagnostics() {
  const rejectionReasons = {};
  return {
    acceptedCount: 0,
    reject(reason = 'not_eligible') {
      const key = String(reason || 'not_eligible');
      rejectionReasons[key] = (rejectionReasons[key] || 0) + 1;
    },
    accept() {
      this.acceptedCount += 1;
    },
    snapshot() {
      return {
        acceptedCount: this.acceptedCount,
        rejectionReasons: { ...rejectionReasons },
      };
    },
  };
}

function summarizeScanDiagnostics(usedQueries = []) {
  const rejectionReasons = {};
  let acceptedSignalCount = 0;
  for (const query of Array.isArray(usedQueries) ? usedQueries : []) {
    acceptedSignalCount += Number(query?.acceptedCount) || 0;
    for (const [reason, count] of Object.entries(query?.rejectionReasons || {})) {
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + (Number(count) || 0);
    }
  }
  return { acceptedSignalCount, rejectionReasons };
}

module.exports = { createQueryDiagnostics, summarizeScanDiagnostics };
