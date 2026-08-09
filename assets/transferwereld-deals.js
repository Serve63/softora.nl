(function exposeTransferwereldDeals(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransferwereldDeals = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function simplifyClubName(value) {
    return normalize(value)
      .replace(/\b(?:football club|futbol club)\b/g, ' ')
      .replace(/\b(?:afc|bfc|cf|fc|fk|kv|ksv|rkc|sc|sk|ssc|sv|ud|vfb|vfl|vv)\b/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function aliasesForClub(club) {
    const slugName = String(club.transfermarkt?.slug || '').replace(/-/g, ' ');
    const aliases = [club.name, club.fullName, club.shortName, club.transfermarkt?.matchedName, slugName];
    return new Set(aliases.flatMap((value) => [normalize(value), simplifyClubName(value)]).filter(Boolean));
  }

  function meaningfulTokens(value) {
    const ignored = new Set(['ac', 'afc', 'and', 'bfc', 'cf', 'club', 'de', 'do', 'ec', 'fc', 'fk', 'football', 'futbol', 'kv', 'ksv', 'rkc', 'sc', 'se', 'sk', 'ssc', 'sv', 'ud', 'vfb', 'vfl', 'vv']);
    return simplifyClubName(value).split(' ').filter((token) => token.length >= 3 && !ignored.has(token));
  }

  function tokenMatches(left, right) {
    if (left === right) return true;
    return left.length >= 5 && right.length >= 4 && (left.endsWith(right) || right.endsWith(left));
  }

  function namesOverlap(left, right) {
    const leftTokens = meaningfulTokens(left);
    const rightTokens = meaningfulTokens(right);
    if (!leftTokens.length || !rightTokens.length) return false;
    const smaller = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
    const larger = smaller === leftTokens ? rightTokens : leftTokens;
    return smaller.every((token) => larger.some((candidate) => tokenMatches(token, candidate)));
  }

  function overlapScore(left, right) {
    if (!namesOverlap(left, right)) return -1;
    const leftTokens = meaningfulTokens(left);
    const rightTokens = meaningfulTokens(right);
    const shared = leftTokens.filter((token) => rightTokens.some((candidate) => tokenMatches(token, candidate))).length;
    const firstMatches = tokenMatches(leftTokens[0], rightTokens[0]) ? 4 : 0;
    const lengthPenalty = Math.abs(leftTokens.length - rightTokens.length);
    return shared * 10 + firstMatches - lengthPenalty;
  }

  function buildClubResolver(clubs) {
    const candidates = new Map();
    const resolutionCache = new Map();
    const clubAliases = clubs.map((club) => ({ club, aliases: [...aliasesForClub(club)] }));
    clubAliases.forEach(({ club, aliases }) => {
      aliases.forEach((alias) => {
        if (!candidates.has(alias)) candidates.set(alias, []);
        candidates.get(alias).push(club);
      });
    });
    return (name) => {
      const cacheKey = normalize(name);
      if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey);
      const exact = candidates.get(cacheKey);
      if (exact?.length === 1) {
        resolutionCache.set(cacheKey, exact[0]);
        return exact[0];
      }
      const simplified = candidates.get(simplifyClubName(name));
      if (simplified?.length === 1) {
        resolutionCache.set(cacheKey, simplified[0]);
        return simplified[0];
      }
      const fuzzy = clubAliases.map(({ club, aliases }) => ({
        club,
        score: Math.max(...aliases.map((alias) => overlapScore(name, alias))),
      })).filter((candidate) => candidate.score >= 0).sort((left, right) => right.score - left.score);
      const resolved = fuzzy.length && (fuzzy.length === 1 || fuzzy[0].score > fuzzy[1].score) ? fuzzy[0].club : null;
      resolutionCache.set(cacheKey, resolved);
      return resolved;
    };
  }

  function movementKind(fee) {
    const value = normalize(fee);
    if (/end of loan|loan return|einde huur|fin de pret|fin de cesion|fine prestito|leih ende|retorno de emprestimo/.test(value)) return 'return';
    if (/loan|huur|prestito|cesion|leihe|emprestimo|pret/.test(value)) return 'loan';
    if (/free|transfervrij|ablosefrei|sans frais|gratis|livre/.test(value)) return 'free';
    return 'transfer';
  }

  function clubKey(club, fallbackName) {
    const transfermarktId = Number(club?.transfermarkt?.id);
    return Number.isFinite(transfermarktId) ? `tm:${transfermarktId}` : `name:${simplifyClubName(club?.name || fallbackName)}`;
  }

  function dealRank(deal) {
    const ranks = [deal.sourceClub?.rank, deal.destinationClub?.rank]
      .map(Number)
      .filter((rank) => Number.isFinite(rank) && rank > 0 && rank < 10000);
    return ranks.length ? Math.min(...ranks) : 10000;
  }

  function buildUniqueDeals(clubs) {
    const resolveClub = buildClubResolver(clubs);
    const deals = new Map();

    clubs.forEach((club) => {
      const movements = [
        ...(club.arrivals || []).map((transfer) => ({ ...transfer, direction: 'in' })),
        ...(club.departures || []).map((transfer) => ({ ...transfer, direction: 'out' })),
      ];

      movements.forEach((transfer) => {
        const counterpartClub = resolveClub(transfer.counterpart);
        const sourceClub = transfer.direction === 'out' ? club : counterpartClub;
        const destinationClub = transfer.direction === 'in' ? club : counterpartClub;
        const sourceName = sourceClub?.name || (transfer.direction === 'in' ? transfer.counterpart : club.name) || 'Onbekend';
        const destinationName = destinationClub?.name || (transfer.direction === 'out' ? transfer.counterpart : club.name) || 'Onbekend';
        const kind = movementKind(transfer.fee);
        const key = [
          normalize(transfer.player),
          clubKey(sourceClub, sourceName),
          clubKey(destinationClub, destinationName),
          kind,
        ].join('|');
        const existing = deals.get(key);
        const feeValue = Number(transfer.feeValue) || 0;

        if (!existing) {
          const deal = {
            player: transfer.player,
            position: transfer.position,
            age: transfer.age,
            sourceClub,
            destinationClub,
            sourceName,
            destinationName,
            kind,
            fee: transfer.fee,
            feeValue,
            records: 1,
          };
          deal.rank = dealRank(deal);
          deals.set(key, deal);
          return;
        }

        existing.records += 1;
        if (!existing.sourceClub && sourceClub) existing.sourceClub = sourceClub;
        if (!existing.destinationClub && destinationClub) existing.destinationClub = destinationClub;
        if (transfer.direction === 'in') {
          existing.position = transfer.position || existing.position;
          existing.age = transfer.age || existing.age;
        }
        if (feeValue > existing.feeValue || (!existing.fee && transfer.fee)) {
          existing.feeValue = feeValue;
          existing.fee = transfer.fee;
        }
        existing.rank = dealRank(existing);
      });
    });

    return [...deals.values()];
  }

  return { buildUniqueDeals, movementKind, normalize, simplifyClubName };
}));
