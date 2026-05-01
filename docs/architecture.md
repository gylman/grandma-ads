# Architecture

## System Diagram

```mermaid
graph TB
    subgraph Actors
        ADV([Advertiser])
        POST([Poster / Channel Owner])
    end

    subgraph Frontend
        WEB["React + Wagmi\nbalance · deposit · campaigns"]
        BOT["Telegram Bot\nlong polling"]
    end

    subgraph Server ["Server — Hexagonal Architecture"]
        direction TB
        subgraph HTTP ["HTTP Layer"]
            API["/users · /channels\n/campaigns · /agent/intake"]
        end

        subgraph App ["Application Layer"]
            UC["Use Cases\ncreateAppUseCases()"]
            AGSVC["Agent Service\nextractIntake · generateOffer\nsuggestCounter · verifyPost"]
        end

        subgraph Domain
            FSM["Campaign FSM\nDRAFT → FUNDED → OFFERED\n→ ACCEPTED → ACTIVE\n→ COMPLETED / REFUNDED"]
            MOD["Content Moderation\nsafety rules"]
            VER["Post Verification\ntext + image hash match"]
        end

        subgraph Adapters
            PERSIST["Persistence\nInMemory / MongoDB"]
            BC["Blockchain Gateway\nviem wallet client"]
            AGGW["Agent Gateway\nOpenAI / Deterministic"]
        end
    end

    subgraph Sponsors ["Sponsor Integration Points"]
        KH["🔵 KeeperHub\nReliable execution layer\nstartCampaign · completeCampaign\nrefundCampaign"]
        ENS["🟢 ENS\nIdentity layer\nadvertiser.eth · poster.eth\nagent.eth + text records"]
        ZG["🟠 0G\nDecentralized AI compute\n— safety inference\n0G Storage\n— campaign proof bundles"]
    end

    subgraph Chain ["Blockchain"]
        ESC["AdEscrow.sol\ndeposit / withdraw\ncreateFromBalance\nstart / complete / refund"]
        USDC[MockUSDC]
    end

    OAI["OpenAI API\nstructured JSON outputs"]

    ADV --> WEB & BOT
    POST --> BOT
    WEB --> API
    BOT --> UC
    API --> UC
    UC --> AGSVC & PERSIST & BC & FSM
    AGSVC --> MOD & VER & AGGW
    AGGW -->|"if OPENAI_API_KEY set"| OAI
    AGGW -. "planned: safety inference" .-> ZG
    BC -->|"direct now"| ESC
    BC -. "planned: via KeeperHub" .-> KH
    KH --> ESC
    ESC --- USDC
    UC -. "planned: proof bundles" .-> ZG
    WEB -. "planned: ENS resolve" .-> ENS
    BOT -. "planned: ENS display" .-> ENS

    style KH fill:#dbeafe,stroke:#3b82f6
    style ENS fill:#dcfce7,stroke:#22c55e
    style ZG fill:#ffedd5,stroke:#f97316
    style FSM fill:#fef9c3,stroke:#eab308
    style Sponsors fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:5
```

## Current Implementation Status

| Layer | Status |
|---|---|
| Smart contract (escrow lifecycle) | Done |
| Campaign FSM (14 states) | Done |
| Telegram bot commands | Done |
| AI agent gateway (OpenAI + fallback) | Done |
| Post verification (text/image match) | Partial — Telegram scraping stubbed |
| Random/final check scheduler | Missing |
| Settlement auto-trigger | Missing — wired but not called automatically |

## Sponsor Integration Plan

### KeeperHub (Priority 1)
Replace direct `viem` calls for `startCampaign`, `completeCampaign`, and `refundCampaign` with KeeperHub execution. Introduce a `ContractExecutionService` abstraction with two implementations: `DirectViemExecutionService` (current) and `KeeperHubExecutionService`.

### ENS (Priority 2)
- Resolve ENS names for advertiser/poster addresses in bot messages and web UI
- Register an ENS name for the settlement agent wallet
- Optionally store poster channel metadata in ENS text records (`com.grandma-ads.telegram`)

### 0G (Priority 3)
- Run content safety classification through 0G Compute instead of local rules
- After each campaign settlement, write a proof bundle JSON to 0G Storage (approved text hash, image hash, verification logs, final outcome)
