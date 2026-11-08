import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PERMISSIONS } from '../rbac/permissions';
import { FinancialSummaryService } from './financial-summary.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly summary: FinancialSummaryService) {}

  @Get('summary') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiOperation({ summary: 'What you have, what is committed, and what you can actually spend' })
  get(@CurrentUser() user: AuthUser) {
    return this.summary.summary(user);
  }
}
