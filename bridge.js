// Runs at document_start in the ISOLATED world.
// Sole job: shuttle state between the page (localStorage + custom events,
// which live in the MAIN world) and chrome.storage / the background service
// worker (which live in the extension world). Without this bridge the
// MAIN-world UI script can't touch chrome.* APIs and the background can't
// touch the page's localStorage.

(() => {
  "use strict";

  function readPage() {
    const active = localStorage.getItem("trxActiveAccount") || "DEFAULT";
    let pairs = null;
    try {
      pairs = JSON.parse(localStorage.getItem("trxAccountPairs") || "null");
    } catch (_) {}
    return { active, pairs };
  }

  async function syncToBackground() {
    const state = readPage();
    await chrome.storage.local.set(state);
    return chrome.runtime.sendMessage({ type: "sync" });
  }

  // Initial sync on every page load so the rules reflect what's stored.
  syncToBackground();

  // Pair discovery happens in the MAIN-world intercept after the page's
  // WebSocket reports accountPairs. The intercept fires "trx:sync".
  window.addEventListener("trx:sync", () => {
    syncToBackground();
  });

  // Toggle clicks fire "trx:toggle" with the new productType. We update
  // localStorage + chrome.storage + rules, THEN reload — so the new page
  // load sees the new active value AND the rewriting rule is already live.
  window.addEventListener("trx:toggle", async (ev) => {
    const next = ev?.detail;
    if (typeof next !== "string") return;
    try {
      localStorage.setItem("trxActiveAccount", next);
      await chrome.storage.local.set({ active: next });
      await chrome.runtime.sendMessage({ type: "sync" });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[trx-bridge] toggle failed", e);
    }
    location.reload();
  });
})();
