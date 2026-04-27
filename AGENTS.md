````md
# AGENTS.md

## Project Overview

This project is an AI-assisted Telegram advertising marketplace with on-chain escrow.

Users can be both advertisers and posters. An advertiser creates an ad campaign, funds their virtual account through a web app, and sends an offer to a poster. A poster opts in by linking a Telegram channel to their account. If the poster accepts the offer, they manually publish the exact approved ad content in their Telegram channel and submit the post URL. The server verifies the content and monitors the post during the agreed duration. If the post remains valid until the end, the poster is paid from escrow into their virtual account balance.

The product goal is simplicity: users should be able to run sponsored Telegram posts without learning complicated ad platforms, reading long documentation, or trusting strangers manually.

The bot is used for onboarding, campaign flow, notifications, negotiation, post-submission, and status updates. Wallet actions happen in the web app, not directly in Telegram.

---

## Repository Structure

The repository has three top-level folders:

```txt
client/
chain/
server/
````

### `client/`

React + TypeScript web app.

Responsibilities:

* Wallet connection
* Wallet-address based account setup
* Deposits into the escrow contract
* Withdrawals from available balance
* Balance dashboard
* Campaign dashboard
* Campaign creation or campaign preview if needed
* Optional Telegram linking instructions
* Optional poster/channel dashboard

### `chain/`

Foundry / Forge smart contract project.

Responsibilities:

* Escrow contract
* Internal virtual balances
* Campaign locking
* Campaign settlement
* Refunds for failed/expired campaigns
* Withdrawal logic
* Tests

### `server/`

TypeScript backend.

Responsibilities:

* Telegram bot
* API for client
* User/account database
* Channel registration
* Campaign lifecycle
* AI/agentic workflow
* Telegram post verification
* Random post checks
* Advertiser-requested checks
* Contract calls for campaign settlement/refund
* Notifications

---

## Core Product Decisions

### 1. There will be a Telegram bot

The bot is part of the backend server. It is not a separate product. It receives Telegram updates and sends messages/buttons to users.

The bot handles:

* `/start`
* user onboarding
* poster opt-in
* channel verification
* campaign offers
* accept/reject/counter
* posting instructions
* post URL submission
* campaign status updates
* random verification alerts
* advertiser-requested verification checks

### 2. Deposits do not happen inside Telegram

Users deposit through the `client` web app.

The bot can send a link/button to the deposit page, but signing, approving ERC-20 tokens, depositing, and withdrawing happen in the browser.

### 3. There is no per-campaign deposit

Users deposit into a virtual account first.

When an advertiser creates a campaign, funds are locked from their existing available balance.

### 4. The virtual account is contract-backed

The virtual account is not only a database number.

The smart contract stores available balances by wallet address and token.

Conceptually:

```solidity
mapping(address user => mapping(address token => uint256 amount)) public balances;
```

### 5. The contract only knows wallet addresses

The contract should not store Telegram numerical IDs, Telegram usernames, channel IDs, post URLs, or ad content.

The contract stores only money-critical data:

* advertiser wallet
* poster wallet
* token
* amount
* campaign status
* timestamps/duration if needed

Telegram identity, channel ID, post URL, image hash, caption, and verification logs live in the server database.

### 6. Posters must opt in before receiving offers

A poster is just a user who has linked at least one Telegram channel.

An advertiser can become a poster later by linking a channel.

### 7. Channel linking uses proof posting

For MVP, channel verification works like this:

```txt
1. User starts the bot.
2. User links or provides their wallet address.
3. User tells the bot which channel they want to register.
4. Bot generates a unique verification code.
5. User posts that code in the target Telegram channel.
6. User sends the verification post URL to the bot.
7. Server verifies that the code exists in the given channel.
8. Server links that channel ID/username to the user account.
```

The bot does not need to be admin in the channel for MVP.

### 8. Users come with wallet addresses ready

Both advertisers and posters are identified financially by wallet address.

The server may link:

```txt
telegramUserId -> walletAddress
```

But the escrow contract should only use the wallet address.

### 9. No dispute resolution in MVP

There is no manual dispute resolution.

If the post matches the required content and remains valid until the end of the duration, the poster is paid.

If the post fails verification, gets deleted, or no valid post is submitted before deadline, the campaign is refunded or failed according to deterministic rules.

### 10. Ad content is restricted to image/text only

Supported ad formats:

```txt
text only
image only
image + caption as one Telegram message
```

Unsupported for MVP:

```txt
video
albums / media groups
multiple messages
threads
stories
voice
documents
stickers
polls
```

### 11. Posters must copy/paste exactly

The bot must clearly warn posters:

```txt
You must publish the ad exactly as shown. Do not change the text, image, links, formatting, or add extra comments. Payment is released only if the submitted post matches the approved ad and remains live for the full duration.
```

### 12. Content filtering is required

The system should reject or flag ads involving prohibited categories, including but not limited to:

* drugs
* pornography / adult sexual content
* scams
* phishing
* wallet drainers
* impersonation
* malware
* illegal goods/services
* hate or extremist content
* deceptive financial guarantees
* gambling, if the project chooses to block it
* political content, if the project chooses to block it

The AI safety check is advisory, but the backend should also apply deterministic rules where possible.

---

## Suggested Tech Stack

### Client

* React
* TypeScript
* Vite or Next.js
* Wagmi
* Viem
* WalletConnect / injected wallets
* TanStack Query
* Tailwind or simple CSS modules

### Chain

* Solidity
* Foundry / Forge
* OpenZeppelin libraries
* ERC-20 support, preferably USDC-like token for MVP

### Server

* Node.js
* TypeScript
* Fastify or Express
* grammY or Telegraf for Telegram bot
* PostgreSQL
* Prisma or Drizzle
* Viem for contract interaction
* OpenAI-compatible agent/LLM layer
* Job queue or cron for verification checks

For MVP, a simple interval worker is acceptable. For production, use a queue such as BullMQ.

---

## Smart Contract Requirements

Create one global escrow contract.

Do not deploy one contract per user.

Do not deploy one contract per campaign.

### Contract Responsibilities

The contract should:

* accept deposits
* track available user balances
* let advertisers lock funds into campaigns
* track campaigns
* let an authorized verifier mark campaigns active/completed/refunded
* credit poster balances after successful completion
* refund advertiser balances when campaign fails
* allow users to withdraw available balances

### Contract Should Not Store

Do not store:

* Telegram user IDs
* Telegram usernames
* Telegram channel IDs
* Telegram post URLs
* ad text
* image hashes
* verification code
* AI results
* moderation details

These belong in the server database.

### Suggested Contract Data Model

```solidity
enum CampaignStatus {
    None,
    Funded,
    Active,
    Completed,
    Refunded,
    Cancelled
}

