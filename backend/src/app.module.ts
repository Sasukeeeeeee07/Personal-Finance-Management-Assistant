import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/auth-context';
import { APP_CONFIG, AppConfig, loadConfig } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { CategoriesController, CategoriesService } from './categories/categories';
import { DashboardController } from './dashboard/dashboard.controller';
import { FinancialSummaryService } from './dashboard/financial-summary.service';
import { OrganizationsController, OrganizationsService } from './organizations/organizations.controller';
import { ReservationsController } from './reservations/reservations.controller';
import { ReservationsService } from './reservations/reservations.service';
import { LedgerService } from './transactions/ledger.service';
import { TransactionsController } from './transactions/transactions.controller';
import { TransactionsService } from './transactions/transactions.service';
import { BudgetsController } from './budgets/budgets.controller';
import { BudgetsService } from './budgets/budgets.service';
import { GoalsController } from './goals/goals.controller';
import { GoalsService } from './goals/goals.service';
import { ForecastController, ForecastService } from './forecast/forecast.service';

@ApiTags('health')
@Controller('health')
class HealthController {
  @Public() @Get()
  health() {
    return { status: 'ok' };
  }
}

export function buildAppModule(config: AppConfig = loadConfig()) {
  @Module({
    imports: [
      { module: class ConfigModule {}, global: true, providers: [{ provide: APP_CONFIG, useValue: config }], exports: [APP_CONFIG] },
      DatabaseModule,
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.nodeEnv === 'test' ? 10_000 : 300 }]),
      AuthModule,
    ],
    controllers: [HealthController, AccountsController, CategoriesController, TransactionsController, ReservationsController, DashboardController, OrganizationsController, BudgetsController, GoalsController, ForecastController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      LedgerService,
      AccountsService,
      CategoriesService,
      TransactionsService,
      ReservationsService,
      FinancialSummaryService,
      OrganizationsService,
      BudgetsService,
      GoalsService,
      ForecastService,
    ],
  })
  class AppModule {}
  return AppModule;
}
