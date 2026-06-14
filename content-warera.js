(() => {
  const STORAGE_KEYS_TO_DISABLE = [
    'warerahubProfile',
    'warerahubResourceCapture',
    'warerahubPendingResourceCapture',
    'warerahubMarketPrices',
    'warerahubCompanySync',
    'warerahubCombatStats',
    'warerahubBattleSync'
  ];

  function safeSet(obj) {
    try { chrome.storage.local.set(obj); } catch {}
  }

  function safeRemove(keys, cb) {
    try { chrome.storage.local.remove(keys, cb); } catch { if (cb) cb(); }
  }

  function setHealth(kind, ok, detail = {}) {
    try {
      chrome.storage.local.get(['warerahubSyncHealth'], (result) => {
        const current = (result && result.warerahubSyncHealth) || {};
        chrome.storage.local.set({
          warerahubSyncHealth: {
            ...current,
            [kind]: {
              ok: !!ok,
              updatedAt: new Date().toISOString(),
              ...detail
            }
          }
        });
      });
    } catch {}
  }

  function setComplianceStatus(status = {}) {
    const next = {
      source: 'warerahub-extension-safe-mode',
      safeMode: true,
      publicApiOnly: true,
      updatedAt: new Date().toISOString(),
      message: 'Safe Mode active: private/JWT-only endpoint sync is disabled.',
      disabledModules: [
        'profile',
        'inventory',
        'resources',
        'equipment',
        'owned-companies',
        'personal-combat-stats',
        'market-dom-scrape'
      ],
      ...status
    };
    safeSet({ warerahubComplianceStatus: next });
    setHealth('safeMode', true, {
      message: 'Public API Safe Mode ativo',
      publicApiOnly: true
    });
  }

  function installHook() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-hook.js');
    script.onload = () => script.remove();
    (document.documentElement || document.head || document.body).appendChild(script);
  }

  // Remove old/private cached captures on load so testers do not keep stale personal data.
  safeRemove(STORAGE_KEYS_TO_DISABLE, () => {
    setComplianceStatus();
    installHook();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data && event.data.type === 'WARERAHUB_PUBLIC_API_STATUS') {
      setComplianceStatus(event.data.payload || {});
      return;
    }

    if (event.data && event.data.type === 'WARERAHUB_PUBLIC_API_CAPTURE') {
      const payload = event.data.payload || {};
      if (!payload.safeMode || !payload.publicApiOnly) return;

      safeSet({
        warerahubPublicApiSync: {
          ...payload,
          updatedAt: payload.updatedAt || new Date().toISOString()
        }
      });

      setHealth('publicApi', true, {
        message: 'Dados públicos/aprovados capturados',
        approvedProcedures: payload.approvedProcedures || []
      });
    }
  });
})();
