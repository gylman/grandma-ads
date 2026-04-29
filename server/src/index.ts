import { createApp } from './app';
import { config } from './config';

const app = createApp();

app.listen(config.port, () => {
  console.log(`[server]: Server is running at http://localhost:${config.port}`);
});
