import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { getAdEventProof, getAdProof } from './lib/api'
import type { ApiCampaign, ApiEnsEvent, ApiEventProofResponse, ApiProofResponse } from './lib/api'
import { appConfig } from './lib/config'

type ProofRoute = {
  onchainCampaignId: string
  eventType: string | null
}

type ProofRecord = {
  key: string
  label: string
  value: string
  href?: string
}

const recordLabels: Record<string, string> = {
  'com.ethy-ads.kind': 'Kind',
  'com.ethy-ads.ad-id': 'Ad ID',
  'com.ethy-ads.status': 'Status',
  'com.ethy-ads.channel': 'Channel',
  'com.ethy-ads.amount': 'Amount',
  'com.ethy-ads.token': 'Token',
  'com.ethy-ads.duration-seconds': 'Duration',
  'com.ethy-ads.advertiser': 'Advertiser',
  'com.ethy-ads.poster': 'Publisher',
  'com.ethy-ads.created-at': 'Created at',
  'com.ethy-ads.updated-at': 'Updated at',
  'com.ethy-ads.latest-event': 'Latest event',
  'com.ethy-ads.latest-tx-hash': 'Latest transaction',
  'com.ethy-ads.event': 'Event',
  'com.ethy-ads.ad': 'Ad ENS name',
  'com.ethy-ads.tx-hash': 'Transaction',
  'com.ethy-ads.agent': 'Agent',
  'com.ethy-ads.timestamp': 'Timestamp',
}

function App() {
  const proofRoute = useMemo(() => parseProofRoute(window.location.pathname), [])
  return proofRoute ? <ProofPage route={proofRoute} /> : <HomePage />
}