struct Campaign {
    address advertiser;
    address poster;
    address token;
    uint256 amount;
    uint256 durationSeconds;
    uint256 startedAt;
    CampaignStatus status;
}
```

Suggested storage:

```solidity
mapping(address => mapping(address => uint256)) public balances;
mapping(uint256 => Campaign) public campaigns;
uint256 public nextCampaignId;

address public verifier;
```

### Required Contract Functions

Minimum:

```solidity
function deposit(address token, uint256 amount) external;

function withdraw(address token, uint256 amount) external;

function createCampaignFromBalance(
    address poster,
    address token,
    uint256 amount,
    uint256 durationSeconds
) external returns (uint256 campaignId);

function startCampaign(uint256 campaignId) external;

function completeCampaign(uint256 campaignId) external;

function refundCampaign(uint256 campaignId) external;
```

`startCampaign`, `completeCampaign`, and `refundCampaign` should be restricted to `onlyVerifier` for MVP.

### Deposit Behavior

Deposit should transfer ERC-20 tokens from the caller into the contract and credit the caller’s virtual account.

```txt
User wallet -> escrow contract
contract balance[user][token] += amount
```

Direct ERC-20 transfers to the contract without calling `deposit()` should not be relied on. The UI must call the proper deposit function.

Optional later:

```solidity
function depositFor(address beneficiary, address token, uint256 amount) external;
```

Do not implement `depositFor` unless needed.

### Locking Behavior

When a campaign is created, the contract subtracts the amount from the advertiser’s available balance and stores it in the campaign record.

```txt
advertiser available balance decreases
campaign locked amount increases
```

No external token transfer happens during locking.

### Completion Behavior

When the server/verifier determines that the campaign was completed successfully:

```txt
campaign status -> Completed
poster available balance += campaign amount
```

### Refund Behavior

When the server/verifier determines that the campaign failed or expired:

```txt
campaign status -> Refunded
advertiser available balance += campaign amount
```

### Withdrawal Behavior

Users can withdraw available balance to their own wallet.

```txt
contract available balance decreases
ERC-20 transfer to msg.sender
```

Use checks-effects-interactions and SafeERC20.

### Events

Emit events for all important actions:

```solidity
event Deposited(address indexed user, address indexed token, uint256 amount);
event Withdrawn(address indexed user, address indexed token, uint256 amount);
event CampaignCreated(
    uint256 indexed campaignId,
    address indexed advertiser,
    address indexed poster,
    address token,
    uint256 amount,
    uint256 durationSeconds
);
event CampaignStarted(uint256 indexed campaignId, uint256 startedAt);
event CampaignCompleted(uint256 indexed campaignId);
event CampaignRefunded(uint256 indexed campaignId);
```

### Testing Requirements

Foundry tests should cover:

* deposit
* withdraw
* cannot withdraw more than balance
* create campaign from balance
* cannot create campaign without enough balance
* locked campaign funds are not withdrawable by advertiser
* only verifier can start campaign
* only verifier can complete campaign
* complete campaign credits poster balance
* refund campaign credits advertiser balance
* cannot complete refunded campaign
* cannot refund completed campaign

---

## Server Requirements

The server is the main orchestrator.

### Server Responsibilities

The server should manage:

* Telegram bot
* HTTP API for client
* user accounts
* wallet address linking
* poster/channel registration
* campaign metadata
* campaign state machine
* AI-assisted campaign creation
* offer negotiation
* post verification
* scheduled checks
* contract settlement calls

### Server Database Entities

Suggested entities:

```ts
type User = {
  id: string;
  telegramUserId: string | null;
  telegramUsername: string | null;
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
};
```

A user can be an advertiser, poster, or both. Avoid separate advertiser/poster tables unless needed.

```ts
type Channel = {
  id: string;
  telegramChannelId: string;
  telegramChannelUsername: string | null;
  title: string | null;
  ownerUserId: string;
  verificationCode: string | null;
  verificationPostUrl: string | null;
  verifiedAt: Date | null;
  status: "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: Date;
  updatedAt: Date;
};
```

```ts
type Campaign = {
  id: string;
  onchainCampaignId: string | null;

  advertiserUserId: string;
  advertiserWalletAddress: string;

  posterUserId: string | null;
  posterWalletAddress: string | null;

  channelId: string | null;
  targetTelegramChannelUsername: string | null;
  targetTelegramChannelId: string | null;

  tokenAddress: string;
  amount: string;
  durationSeconds: number;

  requestedText: string | null;
  requestedImageFileId: string | null;
  requestedImageUrl: string | null;
  requestedImageHash: string | null;

  approvedText: string | null;
  approvedImageHash: string | null;

  submittedPostUrl: string | null;
  submittedMessageId: string | null;

  status:
    | "DRAFT"
    | "AWAITING_FUNDS"
    | "FUNDED"
    | "OFFERED"
    | "NEGOTIATING"
    | "ACCEPTED"
    | "AWAITING_POST"
    | "VERIFYING_POST"
    | "ACTIVE"
    | "COMPLETED"
    | "REFUNDED"
    | "CANCELLED"
    | "REJECTED"
    | "FAILED";

  startsAt: Date | null;
  endsAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
};
```

```ts
type VerificationCheck = {
  id: string;
  campaignId: string;
  type: "INITIAL" | "RANDOM" | "ADVERTISER_REQUESTED" | "FINAL";
  status: "PASSED" | "FAILED";
  reason: string | null;
  checkedAt: Date;
  rawResultJson: unknown;
};
```

```ts
type OfferMessage = {
  id: string;
  campaignId: string;
  fromUserId: string;
  toUserId: string;
  role: "ADVERTISER" | "POSTER" | "AGENT";
  message: string;
  structuredPayloadJson: unknown;
  createdAt: Date;
};
```

### Telegram Identity

The bot should store Telegram numerical IDs from Telegram updates.

Do not use Telegram usernames as primary identity.

Usernames can change. Use them only for display.

### Wallet Linking

Since users come with wallet addresses ready, MVP may allow the user to provide a wallet address to the bot.

Better flow:

```txt
1. User opens client.
2. User connects wallet.
3. User signs a message proving wallet ownership.
4. Client/backend creates a link code.
5. User sends the code to the Telegram bot.
6. Server links telegramUserId to walletAddress.
```

If time is limited, allow the bot to collect wallet addresses, but mark this as less secure.

Preferred production rule:

```txt
No wallet should be fully trusted unless it signed an ownership message.
```

### Bot Commands

Implement at least:

```txt
/start
/help
/link
/register_channel
/my_channels
/new_campaign
/my_campaigns
/balance
```

Buttons are preferred over command-heavy UX.

### Poster Channel Registration Flow

Suggested bot flow:

```txt
User: /register_channel
Bot: Send me the channel username or channel ID.
User: @exampleChannel
Bot: Here is your verification code:
     AD_VERIFY_<random>_<shortWallet>
     Post this exact code in @exampleChannel, then send me the post URL.
