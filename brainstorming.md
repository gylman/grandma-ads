
### Improvement

Make it **opt-in only**.

Posters/channels must register first:

1. Poster starts the bot.
2. Poster connects wallet or creates internal account.
3. Poster registers channel/group/profile.
4. Poster sets prices, accepted categories, minimum duration, minimum budget.
5. Advertisers can only send offers to registered posters.

This also makes the system safer and less scammy.

---

## 2. You need to define “poster” more carefully

There are different cases:

1. A normal Telegram user posts on their personal account.
2. A channel owner posts in a Telegram channel.
3. A group admin pins/posts in a group.
4. A bot posts on behalf of the channel.


For a hackathon MVP, avoid personal accounts. Use **Telegram channels**.

Why? Because channel posts have public links, clearer ownership, and easier verification.

### Better MVP target

> “Advertisers can buy sponsored posts from Telegram channel owners who have registered their channels.”

That is much cleaner than “any username.”

---

### Improvement

For MVP, require one of these:

**Option A: Bot must be admin in the channel**

The poster adds your bot as an admin with limited permissions. Then the bot can verify posts more reliably.

**Option B: Bot posts the ad itself**

This is even better.

Instead of asking the poster to manually post and submit a link, the channel owner approves the campaign, and your bot publishes the ad into the channel directly.

That gives you much stronger guarantees:

For hackathon, I strongly recommend this model.

---

## 4. The “AI negotiates price” part may be overcomplicated

### Improvement

Use structured offers instead of free-form negotiation.

Example:

Advertiser submits:

```ts
{
  targetChannel: "@example_channel",
  budget: "100 USDC",
  durationHours: 24,
  creativeText: "...",
  imageUrl: "...",
  category: "DeFi",
  allowAiRewrite: true
}
```

Poster can choose:

* Accept
* Reject
* Counter price
* Counter duration
* Ask advertiser to revise creative

AI can generate the human-readable message, but the important state should remain structured.

This prevents the AI from making promises that your smart contract cannot enforce.

---

## 5. Smart contract cannot verify Telegram directly

The contract itself cannot know whether a Telegram post exists. You need an off-chain verifier/oracle.

So the real trust model is not fully decentralized.

The contract releases funds based on a backend/bot saying:

> “Yes, the ad was posted and stayed live.”

That means your backend is powerful. If your backend lies or is hacked, funds could be released incorrectly.

### Improvement

Be honest about the trust model.

For a hackathon, say:

> “The MVP uses an off-chain verification service operated by the protocol. Future versions can add decentralized verifiers, challenge periods, or optimistic disputes.”

A good smart contract flow:

1. Advertiser creates campaign and deposits funds.
2. Poster accepts.
3. Bot verifies initial post.
4. Campaign enters `Active`.
5. After duration, bot submits completion proof.
6. Funds become claimable after a short dispute window.
7. If advertiser disputes, campaign goes to manual/arbitration flow.

Do **not** immediately release funds without any dispute mechanism.

---

## 6. Content safety and scam ads are a major issue

Your stated goal includes:

> “They should be able to do it in a way that they would not scam.”

That cuts both ways.

Advertisers can scam audiences too.

For example, someone could buy ads for:

* Fake airdrops
* Phishing links
* Wallet drainers
* Fake investment schemes
* Impersonation
* Illegal products
* Adult content
* Gambling
* Political manipulation
* Malware links

Telegram’s own terms prohibit spam, scams, and various illegal activities. ([Telegram][3])

If your platform makes it easy to buy Telegram ads, it may also make it easy to spread scams unless you add moderation.

### Improvement

Add an AI + rule-based ad safety checker before sending offers.

For MVP:

* Detect wallet-drainer/phishing language
* Block suspicious URLs
* Require domain reputation checks
* Require advertiser identity/wallet history
* Let posters set blocked categories
* Add “AI risk score”
* Let poster manually approve every ad

Your system should not say:

> “We help anyone advertise anything.”

It should say:

> “We help verified advertisers and opted-in publishers run escrow-protected sponsored posts.”

---

## 7. “Image/text comparison” is not enough

Suppose advertiser requests:

> “Promote our new token.”

