import { Body, Controller, Get, Headers, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GoalDetailResponse, GoalResponse } from '../api-responses';
import { validateIdempotencyKey } from '../common/idempotency.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PERMISSIONS } from '../rbac/permissions';
import { ContributionDto, CreateGoalDto, UpdateGoalDto } from './goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('goals')
@ApiBearerAuth()
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get() @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ) @ApiOkResponse({ type: [GoalResponse] })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  list(@CurrentUser() user: AuthUser, @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean) {
    return this.goals.list(user, includeArchived);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ) @ApiOkResponse({ type: GoalDetailResponse })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.get(user, id);
  }

  @Post() @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGoalDto) {
    return this.goals.create(user, dto);
  }

  @Patch(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGoalDto) {
    return this.goals.update(user, id, dto);
  }

  @Post(':id/contributions') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Set money aside for a goal, or take some out. Not income or expense.' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Client-generated key; replays return the original result.' })
  contribute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContributionDto, @Headers('idempotency-key') key?: string) {
    return this.goals.contribute(user, id, dto, validateIdempotencyKey(key));
  }

  @Post(':id/contributions/:contributionId/reverse') @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Reverse a contribution or withdrawal by recording its opposite' })
  reverse(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('contributionId', ParseUUIDPipe) contributionId: string) {
    return this.goals.reverseContribution(user, id, contributionId);
  }

  @Post(':id/complete') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.complete(user, id);
  }

  @Post(':id/archive') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  @ApiOperation({ summary: 'Archive a goal and release its savings back to available-to-spend' })
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.archive(user, id);
  }
}