User: sends https://t.me/exampleChannel/123
Server verifies the post content.
Bot: Channel verified.
```

Store the stable channel ID if available. Store username as display data.

### Campaign Creation Flow

Advertiser can create a campaign through bot chat.

Supported input can be messy natural language.

Example:

```txt
I want to promote this app on @exampleChannel for 100 USDC for 24 hours.
```

The AI should extract structured campaign fields:

```ts
{
  targetChannel: string;
  budgetAmount: string;
  token: string;
  durationSeconds: number;
  text?: string;
  hasImage: boolean;
}
```

The bot should ask for missing fields.

### Campaign Offer Flow

After campaign is funded/locked:

```txt
Bot sends offer to poster:
- channel
- amount
- duration
- ad content preview
- exact posting requirements
- accept / reject / counter buttons
```

Poster can:

```txt
Accept
Reject
Counter amount
Counter duration
Ask for ad changes
```

For MVP, keep negotiation simple.

### Manual Posting Flow

After poster accepts:

```txt
Bot sends exact ad content.
Bot warns poster to copy/paste exactly.
Poster posts the ad manually in their channel.
Poster sends the post URL back to the bot.
Server verifies content.
If passed, server calls startCampaign on-chain.
Campaign becomes ACTIVE.
```

### Random Checks

Server should perform random checks during the campaign duration.

For MVP:

* schedule 1-3 random checks depending on duration
* always perform final check at the end
* allow advertiser to request manual check through bot

Advertiser-requested checks can work like:

```txt
Advertiser replies to campaign status message with /check
```

or presses:

```txt
[Check Now]
```

The server should avoid unlimited checks. Add rate limit.

Example:

```txt
max 3 advertiser-requested checks per campaign per day
```

### Final Check

At the campaign end:

```txt
1. Fetch submitted post URL.
2. Verify post still exists.
3. Verify text/image still match.
4. If passed, call completeCampaign.
5. If failed, call refundCampaign.
6. Notify both users.
```

No dispute flow.

---

## Telegram Post Verification

### Supported Formats

Only verify:

```txt
text only
image only
image + caption in one message
```

### Initial Verification

For submitted post URL, verify:

* URL is valid Telegram post URL
* post belongs to expected channel
* message ID matches URL
* text/caption matches approved text, if text exists
* image matches approved image, if image exists
* no unsupported media exists
* post time is after campaign acceptance
* post is publicly reachable, if using public scraping/client method

### Text Matching

For MVP, use exact normalized matching.

Normalize:

* trim
* collapse repeated spaces
* normalize quote characters
* normalize line endings

Do not allow semantic rewrites after approval unless explicitly implemented.

### Image Matching

Preferred:

* download the image submitted by advertiser
* compute hash
* download the image from submitted post
* compute hash
* compare

For MVP, if exact hashing is too strict because Telegram compresses images, use perceptual hash or AI-assisted image similarity.

The server should store:

```txt
approvedImageHash
submittedImageHash
verification confidence/result
```

### URL Verification

Telegram public post links often look like:

```txt
https://t.me/channelUsername/123
```

For private or non-public channels, MVP may not support verification.

MVP should clearly restrict to public channels if necessary.

### Edited Posts

If possible, detect edited posts. If not possible, final content check is enough for MVP.

Rule:

```txt
If final post content does not match, campaign fails/refunds.
```

### Deleted Posts

If the submitted URL no longer resolves or content cannot be fetched at final check, campaign fails/refunds.

---

## AI / Agentic Requirements

The app should be agentic, but the AI must not control money directly.

### Agent Responsibilities

The AI agent should help with:

* campaign intake from natural language
* extracting structured campaign details
* asking for missing fields
* improving ad copy
* checking content safety
* generating offer messages
* guiding posters
* negotiating within constraints
* explaining verification failures
* summarizing campaign status
* recommending next backend action

### Agent Must Not

The AI must not:

* release funds directly
* call contract settlement without deterministic verification result
* invent budget increases
* change campaign terms without user approval
* message non-opted-in users
* approve prohibited content
* ignore exact content requirements

### Agentic Flow

Use a state machine. The agent suggests actions, but backend validates them.

Example action type:

```ts
type AgentAction =
  | { type: "ASK_MISSING_INFO"; question: string }
  | { type: "SUGGEST_AD_COPY"; text: string }
  | { type: "FLAG_CONTENT_RISK"; reasons: string[] }
  | { type: "GENERATE_POSTER_OFFER"; message: string }
  | { type: "PROPOSE_COUNTER_OFFER"; amount: string; durationSeconds: number }
  | { type: "REQUEST_POST_FIX"; reason: string }
  | { type: "SUMMARIZE_STATUS"; message: string };