function HomePage() {
  const botLink = appConfig.telegramBotUsername ? `https://t.me/${appConfig.telegramBotUsername}` : null

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Telegram ad escrow</p>
        <h1>Grandma Ads makes Telegram sponsorships legible, escrow-backed, and inspectable.</h1>
        <p className="hero-copy">
          Advertisers lock funds before a post goes live. Publishers know the money is already committed. When the ad
          survives the agreed duration, payout is released. If it fails verification, funds return.
        </p>
        <div className="hero-actions">
          {botLink ? (
            <a className="button-link" href={botLink} target="_blank" rel="noreferrer">
              Open Telegram bot
            </a>
          ) : null}
          <a className="button-link secondary" href={`${appConfig.serverUrl}/api/ens/records`} target="_blank" rel="noreferrer">
            View ENS records API
          </a>
        </div>
      </section>

      <section className="feature-grid">
        <article className="panel">
          <h2>What the product does</h2>
          <p>
            The bot handles intake, negotiation, posting coordination, and status updates. The onchain escrow contract
            handles deposits, locking, settlement, refund, and withdrawal logic.
          </p>
        </article>

        <article className="panel">
          <h2>How ENS is involved</h2>
          <p>
            ENS is the identity and proof layer. Each funded ad gets a readable ENS name like <code>7.ad.ethy-ads.eth</code>,
            and each lifecycle milestone gets its own proof name such as <code>locked.7.ad.ethy-ads.eth</code> or{' '}
            <code>completed.7.ad.ethy-ads.eth</code>.
          </p>
        </article>

        <article className="panel">
          <h2>What a proof page shows</h2>
          <p>
            Current ad state, lifecycle records, ENS metadata, and Etherscan links for the onchain transaction that
            locked, started, completed, or refunded the ad.
          </p>
        </article>
      </section>
    </main>
  )
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

  const campaign = proof?.campaign ?? null
  const ensRecord = proof?.ensRecord ?? null
  const event = isEventProof(proof) ? proof.event : null

  return (
    <main className="app-shell proof-shell">
      <header className="topbar proof-topbar">
        <div>
          <p className="eyebrow">Onchain ad proof</p>
          <h1>{route.eventType ? `${capitalize(route.eventType)} proof` : `Ad #${route.onchainCampaignId}`}</h1>
          <p className="hero-copy">
            This page is public and non-personalized. It exists to explain the state of a funded ad and the proofs tied
            to it.
          </p>
        </div>
        <a className="button-link secondary" href="/">
          Back to overview
        </a>
      </header>

      {loading ? <section className="panel proof-panel"><p>Loading proof...</p></section> : null}
      {error ? <section className="panel proof-panel"><p>{error}</p></section> : null}

      {!loading && !error && campaign ? (
        <section className="proof-layout">
          <section className="panel proof-panel">
            <h2>Overview</h2>
            <div className="proof-grid">
              <ProofItem label="Ad" value={`#${campaign.onchainCampaignId ?? route.onchainCampaignId}`} />
              <ProofItem label="Status" value={campaign.status} />
              <ProofItem label="Amount" value={`${campaign.amount} ${tokenLabel(campaign)}`} />
              <ProofItem label="Channel" value={campaign.targetTelegramChannelUsername ?? 'Not set'} />
              <ProofItem label="Duration" value={formatDuration(campaign.durationSeconds)} />
              <ProofItem label="ENS name" value={campaign.ensName ?? 'Not assigned'} mono />
            </div>
          </section>

          {event ? (
            <section className="panel proof-panel">
              <h2>Event proof</h2>
              <div className="proof-grid">
                <ProofItem label="Type" value={event.type} />
                <ProofItem label="ENS event" value={event.name} mono />
                <ProofItem label="Timestamp" value={event.textRecords['com.ethy-ads.timestamp'] ?? formatDate(event.createdAt)} />
                <ProofItem label="Agent" value={event.agentEnsName} mono />
                <ProofItem
                  label="Transaction"
                  value={shortHash(event.txHash)}
                  href={event.txHash ? explorerTxUrl(event.txHash) : undefined}
                />
              </div>
            </section>
          ) : (
            <section className="panel proof-panel">
              <h2>Lifecycle proofs</h2>
              <div className="proof-list">
                {(campaign.ensEvents ?? []).length === 0 ? (
                  <p>No lifecycle proofs have been recorded yet.</p>
                ) : (
                  sortEvents(campaign.ensEvents ?? []).map((item) => (
                    <article key={item.name} className="proof-list-item">
                      <div>
                        <strong>{eventTitle(item.type)}</strong>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <div className="proof-links">
                        <a href={`/proof/ads/${campaign.onchainCampaignId ?? route.onchainCampaignId}/${item.type.toLowerCase()}`}>View proof</a>
                        {item.txHash ? (
                          <a href={explorerTxUrl(item.txHash)} target="_blank" rel="noreferrer">
                            View transaction
                          </a>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {ensRecord ? (
            <section className="panel proof-panel">
              <h2>ENS records</h2>
              <div className="proof-records">
                {formatRecords(ensRecord.textRecords).map((record) => (
                  <div key={record.key} className="record-row">
                    <span>{record.label}</span>
                    {record.href ? (
                      <a href={record.href} target="_blank" rel="noreferrer">
                        {record.value}
                      </a>
                    ) : (
                      <strong className={record.value.includes('.eth') ? 'mono' : undefined}>{record.value}</strong>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}

function parseProofRoute(pathname: string): ProofRoute | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'proof' || parts[1] !== 'ads' || !parts[2]) return null
  return {
    onchainCampaignId: parts[2],
    eventType: parts[3] ?? null,
  }
}

function ProofItem({ label, value, mono = false, href }: { label: string; value: string; mono?: boolean; href?: string }) {
  return (
    <div className="proof-item">
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={mono ? 'mono' : undefined}>
          {value}
        </a>
      ) : (
        <strong className={mono ? 'mono' : undefined}>{value}</strong>
      )}
    </div>
  )
}

function formatRecords(textRecords: Record<string, string>): ProofRecord[] {
  return Object.entries(textRecords)
    .filter(([, value]) => value.trim() !== '')
    .map(([key, value]) => ({
      key,
      label: recordLabels[key] ?? key,
      value: key.includes('timestamp') || key.endsWith('created-at') || key.endsWith('updated-at') ? formatDate(value) : value,
      href: key.includes('tx-hash') ? explorerTxUrl(value) : undefined,
    }))
}

function sortEvents(events: ApiEnsEvent[]): ApiEnsEvent[] {
  const order = ['LOCKED', 'STARTED', 'COMPLETED', 'REFUNDED', 'VERIFIED']
  return [...events].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function isEventProof(value: ApiProofResponse | ApiEventProofResponse | null): value is ApiEventProofResponse {
  return Boolean(value && 'event' in value)
}

function tokenLabel(campaign: ApiCampaign): string {
  if (!campaign.tokenAddress) return 'tokens'
  if (campaign.tokenAddress.toLowerCase() === appConfig.usdcTokenAddress.toLowerCase()) return 'USDC'
  return shortHash(campaign.tokenAddress)
}

function eventTitle(type: string): string {
  switch (type) {
    case 'LOCKED':
      return 'Funding proof'
    case 'STARTED':
      return 'Activation proof'
    case 'COMPLETED':
      return 'Completion proof'
    case 'REFUNDED':
      return 'Refund proof'
    default:
      return `${capitalize(type.toLowerCase())} proof`
  }
}

function explorerTxUrl(txHash: string): string {
  const chainId = String(appConfig.chainId)
  const baseUrl = chainId === '11155111' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io'
  return `${baseUrl}/tx/${txHash}`
}

function shortHash(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  if (value.length < 16) return value
  return `${value.slice(0, 10)}...${value.slice(-8)}`
}

function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400} day${durationSeconds === 86_400 ? '' : 's'}`
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600} hour${durationSeconds === 3_600 ? '' : 's'}`
  if (durationSeconds % 60 === 0) return `${durationSeconds / 60} minute${durationSeconds === 60 ? '' : 's'}`
  return `${durationSeconds} seconds`
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString()
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default App
