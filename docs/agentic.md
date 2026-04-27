Goal
 ↓
Understand campaign request
 ↓
Check safety and feasibility
 ↓
Choose next action
 ↓
Use tools: Telegram, contract, database, verifier, AI vision
 ↓
Observe result
 ↓
Update campaign state
 ↓
Continue until campaign is completed, rejected, refunded, or disputed


- Ask advertiser for missing campaign details
- Rewrite ad text
- Detect scammy content
- Suggest budget/duration changes
- Compose offer message
- Negotiate within limits
- Explain requirements to poster
- Remind poster to publish
- Verify whether submitted post matches campaign
- Explain why verification failed
- Recommend refund/dispute/completion

- Releasing funds without deterministic checks
- Changing campaign amount beyond advertiser-approved limits
- Sending arbitrary messages to non-opted-in users
- Posting ads without poster approval
- Approving suspicious ads without safety rules



To make this app **agentic**, do not just add “AI text generation.”

Make the AI responsible for **goal-driven work across multiple steps**, while your backend keeps strict control over money, permissions, and final state changes.

In your case, the agent should behave like:

> “Given an advertiser’s goal, budget, creative, and target channel, plan the campaign, prepare the offer, negotiate within allowed limits, guide the poster, verify delivery, and trigger settlement when conditions are met.”

That is agentic.

---

# The core agentic loop

Your system can have this loop:

```txt
Goal
 ↓
Understand campaign request
 ↓
Check safety and feasibility
 ↓
Choose next action
 ↓
Use tools: Telegram, contract, database, verifier, AI vision
 ↓
Observe result
 ↓
Update campaign state
 ↓
Continue until campaign is completed, rejected, refunded, or disputed
```

The important part is that the agent is not only replying to messages. It is managing a campaign lifecycle.

---

# What the agent should control

The agent can control **communication and workflow**, not raw money.

Good things for the agent to do:

```txt
- Ask advertiser for missing campaign details
- Rewrite ad text
- Detect scammy content
- Suggest budget/duration changes
- Compose offer message
- Negotiate within limits
- Explain requirements to poster
- Remind poster to publish
- Verify whether submitted post matches campaign
- Explain why verification failed
- Recommend refund/dispute/completion
```

Things the agent should **not** freely control:

```txt
- Releasing funds without deterministic checks
- Changing campaign amount beyond advertiser-approved limits
- Sending arbitrary messages to non-opted-in users
- Posting ads without poster approval
- Approving suspicious ads without safety rules
```

So the agent should recommend or initiate actions, but your backend/state machine should enforce hard rules.

---

# Agent roles in your app

You can present it as several agents, even if technically they are one LLM with different prompts.

## 1. Campaign Intake Agent

This agent helps the advertiser create a proper campaign from messy input.

Advertiser says:

```txt
I want to advertise this meme coin on @somechannel for 20 TON for 24 hours. Here is the image and text.
```

The agent turns that into structured data:

```ts
{
  targetChannel: "@somechannel",
  budget: "20 TON",
  durationHours: 24,
  creativeText: "...",
  mediaType: "image",
  requiredUrl: "...",
  category: "crypto",
  objective: "awareness"
}
```

It should ask for missing fields only when necessary.

For example:

```txt
I have the image and text. I still need the campaign duration and the target channel.
```

This makes the UX feel agentic because the user does not fill a long form. They describe what they want.

---

## 2. Safety & Policy Agent

This agent checks whether the ad is risky.

It looks for:

```txt
- phishing links
- fake airdrops
- wallet-drainer language
- impersonation
- guaranteed profit claims
- illegal offers
- adult/gambling/political categories if you want to block them
- mismatch between image, text, and URL
```

Output should be structured:

```ts
{
  riskLevel: "low" | "medium" | "high",
  allowed: boolean,
  reasons: [
    "Contains guaranteed profit language",
    "External URL domain is newly created or suspicious"
  ],
  suggestedFixes: [
    "Remove guaranteed return claim",
    "Use official project domain"
  ]
}
```

This is very important because your product claims to reduce scams.

---

## 3. Offer Agent

This agent writes the message to the poster/channel owner.

It should not just generate a random persuasive message. It should generate a **structured offer**.

Example:

```txt
You received a sponsored post offer.

Channel: @example
Budget: 20 TON
Duration: 24 hours
Content type: image + caption
Category: DeFi
Post requirement: exact caption and image
Payment: escrowed, claimable after verification

Advertiser message:
...

Accept, reject, or counter?
```

The agent can make it polite and convincing, but the offer data must remain fixed.

---

## 4. Negotiation Agent

This is where the app becomes strongly agentic.

But keep it bounded.

The advertiser should set rules:

```ts
{
  initialOffer: 20,
  maxOffer: 30,
  durationHours: 24,
  allowCounteroffers: true,
  allowedNegotiationFields: ["price", "duration"]
}
```

Then the agent can negotiate.

Example:

Poster says:

```txt
20 TON is too low. I can do 35.
```

Agent checks rules:

