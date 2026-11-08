import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PERMISSIONS } from '../rbac/permissions';
import { AdjustReservationDto, CreateCommitmentDto, CreateReservationDto, ListReservationsQuery, SettleReservationDto } from './dto/reservation.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('money-lock')
@ApiBearerAuth()
@Controller()
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('commitments') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  listCommitments(@CurrentUser() user: AuthUser) {
    return this.reservations.listCommitments(user);
  }

  @Post('commitments') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Create a fixed commitment (rent, EMI, bills) and reserve money for its next due date' })
  createCommitment(@CurrentUser() user: AuthUser, @Body() dto: CreateCommitmentDto) {
    return this.reservations.createCommitment(user, dto);
  }

  @Delete('commitments/:id') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Cancel a commitment and release its open reservation' })
  cancelCommitment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.cancelCommitment(user, id);
  }

  @Get('reservations') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  list(@CurrentUser() user: AuthUser, @Query() q: ListReservationsQuery) {
    return this.reservations.list(user, q.status);
  }

  @Post('reservations') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Reserve money for a one-off upcoming payment' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservations.create(user, dto);
  }

  @Patch('reservations/:id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Change how much is set aside (partial reservations)' })
  adjust(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustReservationDto) {
    return this.reservations.adjust(user, id, dto);
  }

  @Post('reservations/:id/release') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Release an unused reservation back to available-to-spend' })
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.release(user, id);
  }

  @Get('reservations/:id/settlements') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiOperation({ summary: 'Every payment linked to this reservation, including reversed ones' })
  settlements(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.settlementHistory(user, id);
  }

  @Post('reservations/:id/settle') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Mark a reservation as paid by an existing transaction' })
  settle(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleReservationDto) {
    return this.reservations.settleWithExisting(user, id, dto);
  }
}
