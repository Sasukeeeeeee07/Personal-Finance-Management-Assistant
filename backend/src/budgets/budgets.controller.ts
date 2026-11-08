import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PERMISSIONS } from '../rbac/permissions';
import { AsOfQuery, CreateBudgetDto, UpdateBudgetDto } from './budget.dto';
import { BudgetsService } from './budgets.service';

@ApiTags('budgets')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get() @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiOperation({ summary: 'Active budgets with spending in the current period' })
  list(@CurrentUser() user: AuthUser, @Query() q: AsOfQuery) {
    return this.budgets.list(user, q.asOf);
  }

  @Get('alerts') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiOperation({ summary: 'Budget threshold and over-budget alerts, newest first' })
  alerts(@CurrentUser() user: AuthUser) {
    return this.budgets.alerts(user);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: AsOfQuery) {
    return this.budgets.get(user, id, q.asOf);
  }

  @Post() @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Create an overall or category budget (monthly, weekly or custom period)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(user, dto);
  }

  @Patch(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(user, id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Archive a budget (history is kept)' })
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.archive(user, id);
  }
}
