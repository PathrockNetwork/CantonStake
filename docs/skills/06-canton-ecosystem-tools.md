# Skill: Canton Ecosystem Tools — SDKs, Explorers, AI

## When to use
When integrating third-party Canton tools, choosing an SDK, looking up block explorers, or exploring AI+Canton possibilities.

## SDKs & Language Bindings

### Official
| SDK | Language | Use Case | Link |
|---|---|---|---|
| **JSON Ledger API** | HTTP/any | Direct REST interaction with Canton ledger | `https://docs.digitalasset.com/build/3.5` |
| **dazl-client** | Python | Python ledger client for data/AI pipelines | `https://github.com/digital-asset/dazl-client` |
| **DPM Framework** | Daml | Package manager for Daml apps | `https://github.com/digital-asset/dpm` |

### Community (Go — by Noders Team)
| SDK | Use Case | Link |
|---|---|---|
| **Go DAML SDK** | Go client for DAML ledger integration | `https://github.com/noders-team/go-daml` |
| **Go Wallet DAML SDK** | Go SDK for wallet flows and app-side patterns | `https://github.com/noders-team/go-wallet-daml` |

### dApp Development Kit (Hyperledger Labs)
| Tool | Description | Link |
|---|---|---|
| **splice-wallet-kernel** | dApp Development Kit for Canton | `https://github.com/hyperledger-labs/splice-wallet-kernel` |
| **dApp API Spec** | OpenRPC spec for dApp API | `openrpc-dapp-api.json` (in splice-wallet-kernel repo) |
| **dApp SDK** | SDK for dApp-side integration | In splice-wallet-kernel monorepo |

## Wallet Integration

| Resource | Description | Link |
|---|---|---|
| **Canton Ecosystem Wallets** | Overview of available Canton wallets | `https://cantonecosystem.com` |
| **Five North ID SDK** | Identity verification SDK | `https://docs.fivenorth.io/id-sdk` |

### Integration Path for CantonStake
1. **Current**: Static env var `NEXT_PUBLIC_CANTON_DELEGATOR_PARTY`
2. **Near-term**: Wire `useLoopWallet` (already in `frontend/lib/loop-wallet.ts`)
3. **Production**: Integrate `splice-wallet-kernel` or Five North ID SDK

## Block Explorers & Data APIs

| Tool | Type | URL |
|---|---|---|
| **Lighthouse Explorer** | Block explorer | `https://lighthouse.cantonloop.com` |
| **CCView Explorer** | Block explorer | `https://ccview.io` |
| **CCView Indexing API** | Data API | `https://docs.ccview.io` |
| **Modo Agentic API** | Data API (AI-friendly) | `https://docs.modo.link/agentic-api/intro` |

### Use in CantonStake
- **Lighthouse/CCView**: Verify that StakingRequest, StakingPosition, and ActivityMarker contracts are visible on-ledger
- **CCView/Modo APIs**: Could replace or supplement the backend's direct JSON API queries for position/reward dashboards

## AI Tools

### Build on Canton MCP
Local MCP plugin for Claude — curated knowledge base covering Canton's dev stack, guides devs from 0 to 100:
- `https://github.com/Jatinp26/Build-on-Canton-MCP`

### DAML Studio
AI-powered browser IDE for generating and testing DAML smart contracts — useful for rapid prototyping:
- `https://damlstudio.tenzro.network`

### AI Integration Directions
| Direction | Description | Complexity |
|---|---|---|
| **On-chain AI agents** | Execute DAML choices based on AI decisions | High |
| **Data on-chain** | Canton as tamper-proof data layer for AI outputs | Medium |
| **Verified inference** | Record AI inference results with auditability | Medium |
| **Multi-party ML** | Federated learning via Canton sub-transaction privacy | High |
| **AI-gated contracts** | Choices requiring AI-generated proofs or scores | Medium |

## Quick Reference: Getting Started with Canton Dev

```
1. Canton 101          → https://canton-101.vercel.app
2. CN Quickstart       → https://github.com/digital-asset/cn-quickstart
3. Official Docs       → https://docs.canton.network
4. Build Docs (DA)     → https://docs.digitalasset.com/build/3.5
5. DAML Studio         → https://damlstudio.tenzro.network
6. Canton Dev Guide    → https://github.com/JohnLilic/canton-dev-guide
7. Dev Resources       → https://canton.network/developer-resources