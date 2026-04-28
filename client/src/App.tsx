import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { createCampaign, createUser, getHealth, listCampaigns, registerChannel } from './lib/api'
import type { ApiCampaign, ApiChannel } from './lib/api'
import { appConfig } from './lib/config'
import {
  approveTokenSpend,
  connectWallet,
  depositToEscrow,
  formatUnits,
  getEthereumProvider,
  parseUnits,
  readEscrowBalance,
  withdrawFromEscrow,
} from './lib/contract'

const tokenDecimals = 6
const defaultDurationSeconds = 86_400

function App() {
  const [account, setAccount] = useState('')
  const [userId, setUserId] = useState('')
  const [balance, setBalance] = useState<bigint | null>(null)
  const [amount, setAmount] = useState('25')
  const [serverOnline, setServerOnline] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('Connect a wallet to begin.')
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([])
  const [channel, setChannel] = useState('@exampleChannel')
  const [registeredChannel, setRegisteredChannel] = useState<ApiChannel | null>(null)
  const [campaignText, setCampaignText] = useState('Try our app today. Simple sponsored posts, escrow-backed payments.')
  const [campaignBudget, setCampaignBudget] = useState('100 USDC')

  const provider = useMemo(() => getEthereumProvider(), [])
  const contractReady = Boolean(appConfig.escrowContractAddress && appConfig.usdcTokenAddress)
  const shortAccount = account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Not connected'

  useEffect(() => {
    getHealth().then(setServerOnline).catch(() => setServerOnline(false))
    listCampaigns().then(setCampaigns).catch(() => setCampaigns([]))
  }, [])

  async function handleConnect() {
    if (!provider) {
      setNotice('No injected wallet found.')
      return
    }

    try {
      setBusy('wallet')
      const wallet = await connectWallet(provider)
      const response = await createUser(wallet)
      const createdUser = response as { user?: { id?: string } }
      setAccount(wallet)
      setUserId(createdUser.user?.id ?? '')
      setNotice('Wallet connected.')
      await refreshBalance(wallet)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Wallet connection failed.')
    } finally {
      setBusy('')
    }
  }

  async function refreshBalance(wallet = account) {
    if (!provider || !wallet || !contractReady) return

    const current = await readEscrowBalance({
      provider,
      escrowAddress: appConfig.escrowContractAddress,
      userAddress: wallet,
      tokenAddress: appConfig.usdcTokenAddress,
    })
    setBalance(current)
  }

  async function handleApprove() {
    if (!provider || !account) return

    try {
      setBusy('approve')
      const parsedAmount = parseUnits(amount, tokenDecimals)
      await approveTokenSpend({
        provider,
        from: account,
        tokenAddress: appConfig.usdcTokenAddress,
        spenderAddress: appConfig.escrowContractAddress,
        amount: parsedAmount,
      })
      setNotice('Approval submitted.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Approval failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleDeposit() {
    if (!provider || !account) return

    try {
      setBusy('deposit')
      await depositToEscrow({
        provider,
        from: account,
        escrowAddress: appConfig.escrowContractAddress,
        tokenAddress: appConfig.usdcTokenAddress,
        amount: parseUnits(amount, tokenDecimals),
      })
      setNotice('Deposit submitted.')
      await refreshBalance()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Deposit failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleWithdraw() {
    if (!provider || !account) return

    try {
      setBusy('withdraw')
      await withdrawFromEscrow({
        provider,
        from: account,
        escrowAddress: appConfig.escrowContractAddress,
        tokenAddress: appConfig.usdcTokenAddress,
        amount: parseUnits(amount, tokenDecimals),
      })
      setNotice('Withdrawal submitted.')
      await refreshBalance()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Withdrawal failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleRegisterChannel() {
    if (!userId) {
      setNotice('Connect a wallet before registering a channel.')
      return
    }

    try {
      setBusy('channel')
      const nextChannel = await registerChannel({ ownerUserId: userId, telegramChannelUsername: channel })
      setRegisteredChannel(nextChannel)
      setNotice('Channel verification code created.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Channel registration failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleCreateCampaign() {
    if (!account || !userId) {
      setNotice('Connect a wallet before creating a campaign.')
      return
    }

    try {
      setBusy('campaign')
      const nextCampaign = await createCampaign({
        advertiserUserId: userId,
        advertiserWalletAddress: account,
        amount: campaignBudget,
        durationSeconds: defaultDurationSeconds,
        targetTelegramChannelUsername: channel,
        requestedText: campaignText,
        tokenAddress: appConfig.usdcTokenAddress,
      })
      setCampaigns((current) => [nextCampaign, ...current])
      setNotice('Campaign draft created.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Campaign creation failed.')
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Telegram ad escrow</p>
          <h1>Sponsored posts, locked funds, clear delivery.</h1>
        </div>
        <button type="button" onClick={handleConnect} disabled={busy === 'wallet'}>
          {account ? shortAccount : 'Connect wallet'}
        </button>
      </header>

      <section className="status-strip" aria-live="polite">
        <span className={serverOnline ? 'dot online' : 'dot'}></span>
        <span>{serverOnline ? 'Server online' : 'Server offline'}</span>
        <span>{contractReady ? 'Contract configured' : 'Contract env missing'}</span>
        <span>{notice}</span>
      </section>

      <section className="metrics">
        <article>
          <span>Available balance</span>
          <strong>{balance === null ? '0' : formatUnits(balance, tokenDecimals)} USDC</strong>
        </article>
        <article>
          <span>Locked campaigns</span>
          <strong>{campaigns.filter((campaign) => campaign.status !== 'COMPLETED').length}</strong>
        </article>
        <article>
          <span>Telegram bot</span>
          <strong>{appConfig.telegramBotUsername ? `@${appConfig.telegramBotUsername}` : 'Not set'}</strong>
        </article>
      </section>

      <section className="workspace">
        <form className="panel" onSubmit={(event) => event.preventDefault()}>
          <h2>Wallet</h2>
          <label>
            Amount
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          </label>
          <div className="button-row">
            <button type="button" onClick={handleApprove} disabled={!account || !contractReady || busy === 'approve'}>
              Approve
            </button>
            <button type="button" onClick={handleDeposit} disabled={!account || !contractReady || busy === 'deposit'}>
              Deposit
            </button>
            <button type="button" onClick={handleWithdraw} disabled={!account || !contractReady || busy === 'withdraw'}>
              Withdraw
            </button>
          </div>
        </form>

        <form className="panel" onSubmit={(event) => event.preventDefault()}>
          <h2>Poster channel</h2>
          <label>
            Channel
            <input value={channel} onChange={(event) => setChannel(event.target.value)} />
          </label>
          <button type="button" onClick={handleRegisterChannel} disabled={!userId || busy === 'channel'}>
            Create verification code
          </button>
          {registeredChannel ? (
            <p className="code-line">{registeredChannel.verificationCode}</p>
          ) : null}
        </form>

        <form className="panel wide" onSubmit={(event) => event.preventDefault()}>
          <h2>Campaign</h2>
          <div className="field-grid">
            <label>
              Budget
              <input value={campaignBudget} onChange={(event) => setCampaignBudget(event.target.value)} />
            </label>
            <label>
              Duration
              <input value="24 hours" readOnly />
            </label>
          </div>
          <label>
            Approved text
            <textarea value={campaignText} onChange={(event) => setCampaignText(event.target.value)} />
          </label>
          <button type="button" onClick={handleCreateCampaign} disabled={!userId || busy === 'campaign'}>
            Create campaign draft
          </button>
        </form>

        <section className="panel wide campaign-list">
          <h2>Campaigns</h2>
          {campaigns.length === 0 ? (
            <p>No campaigns yet.</p>
          ) : (
            campaigns.map((campaign) => (
              <article key={campaign.id} className="campaign-row">
                <div>
                  <strong>{campaign.amount}</strong>
                  <span>{campaign.targetTelegramChannelUsername ?? 'No channel'}</span>
                </div>
                <span>{campaign.status}</span>
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  )
}

export default App
