# Ethy Ads Architecture

The presentation version of this architecture lives in [`architecture.html`](./architecture.html).

## Product Flow

Ethy Ads is an AI-assisted Telegram ad booking platform with on-chain escrow and ENS proof identities.

1. Advertiser creates a campaign through the Telegram bot or client.
2. Funds are locked from the advertiser's contract-backed balance.
3. Poster receives an offer with the exact ad content and payment conditions.
4. Poster accepts the offer and authorizes the bot-posted ad flow.
5. Bot publishes the approved ad and the server verifies the post content, channel, and timing.
6. Escrow is completed or refunded based on deterministic verification.
7. ENS/CCIP-read proof records expose the campaign lifecycle publicly.

## Implemented Layers

| Layer | Implementation |
|---|---|
| Telegram bot | Onboarding, dev wallets, channel verification, campaign offers, accept/reject, bot posting, verification, notifications |
| Client | React proof pages, campaign/proof display, ENS record access |
| Server | TypeScript, Express, campaign state machine, verification, AI services, persistence, bot adapters |
| Contract | Solidity `AdEscrow.sol` with deposit, withdraw, campaign locking, start, complete, refund |
| Wallets | Dynamic server wallets when configured, local Anvil fallback for dev |
| ENS | User, agent, ad, and lifecycle proof names under `ethy-ads.eth` |
| CCIP-read | EIP-3668-compatible gateway plus `EthyAdsOffchainResolver.sol` |

## ENS Proof Model

Ethy Ads treats ENS as a product identity and proof layer.

Examples:

```txt
alice.user.ethy-ads.eth
verifier.ethy-ads.eth
7.ad.ethy-ads.eth
locked.7.ad.ethy-ads.eth
completed.7.ad.ethy-ads.eth
```

Campaign records expose text records such as:

```txt
com.ethy-ads.kind
com.ethy-ads.ad-id
com.ethy-ads.status
com.ethy-ads.channel
com.ethy-ads.amount
com.ethy-ads.token
com.ethy-ads.advertiser
com.ethy-ads.poster
com.ethy-ads.latest-event
com.ethy-ads.latest-tx-hash
```

Lifecycle event records expose:

```txt
com.ethy-ads.event
com.ethy-ads.ad
com.ethy-ads.ad-id
com.ethy-ads.tx-hash
com.ethy-ads.agent
com.ethy-ads.timestamp
```

## CCIP-read Endpoints

The server exposes dynamic ENS records through:

```txt
GET  /api/ens/records
GET  /api/ens/resolve?name=<ens-name>
POST /api/ens/ccip-read
GET  /api/ens/ccip-read?sender=<resolver>&data=<calldata>
GET  /api/ens/ccip-read/<resolver>/<calldata>.json
```

The gateway supports resolver calls for:

```txt
addr(bytes32)
addr(bytes32,uint256)
text(bytes32,string)
resolve(bytes,bytes)
```

## Attribution

The Telegram bot foundation used [`dynamic-labs-oss/tg-bot-starter`](https://github.com/dynamic-labs-oss/tg-bot-starter) as a starting template, then Ethy Ads expanded it into a custom ad booking, escrow, verification, ENS proof, and AI workflow system.