Poster posts:

> “This token looks suspicious, but they paid us to share it.”

Technically it contains the token and maybe the image, but the meaning is different.

Or advertiser requests:

> “Best wallet security product.”

Poster posts:

> “Worst wallet security product.”

Text similarity may say they match, but semantically they do not.

### Improvement

Verification should check multiple things:

* Is the post in the correct channel?
* Was it posted by the correct channel/admin?
* Does it contain the required image/video?
* Does it contain required text or approved AI rewrite?
* Does it contain forbidden modifications?
* Does it contain the required link?
* Is the sentiment/meaning materially similar?
* Was it live for the full duration?
* Was it edited after approval?
* Was it deleted before expiry?

Use AI as a helper, but keep deterministic checks where possible.

---

## 8. Payment UX may be too hard if you require crypto wallets from everyone

Advertisers in web3 may understand wallets. Telegram channel owners may not.

If a poster has to:

1. Install wallet
2. Understand network
3. Add chain
4. Receive USDC
5. Pay gas
6. Withdraw

some will drop off.

### Improvement

Support two balances:

* **On-chain escrow balance** for transparency
* **Virtual in-app balance** for posters

Poster can later withdraw to wallet when ready.

For hackathon, this is acceptable:

> Advertiser deposits on-chain. Poster receives claimable balance. Poster can withdraw to wallet.

---

# Best version of the idea

I would reframe it like this:

## Agentic Escrow Marketplace for Telegram Sponsored Posts

A Telegram bot and web app that lets advertisers buy sponsored posts from opted-in Telegram channels.

Advertisers upload creative content, define budget and duration, and fund escrow. AI helps rewrite the ad, check safety, and generate a clear offer. Registered channel owners receive the offer through the bot and can accept, reject, or counter.

Once accepted, the bot either posts the ad directly to the channel or verifies the channel owner’s post. The system monitors whether the post remains live for the agreed duration. If the conditions are satisfied, escrowed funds are released to the publisher. If not, the advertiser is refunded or the campaign enters dispute.

---

# MVP I would build for hackathon

Do not build everything. Build the most convincing narrow version.

## MVP flow

1. **Poster onboarding**

   * Channel owner starts the bot.
   * Adds bot as admin to their Telegram channel.
   * Registers channel.
   * Sets minimum price and accepted categories.

2. **Advertiser campaign creation**

   * Advertiser opens web UI.
   * Uploads image and text.
   * Chooses a registered channel.
   * Sets duration, budget, and token.
   * Deposits funds into escrow.

3. **AI campaign assistant**

   * Rewrites ad text.
   * Scores content risk.
   * Generates offer message for the channel owner.

4. **Poster approval**

   * Poster receives Telegram offer.
   * Accepts or rejects.
   * Maybe counteroffers.

5. **Posting**

   * Bot posts the approved ad into the channel.
   * Campaign becomes active.

6. **Monitoring**

   * Bot checks whether post still exists.
   * Optionally checks whether it was edited.

7. **Settlement**

   * If post stayed live for required duration, poster can claim payment.
   * If deleted early, advertiser can refund.

This is much more demoable than free-form negotiation with arbitrary users.

---

# What I would remove from the first version

For hackathon, remove these:

## Remove arbitrary username targeting

Too risky. Only allow registered posters.

## Remove video at first

Image + text is enough. Video verification is harder.

## Remove fully autonomous negotiation

Start with structured accept/reject/counter.

## Remove direct post-link submission

Better: bot posts directly or verifies posts in channels where it has access.

## Remove “any Telegram user can be poster”

Start with channels.

---

# Suggested architecture

## Components

**Telegram Bot**
Handles onboarding, offers, approvals, notifications, and channel verification.

**Web UI**
Used by advertisers to create campaigns, upload creatives, choose channels, and fund escrow.

**Backend**
Stores campaigns, users, channel registrations, post metadata, verification logs, AI results.

**AI Agent**
Handles ad rewrite, safety check, offer generation, semantic comparison, negotiation suggestions.

**Smart Contract**
Handles escrow, campaign funding, claim/refund states, and settlement.

**Verifier Service**
Checks Telegram post existence, content, edit status, and duration.

