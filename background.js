// Service worker: maintains declarativeNetRequest rules that rewrite the
// `secAccNo` query parameter for Trade Republic API calls so the entire UI
// reflects the active account. This catches the chart REST fetch which is
// otherwise issued via a captured `fetch` reference (bypassing any JS patch).

const RULE_ID = 1;

async function updateRules() {
  const { active, pairs } = await chrome.storage.local.get(["active", "pairs"]);
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = old.map((r) => r.id);
  const addRules = [];

  if (active && active !== "DEFAULT" && Array.isArray(pairs)) {
    const def = pairs.find((p) => p.productType === "DEFAULT");
    const to = pairs.find((p) => p.productType === active);
    if (def && to && def.securitiesAccountNumber !== to.securitiesAccountNumber) {
      addRules.push({
        id: RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {
            transform: {
              queryTransform: {
                addOrReplaceParams: [
                  { key: "secAccNo", value: to.securitiesAccountNumber },
                ],
              },
            },
          },
        },
        condition: {
          // Match any API URL that carries the DEFAULT/CTO secAccNo.
          urlFilter: "secAccNo=" + def.securitiesAccountNumber,
          resourceTypes: ["xmlhttprequest"],
          initiatorDomains: ["app.traderepublic.com"],
        },
      });
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
}

chrome.runtime.onInstalled.addListener(updateRules);
chrome.runtime.onStartup.addListener(updateRules);
chrome.storage.onChanged.addListener(updateRules);

// Content-script bridge sends { type: "sync" } whenever localStorage changes;
// we sync, update rules, and acknowledge so the bridge can reload the page
// only after the rule is live.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "sync") {
    updateRules()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async sendResponse
  }
  return false;
});
