import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpAdapterHost } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** Gemeinsame Einrichtung für Start und Tests. */
export function setupApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.setGlobalPrefix('api');
  express.disable('x-powered-by');
  // Hinter dem Ingress im Cluster: Anzahl vertrauenswürdiger Proxys für die Client-IP im Rate-Limit.
  express.set('trust proxy', Number(process.env['TRUST_PROXY_HOPS'] ?? 0));
  express.use(cookieParser());
  express.useGlobalFilters(new AllExceptionsFilter(express.get(HttpAdapterHost).httpAdapter));
  express.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );
}
