// Runs at document_idle in the MAIN world.
// Renders the account-switcher pill in the TR header.

(() => {
  "use strict";

  if (window.__trxUiInstalled) return;
  window.__trxUiInstalled = true;

  const LABEL = {
    DEFAULT: "Brokerage",
    TAX_WRAPPER: "PEA",
  };

  function getPairs() {
    return window.__trx && window.__trx.getPairs();
  }

  function activeProduct() {
    return (window.__trx && window.__trx.getActive()) || "DEFAULT";
  }

  // If we don't yet have the account list, fetch it ourselves so the toggle
  // can render correctly even on the first page load.
  function ensurePairs() {
    if (getPairs()) return Promise.resolve(getPairs());
    return new Promise((resolve) => {
      const ws = new WebSocket("wss://api.traderepublic.com/");
      const timeout = setTimeout(() => {
        try { ws.close(); } catch (_) {}
        resolve(null);
      }, 5000);
      ws.addEventListener("open", () => {
        ws.send(
          "connect 34 " +
            JSON.stringify({
              locale: "en",
              platformId: "webtrading",
              platformVersion: "safari - 18.3.0",
              clientId: "app.traderepublic.com",
              clientVersion: "3.151.3",
            }),
        );
      });
      ws.addEventListener("message", (ev) => {
        if (ev.data === "connected") {
          ws.send('sub 1 {"type":"accountPairs"}');
          return;
        }
        const m = String(ev.data).match(/^1 A (\{[\s\S]*\})$/);
        if (!m) return;
        try {
          const body = JSON.parse(m[1]);
          if (Array.isArray(body.accounts)) {
            window.__trx.setPairs(body.accounts);
            clearTimeout(timeout);
            try { ws.close(); } catch (_) {}
            resolve(body.accounts);
          }
        } catch (_) {}
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  function buildSwitcher(accounts) {
    const wrap = document.createElement("div");
    wrap.className = "trx-switch";
    const current = activeProduct();

    // Stable order: DEFAULT first, then the rest
    const ordered = [...accounts].sort((a, b) =>
      a.productType === "DEFAULT" ? -1 : b.productType === "DEFAULT" ? 1 : 0,
    );

    for (const a of ordered) {
      const btn = document.createElement("button");
      btn.className = "trx-switch__btn" + (a.productType === current ? " -active" : "");
      btn.textContent = LABEL[a.productType] || a.productType;
      btn.title = `sec ${a.securitiesAccountNumber} · cash ${a.cashAccountNumber}`;
      btn.addEventListener("click", () => {
        if (a.productType === current) return;
        // Dispatch into the ISOLATED-world bridge, which updates localStorage,
        // chrome.storage and declarativeNetRequest rules BEFORE reloading.
        window.dispatchEvent(
          new CustomEvent("trx:toggle", { detail: a.productType }),
        );
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function waitFor(selector, timeoutMs = 20000) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const t0 = Date.now();
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
        else if (Date.now() - t0 > timeoutMs) { obs.disconnect(); resolve(null); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function mountSwitcher() {
    if (document.querySelector(".trx-switch")) return;
    // The pill is position:fixed, so just attach it to body.
    await waitFor("body");
    const accounts = await ensurePairs();
    if (!accounts || accounts.length < 2) return;
    const switcher = buildSwitcher(accounts);
    document.body.appendChild(switcher);
  }

  function remount() {
    document.querySelector(".trx-switch")?.remove();
    mountSwitcher();
  }

  // Initial mount
  mountSwitcher();

  // Re-mount on SPA navigations (header might be rebuilt)
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () {
    const r = origPush.apply(this, arguments);
    setTimeout(remount, 250);
    return r;
  };
  history.replaceState = function () {
    const r = origReplace.apply(this, arguments);
    setTimeout(remount, 250);
    return r;
  };
  window.addEventListener("popstate", () => setTimeout(remount, 250));

  // React to pair discovery from the intercept layer
  window.addEventListener("trx:pairs", remount);

  // Add a subtle indicator on the body for theme-aware styling
  function setBodyState() {
    document.body?.classList?.toggle("trx-pea-mode", activeProduct() !== "DEFAULT");
  }
  setBodyState();
  // Body might not exist at document_idle in some race cases
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", setBodyState);
  }
})();
