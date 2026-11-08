import { Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PERMISSIONS } from '../rbac/permissions';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, ReconcileAccountDto, UpdateAccountDto } from './dto/account.dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get() @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  list(@CurrentUser() user: AuthUser, @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean) {
    return this.accounts.list(user, includeArchived);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(user, id);
  }

  @Post() @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounts.create(user, dto);
  }

  @Patch(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(user, id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.remove(user, id);
  }

  @Post(':id/reconcile') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  reconcile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReconcileAccountDto) {
    return this.accounts.reconcile(user, id, dto);
  }
}
