import express, { Express } from 'express';
import { apiRouter } from './api/routes';
import { config } from './config';

const app: Express = express();

app.use(express.json());
app.use(apiRouter);

app.get('/', (_req, res) => {
  res.json({ message: 'Grandma Ads server', health: '/health' });
});

app.listen(config.port, () => {
  console.log(`[server]: Server is running at http://localhost:${config.port}`);
});
