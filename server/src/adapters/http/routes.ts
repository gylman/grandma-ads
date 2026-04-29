import { Router } from 'express';
import { AppConfig } from '../../config';
import { AppUseCases } from '../../application/useCases/createAppUseCases';

export function createHttpRouter(useCases: AppUseCases, config: AppConfig): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json(useCases.health());
  });

  router.get('/api/me', (req, res) => {
    const walletAddress = String(req.query.walletAddress ?? '');
    if (!walletAddress) {
      res.status(400).json({ error: 'walletAddress is required' });
      return;
    }

    res.json({ user: useCases.getUserByWallet(walletAddress) });
  });

  router.post('/api/users', (req, res) => {
    const walletAddress = typeof req.body.walletAddress === 'string' ? req.body.walletAddress : '';
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: 'A valid walletAddress is required' });
      return;
    }

    res.status(201).json({
      user: useCases.upsertUser({
        walletAddress,
        telegramUserId: req.body.telegramUserId ?? null,
        telegramUsername: req.body.telegramUsername ?? null,
      }),
    });
  });

  router.get('/api/balances', async (req, res, next) => {
    try {
      const walletAddress = String(req.query.walletAddress ?? '');
      res.json(await useCases.getBalance(walletAddress, config.usdcTokenAddress));
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/channels', (req, res) => {
    const ownerUserId = typeof req.body.ownerUserId === 'string' ? req.body.ownerUserId : '';
    const telegramChannelUsername = typeof req.body.telegramChannelUsername === 'string' ? req.body.telegramChannelUsername : '';

    if (!ownerUserId || !telegramChannelUsername) {
      res.status(400).json({ error: 'ownerUserId and telegramChannelUsername are required' });
      return;
    }

    res.status(201).json({ channel: useCases.registerChannel({ ownerUserId, telegramChannelUsername }) });
  });

  router.get('/api/channels', (req, res) => {
    const ownerUserId = typeof req.query.ownerUserId === 'string' ? req.query.ownerUserId : undefined;
    res.json({ channels: useCases.listChannels(ownerUserId) });
  });

  router.post('/api/channels/:id/verify', (req, res) => {
    const postUrl = typeof req.body.postUrl === 'string' ? req.body.postUrl : undefined;
    res.json({ channel: useCases.verifyChannel(req.params.id, postUrl) });
  });

  router.post('/api/agent/intake', (req, res) => {
    const message = typeof req.body.message === 'string' ? req.body.message : '';
    res.json(useCases.extractCampaignIntake(message));
  });

  router.post('/api/campaigns', (req, res) => {
    const advertiserUserId = typeof req.body.advertiserUserId === 'string' ? req.body.advertiserUserId : '';
    const advertiserWalletAddress = typeof req.body.advertiserWalletAddress === 'string' ? req.body.advertiserWalletAddress : '';
    const amount = typeof req.body.amount === 'string' ? req.body.amount : '';
    const durationSeconds = Number(req.body.durationSeconds);
    const requestedText = typeof req.body.requestedText === 'string' ? req.body.requestedText : null;

    if (!advertiserUserId || !/^0x[a-fA-F0-9]{40}$/.test(advertiserWalletAddress) || !amount || !durationSeconds) {
      res.status(400).json({ error: 'advertiserUserId, advertiserWalletAddress, amount, and durationSeconds are required' });
      return;
    }

    try {
      const campaign = useCases.createDraftCampaign({
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
    } catch (error) {
      if (error instanceof Error && error.name === 'ContentBlockedError') {
        res.status(422).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  router.get('/api/campaigns', (_req, res) => {
    res.json({ campaigns: useCases.listCampaigns() });
  });

  router.get('/api/campaigns/:id', (req, res) => {
    const campaign = useCases.getCampaign(req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    res.json({ campaign });
  });

  router.post('/api/campaigns/:id/transition', (req, res) => {
    try {
      res.json({ campaign: useCases.advanceCampaign(req.params.id, req.body.status) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid transition' });
    }
  });

  router.post('/api/campaigns/:id/offer-preview', (req, res) => {
    const message = useCases.generatePosterOffer(req.params.id);
    if (!message) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    res.json({ message });
  });

  router.post('/api/campaigns/:id/submit-post', (req, res) => {
    try {
      const submittedPostUrl = typeof req.body.submittedPostUrl === 'string' ? req.body.submittedPostUrl : '';
      if (!submittedPostUrl) {
        res.status(400).json({ error: 'submittedPostUrl is required' });
        return;
      }

      res.json(
        useCases.submitPostForVerification({
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

  return router;
}
