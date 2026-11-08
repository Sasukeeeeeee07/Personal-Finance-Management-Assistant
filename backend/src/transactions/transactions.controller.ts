import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionDetailResponse, TransactionListResponse } from '../api-responses';
import { validateIdempotencyKey } from '../common/idempotency.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PERMISSIONS } from '../rbac/permissions';
import { CreateTransactionDto, ListTransactionsQuery, UpdateTransactionDto } from './dto/transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get() @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ) @ApiOkResponse({ type: TransactionListResponse })
  list(@CurrentUser() user: AuthUser, @Query() q: ListTransactionsQuery) {
    return this.transactions.list(user, q);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ) @ApiOkResponse({ type: TransactionDetailResponse })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transactions.get(user, id);
  }

  @Get(':id/history') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiOperation({ summary: 'Audit history of every change to this transaction' })
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transactions.history(user, id);
  }

  @Post() @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Record income, an expense, or a transfer between your own accounts' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Client-generated key (8–128 chars). Replaying the same request with the same key returns the original result instead of creating a second transaction.' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTransactionDto, @Headers('idempotency-key') key?: string) {
    return this.transactions.create(user, dto, validateIdempotencyKey(key));
  }

  @Patch(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTransactionDto) {
    return this.transactions.update(user, id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transactions.remove(user, id);
  }
}
