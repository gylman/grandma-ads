# Grandma Ads

AI-assisted Telegram advertising marketplace with on-chain escrow.

Advertisers deposit ERC-20 funds into an escrow contract, create sponsored Telegram post campaigns, and lock funds before a poster publishes. Posters link Telegram channels, accept offers, manually publish the exact approved ad, and get paid if verification passes.

## Current State

This repo is an MVP foundation, not the finished production app.

Implemented:

- Foundry escrow contract with virtual balances and campaign settlement.
- Server API with hexagonal architecture.
- Repository ports with pluggable persistence adapters (`inmemory` and MongoDB through Mongoose).
- viem blockchain gateway on the server.
- React client dashboard with wagmi wallet interactions.
- Basic channel registration, campaign draft creation, content safety checks, and post verification primitives.

Not implemented yet:

- Production-hardened database schema and migrations.
- Real Telegram post fetching/scraping.
- Scheduled random/final checks.
- Production wallet signature auth.
- Full offer/accept/reject/counter flow.
- OpenAI-backed agent integration.

## Repo Layout

```txt
client/  React + Vite frontend
server/  Express API, domain logic, ports/adapters
chain/   Foundry smart contract project
```

## Chain

Look here:

```txt
chain/src/AdEscrow.sol
chain/src/MockUSDC.sol
chain/script/DeployLocal.s.sol
chain/script/DeployMockUSDC.s.sol
chain/script/DeploySepoliaEscrow.s.sol
chain/script/MintMockUSDC.s.sol
chain/test/AdEscrow.t.sol
chain/foundry.toml
```

The contract supports:

- `deposit`
- `withdraw`
- `createCampaignFromBalance`
- verifier-only `startCampaign`
- verifier-only `completeCampaign`
- verifier-only `refundCampaign`

Run contract tests:

```sh
pnpm test:chain
```

Build contracts:

```sh
pnpm --filter chain build
```

Format Solidity:

```sh
pnpm --filter chain fmt
```

### Local Contract Deployment

For local development, use mock USDC. Run Anvil in one terminal:

```sh
anvil
```

Create `chain/.env` from `chain/.env.example`, then use one of Anvil's printed private keys as `DEPLOYER_PRIVATE_KEY`.

```sh
cp chain/.env.example chain/.env
```

Edit `chain/.env`:

```txt
RPC_URL=http://127.0.0.1:8545
DEPLOYER_PRIVATE_KEY=0x...
```

Then deploy mock USDC and escrow:

```sh
pnpm deploy:local
```

The chain deploy scripts automatically load `chain/.env` before running Foundry.

`DeployLocal.s.sol` deploys:

- `MockUSDC`
- `AdEscrow`
- an initial mock USDC balance for `INITIAL_USDC_RECIPIENT`

Optional env vars:

```txt
VERIFIER_ADDRESS=0x...          # defaults to deployer
INITIAL_USDC_RECIPIENT=0x...    # defaults to deployer
INITIAL_USDC_MINT=1000000000000 # defaults to 1,000,000 USDC with 6 decimals
```

After deployment, put the emitted/deployed addresses into the server and client env files:

```txt
# server/.env
ESCROW_CONTRACT_ADDRESS=0x...
USDC_TOKEN_ADDRESS=0x...

# client/.env
VITE_ESCROW_CONTRACT_ADDRESS=0x...
VITE_USDC_TOKEN_ADDRESS=0x...
```

To mint local mock USDC to one or more wallets, put the token address and mint file in `chain/.env`:

```txt
USDC_TOKEN_ADDRESS=0x...
MINTS_FILE=mint.mock-usdc.json
```

Create `chain/mint.mock-usdc.json` from the example:

```sh
cp chain/mint.mock-usdc.example.json chain/mint.mock-usdc.json
```

Edit the JSON file:

```json
[
  {
    "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "amount": "10000"
  },
  {
    "account": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "amount": "2500.5"
  }
]
```

Amounts are human USDC amounts. The script converts them to 6-decimal base units. Then run:

