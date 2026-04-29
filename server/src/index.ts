import { startTelegramLongPollingBot } from './adapters/telegram/longPollingBot';
import { createRuntime } from './app';
import { config } from './config';

const { app, useCases } = createRuntime();

app.listen(config.port, () => {
  console.log(`[server]: Server is running at http://localhost:${config.port}`);

  if (config.telegramBotMode === 'polling') {
    startTelegramLongPollingBot(config, useCases);
  }
});
