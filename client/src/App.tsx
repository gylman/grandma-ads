import { useEffect, useMemo, useState } from 'react'
import { erc20Abi, formatUnits, isAddress, parseUnits } from 'viem'
import { useAccount, useConnect, useReadContract, useWriteContract } from 'wagmi'
import './App.css'
import { escrowAbi } from './blockchain/escrowAbi'
import {
  createCampaign,
  createUser,
  getAdEventProof,
  getAdProof,
  getHealth,
  listCampaigns,
  registerChannel,
} from './lib/api'
import type { ApiCampaign, ApiChannel, ApiEventProofResponse, ApiProofResponse } from './lib/api'
import { appConfig } from './lib/config'

const tokenDecimals = 6
const defaultDurationSeconds = 86_400
const zeroAddress = '0x0000000000000000000000000000000000000000' as const

function App() {
  const proofRoute = useMemo(() => parseProofRoute(window.location.pathname), [])

  if (proofRoute) {
    return <ProofPage route={proofRoute} />
  }

  return <DashboardApp />
}

function DashboardApp() {
  const [userId, setUserId] = useState('')
  const [amount, setAmount] = useState('25')
  const [serverOnline, setServerOnline] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('Connect a wallet to begin.')
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([])
  const [channel, setChannel] = useState('@exampleChannel')
  const [registeredChannel, setRegisteredChannel] = useState<ApiChannel | null>(null)
  const [campaignText, setCampaignText] = useState('Try our app today. Simple sponsored posts, escrow-backed payments.')
  const [campaignBudget, setCampaignBudget] = useState('100 USDC')

  const { address, isConnected } = useAccount()
  const { connectors, connectAsync } = useConnect()
  const { writeContractAsync } = useWriteContract()

  const escrowAddress = isAddress(appConfig.escrowContractAddress) ? appConfig.escrowContractAddress : zeroAddress
  const tokenAddress = isAddress(appConfig.usdcTokenAddress) ? appConfig.usdcTokenAddress : zeroAddress
  const contractReady = escrowAddress !== zeroAddress && tokenAddress !== zeroAddress
  const shortAccount = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'

  const {
    data: balance,
    refetch: refetchBalance,
  } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: 'balances',
    args: [address ?? zeroAddress, tokenAddress],
    query: {
      enabled: Boolean(address && contractReady),
    },
  })

  useEffect(() => {
    getHealth().then(setServerOnline).catch(() => setServerOnline(false))
    listCampaigns().then(setCampaigns).catch(() => setCampaigns([]))
  }, [])

  useEffect(() => {
    if (!address) return

    createUser(address)
      .then((response) => {
        const createdUser = response as { user?: { id?: string } }
        setUserId(createdUser.user?.id ?? '')
        setNotice('Wallet connected.')
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Wallet sync failed.'))
  }, [address])

  async function handleConnect() {
    const connector = connectors[0]
    if (!connector) {
      setNotice('No wallet connector found.')
      return
    }

    try {
      setBusy('wallet')
      await connectAsync({ connector })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Wallet connection failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleApprove() {
    if (!address) return

    try {
      setBusy('approve')
      const parsedAmount = parseUnits(amount, tokenDecimals)
      await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [escrowAddress, parsedAmount],
      })
      setNotice('Approval submitted.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Approval failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleDeposit() {
    if (!address) return

    try {
      setBusy('deposit')
      await writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: 'deposit',
        args: [tokenAddress, parseUnits(amount, tokenDecimals)],
      })
      setNotice('Deposit submitted.')
      await refetchBalance()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Deposit failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleWithdraw() {
    if (!address) return

    try {
      setBusy('withdraw')
      await writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: 'withdraw',
        args: [tokenAddress, parseUnits(amount, tokenDecimals)],
      })
      setNotice('Withdrawal submitted.')
      await refetchBalance()
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
    if (!address || !userId) {
      setNotice('Connect a wallet before creating a campaign.')
      return
    }

    try {
      setBusy('campaign')
      const nextCampaign = await createCampaign({
        advertiserUserId: userId,
        advertiserWalletAddress: address,
        amount: campaignBudget,
        durationSeconds: defaultDurationSeconds,
        targetTelegramChannelUsername: channel,
        requestedText: campaignText,
        tokenAddress,
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
          {isConnected ? shortAccount : 'Connect wallet'}
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
          <strong>{balance === undefined ? '0' : formatUnits(balance, tokenDecimals)} USDC</strong>
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
            <button type="button" onClick={handleApprove} disabled={!address || !contractReady || busy === 'approve'}>
              Approve
            </button>
            <button type="button" onClick={handleDeposit} disabled={!address || !contractReady || busy === 'deposit'}>
              Deposit
            </button>
            <button type="button" onClick={handleWithdraw} disabled={!address || !contractReady || busy === 'withdraw'}>
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
              Channel
              <input value={channel} onChange={(event) => setChannel(event.target.value)} />
            </label>
          </div>
          <label>
            Caption
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
                  <strong>{campaign.onchainCampaignId ? `Ad #${campaign.onchainCampaignId}` : 'Draft ad'}</strong>
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

type ProofRoute = {
  onchainCampaignId: string
  eventType: string | null
}

function parseProofRoute(pathname: string): ProofRoute | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'proof' || parts[1] !== 'ads' || !parts[2]) return null
  return {
    onchainCampaignId: parts[2],
    eventType: parts[3] ?? null,
  }
}

function ProofPage({ route }: { route: ProofRoute }) {
  const [proof, setProof] = useState<ApiProofResponse | ApiEventProofResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const request = route.eventType
      ? getAdEventProof(route.onchainCampaignId, route.eventType)
      : getAdProof(route.onchainCampaignId)

    request
      .then((data) => {
        if (!cancelled) setProof(data)
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Could not load proof.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [route.eventType, route.onchainCampaignId])

  const campaign = proof?.campaign
  const ensRecord = proof?.ensRecord
  const event = isEventProof(proof) ? proof.event : null

  return (
    <main className="app-shell proof-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Ad proof</p>
          <h1>{route.eventType ? `${capitalize(route.eventType)} proof` : `Ad #${route.onchainCampaignId}`}</h1>
        </div>
      </header>

      {loading ? <section className="panel proof-panel"><p>Loading proof...</p></section> : null}
      {error ? <section className="panel proof-panel"><p>{error}</p></section> : null}

      {!loading && !error && campaign ? (
        <section className="workspace proof-workspace">
          <section className="panel proof-panel">
            <h2>Overview</h2>
            <div className="proof-grid">
              <ProofItem label="Ad" value={`#${campaign.onchainCampaignId ?? route.onchainCampaignId}`} />
              <ProofItem label="Status" value={campaign.status} />
              <ProofItem label="Amount" value={campaign.amount} />
              <ProofItem label="Channel" value={campaign.targetTelegramChannelUsername ?? 'Not set'} />
              <ProofItem label="Duration" value={formatDuration(campaign.durationSeconds)} />
              <ProofItem label="ENS name" value={campaign.ensName ?? 'Not assigned'} />
            </div>
          </section>

          {event ? (
            <section className="panel proof-panel">
              <h2>Event</h2>
              <div className="proof-grid">
                <ProofItem label="Type" value={event.type} />
                <ProofItem label="ENS event" value={event.name} />
                <ProofItem label="Timestamp" value={event.textRecords['com.ethy-ads.timestamp'] ?? formatDate(event.createdAt)} />
                <ProofItem label="Verifier" value={event.agentEnsName} />
                <ProofItem label="Transaction" value={event.txHash ?? 'Not recorded'} mono />
              </div>
            </section>
          ) : null}

          {ensRecord ? (
            <section className="panel proof-panel">
              <h2>ENS records</h2>
              <div className="proof-records">
                {Object.entries(ensRecord.textRecords).map(([key, value]) => (
                  <div key={key} className="record-row">
                    <span>{key}</span>
                    <strong>{value || '—'}</strong>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {campaign.submittedPostUrl ? (
            <section className="panel proof-panel">
              <h2>Published post</h2>
              <p>
                <a href={campaign.submittedPostUrl} target="_blank" rel="noreferrer">
                  Open Telegram post
                </a>
              </p>
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}

function ProofItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="proof-item">
      <span>{label}</span>
      <strong className={mono ? 'mono' : undefined}>{value}</strong>
    </div>
  )
}

function isEventProof(value: ApiProofResponse | ApiEventProofResponse | null): value is ApiEventProofResponse {
  return Boolean(value && 'event' in value)
}

function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400} day${durationSeconds === 86_400 ? '' : 's'}`
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600} hour${durationSeconds === 3_600 ? '' : 's'}`
  if (durationSeconds % 60 === 0) return `${durationSeconds / 60} minute${durationSeconds === 60 ? '' : 's'}`
  return `${durationSeconds} seconds`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

export default App
