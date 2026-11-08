import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { DomainError, notFound } from '../common/errors';
import { DATABASE } from '../database/database.module';
import type { DB, Executor } from '../database/schema';
import { PERMISSIONS } from '../rbac/permissions';

export class CreateCategoryDto {
  @ApiProperty() @IsString() @MinLength(1, { message: 'Enter a category name.' }) @MaxLength(50) name: string;
  @ApiProperty({ enum: ['income', 'expense'] }) @IsIn(['income', 'expense']) kind: 'income' | 'expense';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isEssential?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) icon?: string;
}

@Injectable()
export class CategoriesService {
  constructor(@Inject(DATABASE) private readonly db: DB) {}

  async list(user: AuthUser, kind?: 'income' | 'expense') {
    let q = this.db
      .selectFrom('transaction_categories')
      .select(['id', 'name', 'kind', 'is_essential', 'icon', 'owner_id'])
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('owner_id', 'is', null), eb('owner_id', '=', user.userId)]));
    if (kind) q = q.where('kind', '=', kind);
    const rows = await q.orderBy('kind').orderBy('name').execute();
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, isEssential: r.is_essential, icon: r.icon, isCustom: r.owner_id !== null }));
  }

  async create(user: AuthUser, dto: CreateCategoryDto) {
    try {
      const r = await this.db
        .insertInto('transaction_categories')
        .values({ owner_id: user.userId, name: dto.name.trim(), kind: dto.kind, is_essential: dto.isEssential ?? false, icon: dto.icon ?? null, deleted_at: null })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { id: r.id, name: r.name, kind: r.kind, isEssential: r.is_essential, icon: r.icon, isCustom: true };
    } catch (e: any) {
      if (e?.code === '23505') throw new DomainError('category_exists', 'You already have a category with this name.', HttpStatus.CONFLICT);
      throw e;
    }
  }

  async remove(user: AuthUser, id: string) {
    const r = await this.db.updateTable('transaction_categories').set({ deleted_at: new Date() }).where('id', '=', id).where('owner_id', '=', user.userId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Category');
  }

  /** A category is usable if it is a system category or the caller's own, and matches the transaction kind. */
  async assertUsable(db: Executor, ownerId: string, id: string, kind: 'income' | 'expense') {
    const c = await db
      .selectFrom('transaction_categories')
      .select(['id', 'kind', 'is_essential'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('owner_id', 'is', null), eb('owner_id', '=', ownerId)]))
      .executeTakeFirst();
    if (!c) throw notFound('Category');
    if (c.kind !== kind) throw new DomainError('category_kind_mismatch', `Choose an ${kind} category.`);
    return c;
  }
}

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get() @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiQuery({ name: 'kind', required: false, enum: ['income', 'expense'] })
  list(@CurrentUser() user: AuthUser, @Query('kind') kind?: 'income' | 'expense') {
    if (kind && kind !== 'income' && kind !== 'expense') throw new DomainError('invalid_kind', 'kind must be income or expense', HttpStatus.BAD_REQUEST);
    return this.categories.list(user, kind);
  }

  @Post() @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(user, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.FINANCE_OWN_WRITE)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(user, id);
  }
}