```txt
Advertiser max is 30 TON.
```

Agent replies:

```txt
The advertiser can go up to 30 TON for 24 hours. Would you accept 30 TON, or 20 TON for 12 hours?
```

This is a real agentic behavior: it observes, reasons within constraints, and acts.

But it cannot invent:

```txt
Sure, 35 TON is okay.
```

unless the advertiser authorized it.

---

## 5. Verification Agent

This agent verifies the submitted post.

It receives:

```ts
{
  expectedCaption,
  expectedMediaHash,
  requiredChannelId,
  requiredDuration,
  submittedPostLink
}
```

It checks:

```txt
- correct channel
- correct timestamp
- caption match
- media match
- required link exists
- no forbidden extra text
- post is public/reachable
```

Then produces:

```ts
{
  matched: true,
  confidence: 0.98,
  failures: [],
  shouldStartCountdown: true
}
```

If failed:

```ts
{
  matched: false,
  confidence: 0.62,
  failures: [
    "Caption changed: missing required URL",
    "Image does not match approved creative"
  ],
  suggestedMessageToPoster: "The post is missing the required link. Please edit the caption or repost it exactly."
}
```

This is agentic because the AI does not only say “failed.” It guides the next step.

---

## 6. Settlement Agent

This agent monitors active campaigns and recommends state transitions.

For example:

```txt
Campaign #12 duration ended.
Post still exists.
No disqualifying edit detected.
Move to PendingSettlement.
```

But do not let the LLM directly release money.

Better:

```txt
Agent recommendation → deterministic backend checks → contract call
```

Settlement should be rule-based.

---

# The best architecture

Use a **state machine + agents**.

Do not make the LLM the source of truth.

Your app should have campaign states:

```txt
Draft
AwaitingFunding
Funded
Offered
Negotiating
Accepted
AwaitingPost
VerifyingPost
Active
PendingSettlement
Claimable
Rejected
Refunded
Disputed
Cancelled
```

The agent can choose actions depending on the state.

Example:

```ts
type AgentAction =
  | { type: "ASK_ADVERTISER_FOR_MISSING_INFO"; question: string }
  | { type: "RUN_SAFETY_CHECK" }
  | { type: "GENERATE_OFFER_MESSAGE" }
  | { type: "SEND_TELEGRAM_OFFER"; posterId: string }
  | { type: "PROPOSE_COUNTEROFFER"; amount: string; durationHours: number }
  | { type: "REQUEST_POST_REVISION"; reason: string }
  | { type: "START_COUNTDOWN" }
  | { type: "MARK_READY_FOR_SETTLEMENT" }
  | { type: "OPEN_DISPUTE"; reason: string };
```

Then your backend validates:

```ts
function canApplyAction(campaign, action) {
  // hard-coded rules
}
```

This protects you from AI mistakes.

---

# What tools should the agent have?

Think of each backend function as a tool.

## Campaign tools

```ts
createCampaignDraft(input)
updateCampaignDraft(campaignId, patch)
getCampaign(campaignId)
setCampaignStatus(campaignId, status)
```

## Telegram tools

```ts
sendMessage(userId, text)
sendOfferToPoster(posterId, campaignId)
getChannelPost(channelId, messageId)
listenForChannelPost(channelId)
```

## Verification tools

```ts
compareText(expected, actual)
compareImage(expectedImage, actualImage)
verifyPostLink(postLink, campaignId)
checkPostStillExists(postLink)
checkPostWasEdited(postLink)
```

## Contract tools

```ts
createEscrow(campaignId, amount)
getEscrowStatus(campaignId)
markCampaignCompleted(campaignId)
refundCampaign(campaignId)
getPosterClaimableBalance(posterWallet)
```

## AI tools

```ts
rewriteAdText(input)
classifyAdRisk(input)
generateOfferMessage(input)
analyzePostMatch(expected, actual)
summarizeNegotiation(history)
```

The agent should call these tools step by step.

---

# Example agentic flow

Advertiser messages bot:

```txt
I want to promote this image on @cryptoAlpha for 15 TON, 24 hours.
```

Agent:

```txt
Understood. I’ll prepare a campaign for @cryptoAlpha with a 15 TON budget and 24-hour duration. Please send the caption or allow me to generate one.
```

Advertiser sends caption.

Agent runs:

```txt
Safety check → passed
Ad rewrite → improved caption
Channel lookup → @cryptoAlpha is registered
Price check → channel minimum is 20 TON
```

Agent replies:

```txt
@cryptoAlpha’s minimum price for a 24-hour sponsored post is 20 TON. You offered 15 TON. I can either propose 15 TON as a lower offer, reduce the duration to 12 hours, or ask you to increase the budget to 20 TON.
```

Advertiser chooses 20 TON.

Agent:

```txt
Please fund 20 TON into escrow.
```

After funding:

```txt
Escrow confirmed. I’m sending the offer to @cryptoAlpha.
```

Poster receives:

```txt
Sponsored post offer:
20 TON for 24 hours.
Escrow funded.
Post must match the approved image and caption.
Accept / Reject / Counter
```

