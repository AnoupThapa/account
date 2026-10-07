/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Controller, Get } from '@nestjs/common';
import { sql } from 'kysely';
import { Public } from '../../common/decorators';
import { DatabaseService } from '../../common/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly dbs: DatabaseService) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    await sql`SELECT 1`.execute(this.dbs.db);
    return { status: 'ok', db: 'ok' };
  }
}
