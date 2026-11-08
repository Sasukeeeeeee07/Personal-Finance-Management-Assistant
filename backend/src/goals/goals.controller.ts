import { Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PERMISSIONS } from '../rbac/permissions';
import { ContributionDto, CreateGoalDto, UpdateGoalDto } from './goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('goals')
@ApiBearerAuth()
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get() @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  list(@CurrentUser() user: AuthUser, @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean) {
    return this.goals.list(user, includeArchived);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
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
  contribute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContributionDto) {
    return this.goals.contribute(user, id, dto);
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
