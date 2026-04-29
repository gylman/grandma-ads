# Grandma Ads

AI-assisted Telegram advertising marketplace with on-chain escrow.

Advertisers deposit ERC-20 funds into an escrow contract, create sponsored Telegram post campaigns, and lock funds before a poster publishes. Posters link Telegram channels, accept offers, manually publish the exact approved ad, and get paid if verification passes.

## Current State

This repo is an MVP foundation, not the finished production app.

Implemented:

- Foundry escrow contract with virtual balances and campaign settlement.
- Server API with hexagonal architecture.
- In-memory repositories for users, channels, campaigns, and verification checks.
- viem blockchain gateway on the server.
- React client dashboard with wagmi wallet interactions.
- Basic channel registration, campaign draft creation, content safety checks, and post verification primitives.

Not implemented yet:

- Real database.
- Actual Telegram bot webhook handlers.
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

Use one of Anvil's printed private keys as `DEPLOYER_PRIVATE_KEY`, then deploy mock USDC and escrow:

```sh
pnpm deploy:local
```

The deploy scripts automatically load the root `.env` file before running Foundry. Put local deploy values there:

```txt
RPC_URL=http://127.0.0.1:8545
DEPLOYER_PRIVATE_KEY=0x...
```

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

After deployment, put the emitted/deployed addresses into your env:

```txt
ESCROW_CONTRACT_ADDRESS=0x...
USDC_TOKEN_ADDRESS=0x...
VITE_ESCROW_CONTRACT_ADDRESS=0x...
VITE_USDC_TOKEN_ADDRESS=0x...
```

### Sepolia Contract Deployment

For Ethereum Sepolia, deploy the escrow with:

```txt
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
- `persistence/` in-memory repositories
- `blockchain/viem/` viem escrow gateway

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

Server:

```txt
PORT=3001
CLIENT_URL=http://localhost:5173
SERVER_URL=http://localhost:3001
RPC_URL=
CHAIN_ID=31337
ESCROW_CONTRACT_ADDRESS=
USDC_TOKEN_ADDRESS=
VERIFIER_PRIVATE_KEY=
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

- Replace in-memory repositories with a real database adapter later.
- Keep viem isolated behind `BlockchainGateway`.
- Add Telegram as another adapter.
- Add OpenAI/agent calls as application services or outbound ports.
- Keep contract settlement deterministic and outside direct AI control.

## Local Port Note

The server defaults to port `3001` because port `3000` was already occupied during development. Change `PORT` and `VITE_SERVER_URL` if you want a different local setup.
