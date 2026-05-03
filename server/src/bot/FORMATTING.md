Got it — this time I will **keep ALL your instructions**, just make them readable, structured, and clear. Nothing removed, nothing “product-decided away”. Only formatting + English cleanup.

---

## 🔧 Instruction 1 — Channel Input Formatting

You mentioned:

* No break line
* Replace `@username` with `https://t.me/...`
* Make readable English

### Current:

```
Reply to this message with the channel username you want to register.
Example: @exampleChannel
```

### Improved (readable, same meaning):

```
Reply to this message with the channel link you want to register.

Example:
https://t.me/exampleChannel
```

---

## 🔧 Instruction 2 — Channel Registration Message

You mentioned:

* Needs line breaks
* Code should be copyable
* Better formatting

### Current:

```
Channel registration created for @openagents2026.
Verification code: AD_VERIFY_DY9LBS_557A5C

Post this exact code in the channel.
I will verify it there and delete the verification post right away.
```

### Improved:

```
Channel registration created for:
https://t.me/openagents2026

Verification code:
`AD_VERIFY_DY9LBS_557A5C`

Post this exact code in the channel.

I will verify it there and delete the verification post right away.
```

---

## 🔧 Instruction 3 — Ad Creation Prompt

You mentioned:

* Needs spacing
* Replace @ with link
* Improve English readability

### Current:

```
Tell me about the ad you want to run.

You can write it naturally. I just need the channel, price, currency, how long the post should stay up, and the caption. You can include the image.

I will draft the first version, then we can tune the wording before anything is sent.

For example:
Promote Grandma Ads on @openagents2026 for 100 USDC for 24 hours. Caption: Sponsored posts with escrow, without spreadsheets
```

### Improved:

```
Tell me about the ad you want to run.

You can write it naturally. I just need:
- Channel (link)
- Price
- Currency
- Duration (how long the post should stay up)
- Caption

You can also include an image.

I will draft the first version, then we can tune the wording before anything is sent.

Example:
Promote Grandma Ads on https://t.me/openagents2026 for 100 USDC for 24 hours.
Caption: Sponsored posts with escrow, without spreadsheets
```

---

## 🔧 Instruction 4 — Wallet Display

You mentioned:

* Looks ugly
* Needs structure
* Show Wallet / Available / Locked clearly
* Emojis allowed

### Current:

```
Wallet: 0xF9a464411Cdf33a9Ecd0d342a714B777bD3b53F1

Balances:
ETH: wallet 0
USDC: wallet 0, available in escrow 990
```

### Improved:

```
👛 Wallet:
0xF9a464411Cdf33a9Ecd0d342a714B777bD3b53F1

💰 Balances:

ETH
- Wallet: 0

USDC
- Wallet: 0
- Available in escrow: 990
- Locked in escrow: 0
```

---

## 🔧 Instruction 5 — Channel Verified Message

You mentioned:

* Replace @ with link
* Add human explanation about notifications

### Current:

```
Channel verified: @openagents2026
```

### Improved:

```
Channel verified:
https://t.me/openagents2026

You will be notified if someone wants to run ads on your channel.
```

---

## 🔧 Instruction 6 — Start Message (User Instruction)

You said:

* Should explain bot simply
* Buttons below (Create Campaign, Register Channel, etc.)

### Improved:

```
Welcome.

This bot helps you create and manage advertisement campaigns with escrow.

How it works:
- Register your channel
- Create a campaign
- Fund it
- Run ads safely

Choose an option below.
```

(Buttons remain as you specified)

---

## 🔧 Instruction 7 — Campaign Draft

You mentioned formatting issues

### Current:

```
Campaign draft created.

Draft ad: 100 for @openagents2026
Token: 0x8D63feBD585fDB7e6bcb7a551Ed3dC4AC00d9aB0
Duration: 120s
Status: DRAFT
```

### Improved:

```
Campaign draft created.

Channel:
https://t.me/openagents2026

Price:
100

Token:
0x8D63feBD585fDB7e6bcb7a551Ed3dC4AC00d9aB0

Duration:
120 seconds

Status:
DRAFT
```

---

## 🔧 Instruction 8 — Wallet Flow (Duplicate + Cleanup)

You mentioned:

* Message sent twice
* Remove provider mention
* Possibly hide hex address (noted, not removed here unless explicit)
* Remove “Wallet actions”

### Cleaned version (same content, readable, no duplication):

```
The campaign draft is ready.

Before I can send it to the publisher, we need a wallet for the funded offer.

Click "Create Wallet", add funds, then send the offer again.
```

```
Wallet created.

ENS:
that0ne9uy.user.ethy-ads.eth

Address:
0xAe1644b89B37E20F6D00eAe722f5f5a8e65c61e4
```

```
Wallet:
0xAe1644b89B37E20F6D00eAe722f5f5a8e65c61e4

Balances:

ETH
- Wallet: 0

No USDC, USDT, DAI, or WBTC balance found yet.

Send one of those tokens to the wallet, then click "Check Balance".
```

---

## 🔧 Instruction 9 — Deposit Input

### Current:

```
Reply with amount and token.
Example: 1000 USDC or 1000 USDT
```

### Improved:

```
Reply with the amount and token.

Examples:
1000 USDC
1000 USDT
```

---

## 🔧 Instruction 10 — Processing Message

### Current:

```
Processing...
```

### Improved:

```
⏳ Processing...
```

---

## 🔧 Instruction 11 — Mint + Balance Update

### Current:

(messy combined log)

### Improved:

```
Mint complete.

Amount:
1000 USDC

Wallet:
0xAe1644b89B37E20F6D00eAe722f5f5a8e65c61e4

View transaction:
https://sepolia.etherscan.io/tx/0xf9f9c4ec1ccd03697558f5f7686b251af589b1ecea87ca5e4c28f5ba7fe4ab5a
```

```
Balance updated.

Wallet:
0xAe1644b89B37E20F6D00eAe722f5f5a8e65c61e4

ETH
- Wallet: 0

USDC
- Wallet: 1000
- Available in escrow: 0
- Locked in escrow: 0
```

---

## 🔧 Instruction 12 — Remove “Check Balance” Button

Your instruction:

> no need Check Balance button if followed by balance update

✔️ Kept as instruction, not altered in text.

---

## 🔧 Instruction 13 — Balance Message Buttons

Your instruction:

> Balance message should always have:

* Mint
* Deposit
* Withdraw

✔️ Preserved as instruction.

---

## 🔧 Instruction 14 — Remove Gas Mention

### Current:

```
Deposited 500 mock USDC into escrow with a gasless relay.
```

### Improved:

```
Deposited 500 USDC into escrow.
```

---

## 🔧 Instruction 15 — Remove “Wallet Actions” + Provider

✔️ Preserved as instruction
✔️ Already removed in cleaned text

---

Also, even tho the negotiations go in a human readable way, normal english. When the 'Accept' button is clicked by either of the sides and the contract sets Active bot sides should have the receipt. And that receipt should not include signature or anything:

Just essential stuff: The ad id, target channel, advertiser's ens, teh duration, currency, ammount, caption, image.
In fact you can send this after any of the following, such as: Funded, Completed, etc.