```

The backend decides what is allowed in the current campaign state.

### Campaign Intake Agent

Input:

```txt
User message, uploaded image, target channel, budget, duration.
```

Output:

```ts
{
  targetChannel?: string;
  amount?: string;
  tokenSymbol?: string;
  durationSeconds?: number;
  adText?: string;
  missingFields: string[];
}
```

### Safety Agent

Input:

```txt
Ad text, image description if available, URLs, category.
```

Output:

```ts
{
  allowed: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  suggestedFixes: string[];
}
```

The backend should block `allowed: false`.

### Offer Agent

Creates clear offer text for posters.

Must include:

* amount
* duration
* channel
* accepted format
* exact posting rule
* payment condition
* expiry/deadline if applicable

### Negotiation Agent

For MVP, negotiation should be bounded.

Advertiser can set:

```ts
{
  initialAmount: string;
  maxAmount?: string;
  initialDurationSeconds: number;
  minDurationSeconds?: number;
  allowCounterOffers: boolean;
}
```

Poster can counter:

```txt
amount
duration
minor content-change request
```

The agent can suggest but not finalize changes without confirmation from the affected user.

### Verification Explanation Agent

When verification fails, AI can produce a readable explanation:

```txt
The post was found, but the caption does not match. The required URL is missing. Please repost or edit the message exactly as shown.
```

But the pass/fail result should come from deterministic verification logic where possible.

---

## Client Requirements

The client is a React TypeScript app focused on wallet actions and dashboard.

### Required Pages

Minimum:

```txt
/
Connect wallet
Dashboard
Deposit
Withdraw
Campaigns
```

Optional:

```txt
Channel management
Campaign creation
Campaign detail page
```

### Wallet Actions

The client should support:

* connect wallet
* sign message for login/linking
* read available balance
* deposit ERC-20 token
* withdraw ERC-20 token
* show campaign locked amounts
* show pending/available/withdrawn overview

### Balance Types

Show:

```txt
Available balance
Locked in campaigns
Pending earnings
Withdrawn history
```

Contract only needs available balances and campaign records.

The server/client can compute pending and locked based on campaign states.

### Depositing

Deposit flow:

```txt
Connect wallet
Select token
Enter amount
Approve token
Call deposit(token, amount)
Wait for confirmation
Show updated available balance
```

### Withdrawing

Withdraw flow:

```txt
Connect wallet
Select token
Enter amount
Call withdraw(token, amount)
Wait for confirmation
Show updated available balance
```

### Telegram Linking

The client may show:

```txt
Open Telegram bot
Send this linking code
```

Preferred flow:

```txt
Client generates link session after wallet signature.
User opens bot with deep link.
Bot finalizes Telegram account linking.
```

---

## Server API Suggestions

Suggested endpoints:

```txt
POST /api/auth/nonce
POST /api/auth/verify-signature
GET  /api/me