Poster accepts.

Agent sends exact posting instructions.

Poster posts manually and sends link.

Agent verifies:

```txt
Correct channel: yes
Caption match: yes
Image match: yes
Timestamp: valid
```

Agent:

```txt
Post verified. The 24-hour timer has started.
```

After duration:

```txt
Post still live. No invalid edits detected. Payment is now claimable.
```

That is agentic.

---

# What makes this better than a normal bot?

A normal bot does this:

```txt
User clicks buttons.
Bot follows fixed flow.
```

Your agentic app does this:

```txt
User expresses goal in natural language.
Agent extracts intent.
Agent checks missing details.
Agent improves ad.
Agent evaluates risk.
Agent negotiates under constraints.
Agent verifies execution.
Agent guides both sides until settlement.
```

That is the story you should tell judges.

---

# Do not make it too autonomous

For hackathon, avoid saying:

> “The agent fully controls advertising.”

Say:

> “The agent manages the campaign workflow, while escrow and settlement are enforced by deterministic rules.”

This sounds safer and more serious.

---

# Where AI is genuinely needed

Use AI where normal code is weak:

```txt
- understanding messy advertiser requests
- rewriting ad copy
- scam/risk classification
- negotiation language
- semantic comparison of post content
- explaining verification failure
- summarizing campaign status
```

Use normal code where normal code is strong:

```txt
- checking balances
- campaign states
- duration timers
- exact text matching
- wallet addresses
- escrow logic
- post timestamps
- permission checks
```

That separation is very important.

---

# Suggested hackathon tagline

> An AI agent that manages Telegram ad campaigns from request to settlement: it prepares the ad, negotiates with channel owners, verifies delivery, and releases TON escrow only when the sponsored post stays live for the agreed duration.

That is a strong agentic framing.

---

# The simplest MVP agent

Build one “Campaign Manager Agent” with these abilities:

```txt
1. Intake campaign from natural language
2. Generate/rewrite ad
3. Check ad risk
4. Send structured offer
5. Handle accept/reject/counter
6. Verify submitted post
7. Trigger claimable balance after duration
```

That is enough.

Do not overbuild multi-agent architecture unless the hackathon specifically asks for it. Internally, one agent with tool calls is simpler.


The agentic part in this architecture

The AI agent does not touch private keys or signatures.

It uses tools like:

getUserBalance(wallet)
createCampaignDraft()
sendOfferToPoster()
handleCounterOffer()
verifyPostContent()
recommendSettlement()

But actual financial actions happen via:

web app + wallet
contract transaction
backend verifier

That is a safer design.


Better: use Telegram Login Widget / Mini App auth

Telegram has official login/auth mechanisms where Telegram signs the user data. Your backend can verify the hash and know the Telegram account is real.

Then the flow is:

1. User connects wallet.
2. User signs wallet message.
3. User logs in with Telegram.
4. Backend verifies Telegram auth hash.
5. Backend links wallet + Telegram user_id.


No-bot flow

A botless version could work like this:

1. Poster comes to web app.
2. Poster connects Ethereum wallet.
3. Poster claims: “I can post in @SomeChannel.”
4. Advertiser creates campaign targeting @SomeChannel.
5. Advertiser locks funds in escrow.
6. Poster accepts campaign.
7. Poster manually posts the exact ad in @SomeChannel.
8. Poster submits the public post link.
9. Your verifier checks:
   - correct channel
   - correct post content
   - correct media
   - correct timestamp
   - post still exists after duration
10. If valid, escrow pays the wallet that accepted the campaign.

1. Poster connects wallet.
2. Poster enters channel username: @SomeChannel.
3. Backend generates unique verification code:
   VERIFY-123456-0xPosterWallet
4. Poster posts this code in @SomeChannel.
5. Poster submits the verification post link.
6. Backend fetches the post link and checks:
   - is it from @SomeChannel?
   - does it contain the exact code?
   - was it posted recently?
7. If valid, mark channel as verified for that wallet.
8. Poster can now receive/accept campaigns for that channel.


{
  initialBudget: 100,
  maxBudget: 130,
  desiredDurationHours: 24,
  minDurationHours: 12,
  allowedChanges: ["price", "duration", "caption"],
  requireApprovalBeforeFinalAccept: true
}


Advertiser: I want to promote this app on @SomeChannel. Budget $100.
Agent: That channel usually asks for $150 for 24 hours. Do you want me to offer $100 anyway, offer $120 for 12 hours, or ask for a counter?

Agent: You received a $100 offer for a 24-hour post. Your minimum is $120. I can counter with $120 or suggest a 12-hour post for $100.

Web app:
- wallet connection
- deposits
- campaign creation
- negotiation dashboard
- channel verification by proof post
- post-link submission

Telegram bot:
- notify poster about new offer
- notify advertiser about counteroffer
- remind poster to publish
- remind advertiser to respond


Option B: Bot for notifications only

Agentic negotiation can happen through both web app and Telegram messages.

Good: practical, user-friendly
Bad: users must start the bote