---

# Smart contract states

A clean campaign state machine:

```ts
Draft
Funded
Offered
Accepted
Posted
Active
Completed
Claimed
Refunded
Disputed
Cancelled
```

Main contract actions:

```ts
createCampaign()
fundCampaign()
acceptCampaign()
markPosted()
markCompleted()
claimPayment()
refundAdvertiser()
openDispute()
resolveDispute()
```

For MVP, some actions can be backend-authorized. Later, you can make them more decentralized.

---

# Biggest risk areas

## Risk 1: Spam accusations

Solved by opt-in marketplace.

## Risk 2: Fake verification

Solved partially by bot-admin posting and public verification logs.

## Risk 3: Scam ads

Solved partially by AI safety checks, category restrictions, blocked URLs, and poster approval.

## Risk 4: AI overpromising

Solved by structured offers and bounded negotiation.

## Risk 5: Bad UX for wallets

Solved by virtual balances and optional withdrawal.

## Risk 6: Private channels

Solved by requiring bot access/admin permissions.

---

# Best hackathon pitch

Your current pitch is good, but I would make it sharper:

> We are building an AI-powered escrow marketplace for Telegram ads. Advertisers create a campaign in plain language, upload creative content, choose a registered Telegram channel, and deposit funds into escrow. The AI agent improves the ad, checks it for scam risk, and sends a structured offer to the channel owner. If the owner accepts, the bot publishes or verifies the sponsored post and monitors whether it stays live for the agreed duration. Once the conditions are satisfied, the smart contract releases payment automatically. This removes manual negotiation, reduces scams, and gives both advertisers and publishers a safer way to run direct ads.

That is much stronger.

---

# Final verdict

I would pursue this idea, but only with these changes:

1. **Opt-in posters only**
2. **Start with Telegram channels, not random users**
3. **Require bot admin access or bot-controlled posting**
4. **Use structured offers, not fully free-form negotiation**
5. **Add content safety checks**
6. **Use smart contract escrow, but admit verification is off-chain**
7. **Add a dispute window**
8. **Start with image + text, not video**
9. **Let posters set prices/categories**
10. **Make the MVP marketplace-based, not cold-DM-based**

The strongest product is not “AI messages anyone and negotiates ads.”

The strongest product is:

> **A safe, escrow-backed, AI-assisted marketplace for sponsored Telegram posts.**

[1]: https://telegram.org/faq_spam?utm_source=chatgpt.com "Spam FAQ"
[2]: https://core.telegram.org/bots/api?utm_source=chatgpt.com "Telegram Bot API"
[3]: https://telegram.org/tos?utm_source=chatgpt.com "Terms of Service"



But what if poster has no wallet yet?

This is the important part.

Telegram users may not have wallets. So you need an identity system.

You have two main choices.

Choice A: Require poster wallet before accepting ads

This is simplest.

During onboarding:

Poster starts Telegram bot.
Poster connects wallet.
Backend links Telegram ID to wallet address.
Poster accepts campaigns.
Contract uses their wallet address as the poster address.
Earnings go to claimableBalance[wallet].

---

Choice B: Let poster earn before connecting wallet

This is more user-friendly but more complex.

Poster can accept campaigns before connecting a wallet.

In this case, your backend tracks:

telegramUserId -> pending earnings

But the smart contract cannot pay a Telegram ID. It only understands addresses.

So you need a temporary holding model.

There are two ways.


Version B2: Use an embedded wallet

This is smoother.

When poster signs up through Telegram, you create an embedded wallet for them using something like account abstraction / social login wallet infrastructure.

Then every poster has an address from the beginning, even if they do not understand crypto yet.

The flow becomes:

Poster starts bot.
System creates or links an embedded wallet.
Contract credits earnings to that wallet.
Poster can later export/connect/withdraw.

This is good UX but more integration work.

For hackathon, it may be too much unless the event provides wallet infra.

Recommended hackathon version

Use this:

Posters must connect a wallet before they can accept campaigns, but they do not need to withdraw after every campaign. Their earnings accumulate as a claimable balance in the escrow contract.

That gives you the benefit of virtual balance without becoming fully custodial.