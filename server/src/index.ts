import { startTelegramLongPollingBot } from './adapters/telegram/longPollingBot';
import { createRuntime } from './app';
import { config } from './config';

void bootstrap();

async function bootstrap() {
  const { app, useCases, close } = await createRuntime();
  let shuttingDown = false;
  let telegramBot: ReturnType<typeof startTelegramLongPollingBot> | null = null;

  const server = app.listen(config.port, () => {
    console.log(`[server]: Server is running at http://localhost:${config.port}`);

    if (config.telegramBotMode === 'polling') {
      telegramBot = startTelegramLongPollingBot(config, useCases);
    }
  });

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server]: received ${signal}, shutting down...`);
    telegramBot?.stop();
    server.close();
    await close();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
