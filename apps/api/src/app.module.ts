/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseService } from './common/database.service';
import { AuditService } from './common/audit.service';
import { ProblemFilter } from './common/errors';
import { AuthGuard, CompanyGuard, CsrfGuard, PermissionGuard } from './common/guards';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CompaniesController } from './modules/companies/companies.controller';
import { ProvisioningService } from './modules/companies/provisioning.service';
import { UsersController } from './modules/users/users.controller';
import { SettingsController } from './modules/settings/settings.controller';
import { FiscalService } from './modules/settings/fiscal.service';
import { NumberingService } from './modules/settings/numbering.service';
import { HealthController } from './modules/health/health.controller';
import { FEATURE_CONTROLLERS, FEATURE_PROVIDERS } from './features';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      skipIf: () => process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== 'on',
    }),
  ],
  controllers: [HealthController, AuthController, CompaniesController, UsersController, SettingsController, ...FEATURE_CONTROLLERS],
  providers: [
    DatabaseService,
    AuditService,
    AuthService,
    ProvisioningService,
    FiscalService,
    NumberingService,
    ...FEATURE_PROVIDERS,
    { provide: APP_FILTER, useClass: ProblemFilter },
    // Order matters: rate limit → CSRF → auth → company → permission (architecture.md §12)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CompanyGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
