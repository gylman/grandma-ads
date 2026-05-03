# Ethy Ads 90-Second Script

Hi, I’m presenting Ethy Ads: AI Telegram ad booking with ENS proof identities and on-chain escrow.

The problem is that Telegram ads still happen like side deals. Advertisers have to find channel owners, DM them, negotiate manually, trust the post will stay live, and usually pay through informal or centralized rails. Publishers have the opposite risk: the ad may go live and they may still not get paid.

Ethy Ads turns that into a structured flow. An advertiser creates a campaign, locks funds in a Solidity escrow contract, and sends an offer to a Telegram channel owner. The publisher accepts, then the bot publishes the exact approved ad in the channel. Our server verifies the channel, content, and timing. If the post stays valid, the publisher is paid. If it fails, the advertiser is refunded.

The special part is ENS. We use ENS as the identity and proof layer, not just as a pretty name. Users, AI agents, ads, and lifecycle events get readable ENS names like `verifier.ethy-ads.eth`, `7.ad.ethy-ads.eth`, and `locked.7.ad.ethy-ads.eth`. Through CCIP-read, those names resolve to live records: status, channel, amount, participants, verifier agent, timestamp, and transaction hash.

We also used Dynamic’s Telegram bot starter and Dynamic server wallets for the dev flow, then expanded it with escrow, AI campaign helpers, verification, proof pages, and ENS records.

The result is simple: advertisers pay only for verified delivery, and publishers know the money is already locked before the bot posts.
