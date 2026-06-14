(() => {
  let alive = true;

  function hasRuntime() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);
    } catch {
      return false;
    }
  }

  function makeSafeProfile(result) {
    const complianceStatus = result && result.warerahubComplianceStatus;
    const publicApiSync = result && result.warerahubPublicApiSync;
    const syncHealth = result && result.warerahubSyncHealth;

    return {
      source: 'warerahub-extension-safe-mode',
      extensionSafeMode: true,
      publicApiOnly: true,
      syncedAt: new Date().toISOString(),
      complianceStatus: complianceStatus || {
        safeMode: true,
        publicApiOnly: true,
        message: 'Safe Mode active. Private/JWT-only sync disabled.'
      },
      publicApiSync: publicApiSync || null,
      battleSync: publicApiSync && publicApiSync.battleSync ? publicApiSync.battleSync : null,
      syncHealth: syncHealth || {}
    };
  }

  function publish(profile) {
    if (!profile) return;
    try { localStorage.setItem('warerahub_sync_profile', JSON.stringify(profile)); } catch {}
    try { window.postMessage({ type: 'WARERAHUB_EXTENSION_SYNC', payload: profile }, '*'); } catch {}
    try { window.dispatchEvent(new CustomEvent('warerahub-extension-sync', { detail: profile })); } catch {}
  }

  function loadAndPublish() {
    if (!alive || !hasRuntime()) { alive = false; return; }
    try {
      chrome.storage.local.get(['warerahubComplianceStatus', 'warerahubPublicApiSync', 'warerahubSyncHealth'], (result) => {
        if (chrome.runtime.lastError) { alive = false; return; }
        publish(makeSafeProfile(result || {}));
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
        'warerahubCombatStats',
        'warerahubBattleSync',
        'warerahubPublicApiSync',
        'warerahubComplianceStatus',
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
        if (area === 'local' && (changes.warerahubComplianceStatus || changes.warerahubPublicApiSync || changes.warerahubSyncHealth)) {
          loadAndPublish();
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
