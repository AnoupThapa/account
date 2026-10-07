/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requestId } from './common/request-id';
import { config } from './config';
import { DatabaseService } from './common/database.service';
import { loadBsCalendarFromDb } from './modules/settings/settings.controller';

export async function createApp(): Promise<INestApplication> {
  const cfg = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: cfg.NODE_ENV === 'test' ? false : ['error', 'warn'] });
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: cfg.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.enableCors({ origin: cfg.WEB_ORIGIN, credentials: true });
  await loadBsCalendarFromDb(app.get(DatabaseService)).catch(() => undefined);
  return app;
}