```sh
pnpm mint:mock-usdc
```

The mint transaction must be sent by the `MockUSDC` owner. For local deployments, that is usually the same account as `DEPLOYER_PRIVATE_KEY`.

### Sepolia Contract Deployment

For Ethereum Sepolia, deploy the escrow with:

```txt
# chain/.env
RPC_URL=https://...
DEPLOYER_PRIVATE_KEY=0x...
VERIFIER_ADDRESS=0x...
ETHERSCAN_API_KEY=...
```

Then run:

```sh
pnpm deploy:sepolia
```

The escrow contract does not hardcode a token address. The server/client decide which ERC-20 token address to use through env vars.

For Sepolia demos, you have two choices:

- Use a real/test USDC token address for Sepolia if you have one and can get funds.
- Deploy `MockUSDC` on Sepolia with `pnpm deploy:mock-usdc` and use that token address while testing.

Do not use `MockUSDC` as a production token.

## Server

The server uses ports and adapters.

Important folders:

```txt
server/src/domain/
```

Pure domain code:

- campaign state transitions
- moderation rules
- Telegram post URL/text verification
- shared domain types

```txt
server/src/application/
```

Application layer:

- ports/interfaces
- use cases
- application services

```txt
server/src/adapters/
```

External adapters:

- `http/` Express routes
- `persistence/` in-memory and Mongoose-backed MongoDB repository adapters
- `blockchain/viem/` viem escrow gateway
- `telegram/` Telegram long-polling bot adapter

```txt
server/src/app.ts
server/src/index.ts
```

Composition and process entrypoint.

Run the API:

```sh
pnpm --filter server dev
```

Default API URL:

```txt
http://localhost:3001
```

Health check:

```sh
curl http://localhost:3001/health
```

Type-check server:

```sh
pnpm --filter server build
```

The server intentionally uses:

- `tsx` for dev/start
- `tsc --noEmit` for build checks
- no `ts-node`
- no `nodemon`

### Telegram Bot: Long Polling

For local development, the server uses Telegram `getUpdates` long polling. You do not need a public tunnel or webhook URL for this mode.

Set these in `server/.env`:

```txt
TELEGRAM_BOT_MODE=polling
TELEGRAM_BOT_TOKEN=
```

Then run:

```sh
pnpm --filter server dev
```

The bot currently handles a small command set:

```txt
/start
/help
/link
/register_channel
/balance
/my_campaigns
```

Webhook support can be added later for production. For now, leave `TELEGRAM_BOT_MODE=polling` locally.

### Dev Custodial Wallet Mode

For local development only, the bot can generate a test wallet for each Telegram user and sign local Anvil transactions from the server. This is useful for exercising the full bot/server/chain lifecycle before the production wallet handoff is finished.

Do not use this mode with real user keys or real funds.

Enable it in `server/.env`:

```txt
CUSTODIAL_DEV_MODE=true
DEV_WALLET_MINTER_PRIVATE_KEY=0x...
DEV_WALLET_ETH_TOP_UP_AMOUNT=0.05
```

`DEV_WALLET_MINTER_PRIVATE_KEY` must be the owner of the local `MockUSDC` contract if you want `/dev_mint` to work. In local Anvil, this is usually the same key that deployed `MockUSDC`.

The same key also tops up generated dev wallets with a small amount of local ETH so they can pay gas for approve/deposit/withdraw transactions.

Dev bot commands:

```txt
/dev_wallet
/dev_balance
/dev_mint 1000
/dev_deposit 100
/dev_withdraw 25
```

What they do:

- `/dev_wallet`: creates or shows the Telegram user's generated test wallet.
- `/dev_mint 1000`: mints 1,000 mock USDC to that generated wallet.
- `/dev_deposit 100`: approves escrow and deposits 100 mock USDC.
- `/dev_withdraw 25`: withdraws 25 mock USDC from escrow.
- `/dev_balance`: shows wallet token balance and available escrow balance.

## Client

Look here:

