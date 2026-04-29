import express, { Express } from 'express';
import { createHttpRouter } from './adapters/http/routes';
import { createViemBlockchainGateway } from './adapters/blockchain/viem/viemBlockchainGateway';
import { createInMemoryRepositories } from './adapters/persistence/inMemoryRepositories';
import { config } from './config';
import { createAppUseCases } from './application/useCases/createAppUseCases';

export function createApp(): Express {
  const repositories = createInMemoryRepositories();
  const blockchain = createViemBlockchainGateway(config);
  const useCases = createAppUseCases({ ...repositories, blockchain });

  const app = express();
  app.use(express.json());
  app.use(createHttpRouter(useCases, config));

  app.get('/', (_req, res) => {
    res.json({ message: 'Grandma Ads server', health: '/health' });
  });

  return app;
}
