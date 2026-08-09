(function exposeTransferwereldScope(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TransferwereldScope = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  function transfermarktId(item) {
    return Number(item?.transfermarkt?.id ?? item?.transfermarktId);
  }

  function buildScopedDataset(baseDataset, scopeDataset) {
    const scopeLeagues = scopeDataset?.scopeLeagues || baseDataset?.scopeLeagues || [];
    const scopeClubIds = new Set(scopeLeagues.flatMap((league) => (
      (league.teams || []).map(transfermarktId).filter(Number.isFinite)
    )));
    const mergedClubs = [...(baseDataset?.clubs || []), ...(scopeDataset?.clubs || [])];
    const clubById = new Map();
    mergedClubs.forEach((club) => {
      const id = transfermarktId(club);
      if (Number.isFinite(id) && scopeClubIds.has(id)) clubById.set(id, club);
    });
    const clubs = [...scopeClubIds].map((id) => clubById.get(id)).filter(Boolean);

    return {
      ...baseDataset,
      clubs,
      scopeLeagues,
      meta: {
        ...(baseDataset?.meta || {}),
        activeScopeClubCount: clubs.length,
      },
    };
  }

  return { buildScopedDataset, transfermarktId };
});
