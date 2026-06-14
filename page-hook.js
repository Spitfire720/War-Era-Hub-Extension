(() => {
  if (window.__wareraHubPublicApiSafeHooked) return;
  window.__wareraHubPublicApiSafeHooked = true;

  /*
   * WarEraHub Public API Safe Mode
   *
   * Admin clarification:
   * - Data accessible through public API is allowed.
   * - Be careful with endpoints only accessible with JWT.
   *
   * This hook therefore does NOT inspect every tRPC response.
   * It only reads responses for explicitly approved public endpoints.
   *
   * Until an endpoint is confirmed/admin-approved, keep it out of this set.
   */
  const APPROVED_PUBLIC_TRPC_PROCEDURES = new Set([
    // Add approved public endpoints here only after confirmation.
    // Example after approval:
    // 'battle.getSortedActiveBattles',
    // 'battle.getById',
    // 'battle.getLiveBattleData',
    // 'battleOrderSummary.getByBattle',
  ]);

  const KNOWN_PRIVATE_OR_JWT_ONLY = new Set([
    'user.getMe',
    'inventory.equippedItems',
    'asset.getUserAssets',
    'asset.getMyAssets',
    'inventory.getById',
    'company.getCompanies',
    'company.getById',
    'worker.getMyWorker',
    'worker.getWorkers',
    'market.getMyOrders',
    'equipmentMarket.getOrders',
    'equipmentMarket.getUserOrders',
  ]);

  const PUBLIC_PENDING_REVIEW = [
    'battle.getSortedActiveBattles',
    'battle.getById',
    'battle.getLiveBattleData',
    'battleOrderSummary.getByBattle',
  ];

  let statusSent = false;

  function getUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function procedureList(url) {
    const marker = '/trpc/';
    const i = url.indexOf(marker);
    if (i === -1) return [];
    const rest = url.slice(i + marker.length).split('?')[0];
    return decodeURIComponent(rest).split(',').filter(Boolean);
  }

  function isApprovedProcedure(proc) {
    return APPROVED_PUBLIC_TRPC_PROCEDURES.has(proc);
  }

  function allProceduresApproved(procedures) {
    return procedures.length > 0 && procedures.every(isApprovedProcedure);
  }

  function unwrapData(data) {
    if (!data || typeof data !== 'object') return data;
    if (Object.prototype.hasOwnProperty.call(data, 'json')) return data.json;
    if (data.data && Object.prototype.hasOwnProperty.call(data.data, 'json')) return data.data.json;
    return data;
  }

  function resultData(result) {
    const raw = result && result.result && Object.prototype.hasOwnProperty.call(result.result, 'data')
      ? result.result.data
      : null;
    return unwrapData(raw);
  }

  function collectByProcedure(procedures, results, name) {
    const out = [];
    procedures.forEach((proc, i) => {
      if (proc !== name) return;
      const value = resultData(results[i]);
      if (value !== undefined && value !== null) out.push(value);
    });
    return out;
  }

  function compactSide(side) {
    if (!side || typeof side !== 'object') return null;
    return {
      country: side.country || null,
      region: side.region || null,
      wonRoundsCount: Number.isFinite(Number(side.wonRoundsCount)) ? Number(side.wonRoundsCount) : null,
      countryOrders: Array.isArray(side.countryOrders) ? side.countryOrders.slice(0, 30) : [],
      muOrders: Array.isArray(side.muOrders) ? side.muOrders.slice(0, 30) : [],
      hitCount: Number.isFinite(Number(side.hitCount)) ? Number(side.hitCount) : null,
      moneyPer1kDamages: Number.isFinite(Number(side.moneyPer1kDamages)) ? Number(side.moneyPer1kDamages) : null,
      moneyPool: Number.isFinite(Number(side.moneyPool)) ? Number(side.moneyPool) : null,
      bountyEffectiveAt: side.bountyEffectiveAt || null
    };
  }

  function compactBattle(battle) {
    if (!battle || typeof battle !== 'object') return null;
    return {
      id: battle._id || battle.id || null,
      war: battle.war || null,
      type: battle.type || null,
      isActive: battle.isActive !== false,
      isBigBattle: !!battle.isBigBattle,
      isSystemResistance: !!battle.isSystemResistance,
      roundsToWin: Number.isFinite(Number(battle.roundsToWin)) ? Number(battle.roundsToWin) : null,
      currentRound: battle.currentRound || null,
      rounds: Array.isArray(battle.rounds) ? battle.rounds.slice(0, 8) : [],
      roundsHistory: Array.isArray(battle.roundsHistory) ? battle.roundsHistory.slice(-4) : (Array.isArray(battle.roundHistory) ? battle.roundHistory.slice(-4) : []),
      attacker: compactSide(battle.attacker),
      defender: compactSide(battle.defender),
      updatedAt: battle.updatedAt || null,
      createdAt: battle.createdAt || null
    };
  }

  function compactLiveData(live) {
    if (!live || typeof live !== 'object') return null;
    const round = live.round || live;
    const battleMeta = live.battle || {};
    const attacker = round.attacker || {};
    const defender = round.defender || {};
    const roundId = round.roundId || round._id || null;
    return {
      battleId: live.battleId || round.battle || null,
      roundId,
      attackerCountry: attacker.country || round.attackerCountry || null,
      defenderCountry: defender.country || round.defenderCountry || null,
      attackerCountryOrders: Array.isArray(battleMeta.attackerCountryOrders) ? battleMeta.attackerCountryOrders.slice(0, 40) : [],
      defenderCountryOrders: Array.isArray(battleMeta.defenderCountryOrders) ? battleMeta.defenderCountryOrders.slice(0, 40) : [],
      attackerMoneyPer1kDamages: Number.isFinite(Number(battleMeta.attackerMoneyPer1kDamages)) ? Number(battleMeta.attackerMoneyPer1kDamages) : null,
      attackerMoneyPool: Number.isFinite(Number(battleMeta.attackerMoneyPool)) ? Number(battleMeta.attackerMoneyPool) : null,
      attackerBountyEffectiveAt: battleMeta.attackerBountyEffectiveAt || null,
      defenderMoneyPer1kDamages: Number.isFinite(Number(battleMeta.defenderMoneyPer1kDamages)) ? Number(battleMeta.defenderMoneyPer1kDamages) : null,
      defenderMoneyPool: Number.isFinite(Number(battleMeta.defenderMoneyPool)) ? Number(battleMeta.defenderMoneyPool) : null,
      defenderBountyEffectiveAt: battleMeta.defenderBountyEffectiveAt || null,
      attackerDamages: Number.isFinite(Number(attacker.damages ?? round.attackerDamages)) ? Number(attacker.damages ?? round.attackerDamages) : 0,
      defenderDamages: Number.isFinite(Number(defender.damages ?? round.defenderDamages)) ? Number(defender.damages ?? round.defenderDamages) : 0,
      attackerPoints: Number.isFinite(Number(attacker.points ?? round.attackerPoints)) ? Number(attacker.points ?? round.attackerPoints) : 0,
      defenderPoints: Number.isFinite(Number(defender.points ?? round.defenderPoints)) ? Number(defender.points ?? round.defenderPoints) : 0,
      isActive: round.isActive !== false,
      actualTickPoints: round.actualTickPoints ?? live.live?.actualTickPoints ?? null,
      nextTickAt: round.nextTickAt || live.live?.nextTickAt || null,
      ticksCount: live.live?.ticksCount ?? null,
      roundUpdatedAt: round.updatedAt || null,
      battleRoundIds: Array.isArray(battleMeta.roundIds) ? battleMeta.roundIds.slice(0, 8) : []
    };
  }

  function compactOrder(order) {
    if (!order || typeof order !== 'object') return null;
    return {
      id: order._id || order.id || null,
      country: order.country || null,
      battleId: order.battle || order.battleId || null,
      side: order.side || null,
      sideCountry: order.sideCountry || null,
      text: order.text || null,
      priority: order.priority || null,
      isActive: order.isActive !== false,
      createdAt: order.createdAt || null,
      updatedAt: order.updatedAt || null
    };
  }

  function makeApprovedPublicSync(procedures, results) {
    const orders = collectByProcedure(procedures, results, 'battleOrderSummary.getByBattle')
      .flatMap(x => Array.isArray(x) ? x : (x ? [x] : []))
      .map(compactOrder)
      .filter(Boolean);

    const battles = collectByProcedure(procedures, results, 'battle.getById')
      .map(compactBattle)
      .filter(b => b && b.id);

    const live = collectByProcedure(procedures, results, 'battle.getLiveBattleData')
      .map(compactLiveData)
      .filter(Boolean);

    const activeBattleIds = collectByProcedure(procedures, results, 'battle.getSortedActiveBattles')
      .flatMap(x => Array.isArray(x) ? x : [])
      .map(String)
      .slice(0, 80);

    if (!orders.length && !battles.length && !live.length && !activeBattleIds.length) return null;

    return {
      source: 'warerahub-public-api-safe-mode',
      safeMode: true,
      publicApiOnly: true,
      updatedAt: new Date().toISOString(),
      approvedProcedures: procedures.filter(isApprovedProcedure),
      battleSync: {
        source: 'warerahub-approved-public-battles',
        trusted: true,
        updatedAt: new Date().toISOString(),
        orders,
        battles,
        live,
        activeBattleIds
      }
    };
  }

  function postStatus(extra = {}) {
    const payload = {
      source: 'warerahub-public-api-safe-mode',
      safeMode: true,
      publicApiOnly: true,
      updatedAt: new Date().toISOString(),
      approvedProcedures: Array.from(APPROVED_PUBLIC_TRPC_PROCEDURES),
      pendingReviewProcedures: PUBLIC_PENDING_REVIEW,
      privateOrJwtOnlyBlocked: Array.from(KNOWN_PRIVATE_OR_JWT_ONLY),
      note: 'This extension only inspects responses for explicitly approved public endpoints.',
      ...extra
    };
    try { window.postMessage({ type: 'WARERAHUB_PUBLIC_API_STATUS', payload }, '*'); } catch {}
  }

  async function inspectResponse(input, response) {
    const url = getUrl(input);
    if (!url.includes('/trpc/')) return;
    const procedures = procedureList(url);
    if (!procedures.length) return;

    const blocked = procedures.filter(p => KNOWN_PRIVATE_OR_JWT_ONLY.has(p));
    const unapproved = procedures.filter(p => !isApprovedProcedure(p));

    // Critical safety rule:
    // If any procedure in this request is unapproved, do not clone/read the response at all.
    if (!allProceduresApproved(procedures)) {
      if (!statusSent || blocked.length) {
        statusSent = true;
        postStatus({
          lastIgnoredProcedures: procedures.slice(0, 20),
          lastBlockedPrivateProcedures: blocked.slice(0, 20),
          lastUnapprovedProcedures: unapproved.slice(0, 20)
        });
      }
      return;
    }

    const data = await response.clone().json().catch(() => null);
    if (!data) return;

    const results = Array.isArray(data) ? data : [data];
    const sync = makeApprovedPublicSync(procedures, results);
    if (!sync) return;

    try { window.postMessage({ type: 'WARERAHUB_PUBLIC_API_CAPTURE', payload: sync }, '*'); } catch {}
  }

  postStatus();

  const originalFetch = window.fetch;
  window.fetch = async function wareraHubPublicApiSafeFetch(...args) {
    const response = await originalFetch.apply(this, args);
    try { inspectResponse(args[0], response); } catch {}
    return response;
  };
})();
