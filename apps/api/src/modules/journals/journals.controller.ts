/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { manualJournalSchema, ManualJournalInput } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { JournalsService } from './journals.service';

const updateSchema = manualJournalSchema.extend({ version: z.number().int() });

@Controller('journals')
export class JournalsController {
  constructor(private readonly svc: JournalsService) {}

  @Perm('journal.view')
  @Get()
  list(@Ctx() ctx: CompanyContext, @Query('status') status?: string) {
    return this.svc.list(ctx, status);
  }

  @Perm('journal.view')
  @Get(':id')
  get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Perm('journal.create')
  @Post()
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(manualJournalSchema)) b: ManualJournalInput) {
    return this.svc.create(ctx, b);
  }

  @Perm('journal.create')
  @Patch(':id')
  update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(updateSchema)) b: ManualJournalInput & { version: number }) {
    return this.svc.update(ctx, id, b);
  }

  @Perm('journal.create')
  @Delete(':id')
  remove(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }
}
