(() => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-hook.js');
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);

  function combineResources(...sources) {
    const out = {};
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      for (const [key, value] of Object.entries(source)) {
        const n = Number(value);
        if (Number.isFinite(n)) out[key] = n;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  function makeResourceCapture(payload) {
    if (!payload || !payload.resourcesTrusted || !payload.resources) return null;
    return {
      source: 'warera-extension',
      resourcesTrusted: true,
      resources: combineResources(payload.resources),
      assets: payload.assets || null,
      assetBasics: payload.assetBasics || null,
      procedures: payload.procedures || [],
      resourceDebug: payload.resourceDebug || null,
      syncedAt: payload.syncedAt || new Date().toISOString()
    };
  }



  function saveSyncHealth(kind, ok, detail = {}) {
    if (!kind) return;
    try {
      chrome.storage.local.get(['warerahubSyncHealth'], (result) => {
        if (chrome.runtime.lastError) return;
        const current = (result && result.warerahubSyncHealth) || {};
        const next = {
          ...current,
          [kind]: {
            ok: !!ok,
            updatedAt: new Date().toISOString(),
            ...detail
          }
        };
        chrome.storage.local.set({ warerahubSyncHealth: next });
      });
    } catch {}
  }

  function mergeProfiles(oldProfile, payload, pendingResources, resourceCapture) {
    const oldId = oldProfile && oldProfile.user && oldProfile.user.id;
    const newId = payload && payload.user && payload.user.id;

    // Só aceitamos trocar de user quando o payload é explicitamente do user.getMe.
    // Isto evita sincronizar outra pessoa vista em MU, party, rankings ou company context.
    if (oldId && newId && oldId !== newId && !payload.isSelfProfile) return oldProfile;
    const base = oldId && newId && oldId !== newId ? {} : (oldProfile || {});

    const pendingTrusted = pendingResources && pendingResources.resourcesTrusted && pendingResources.resources;
    const captureTrusted = resourceCapture && resourceCapture.resourcesTrusted && resourceCapture.resources;
    const payloadTrusted = payload && payload.resourcesTrusted && payload.resources;
    const mergedResources = combineResources(
      (base.resourcesTrusted && base.resources) || null,
      pendingTrusted || null,
      captureTrusted || null,
      payloadTrusted ? payload.resources : null
    );

    const merged = {
      ...base,
      ...(payload || {}),
      syncedAt: (payload && payload.syncedAt) || new Date().toISOString(),
      resources: mergedResources,
      resourcesTrusted: !!((payload && payload.resourcesTrusted) || (pendingResources && pendingResources.resourcesTrusted) || (resourceCapture && resourceCapture.resourcesTrusted) || base.resourcesTrusted),
      assets: (payload && payload.assets) || (pendingResources && pendingResources.assets) || (resourceCapture && resourceCapture.assets) || base.assets || null,
      assetBasics: (payload && payload.assetBasics) || (pendingResources && pendingResources.assetBasics) || (resourceCapture && resourceCapture.assetBasics) || base.assetBasics || null,
      companies: (payload && Object.prototype.hasOwnProperty.call(payload, 'companies')) ? payload.companies : (base.companies || null),
      companiesConfirmed: (payload && Object.prototype.hasOwnProperty.call(payload, 'companiesConfirmed')) ? payload.companiesConfirmed : (base.companiesConfirmed || false),
      companyCandidates: (payload && payload.companyCandidates) || base.companyCandidates || null,
      procedures: Array.from(new Set([
        ...((base.procedures) || []),
        ...(((pendingResources || {}).procedures) || []),
        ...(((payload || {}).procedures) || [])
      ])),
      resourceDebug: (payload && payload.resourceDebug) || (pendingResources && pendingResources.resourceDebug) || (resourceCapture && resourceCapture.resourceDebug) || base.resourceDebug || null,
      resourceCapture: resourceCapture || (pendingResources && pendingResources.resourcesTrusted ? pendingResources : null) || base.resourceCapture || null,
      companySync: (payload && payload.companySync) || base.companySync || null
    };
    if (merged.resources && !Object.keys(merged.resources).length) merged.resources = null;
    return merged;
  }



  const MARKET_ITEM_ALIASES = {
    concrete:['concrete','betao','betão','cement'],
    steel:['steel','aco','aço'],
    iron:['iron','ferro'],
    limestone:['limestone','calcario','calcário','lime','stone'],
    scrap:['scrap','scraps','sucata'],
    bread:['bread','pao','pão'],
    steak:['steak','carne'],
    case1:['case1','basiccase','basic-case'],
    case2:['case2','elitecase','elite-case'],
    coca:['coca'],
    lightAmmo:['lightammo','light-ammo','municaoverde','muniçãoverde'],
    heavyAmmo:['heavyammo','heavy-ammo']
  };

  function normalizeMarketCode(text) {
    const clean = String(text || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ');
    if (!clean.trim()) return null;
    for (const [code, aliases] of Object.entries(MARKET_ITEM_ALIASES)) {
      for (const rawAlias of aliases) {
        const alias = String(rawAlias).toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        if (!alias) continue;
        if (clean === alias || clean.includes(` ${alias} `) || clean.startsWith(`${alias} `) || clean.endsWith(` ${alias}`) || clean.includes(alias)) {
          return code;
        }
      }
    }
    return null;
  }

  function isReasonableDomMarketPrice(code, value) {
    const n = Number(value);
    if (!code || !Number.isFinite(n) || n <= 0) return false;
    const maxByCode = {
      concrete: 5,
      steel: 5,
      iron: 2,
      limestone: 2,
      scrap: 5,
      bread: 10,
      steak: 15,
      lightAmmo: 5,
      heavyAmmo: 10
    };
    const max = maxByCode[code] || 25;
    return n <= max;
  }

  function marketElementSignal(el) {
    if (!el || !el.getAttribute) return '';
    const attrs = ['src','href','alt','title','aria-label','class','id','data-code','data-item','data-name','data-type'];
    const parts = [];
    for (const attr of attrs) {
      try {
        const v = el.getAttribute(attr);
        if (v) parts.push(v);
      } catch {}
    }
    try {
      if (el.dataset) Object.values(el.dataset).forEach(v => v && parts.push(v));
    } catch {}
    return parts.join(' ');
  }

  function priceFromText(text, code) {
    const raw = String(text || '').replace(/\s+/g, ' ');
    // Preços no Market aparecem como decimais: 1.61, 0.08, 22.4, etc.
    const matches = raw.match(/(?:^|[^0-9])(\d{1,6}[,.]\d{1,4})(?![0-9])/g) || [];
    const values = matches
      .map(m => Number(String(m).replace(/[^0-9,.]/g, '').replace(',', '.')))
      .filter(n => isReasonableDomMarketPrice(code, n));
    if (!values.length) return null;
    return values[0];
  }

  function nearestMarketCardText(el, code) {
    let cur = el;
    for (let i = 0; cur && i < 8; i += 1, cur = cur.parentElement) {
      const text = (cur.innerText || cur.textContent || '').trim();
      if (!text) continue;
      // Evita apanhar a página inteira, inventário do topo, carteira ou listas grandes. Queremos o tile do Market.
      if (text.length <= 180 && !/citizen since|last connection|inventory\s*→|companies|skills|battles/i.test(text) && priceFromText(text, code) != null) return text;
    }
    return '';
  }

  function scrapeVisibleMarketPrices() {
    const bodyText = (document.body && document.body.innerText) || '';
    const url = location.href || '';
    // Só tentamos quando parece haver Market aberto. Mesmo assim, a leitura é conservadora.
    const looksMarket = /market/i.test(url) || /market/i.test(bodyText);
    if (!looksMarket) return null;

    const prices = {};
    const evidence = {};
    const candidates = Array.from(document.querySelectorAll('img,svg,[class],[data-code],[data-item],[aria-label],[title]'));

    for (const el of candidates) {
      const code = normalizeMarketCode(marketElementSignal(el));
      if (!code) continue;
      const cardText = nearestMarketCardText(el, code);
      const price = priceFromText(cardText, code);
      if (price == null) continue;
      // Se aparecer mais que um tile do mesmo recurso, guardamos o menor preço visível.
      if (prices[code] == null || price < prices[code]) {
        prices[code] = price;
        evidence[code] = cardText.slice(0, 160);
      }
    }

    const wanted = ['concrete','steel','iron','limestone','scrap'];
    const hasUseful = wanted.some(k => Number.isFinite(prices[k]));
    if (!hasUseful) return null;

    return {
      source: 'warera-market-dom',
      marketPricesTrusted: true,
      prices,
      evidence,
      updatedAt: new Date().toISOString(),
      url: location.href
    };
  }

  function saveMarketPrices(capture) {
    if (!capture || !capture.marketPricesTrusted || !capture.prices) return;
    try {
      chrome.storage.local.get(['warerahubMarketPrices','warerahubProfile'], (result) => {
        if (chrome.runtime.lastError) return;
        const previous = result.warerahubMarketPrices;
        const mergedPrices = { ...((previous && previous.prices) || {}), ...(capture.prices || {}) };
        const merged = { ...capture, prices: mergedPrices };
        const profile = result.warerahubProfile;
        const nextProfile = profile && profile.user ? {
          ...profile,
          marketPricesTrusted: true,
          marketPrices: merged,
          marketPricesUpdatedAt: merged.updatedAt
        } : profile;
        saveSyncHealth('market', true, { message: 'Preços Market capturados', prices: mergedPrices, source: merged.source || 'warera-market-dom' });
        chrome.storage.local.set({
          warerahubMarketPrices: merged,
          ...(nextProfile ? { warerahubProfile: nextProfile } : {})
        });
      });
    } catch {}
  }

  let lastMarketSignature = '';
  function scanMarketPricesSoon() {
    try {
      const capture = scrapeVisibleMarketPrices();
      if (!capture) return;
      const signature = JSON.stringify(capture.prices || {});
      if (signature === lastMarketSignature) return;
      lastMarketSignature = signature;
      saveMarketPrices(capture);
    } catch {}
  }

  // DOM scrape leve: só lê preços visíveis no Market. Não toca cookies/JWT.
  setTimeout(scanMarketPricesSoon, 1200);
  setInterval(scanMarketPricesSoon, 5000);
  try {
    const obs = new MutationObserver(() => setTimeout(scanMarketPricesSoon, 350));
    obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch {}



  const COMPANY_PAGE_SIGNALS = ['produce all','build a company','companies','empresas','work','produce'];

  function normalizeCompanyProduct(text) {
    return normalizeMarketCode(text);
  }

  function looksLikeCompaniesPageText(text, url) {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
    return /companies/i.test(url || '') ||
      (lower.includes('produce all') && (lower.includes('build a company') || lower.includes('companies'))) ||
      (lower.includes('companies') && lower.includes('workers')) ||
      /\d{1,2}\s*\/\s*\d{1,2}\s*(companies|empresas)/i.test(raw) ||
      /(companies|empresas)\s*\d{1,2}\s*\/\s*\d{1,2}/i.test(raw);
  }

  function parseCountPair(text, labels) {
    const raw = String(text || '').replace(/\s+/g, ' ');
    for (const label of labels) {
      const patterns = [
        new RegExp('([0-9]{1,3})\\s*\\/\\s*([0-9]{1,3})\\s*' + label, 'i'),
        new RegExp(label + '\\s*([0-9]{1,3})\\s*\\/\\s*([0-9]{1,3})', 'i')
      ];
      for (const re of patterns) {
        const m = raw.match(re);
        if (m) return { current: Number(m[1]), limit: Number(m[2]) };
      }
    }
    return null;
  }

  function numberFromText(value) {
    const n = Number(String(value || '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function parseCompanyLevel(text, signal, kind) {
    const raw = `${text || ''} ${signal || ''}`.replace(/\s+/g, ' ');
    const isAe = kind === 'ae';
    const patterns = isAe ? [
      /(?:\bAE\b|Automated\s*Engine|Auto\s*Engine|Engine|Motor\s*Autom[aá]tico|Automatiza(?:[cç][aã]o)?)[^0-9]{0,24}([1-9][0-9]?)/i,
      /([1-9][0-9]?)[^0-9]{0,10}(?:\bAE\b|Automated\s*Engine|Auto\s*Engine)/i,
      /(?:ae|auto(?:mated)?[-_ ]?engine|engine)[-_ ]?([1-9][0-9]?)/i
    ] : [
      /(?:Storage|Armaz[eé]m|Warehouse|Storehouse)[^0-9]{0,24}([1-9][0-9]?)/i,
      /([1-9][0-9]?)[^0-9]{0,10}(?:Storage|Armaz[eé]m|Warehouse)/i,
      /(?:storage|warehouse|storehouse)[-_ ]?([1-9][0-9]?)/i
    ];
    for (const re of patterns) {
      const m = raw.match(re);
      if (!m) continue;
      const n = numberFromText(m[1]);
      if (Number.isFinite(n) && n > 0 && n <= 20) return n;
    }
    return null;
  }

  function companyCardSignal(el) {
    if (!el || !el.querySelectorAll) return '';
    const parts = [el.innerText || el.textContent || ''];
    try {
      el.querySelectorAll('img,svg,[src],[alt],[title],[aria-label],[class],[data-code],[data-product],[data-item]').forEach(child => {
        ['src','href','alt','title','aria-label','class','id','data-code','data-product','data-item','data-name','data-type'].forEach(attr => {
          const v = child.getAttribute && child.getAttribute(attr);
          if (v) parts.push(v);
        });
        if (child.dataset) Object.values(child.dataset).forEach(v => v && parts.push(v));
      });
    } catch {}
    return parts.join(' ');
  }

  function extractCompanyCard(el, index) {
    const text = String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 20 || text.length > 1100) return null;
    const lower = text.toLowerCase();
    const hasWork = /\bwork\b|\bproduce\b|produzir|empresa|company/i.test(text);
    const hasProgress = /[0-9]+(?:[,.][0-9]+)?\s*\/\s*[0-9]{2,4}/.test(text);
    const hasCompanyWord = /company|empresa|my new company|my first company/i.test(text);
    if (!hasWork || (!hasProgress && !hasCompanyWord)) return null;
    if (/battle|round|attacker|defender|damage|market|inventory\s*→/i.test(text) && !hasCompanyWord) return null;

    const signal = companyCardSignal(el);
    const product = normalizeCompanyProduct(signal) || normalizeCompanyProduct(text);
    const nameMatch = text.match(/(?:My\s+(?:new|first)\s+company|[^\n]{0,60}\bcompany\b[^\n]{0,60})/i);
    const progressMatch = text.match(/([0-9]+(?:[,.][0-9]+)?)\s*\/\s*([0-9]{2,4})/);
    const aeLevel = parseCompanyLevel(text, signal, 'ae');
    const storageLevel = parseCompanyLevel(text, signal, 'storage');
    const bonusMatch = text.match(/\+\s*([0-9]+(?:[,.][0-9]+)?)\s*%/);

    return {
      id: `dom-${index}-${(product || 'company')}`,
      name: nameMatch ? nameMatch[0].trim() : `Empresa ${index + 1}`,
      product: product || null,
      aeLevel: aeLevel || null,
      storageLevel: storageLevel || null,
      productionBonusPercent: bonusMatch ? numberFromText(bonusMatch[1]) : null,
      pp: progressMatch ? numberFromText(progressMatch[1]) : null,
      ppCap: progressMatch ? numberFromText(progressMatch[2]) : null,
      evidence: text.slice(0, 260)
    };
  }

  function scrapeVisibleCompanies() {
    const bodyText = String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
    const url = location.href || '';
    const lower = bodyText.toLowerCase();
    const looksCompanies = looksLikeCompaniesPageText(bodyText, url);
    if (!looksCompanies) return null;

    const companyCount = parseCountPair(bodyText, ['Companies','Empresas']);
    const workerCount = parseCountPair(bodyText, ['Workers','Trabalhadores']);
    const elements = Array.from(document.querySelectorAll('article,section,li,div'));
    const cards = [];
    const seenEvidence = new Set();
    for (const el of elements) {
      const c = extractCompanyCard(el, cards.length);
      if (!c) continue;
      const key = c.evidence.replace(/\d+(?:[,.]\d+)?/g, '#').slice(0, 120);
      if (seenEvidence.has(key)) continue;
      // Evita capturar o container da página quando já capturámos cards menores.
      if (cards.some(prev => prev.evidence && c.evidence.includes(prev.evidence))) continue;
      seenEvidence.add(key);
      cards.push(c);
      if (cards.length >= 12) break;
    }

    const useful = (companyCount && Number.isFinite(companyCount.current)) || cards.length;
    if (!useful) return null;
    return {
      source: 'warera-companies-dom',
      companiesTrusted: true,
      summary: {
        owned: companyCount ? companyCount.current : (cards.length || null),
        limit: companyCount ? companyCount.limit : null,
        workers: workerCount ? workerCount.current : null,
        workerLimit: workerCount ? workerCount.limit : null
      },
      list: cards,
      aeLevels: cards.map(c => c.aeLevel).filter(n => Number.isFinite(Number(n))),
      products: cards.map(c => c.product).filter(Boolean),
      diagnostics: {
        cardsSeen: cards.length,
        aeConfirmed: cards.filter(c => Number.isFinite(Number(c.aeLevel)) && c.aeLevel > 0).length,
        storageConfirmed: cards.filter(c => Number.isFinite(Number(c.storageLevel)) && c.storageLevel > 0).length,
        ppConfirmed: cards.filter(c => Number.isFinite(Number(c.pp))).length
      },
      updatedAt: new Date().toISOString(),
      url: location.href,
      evidence: bodyText.slice(0, 700)
    };
  }

  function saveCompanySync(capture) {
    if (!capture || !capture.companiesTrusted) return;
    try {
      chrome.storage.local.get(['warerahubCompanySync','warerahubProfile'], (result) => {
        if (chrome.runtime.lastError) return;
        const previous = result.warerahubCompanySync || {};
        const merged = {
          ...previous,
          ...capture,
          summary: { ...((previous && previous.summary) || {}), ...((capture && capture.summary) || {}) },
          list: capture.list && capture.list.length ? capture.list : (previous.list || []),
          aeLevels: capture.aeLevels && capture.aeLevels.length ? capture.aeLevels : (previous.aeLevels || []),
          products: capture.products && capture.products.length ? capture.products : (previous.products || []),
          diagnostics: capture.diagnostics || previous.diagnostics || null
        };
        const profile = result.warerahubProfile;
        const nextProfile = profile && profile.user ? {
          ...profile,
          companiesConfirmed: true,
          companySync: merged,
          companies: {
            source: 'warera-companies-dom',
            confirmed: true,
            count: merged.summary && merged.summary.owned,
            limit: merged.summary && merged.summary.limit,
            list: merged.list || [],
            aeLevels: merged.aeLevels || [],
            products: merged.products || [],
            updatedAt: merged.updatedAt || null
          }
        } : profile;
        saveSyncHealth('companies', true, { message: 'Empresas capturadas', summary: merged.summary || null, products: merged.products || [], aeLevels: merged.aeLevels || [], diagnostics: merged.diagnostics || null, source: merged.source || 'warera-companies-dom' });
        chrome.storage.local.set({
          warerahubCompanySync: merged,
          ...(nextProfile ? { warerahubProfile: nextProfile } : {})
        });
      });
    } catch {}
  }

  let lastCompanySignature = '';
  function scanCompaniesSoon() {
    try {
      const bodyText = String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
      const onCompaniesPage = looksLikeCompaniesPageText(bodyText, location.href || '');
      const capture = scrapeVisibleCompanies();
      if (!capture) {
        if (onCompaniesPage) {
          saveSyncHealth('companies', false, {
            message: 'Página Companies detetada, mas ainda não consegui ler a contagem/cards.',
            pageDetected: true,
            preview: bodyText.slice(0, 320)
          });
        }
        return;
      }
      const signature = JSON.stringify({ s: capture.summary, a: capture.aeLevels, p: capture.products, n: (capture.list || []).length });
      if (signature === lastCompanySignature) return;
      lastCompanySignature = signature;
      saveCompanySync(capture);
    } catch (err) {
      saveSyncHealth('companies', false, { message: 'Erro ao tentar ler Companies.', error: String(err && err.message || err).slice(0, 180) });
    }
  }

  setTimeout(scanCompaniesSoon, 1500);
  setInterval(scanCompaniesSoon, 6000);
  try {
    const companyObs = new MutationObserver(() => setTimeout(scanCompaniesSoon, 450));
    companyObs.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch {}

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'WARERA_TRPC_CAPTURE') return;
    const payload = event.data.payload;
    if (!payload) return;

    chrome.storage.local.get(['warerahubProfile', 'warerahubPendingResourceCapture', 'warerahubResourceCapture'], (result) => {
      const currentProfile = result.warerahubProfile;
      const pending = result.warerahubPendingResourceCapture;
      const existingResourceCapture = result.warerahubResourceCapture;

      // Recursos confirmados podem chegar antes do perfil. Guardamos em buffer para
      // juntar ao próximo user.getMe em vez de perder Concrete/Steel/etc.
      const hasProfile = currentProfile && currentProfile.user && currentProfile.leveling && currentProfile.skills;
      const incomingResourceCapture = makeResourceCapture(payload);
      if (payload.user && payload.leveling && payload.skills) saveSyncHealth('profile', true, { message: 'Perfil e skills capturados', username: payload.user.username || null, level: payload.leveling.level || null });
      if (payload.resourcesTrusted && payload.resources) saveSyncHealth('inventory', true, { message: 'Inventário capturado', resources: payload.resources });

      const isResourceOnly = payload.resourcesTrusted && payload.resources && !payload.user;
      if (isResourceOnly && !hasProfile) {
        const mergedPending = {
          ...(pending || {}),
          source: 'warera-extension',
          resourcesTrusted: true,
          resources: { ...(((pending || {}).resources) || {}), ...payload.resources },
          assets: payload.assets || (pending && pending.assets) || null,
          procedures: Array.from(new Set([ ...(((pending || {}).procedures) || []), ...((payload.procedures) || []) ])),
          resourceDebug: payload.resourceDebug || (pending && pending.resourceDebug) || null,
          syncedAt: payload.syncedAt || new Date().toISOString()
        };
        chrome.storage.local.set({
          warerahubPendingResourceCapture: mergedPending,
          warerahubResourceCapture: incomingResourceCapture || existingResourceCapture || mergedPending
        });
        return;
      }

      const merged = mergeProfiles(currentProfile, payload, pending, incomingResourceCapture || existingResourceCapture);
      if (!merged.user || !merged.leveling || !merged.skills) return;

      chrome.storage.local.set({
        warerahubProfile: merged,
        warerahubProfileUpdatedAt: Date.now(),
        warerahubPendingResourceCapture: null,
        warerahubResourceCapture: merged.resourceCapture || incomingResourceCapture || existingResourceCapture || null
      });
    });
  });
})();
