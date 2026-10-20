import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { setupApp } from './app/app.setup';

async function bootstrap(): Promise<void> {
  // Kein Request-Logging: Logs enthalten keine personenbezogenen Daten.
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  setupApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env['API_PORT'] ?? 3000);
  await app.listen(port);
  Logger.log(`API läuft auf Port ${port}`, 'Bootstrap');
}

void bootstrap();