```txt
client/src/App.tsx
client/src/blockchain/
client/src/lib/
```

Important files:

- `client/src/blockchain/wagmi.ts`: wagmi config
- `client/src/blockchain/escrowAbi.ts`: escrow ABI used by wagmi
- `client/src/lib/api.ts`: API client
- `client/src/lib/config.ts`: frontend env config

The current UI supports:

- injected wallet connect
- escrow balance read
- ERC-20 approve
- escrow deposit
- escrow withdraw
- channel verification-code creation
- campaign draft creation
- campaign list

Run the client:

```sh
pnpm --filter client dev
```

Default client URL:

```txt
http://localhost:5173
```

Build client:

```sh
pnpm --filter client build
```

Lint client:

```sh
pnpm --filter client lint
```

## Install

This repo uses pnpm workspaces.

```sh
pnpm install
```

## Common Commands

Run everything that currently has a build:

```sh
pnpm build
```

Run chain tests:

```sh
pnpm test:chain
```

Run API:

```sh
pnpm --filter server dev
```

Run frontend:

```sh
pnpm --filter client dev
```

## Environment Variables

Environment files are split by package. Do not put all runtime values in the repo root `.env`.

Use these files:

```txt
chain/.env
server/.env
client/.env
```

Commit the example files, not real `.env` files:

```txt
chain/.env.example
server/.env.example
client/.env.example
```

Chain:

```txt
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
DEPLOYER_PRIVATE_KEY=
VERIFIER_ADDRESS=
USDC_TOKEN_ADDRESS=
INITIAL_USDC_RECIPIENT=
INITIAL_USDC_MINT=1000000000000
MINTS_FILE=mint.mock-usdc.json
ETHERSCAN_API_KEY=
```

Server:

```txt
PORT=3001
CLIENT_URL=http://localhost:5173
SERVER_URL=http://localhost:3001
PERSISTENCE_MODE=inmemory
DATABASE_URL=mongodb://127.0.0.1:27017
DATABASE_NAME=grandma_ads
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
ESCROW_CONTRACT_ADDRESS=
USDC_TOKEN_ADDRESS=
VERIFIER_PRIVATE_KEY=
CUSTODIAL_DEV_MODE=false
DEV_WALLET_MINTER_PRIVATE_KEY=
DEV_WALLET_ETH_TOP_UP_AMOUNT=0.05
TELEGRAM_BOT_MODE=polling
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
OPENAI_API_KEY=
```

Client:

```txt
VITE_CHAIN_ID=31337
VITE_RPC_URL=http://127.0.0.1:8545
VITE_ESCROW_CONTRACT_ADDRESS=
VITE_USDC_TOKEN_ADDRESS=
VITE_SERVER_URL=http://localhost:3001
VITE_TELEGRAM_BOT_USERNAME=
```

Without contract/token env vars, the UI will still load, but wallet contract actions will be disabled or fail because there is no configured escrow/token address.

## API Endpoints

Current API surface:

```txt
GET  /health
GET  /api/me?walletAddress=0x...
POST /api/users
GET  /api/balances?walletAddress=0x...
POST /api/channels
GET  /api/channels
POST /api/channels/:id/verify
POST /api/agent/intake
POST /api/campaigns
GET  /api/campaigns
GET  /api/campaigns/:id
POST /api/campaigns/:id/transition
POST /api/campaigns/:id/offer-preview
POST /api/campaigns/:id/submit-post
```

## Architecture Notes

The server is organized so core product logic does not depend on Express, viem, or the database implementation.

Direction:

- Keep repository ports stable while switching adapters (`inmemory` or `mongodb`).
- Keep viem isolated behind `BlockchainGateway`.
- Expand the Telegram adapter from simple long polling commands into the full offer/channel/campaign flow.
- Add OpenAI/agent calls as application services or outbound ports.
- Keep contract settlement deterministic and outside direct AI control.

## Local Port Note

The server defaults to port `3001` because port `3000` was already occupied during development. Change `PORT` and `VITE_SERVER_URL` if you want a different local setup.
