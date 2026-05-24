// Runs at document_start in the page's MAIN world.
// Patches WebSocket.prototype.send so account-scoped subscriptions return
// PEA data when the toggle is on. (HTTP fetches are rewritten at the network
// layer by declarativeNetRequest in background.js — that approach doesn't
// race with page modules capturing the native `fetch` reference.)

(() => {
  "use strict";

  if (window.__trxInterceptInstalled) return;
  window.__trxInterceptInstalled = true;

  const STORAGE_KEY = "trxActiveAccount";
  const PAIRS_KEY = "trxAccountPairs";

  let pairs = (() => {
    try {
      return JSON.parse(localStorage.getItem(PAIRS_KEY) || "null") || null;
    } catch (_) {
      return null;
    }
  })();

  const getActive = () => localStorage.getItem(STORAGE_KEY) || "DEFAULT";
  const accountFor = (type) => pairs && pairs.find((a) => a.productType === type);

  // Exposed for ui.js (also MAIN world) — it reads pairs/active to build the toggle.
  window.__trx = {
    getActive,
    getPairs() {
      return pairs;
    },
    setPairs(arr) {
      pairs = arr;
      localStorage.setItem(PAIRS_KEY, JSON.stringify(arr));
      window.dispatchEvent(new CustomEvent("trx:sync"));
    },
  };

  // ── rewrite helpers ─────────────────────────────────────────────────

  function rewriteString(s) {
    const active = getActive();
    if (active === "DEFAULT") return s;
    const from = accountFor("DEFAULT");
    const to = accountFor(active);
    if (!from || !to || from === to) return s;
    let out = s;
    if (from.securitiesAccountNumber !== to.securitiesAccountNumber) {
      out = out.split(from.securitiesAccountNumber).join(to.securitiesAccountNumber);
    }
    if (from.cashAccountNumber !== to.cashAccountNumber) {
      out = out.split(from.cashAccountNumber).join(to.cashAccountNumber);
    }
    return out;
  }

  // For WS subscription types that the page sends without an explicit
  // account field but that the server treats as DEFAULT-scoped, inject the
  // active account's identifier so the response comes back for that account.
  const NEEDS_CASH_ACCT = new Set([
    "availableCash",
    "cash",
    "availableCashForPayout",
    "timelineTransactions",
  ]);
  const NEEDS_SEC_ACCT = new Set([
    "savingsPlans",
    "compactPortfolio",
    "compactPortfolioByType",
    "compactPortfolioByTypeV2",
    "portfolioStatus",
    "tradeAggregateHistory",
    "aggregateHistoryLight",
  ]);

  function augmentSubPayload(payload) {
    const active = getActive();
    if (active === "DEFAULT") return payload;
    const to = accountFor(active);
    if (!to || !payload || typeof payload !== "object" || !payload.type) return payload;
    let out = payload;
    if (
      NEEDS_CASH_ACCT.has(payload.type) &&
      !payload.accountNumber &&
      !payload.cashAccountNumber
    ) {
      out = { ...out, accountNumber: to.cashAccountNumber };
    }
    if (NEEDS_SEC_ACCT.has(payload.type) && !payload.securitiesAccountNumber) {
      out = { ...out, securitiesAccountNumber: to.securitiesAccountNumber };
    }
    return out;
  }

  // ── WebSocket prototype patch ───────────────────────────────────────
  // Patching the prototype catches every send, even on WS instances created
  // before our patch was installed (because send() resolves on the prototype
  // at call time).

  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === "string" && this.url && this.url.includes("traderepublic.com")) {
        // Snoop accountPairs responses on this socket so we can auto-discover
        // identifiers on first run.
        if (!this.__trxAccountPairsHooked) {
          this.__trxAccountPairsHooked = true;
          this.addEventListener("message", (ev) => {
            if (typeof ev.data !== "string") return;
            const m = ev.data.match(/^\d+ A (\{[\s\S]*"authAccountId"[\s\S]*\})$/);
            if (!m) return;
            try {
              const body = JSON.parse(m[1]);
              if (Array.isArray(body.accounts) && body.accounts.length) {
                window.__trx.setPairs(body.accounts);
              }
            } catch (_) {}
          });
        }
        const subMatch = data.match(/^sub (\d+) ([\s\S]+)$/);
        if (subMatch) {
          let payload;
          try {
            payload = JSON.parse(subMatch[2]);
          } catch (_) {}
          if (payload) {
            const augmented = augmentSubPayload(payload);
            data = `sub ${subMatch[1]} ${rewriteString(JSON.stringify(augmented))}`;
          } else {
            data = rewriteString(data);
          }
        } else {
          data = rewriteString(data);
        }
      }
    } catch (_) {}
    return origSend.call(this, data);
  };
})();
