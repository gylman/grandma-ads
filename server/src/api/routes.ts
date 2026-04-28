import { Router } from 'express';
import { config } from '../config';
import { checkContentSafety } from '../domain/moderation';
import { extractCampaignIntake, generatePosterOffer } from '../services/agentService';
import {
  advanceCampaign,
  createDraftCampaign,
  getCampaign,
  getUserByWallet,
  listCampaigns,
  listChannels,
  registerChannel,
  submitPostForVerification,
  updateChannelStatus,
  upsertUser,
} from '../services/store';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'grandma-ads-server' });
});

apiRouter.get('/api/me', (req, res) => {
  const walletAddress = String(req.query.walletAddress ?? '');
  if (!walletAddress) {
    res.status(400).json({ error: 'walletAddress is required' });
    return;
  }

  res.json({ user: getUserByWallet(walletAddress) });
});

apiRouter.post('/api/users', (req, res) => {
  const walletAddress = typeof req.body.walletAddress === 'string' ? req.body.walletAddress : '';
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: 'A valid walletAddress is required' });
    return;
  }

  res.status(201).json({
    user: upsertUser({
      walletAddress,
      telegramUserId: req.body.telegramUserId ?? null,
      telegramUsername: req.body.telegramUsername ?? null,
    }),
  });
});

apiRouter.get('/api/balances', (req, res) => {
  const walletAddress = String(req.query.walletAddress ?? '');
  res.json({
    walletAddress,
    tokenAddress: config.usdcTokenAddress,
    available: '0',
    locked: '0',
    pendingEarnings: '0',
    source: 'contract-read-pending',
  });
});

apiRouter.post('/api/channels', (req, res) => {
  const ownerUserId = typeof req.body.ownerUserId === 'string' ? req.body.ownerUserId : '';
  const telegramChannelUsername = typeof req.body.telegramChannelUsername === 'string' ? req.body.telegramChannelUsername : '';

  if (!ownerUserId || !telegramChannelUsername) {
    res.status(400).json({ error: 'ownerUserId and telegramChannelUsername are required' });
    return;
  }

  res.status(201).json({ channel: registerChannel({ ownerUserId, telegramChannelUsername }) });
});

apiRouter.get('/api/channels', (req, res) => {
  const ownerUserId = typeof req.query.ownerUserId === 'string' ? req.query.ownerUserId : undefined;
  res.json({ channels: listChannels(ownerUserId) });
});

apiRouter.post('/api/channels/:id/verify', (req, res) => {
  const postUrl = typeof req.body.postUrl === 'string' ? req.body.postUrl : undefined;
  res.json({ channel: updateChannelStatus(req.params.id, 'VERIFIED', postUrl) });
});

apiRouter.post('/api/agent/intake', (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message : '';
  res.json({ intake: extractCampaignIntake(message), safety: checkContentSafety(message) });
});

apiRouter.post('/api/campaigns', (req, res) => {
  const advertiserUserId = typeof req.body.advertiserUserId === 'string' ? req.body.advertiserUserId : '';
  const advertiserWalletAddress = typeof req.body.advertiserWalletAddress === 'string' ? req.body.advertiserWalletAddress : '';
  const amount = typeof req.body.amount === 'string' ? req.body.amount : '';
  const durationSeconds = Number(req.body.durationSeconds);
  const requestedText = typeof req.body.requestedText === 'string' ? req.body.requestedText : null;

  if (!advertiserUserId || !/^0x[a-fA-F0-9]{40}$/.test(advertiserWalletAddress) || !amount || !durationSeconds) {
    res.status(400).json({ error: 'advertiserUserId, advertiserWalletAddress, amount, and durationSeconds are required' });
    return;
  }

  const safety = checkContentSafety(requestedText);
  if (!safety.allowed) {
    res.status(422).json({ error: 'Campaign content is blocked', safety });
    return;
  }

  const campaign = createDraftCampaign({
    id: 'ignored',
    advertiserUserId,
    advertiserWalletAddress,
    tokenAddress: req.body.tokenAddress ?? config.usdcTokenAddress,
    amount,
    durationSeconds,
    targetTelegramChannelUsername: req.body.targetTelegramChannelUsername ?? null,
    requestedText,
    requestedImageUrl: req.body.requestedImageUrl ?? null,
    requestedImageHash: req.body.requestedImageHash ?? null,
  });

  res.status(201).json({ campaign });
});

apiRouter.get('/api/campaigns', (_req, res) => {
  res.json({ campaigns: listCampaigns() });
});

apiRouter.get('/api/campaigns/:id', (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  res.json({ campaign });
});

apiRouter.post('/api/campaigns/:id/transition', (req, res) => {
  try {
    res.json({ campaign: advanceCampaign(req.params.id, req.body.status) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid transition' });
  }
});

apiRouter.post('/api/campaigns/:id/offer-preview', (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  res.json({ message: generatePosterOffer(campaign) });
});

apiRouter.post('/api/campaigns/:id/submit-post', (req, res) => {
  try {
    const submittedPostUrl = typeof req.body.submittedPostUrl === 'string' ? req.body.submittedPostUrl : '';
    if (!submittedPostUrl) {
      res.status(400).json({ error: 'submittedPostUrl is required' });
      return;
    }

    res.json(
      submitPostForVerification({
        campaignId: req.params.id,
        submittedPostUrl,
        observedText: req.body.observedText ?? null,
        observedImageHash: req.body.observedImageHash ?? null,
      }),
    );
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Post verification failed' });
  }
});
