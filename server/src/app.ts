import express, { Express } from 'express';
import { createHttpRouter } from './adapters/http/routes';
import { createViemBlockchainGateway } from './adapters/blockchain/viem/viemBlockchainGateway';
import { createInMemoryRepositories } from './adapters/persistence/inMemoryRepositories';
import { config } from './config';
import { createAppUseCases } from './application/useCases/createAppUseCases';

export function createApp(): Express {
  return createRuntime().app;
}

export function createRuntime() {
  const repositories = createInMemoryRepositories();
  const blockchain = createViemBlockchainGateway(config);
  const useCases = createAppUseCases({ ...repositories, blockchain });

  const app = express();
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = new Set([config.clientUrl, 'http://localhost:5173', 'http://127.0.0.1:5173']);

    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });
  app.use(express.json());
  app.use(createHttpRouter(useCases, config));

  app.get('/', (_req, res) => {
    res.json({ message: 'Grandma Ads server', health: '/health' });
  });

  return { app, useCases };
}
