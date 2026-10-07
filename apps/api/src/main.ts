/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { createApp } from './bootstrap';
import { config } from './config';
import { logger } from './common/logger';

createApp()
  .then(async (app) => {
    await app.listen(config().API_PORT);
    logger.info({ port: config().API_PORT }, 'LedgerPro API listening');
  })
  .catch((e) => {
    logger.error({ err: e }, 'API failed to start');
    process.exit(1);
  });
