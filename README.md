# Trade Republic — Account Switcher Chrome plugin

Adds a **Brokerage ⇄ PEA** toggle pill (top-right of the screen) to the Trade
Republic web app. Click it and the *entire* UI — portfolio chart,
investments list, savings plans, cash — reflects the chosen account, using the
same UX as the native brokerage view.

## How it works

| Layer | File | World | Role |
|---|---|---|---|
| Network rewriter | `background.js` | service worker | declarativeNetRequest rule that rewrites the `secAccNo` query param on every Trade Republic API call when PEA is active. Catches the portfolio-chart REST fetch which JS-level patches can't reliably intercept (TR's bundle captures the native `fetch` reference at module init). |
| Bridge | `bridge.js` | content (ISOLATED) | Sole link between the page (`localStorage`, custom events) and the service worker (`chrome.storage`, dNR rules). Forwards the active-account state on every page load and on toggle clicks; resolves the toggle round-trip BEFORE reloading so the new rule is live when the page re-renders. |
| WS rewriter | `intercept.js` | content (MAIN, document_start) | Patches `WebSocket.prototype.send` to (a) rewrite occurrences of the CTO securities/cash account numbers to the active account's and (b) inject `accountNumber` / `securitiesAccountNumber` into known account-scoped subscription payloads (`availableCash`, `timelineTransactions`, `savingsPlans`, …) that the page sends without an account field. Also snoops the `accountPairs` response on first connect to auto-discover the identifier mapping. |
| Toggle UI | `ui.js` + `panel.css` | content (MAIN, document_idle) | Renders the pill, dispatches `trx:toggle` on click. |

## Load it

1. `chrome://extensions/`
2. Toggle **Developer mode**
3. **Load unpacked** → pick this directory
4. Open https://app.traderepublic.com/. A "Brokerage / PEA" pill appears
   top-right. Click PEA to browse the PEA account everywhere.

## Small side-fix

Also fixed the graph wandering free on the page on 1d timescale ( .chart > svg { overflow: hidden !important; } )

## Why declarativeNetRequest (instead of patching fetch)?

The earlier 0.2.0 / 0.3.0 versions tried two approaches that don't work
reliably:

- `world: "MAIN"` content_script at `document_start` patches `window.fetch` —
  but this isn't guaranteed to run before the page's `<script type="module">`
  bundle. TR's HTTP client captures the native `fetch` reference at module
  init, so subsequent calls bypass our patched `window.fetch`.
- Inline `<script>` injection from an ISOLATED content_script — blocked by
  the extension-merged Content Security Policy (`script-src 'self' …` without
  `unsafe-inline`).

`declarativeNetRequest` runs at the network layer, so it doesn't care which
`fetch` reference the page used. Trade-off: rule changes go through the
service worker, so the toggle path is async (the bridge `await`s the rule
update before reloading the page).

## Known gaps

- The WS augmentation uses a whitelist of subscription types we've confirmed
  are account-scoped. Pages that fetch via a not-yet-listed subscription type
  will keep showing CTO data until the type is added to `NEEDS_CASH_ACCT` /
  `NEEDS_SEC_ACCT` in `intercept.js`.
- Only `DEFAULT` and `TAX_WRAPPER` are labelled; other `productType`s show
  the raw enum name.