GET  /api/balances
GET  /api/campaigns
GET  /api/campaigns/:id

POST /api/link/telegram-session
POST /api/channels
GET  /api/channels

POST /api/campaigns
POST /api/campaigns/:id/request-check
```

Telegram webhook:

```txt
POST /telegram/webhook
```

---

## Campaign State Machine

Suggested server-level states:

```txt
DRAFT
AWAITING_FUNDS
FUNDED
OFFERED
NEGOTIATING
ACCEPTED
AWAITING_POST
VERIFYING_POST
ACTIVE
COMPLETED
REFUNDED
CANCELLED
REJECTED
FAILED
```

### Important Transitions

```txt
DRAFT -> AWAITING_FUNDS
AWAITING_FUNDS -> FUNDED
FUNDED -> OFFERED
OFFERED -> ACCEPTED
OFFERED -> REJECTED
OFFERED -> NEGOTIATING
NEGOTIATING -> ACCEPTED
ACCEPTED -> AWAITING_POST
AWAITING_POST -> VERIFYING_POST
VERIFYING_POST -> ACTIVE
ACTIVE -> COMPLETED
ACTIVE -> REFUNDED
```

The on-chain campaign can use fewer states:

```txt
Funded
Active
Completed
Refunded
Cancelled
```

The server holds the richer workflow.

---

## Security Rules

### Wallets

* Never trust a wallet address typed in chat as fully verified unless it has signed a message in the client.
* For MVP, typed wallet addresses may be allowed, but mark this as insecure and avoid using for production.

### Telegram

* Do not use username as stable identity.
* Store Telegram numerical user ID.
* Store Telegram channel ID where possible.
* Usernames are display-only.

### Contract

* Use SafeERC20.
* Use reentrancy guard on withdrawal if needed.
* Restrict verifier functions.
* Emit events.
* Do not put mutable off-chain ad data into contract.
* Do not let AI directly call settlement functions.
* Backend/verifier wallet should be configurable.

### Content

* Reject prohibited categories before sending offers.
* Do not send ad offers for blocked/risky content.
* Keep content safety logs.

### Rate Limits

Rate limit:

* channel verification attempts
* advertiser-requested checks
* campaign creation spam
* bot commands
* AI calls

---

## MVP Scope

Build the simplest working version.

### Must Have

* One escrow contract
* Deposit/withdraw in client
* Internal balances
* Campaign creation from balance
* Telegram bot onboarding
* Poster channel verification by proof code
* Advertiser campaign intake
* Image/text only ad format
* Offer sent to opted-in poster
* Poster accept/reject
* Manual post submission by URL
* Initial verification
* Random checks
* Final verification
* Complete/refund on-chain
* Notifications to both sides

### Should Have

* AI ad rewrite
* AI content safety check
* AI campaign intake
* AI explanation of verification failures
* Simple bounded counteroffers

### Not MVP

* Video
* Private channels
* Bot admin posting
* Per-campaign contracts
* Per-user contracts
* Full dispute resolution
* Arbitrators
* Multi-token complexity beyond one ERC-20
* Semantic rewrite matching
* Complex audience analytics
* Marketplace discovery/ranking

---

## Suggested Development Order

1. Create `chain` Foundry project.
2. Implement escrow contract.
3. Write Foundry tests.
4. Create `server` project with database schema.
5. Implement Telegram bot `/start`.
6. Implement user wallet linking placeholder.
7. Implement poster channel verification by code.
8. Implement campaign creation in database.
9. Implement client wallet connect.
10. Implement client deposit/withdraw.
11. Connect server to contract with viem.
12. Implement campaign locking on-chain.
13. Implement offer flow through Telegram.
14. Implement poster accept/reject.
15. Implement post URL submission.
16. Implement Telegram post verification.
17. Implement final settlement/refund.
18. Add AI intake/safety/offer generation.
19. Add random checks.
20. Polish demo.

---

## Naming

Use the project name consistently once chosen.

Current possible names discussed:

```txt
Ad Me In
AdAid
AddAnAd
PostEasy
JustAds
```

Do not hardcode name-specific logic. Keep names configurable in environment variables or frontend constants.

---

## Environment Variables

Suggested server env:

```txt
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
DATABASE_URL=
OPENAI_API_KEY=
RPC_URL=
CHAIN_ID=
ESCROW_CONTRACT_ADDRESS=
VERIFIER_PRIVATE_KEY=
USDC_TOKEN_ADDRESS=
CLIENT_URL=
SERVER_URL=
```

Suggested client env:

```txt
VITE_CHAIN_ID=
VITE_RPC_URL=
VITE_ESCROW_CONTRACT_ADDRESS=
VITE_USDC_TOKEN_ADDRESS=
VITE_SERVER_URL=
VITE_TELEGRAM_BOT_USERNAME=
```

---

## Coding Style

Use TypeScript strictly in `client` and `server`.

Prefer:

* clear domain types
* explicit state transitions
* small service modules
* no business logic hidden inside route handlers
* no direct contract calls from random files
* no AI-generated final actions without backend validation

Suggested server module structure:

```txt
server/src/
  bot/
    index.ts
    handlers/
    keyboards/
  api/
    routes/
  domain/
    campaign.ts
    user.ts
    channel.ts
    verification.ts
  services/
    campaignService.ts
    channelService.ts
    verificationService.ts
    contractService.ts
    agentService.ts
  db/
    schema.ts
    client.ts
  jobs/
    randomChecks.ts
    finalSettlement.ts
  config.ts
  index.ts
