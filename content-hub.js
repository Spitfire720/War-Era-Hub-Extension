(() => {
  let alive = true;

  function hasRuntime() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);
    } catch {
      return false;
    }
  }

  function mergeResourceCapture(profile, capture) {
    if (!profile || !capture || !capture.resourcesTrusted || !capture.resources) return profile;
    return {
      ...profile,
      resourcesTrusted: true,
      resources: { ...((profile.resourcesTrusted && profile.resources) || {}), ...(capture.resources || {}) },
      assets: profile.assets || capture.assets || null,
      assetBasics: profile.assetBasics || capture.assetBasics || null,
      resourceCapture: capture,
      resourceDebug: profile.resourceDebug || capture.resourceDebug || null
    };
  }




  function mergeCompanySync(profile, companyCapture) {
    if (!profile || !companyCapture || !companyCapture.companiesTrusted) return profile;
    return {
      ...profile,
      companiesConfirmed: true,
      companySync: companyCapture,
      companies: {
        source: companyCapture.source || 'warera-companies-dom',
        confirmed: true,
        count: companyCapture.summary && companyCapture.summary.owned,
        limit: companyCapture.summary && companyCapture.summary.limit,
        workerCount: companyCapture.summary && companyCapture.summary.workers,
        workerLimit: companyCapture.summary && companyCapture.summary.workerLimit,
        list: companyCapture.list || [],
        aeLevels: companyCapture.aeLevels || [],
        products: companyCapture.products || [],
        updatedAt: companyCapture.updatedAt || null
      }
    };
  }

  function mergeMarketPrices(profile, marketCapture) {
    if (!profile || !marketCapture || !marketCapture.marketPricesTrusted || !marketCapture.prices) return profile;
    return {
      ...profile,
      marketPricesTrusted: true,
      marketPrices: marketCapture,
      marketPricesUpdatedAt: marketCapture.updatedAt || null
    };
  }

  function mergeSyncHealth(profile, health) {
    if (!profile || !health || typeof health !== 'object') return profile;
    return {
      ...profile,
      syncHealth: health
    };
  }

  function mergeAllCaptures(profile, resourceCapture, marketCapture, companyCapture, syncHealth) {
    return mergeSyncHealth(mergeCompanySync(mergeMarketPrices(mergeResourceCapture(profile, resourceCapture), marketCapture), companyCapture), syncHealth);
  }

  function publish(profile) {
    if (!profile) return;
    try { localStorage.setItem('warerahub_sync_profile', JSON.stringify(profile)); } catch {}
    try { window.postMessage({ type: 'WARERAHUB_EXTENSION_SYNC', payload: profile }, '*'); } catch {}
    try {
      window.dispatchEvent(new CustomEvent('warerahub-extension-sync', { detail: profile }));
    } catch {}
  }

  function loadAndPublish() {
    if (!alive || !hasRuntime()) { alive = false; return; }
    try {
      chrome.storage.local.get(['warerahubProfile', 'warerahubResourceCapture', 'warerahubMarketPrices', 'warerahubCompanySync', 'warerahubSyncHealth'], (result) => {
        if (chrome.runtime.lastError) { alive = false; return; }
        publish(mergeAllCaptures(result && result.warerahubProfile, result && result.warerahubResourceCapture, result && result.warerahubMarketPrices, result && result.warerahubCompanySync, result && result.warerahubSyncHealth));
      });
    } catch {
      alive = false;
    }
  }


  function clearExtensionSyncStorage() {
    try { localStorage.removeItem('warerahub_sync_profile'); } catch {}
    if (!alive || !hasRuntime()) return;
    try {
      chrome.storage.local.remove([
        'warerahubProfile',
        'warerahubResourceCapture',
        'warerahubPendingResourceCapture',
        'warerahubMarketPrices',
        'warerahubCompanySync',
        'warerahubSyncHealth'
      ], () => {
        if (chrome.runtime.lastError) { alive = false; return; }
        try {
          window.postMessage({ type: 'WARERAHUB_EXTENSION_SYNC_CLEARED' }, '*');
          window.dispatchEvent(new CustomEvent('warerahub-extension-sync-cleared'));
        } catch {}
      });
    } catch {
      alive = false;
    }
  }

  loadAndPublish();
  const timer = setInterval(() => {
    if (!alive) { clearInterval(timer); return; }
    loadAndPublish();
  }, 5000);

  try {
    if (hasRuntime()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!alive) return;
        if (area === 'local' && (changes.warerahubProfile || changes.warerahubResourceCapture || changes.warerahubMarketPrices || changes.warerahubCompanySync || changes.warerahubSyncHealth)) {
          chrome.storage.local.get(['warerahubProfile', 'warerahubResourceCapture', 'warerahubMarketPrices', 'warerahubCompanySync', 'warerahubSyncHealth'], (result) => {
            if (chrome.runtime.lastError) { alive = false; return; }
            publish(mergeAllCaptures(result && result.warerahubProfile, result && result.warerahubResourceCapture, result && result.warerahubMarketPrices, result && result.warerahubCompanySync, result && result.warerahubSyncHealth));
          });
        }
      });
    }
  } catch {
    alive = false;
  }

  try {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === 'WARERAHUB_CLEAR_EXTENSION_SYNC') {
        clearExtensionSyncStorage();
      }
    });
    window.addEventListener('warerahub-clear-extension-sync', clearExtensionSyncStorage);
  } catch {}

})();
