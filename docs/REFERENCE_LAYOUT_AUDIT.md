# Reference layout audit — 2026-09-21

The six `ref/ChatGPT Image Sep 19, 2026, …` boards were inspected and mapped to the existing application. The public `/` homepage remains separate from `/dashboard` and retains its JavaScript Canvas globe.

| Reference | Route | Applied regions |
| --- | --- | --- |
| 08_12_25 PM (1) | `/dashboard` | Four account metrics, positions table, native/CC reward cards, 75/25 split, supported chain, lifecycle, privacy and recorded activity |
| 08_12_25 PM (2) | `/stake` | Five-step guide, chain/token/validator/amount columns, reward preview, split, transaction flow and review dialog |
| 08_12_26 PM (3) | `/positions` | Four metrics, searchable/filterable table, selected position details, lifecycle and existing native staking actions |
| 08_12_26 PM (4) | `/rewards` | Two reward streams and charts, filtered/paginated history, split, cadence and per-position allocations |
| 08_12_26 PM (5) | `/analytics` | Activity feed and filters, paginated events, four recorded metrics, watcher/service health, privacy and marker history |
| 08_12_27 PM (6) | `/settings` | Six-section navigation, editable registered profile, connected wallets, identity/privacy, notifications, reward permissions and browser preferences |

Shared styling uses the reference's green grid, serif headings, outlined panels, mono labels and purple/gold reward distinction. Navigation text remains at least 12px with controls at least 44px high. Tables scroll within their panels on mobile. The trace drawer no longer extends the document when closed.

## Adaptations to available product functionality

- Only configured, supported staking chains are selectable. Reference-only balances, APYs, validators and connected wallets are not seeded into the application.
- Account figures and charts use existing APIs plus a read-only, address-scoped reward-history endpoint. Native history uses net payout wei without losing precision; CC history uses the recorded delegator share. API failures remain explicit.
- An unknown position chain cannot be valued as POL. Unavailable validator APR is shown as a dash; the previous commission-derived APR and sample Polygon validator fallback were removed.
- Existing checkpoint-based Polygon withdrawal eligibility, wallet approvals and transaction handlers are retained. A timer cannot claim that a Canton marker was emitted.
- Profile editing uses the existing registered identity API. Unsupported account deletion, identity verification and profile email fields are omitted. Existing notification channels and scoped auto-compound permissions are retained in their corresponding sections.
- Cadence indicates estimated time through a scheduled round, not fabricated completed payments. Public-chain transaction visibility is distinguished from private Canton contract state.

## Verification

- Frontend: 30 tests passed, covering Polygon transactions, exact decimal amounts, account attribution/valuation, unavailable validator data, protocol aggregation and globe geometry.
- Backend: 9 tests passed, covering recorded/ledger aggregation and reward-history validation, address scoping, precision, chronological limits and storage failures.
- Both TypeScript checks and `git diff --check` passed. Mainnet and testnet production frontend builds and the backend build passed. Existing optional wallet SDK dependency warnings remain non-fatal.
- All six connected account screens passed at 320, 390, 768, 1280 and 1672px with no document overflow or browser exceptions. Desktop/mobile screenshots were captured and inspected.
- Browser interactions passed: validator selection and review/cancel, 18-decimal amount retention, zero-amount rejection, Max balance, position search/status/selection, checkpoint-gated claim availability, reward filtering/pagination, activity filters, six settings sections, profile save and persisted display density.
- Mainnet deployment passed live checks for all six routes, desktop/mobile navigation sizing, the trace drawer at 320px, and reward-history HTTP 200/400 behavior.
- Browser fixtures are local test data only. They intercept account APIs and RPC reads and block wallet signing; no staking transaction or notification is sent.

Screenshot and browser reports are stored locally in `/tmp/cantonstake-reference-audit/`.

Both deployments passed live checks for all six routes, navigation sizing, mobile overflow, the trace drawer, and reward-history validation. Mainnet's refreshed validator feed returned 25 ranked validators and 138 share mappings, with 15 eligible validators rendered by the staking adapter.

The homepage globe passed on mainnet and testnet at 12 widths from 320 to 1920px: JavaScript animation, pause/resume, reduced motion, offscreen suspension, geography-load fallback, wallet dialog, navigation, separate dashboard, and zero video elements or media requests. Desktop and mobile navigation screenshots were inspected; controls are at least 44px high and labels at least 12px.

Live evidence: `live-mainnet-report.json`, `live-testnet-report.json`; simulated account evidence: `connected-report.json`, plus paired desktop/mobile screenshots for every route under `/tmp/cantonstake-reference-audit/`. Homepage and navigation captures use `/tmp/cantonstake-native-{mainnet,testnet}-*.png` and `/tmp/cantonstake-nav-{mainnet,testnet}-*.png`.

Additional browser edge checks passed: claim becomes available after the checkpoint threshold; malformed, overprecision, below-minimum and over-balance stake amounts are blocked; a mismatched Canton identity cannot edit the registered profile; reward-history failures produce an explicit error with no payout rows. `edge-report.json` records zero mutations and zero browser exceptions.
