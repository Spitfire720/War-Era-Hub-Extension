(() => {
  if (window.__wareraHubSyncHooked) return;
  window.__wareraHubSyncHooked = true;

  const skillKeys = [
    'attack','precision','criticalChance','criticalDamages','armor','dodge','health','lootChance','hunger',
    'entrepreneurship','energy','production','companies','management'
  ];

  const RESOURCE_ALIASES = {
    money:['money','coins','coin','btc','currency'],
    concrete:['concrete','cement'],
    steel:['steel'],
    iron:['iron'],
    limestone:['limestone','lime','stone'],
    scrap:['scrap','scraps'],
    grain:['grain','cereal','cereals'],
    lead:['lead'],
    oil:['oil'],
    wood:['wood'],
    paper:['paper'],
    ammo:['ammo','ammunition'],
    weapon:['weapon','weapons']
  };

  let lastPayload = null;

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

  function pickByProcedure(procedures, results, name) {
    const idx = procedures.indexOf(name);
    if (idx === -1) return null;
    return resultData(results[idx]);
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

  function looksLikeUser(data) {
    return data && data._id && data.username && data.leveling && data.skills;
  }

  function normalizeText(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).toLowerCase();
    if (typeof value === 'object') {
      const parts = [];
      for (const k of ['code','key','slug','name','title','label','type','resource','resourceCode']) {
        if (value[k] != null && typeof value[k] !== 'object') parts.push(String(value[k]));
      }
      return parts.join(' ').toLowerCase();
    }
    return '';
  }

  function normalizeResourceCode(...values) {
    const clean = values.map(normalizeText).join(' ').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    if (!clean.trim()) return null;
    for (const [key, aliases] of Object.entries(RESOURCE_ALIASES)) {
      if (aliases.some(a => {
        const aa = String(a).toLowerCase();
        return clean === aa || clean.includes(` ${aa} `) || clean.startsWith(`${aa} `) || clean.endsWith(` ${aa}`) || clean.includes(aa);
      })) return key;
    }
    return null;
  }

  function numberFrom(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const n = Number(value.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function addResource(out, code, quantity) {
    const key = normalizeResourceCode(code);
    const n = numberFrom(quantity);
    if (!key || n == null) return;
    out[key] = (out[key] || 0) + n;
  }

  function quantityCandidates(node) {
    // Intencionalmente restrito. Campos genéricos como value, total, current e capacity
    // confundem storage/PP/níveis com recursos reais.
    return [node.quantity, node.amount, node.count, node.qty];
  }

  function codeCandidates(node) {
    return [
      node.code, node.key, node.type, node.name, node.title, node.label, node.slug, node.resource, node.resourceCode,
      node.item, node.asset, node.resourceType, node.product, node.material, node.good,
      node.item?.code, node.item?.name, node.item?.title, node.item?.slug,
      node.asset?.code, node.asset?.name, node.asset?.title, node.asset?.slug, node.asset?.type,
      node.resourceType?.code, node.resourceType?.name, node.product?.code, node.product?.name
    ];
  }

  function extractResources(node, out = {}, depth = 0, seen = new WeakSet()) {
    if (!node || depth > 12) return out;
    if (Array.isArray(node)) {
      node.forEach(x => extractResources(x, out, depth + 1, seen));
      return out;
    }
    if (typeof node !== 'object') return out;
    if (seen.has(node)) return out;
    seen.add(node);

    // Suporta mapas simples de recursos, por exemplo { concrete: 24 }
    // ou { concrete: { amount: 24 } }.
    for (const [entryKey, entryVal] of Object.entries(node)) {
      const mappedKey = normalizeResourceCode(entryKey);
      if (mappedKey) {
        if (typeof entryVal === 'number' || typeof entryVal === 'string') addResource(out, mappedKey, entryVal);
        if (entryVal && typeof entryVal === 'object') {
          for (const q of quantityCandidates(entryVal)) {
            const n = numberFrom(q);
            if (n != null) { addResource(out, mappedKey, n); break; }
          }
        }
      }
    }

    const code = normalizeResourceCode(...codeCandidates(node));
    if (code) {
      for (const q of quantityCandidates(node)) {
        const n = numberFrom(q);
        if (n != null) { addResource(out, code, n); break; }
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') extractResources(value, out, depth + 1, seen);
    }
    return out;
  }



  function extractResourcesFromAssetInventory(source) {
    if (!source || typeof source !== 'object') return {};
    const basics = source.items && source.items.basics;
    if (!basics || typeof basics !== 'object' || Array.isArray(basics)) return {};

    // Forma confirmada do endpoint asset.getUserAssets:
    // result.data.items.basics = { bread, steak, case1, concrete, steel, coca, scraps, limestone, iron, ... }
    // Só usamos este caminho explícito para evitar confundir PP, storage ou stats com recursos.
    const out = {};
    if (Number.isFinite(Number(source.money))) out.money = Number(source.money);

    for (const [rawKey, rawValue] of Object.entries(basics)) {
      const key = normalizeResourceCode(rawKey);
      const n = numberFrom(rawValue);
      if (!key || n == null) continue;
      out[key] = n;
    }
    return out;
  }

  function getAssetBasics(source) {
    const basics = source && source.items && source.items.basics;
    if (!basics || typeof basics !== 'object' || Array.isArray(basics)) return null;
    const out = {};
    for (const [key, value] of Object.entries(basics)) {
      if (typeof value === 'number' || typeof value === 'string') out[key] = value;
    }
    return Object.keys(out).length ? out : null;
  }

  function looksLikeAssetInventory(source) {
    const basics = getAssetBasics(source);
    if (!basics) return false;

    // v16.3: só aceitamos o formato real do asset.getUserAssets.
    // O fallback global da v16.2 encontrava qualquer items.basics no JSON e podia
    // confundir payloads de contexto com inventário real. O endpoint correto tem
    // user/asset identity + money/market/estimatedValues.
    const hasOwnerSignal = !!(source.user || source.managers || source._id);
    const hasAssetSignal = (typeof source.money === 'number') || !!source.market || !!source.estimatedValues;
    if (!hasOwnerSignal || !hasAssetSignal) return false;

    const confirmedKeys = ['concrete','steel','iron','limestone','scraps','scrap','bread','steak','case1','case2','coca'];
    return confirmedKeys.some(k => Object.prototype.hasOwnProperty.call(basics, k));
  }

  function findAssetInventory(node, depth = 0, seen = new WeakSet()) {
    if (!node || depth > 8) return null;
    if (typeof node !== 'object') return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (looksLikeAssetInventory(node)) return node;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findAssetInventory(item, depth + 1, seen);
        if (found) return found;
      }
      return null;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        const found = findAssetInventory(value, depth + 1, seen);
        if (found) return found;
      }
    }
    return null;
  }

  function mergeResourceObjects(...objects) {
    const out = {};
    for (const obj of objects) {
      if (!obj || typeof obj !== 'object') continue;
      for (const [key, value] of Object.entries(obj)) {
        const n = numberFrom(value);
        if (n == null) continue;
        out[key] = n;
      }
    }
    return out;
  }

  function extractTrustedResourcesFromProcedures(procedureData) {
    const assetSource = procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets'];

    // v16.3: recursos trusted vêm apenas do endpoint confirmado:
    // asset.getUserAssets -> result.data.items.basics.
    // Não usamos parser genérico de inventory/company/battle porque já causou valores falsos
    // como steel/iron vindos de outros contextos.
    return extractResourcesFromAssetInventory(assetSource);
  }

  function looksLikeCompany(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    const hasIdentity = !!(node._id || node.id);
    const hasSignal = !!(
      node.automatedEngine || node.automatedEngineLevel !== undefined || node.autoEngineLevel !== undefined ||
      node.storage || node.storageLevel !== undefined || node.productionPoints !== undefined || node.currentProductionPoints !== undefined ||
      node.pp !== undefined || node.product || node.recipe || node.resourceCode || node.workers || node.location || node.region
    );
    const battleLike = node.battle || node.side || node.priority || node.terrain || node.round;
    return hasIdentity && hasSignal && !battleLike;
  }

  function normalizeCompany(node) {
    if (!looksLikeCompany(node)) return null;
    const ae = node.automatedEngine?.level ?? node.automatedEngineLevel ?? node.autoEngineLevel ?? node.engine?.level ?? node.aeLevel ?? node.ae;
    const storage = node.storage?.level ?? node.storageLevel ?? node.warehouseLevel ?? node.storehouseLevel ?? node.storage?.currentLevel;
    const pp = node.productionPoints ?? node.currentProductionPoints ?? node.pp ?? node.points ?? node.progress?.current ?? null;
    const ppCap = node.productionPointsCapacity ?? node.maxProductionPoints ?? node.capacity ?? node.storage?.capacity ?? node.progress?.max ?? null;
    return {
      id: node._id || node.id,
      name: node.name || node.title || null,
      product: node.product?.code || node.product?.name || node.product || node.recipe?.code || node.recipe?.name || node.recipe || node.resourceCode || node.resource || node.code || null,
      aeLevel: Number.isFinite(Number(ae)) ? Number(ae) : null,
      storageLevel: Number.isFinite(Number(storage)) ? Number(storage) : null,
      pp: Number.isFinite(Number(pp)) ? Number(pp) : null,
      ppCap: Number.isFinite(Number(ppCap)) ? Number(ppCap) : null
    };
  }

  function extractCompanies(node, out = [], seenIds = new Set(), depth = 0, seenNodes = new WeakSet()) {
    if (!node || depth > 12) return out;
    if (Array.isArray(node)) {
      node.forEach(x => extractCompanies(x, out, seenIds, depth + 1, seenNodes));
      return out;
    }
    if (typeof node !== 'object') return out;
    if (seenNodes.has(node)) return out;
    seenNodes.add(node);
    const c = normalizeCompany(node);
    if (c && !seenIds.has(c.id)) { seenIds.add(c.id); out.push(c); }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') extractCompanies(value, out, seenIds, depth + 1, seenNodes);
    }
    return out;
  }

  function makeProcedureMap(procedures, results) {
    const map = {};
    procedures.forEach((name, i) => {
      const value = resultData(results[i]);
      if (value !== undefined && value !== null) map[name] = value;
    });

    // tRPC batches occasionally include the procedure name in the URL but the simple
    // index map misses the corresponding result. When asset.getUserAssets is present,
    // scan the full response for the confirmed inventory shape instead of relying only
    // on the array index. This avoids the current state where procedureNames contains
    // asset.getUserAssets but hasAssetProcedure is false.
    const assetProcedureName = procedures.includes('asset.getUserAssets')
      ? 'asset.getUserAssets'
      : (procedures.includes('asset.getMyAssets') ? 'asset.getMyAssets' : null);
    if (assetProcedureName && !looksLikeAssetInventory(map[assetProcedureName])) {
      const candidate = findAssetInventory(results.map(resultData).filter(Boolean)) || findAssetInventory(results);
      if (candidate) map[assetProcedureName] = candidate;
    }
    return map;
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
      battleId: live.battleId || round.battle || live.battleId || null,
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
      hitCountAttacker: Number.isFinite(Number(attacker.hitCount)) ? Number(attacker.hitCount) : null,
      hitCountDefender: Number.isFinite(Number(defender.hitCount)) ? Number(defender.hitCount) : null,
      isActive: round.isActive !== false,
      actualTickPoints: round.actualTickPoints ?? live.live?.actualTickPoints ?? null,
      nextTickAt: round.nextTickAt || live.live?.nextTickAt || null,
      ticksCount: live.live?.ticksCount ?? null,
      roundUpdatedAt: round.updatedAt || null,
      battleRoundIds: battleMeta && Array.isArray(battleMeta.roundIds) ? battleMeta.roundIds.slice(0, 8) : []
    };
  }


  function compactOrder(order) {
    if (!order || typeof order !== 'object') return null;
    return {
      id: order._id || order.id || null,
      country: order.country || null,
      user: order.user || null,
      battle: order.battle || order.battleId || null,
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


  function mergeUniqueBy(items, keyFn, limit) {
    const map = new Map();
    (items || []).filter(Boolean).forEach(item => {
      const key = keyFn(item);
      if (!key) return;
      map.set(String(key), { ...(map.get(String(key)) || {}), ...item });
    });
    return Array.from(map.values()).slice(0, limit || 60);
  }

  function mergeBattleSyncPackets(previous, current) {
    if (!previous || !previous.trusted) return current || null;
    if (!current || !current.trusted) return previous || null;
    const activeBattleIds = Array.from(new Set([
      ...((previous.activeBattleIds || []).map(String)),
      ...((current.activeBattleIds || []).map(String))
    ])).slice(0, 80);
    const orders = mergeUniqueBy([...(previous.orders || []), ...(current.orders || [])], o => o.id || `${o.battleId || o.battle}-${o.side}-${o.text || ''}`, 40);
    const battles = mergeUniqueBy([...(previous.battles || []), ...(current.battles || [])], b => b.id || b._id || b.battleId, 60);
    const live = mergeUniqueBy([...(previous.live || []), ...(current.live || [])], l => l.battleId || l.roundId || l.currentRound, 80);
    return {
      ...previous,
      ...current,
      source: current.source || previous.source || 'warera-trpc-battles',
      trusted: true,
      updatedAt: current.updatedAt || new Date().toISOString(),
      activeBattleIds,
      orders,
      battles,
      live,
      diagnostics: {
        ...((previous && previous.diagnostics) || {}),
        ...((current && current.diagnostics) || {}),
        mergedPrevious: true,
        ordersStored: orders.length,
        battlesStored: battles.length,
        liveStored: live.length
      }
    };
  }

  function makeBattleSync(procedures, results, procedureData) {
    const orderPayloads = collectByProcedure(procedures, results, 'battleOrderSummary.getByBattle')
      .flatMap(x => Array.isArray(x) ? x : (x ? [x] : []))
      .map(compactOrder)
      .filter(Boolean);
    const battlePayloads = collectByProcedure(procedures, results, 'battle.getById')
      .map(compactBattle)
      .filter(b => b && b.id);
    const livePayloads = collectByProcedure(procedures, results, 'battle.getLiveBattleData')
      .map(compactLiveData)
      .filter(Boolean);
    const activeIdsPayloads = collectByProcedure(procedures, results, 'battle.getSortedActiveBattles')
      .flatMap(x => Array.isArray(x) ? x : []);

    if (!orderPayloads.length && !battlePayloads.length && !livePayloads.length && !activeIdsPayloads.length) return null;

    const battleById = new Map(battlePayloads.map(b => [String(b.id), b]));
    const liveByRound = new Map(livePayloads.filter(l => l.roundId).map(l => [String(l.roundId), l]));
    const liveByBattle = new Map(livePayloads.filter(l => l.battleId).map(l => [String(l.battleId), l]));
    const orders = orderPayloads.map(order => {
      const battle = battleById.get(String(order.battleId || '')) || null;
      const live = liveByBattle.get(String(order.battleId || '')) || liveByRound.get(String(battle && battle.currentRound || '')) || null;
      return { ...order, battleObj: battle, live };
    });

    return {
      source: 'warera-trpc-battles',
      trusted: true,
      updatedAt: new Date().toISOString(),
      activeBattleIds: Array.from(new Set(activeIdsPayloads.map(String))).slice(0, 60),
      orders: orders.slice(0, 20),
      battles: battlePayloads.slice(0, 30),
      live: livePayloads.slice(0, 30),
      diagnostics: {
        procedureNames: procedures.filter(p => /battle|order|round/i.test(p)).slice(0, 60),
        ordersSeen: orders.length,
        battlesSeen: battlePayloads.length,
        liveSeen: livePayloads.length,
        activeIdsSeen: activeIdsPayloads.length
      }
    };
  }


  function normalizeUser(user, equipped, assets, companies, procedures, allResults, procedureData, resourcesOverride) {
    const skills = {};
    for (const key of skillKeys) {
      const s = user.skills && user.skills[key];
      if (!s) continue;
      skills[key] = {
        level: Number(s.level || 0),
        value: s.value ?? null,
        total: s.total ?? null,
        totalAfterSoftCap: s.totalAfterSoftCap ?? null,
        currentBarValue: s.currentBarValue ?? null,
        hourlyBarRegen: s.hourlyBarRegen ?? null
      };
    }

    const resources = resourcesOverride && Object.keys(resourcesOverride).length
      ? resourcesOverride
      : extractTrustedResourcesFromProcedures(procedureData);
    const resourcesTrusted = !!(resources && Object.keys(resources).length);
    const assetBasics = getAssetBasics(assets || procedureData['asset.getUserAssets']);

    // Só guardamos empresas confirmadas quando vêm diretamente no user.getMe.
    // company.getCompanies pode trazer listas públicas ou dados de contexto e não deve ser usado como owned.
    const ownedCompanySource = user.companies || user.ownedCompanies || user.userCompanies || user.companyList || null;
    const ownedCompanies = extractCompanies(ownedCompanySource);
    const companyCandidates = companies && companies.length ? companies : extractCompanies({ allResults, procedureData });

    return {
      source: 'warera-extension',
      isSelfProfile: true,
      syncedAt: new Date().toISOString(),
      procedures,
      user: {
        id: user._id,
        username: user.username,
        country: user.country || null,
        avatarUrl: user.avatarUrl || null,
        militaryRank: user.militaryRank || null
      },
      leveling: {
        level: user.leveling?.level ?? null,
        totalXp: user.leveling?.totalXp ?? null,
        availableSkillPoints: user.leveling?.availableSkillPoints ?? null,
        spentSkillPoints: user.leveling?.spentSkillPoints ?? null,
        totalSkillPoints: user.leveling?.totalSkillPoints ?? null,
        freeReset: user.leveling?.freeReset ?? null
      },
      skills,
      equipment: equipped || user.equipment || null,
      assets: assets || procedureData['asset.getUserAssets'] || null,
      assetBasics,
      resources: Object.keys(resources).length ? resources : null,
      resourcesTrusted,
      companies: ownedCompanies && ownedCompanies.length ? { source:'owned', confirmed:true, list:ownedCompanies } : null,
      companiesConfirmed: !!(ownedCompanies && ownedCompanies.length),
      companyCandidates: companyCandidates && companyCandidates.length ? companyCandidates.slice(0,20) : null,
      company: user.company || null,
      mu: user.mu || null,
      party: user.party || null,
      rankings: user.rankings || null,
      stats: user.stats || null,
      resourceDebug: {
        resourcesTrusted,
        hasAssetProcedure: !!(procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets']),
        hasCompanyProcedure: !!procedureData['company.getCompanies'],
        procedureNames: procedures,
        assetPreview: (procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets']) ? JSON.stringify(procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets']).slice(0,1200) : null,
        companyPreview: procedureData['company.getCompanies'] ? JSON.stringify(procedureData['company.getCompanies']).slice(0,1200) : null
      }
    };
  }

  function emit(payload) {
    if (!payload) return;
    const merged = {
      ...(lastPayload || {}),
      ...payload,
      syncedAt: payload.syncedAt || new Date().toISOString(),
      resources: payload.resourcesTrusted
        ? { ...((lastPayload && lastPayload.resourcesTrusted && lastPayload.resources) || {}), ...(payload.resources || {}) }
        : ((lastPayload && lastPayload.resourcesTrusted && lastPayload.resources) || null),
      resourcesTrusted: !!(payload.resourcesTrusted || (lastPayload && lastPayload.resourcesTrusted)),
      assets: payload.assets || (lastPayload && lastPayload.assets) || null,
      assetBasics: payload.assetBasics || (lastPayload && lastPayload.assetBasics) || null,
      companies: payload.companies || (lastPayload && lastPayload.companies) || null,
      battleSync: mergeBattleSyncPackets(lastPayload && lastPayload.battleSync, payload.battleSync) || null
    };
    if (merged.resources && !Object.keys(merged.resources).length) merged.resources = null;
    lastPayload = merged;
    window.postMessage({ type: 'WARERA_TRPC_CAPTURE', payload: merged }, '*');
  }

  async function inspectResponse(input, response) {
    const url = getUrl(input);
    if (!url.includes('/trpc/')) return;
    const procedures = procedureList(url);
    if (!procedures.length) return;

    const data = await response.clone().json().catch(() => null);
    if (!data) return;
    const results = Array.isArray(data) ? data : [data];
    const allData = results.map(resultData).filter(Boolean);
    const procedureData = makeProcedureMap(procedures, results);

    const user = pickByProcedure(procedures, results, 'user.getMe');

    const resources = extractTrustedResourcesFromProcedures(procedureData);
    const resourcesTrusted = !!(resources && Object.keys(resources).length);
    const equipped = pickByProcedure(procedures, results, 'inventory.equippedItems');
    const assets = procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets'] || null;
    const assetBasics = getAssetBasics(assets);
    const companiesFromProcedure = pickByProcedure(procedures, results, 'company.getCompanies');
    const companies = extractCompanies({ companiesFromProcedure, allData, procedureData });
    const battleSync = makeBattleSync(procedures, results, procedureData);

    if (looksLikeUser(user)) {
      const normalized = normalizeUser(user, equipped, assets, companies, procedures, allData, procedureData, resources);
      if (battleSync) normalized.battleSync = battleSync;
      emit(normalized);
      return;
    }

    // Updates parciais: recursos confirmados de asset.getUserAssets são seguros mesmo que
    // cheguem antes do user.getMe nesta página. O content script faz o merge com o perfil
    // guardado ou guarda temporariamente até o perfil chegar. Empresas continuam a não ser
    // aceites como owned sem confirmação do user.getMe.
    if (resourcesTrusted || assets || battleSync || (companiesFromProcedure && lastPayload && lastPayload.isSelfProfile)) {
      emit({
        source: 'warera-extension',
        isPartialCapture: true,
        syncedAt: new Date().toISOString(),
        procedures,
        resources: resourcesTrusted ? resources : undefined,
        resourcesTrusted,
        assets: assets || undefined,
        assetBasics: assetBasics || undefined,
        battleSync: battleSync || undefined,
        rawResources: allData,
        resourceDebug: {
          resourcesTrusted,
          hasAssetProcedure: !!(procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets']),
          hasCompanyProcedure: !!procedureData['company.getCompanies'],
          procedureNames: procedures,
          assetPreview: (procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets']) ? JSON.stringify(procedureData['asset.getUserAssets'] || procedureData['asset.getMyAssets']).slice(0,1200) : null,
          companyPreview: procedureData['company.getCompanies'] ? JSON.stringify(procedureData['company.getCompanies']).slice(0,1200) : null,
          companyCandidates: companies.length
        }
      });
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const response = await originalFetch.apply(this, args);
    try { inspectResponse(args[0], response); } catch {}
    return response;
  };
})();