```

Suggested client structure:

```txt
client/src/
  components/
  pages/
  hooks/
  lib/
    contract.ts
    api.ts
    wallet.ts
  App.tsx
```

Suggested chain structure:

```txt
chain/
  src/
    AdEscrow.sol
  test/
    AdEscrow.t.sol
  script/
    Deploy.s.sol
```

---

## Product Copy Requirements

Use simple wording.

Avoid technical phrases in user-facing bot messages unless necessary.

Good:

```txt
Your ad balance is 100 USDC.
I locked 25 USDC for this campaign.
The poster will be paid only if the post stays live for 24 hours.
```

Avoid:

```txt
Your escrow mapping was debited.
The verifier called startCampaign.
```

Poster warning must be clear:

```txt
Please publish this ad exactly as shown. If you change the text, image, or link, verification may fail and payment will not be released.
```

Advertiser explanation must be clear:

```txt
Your funds are locked for this campaign. If the poster does not publish a valid post, the funds return to your available balance.
```

---

## Core Guarantee

The product guarantee is:

```txt
Advertisers pay only when the approved ad appears in the approved Telegram channel and remains valid for the agreed duration.

Posters know the advertiser already locked funds before they publish.
```

The system does not guarantee:

```txt
exact legal ownership of the channel
perfect detection of all edits
private channel support
human dispute resolution
```

For MVP, the system verifies delivery, not legal ownership.

---

## Final MVP Architecture

```txt
Advertiser / Poster
        |
        | Telegram messages/buttons
        v
Telegram Bot inside server
        |
        | campaign state / AI / verification
        v
Server + Database
        |
        | viem contract calls
        v
Ethereum Escrow Contract
        |
        | deposits / locked funds / balances / withdrawals
        v
ERC-20 token

Wallet actions:
Advertiser/Poster -> React client -> wallet -> escrow contract
```

```
```
