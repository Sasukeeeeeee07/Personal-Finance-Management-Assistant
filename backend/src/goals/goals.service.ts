import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Selectable } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser } from '../common/auth-context';
import { addDays, addMonths, daysBetween, today } from '../common/dates';
import { DomainError, notFound } from '../common/errors';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { DB, Executor, FinancialGoalsTable } from '../database/schema';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { FinancialSummaryService } from '../dashboard/financial-summary.service';
import { ContributionDto, CreateGoalDto, UpdateGoalDto } from './goal.dto';
import { IdempotencyService } from '../common/idempotency.service';

type GoalRow = Selectable<FinancialGoalsTable>;

/** Whole months from `from` to `to`, rounded up, at least 1. */
export function monthsUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const months = (ty - fy) * 12 + (tm - fm) + (td > fd ? 1 : 0);
  return Math.max(months, 1);
}

/**
 * Pure goal projections.
 * - recommendedMonthly: what to set aside each month to reach the target by the target date.
 * - estimatedCompletionDate: at the planned monthly contribution, or else the recent average pace.
 */
export function projectGoal(input: { target: Decimal; saved: Decimal; targetDate: string | null; monthlyContribution: Decimal | null; recentMonthlyPace: Decimal; asOf: string }) {
  const remaining = Decimal.max(input.target.minus(input.saved), 0);
  const progressPercent = Decimal.min(input.saved.div(input.target).times(100), 100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const reached = remaining.isZero();
  const targetPassed = !!input.targetDate && input.targetDate < input.asOf;
  const recommendedMonthly =
    reached || !input.targetDate ? null : targetPassed ? remaining : remaining.div(monthsUntil(input.asOf, input.targetDate)).toDecimalPlaces(2, Decimal.ROUND_UP);
  const pace = input.monthlyContribution ?? (input.recentMonthlyPace.gt(0) ? input.recentMonthlyPace : null);
  const paceSource = input.monthlyContribution ? 'planned_monthly_contribution' : pace ? 'average_of_last_3_months' : null;
  let estimatedCompletionDate: string | null = reached ? input.asOf : null;
  if (!reached && pace) {
    const months = remaining.div(pace).ceil().toNumber();
    estimatedCompletionDate = addMonths(input.asOf, months, Number(input.asOf.slice(8, 10)));
  }
  const onTrack = reached ? true : input.targetDate && estimatedCompletionDate ? estimatedCompletionDate <= input.targetDate : null;
  return { remaining, progressPercent, reached, targetPassed, recommendedMonthly, estimatedCompletionDate, paceSource, pace, onTrack };
}

/**
 * Savings goals. Contributions are allocations (D-013): they never create income or expense
 * entries, so they cannot be double-counted. Saved money reduces available-to-spend unless the
 * goal's account is non-liquid (e.g. a fixed deposit), see FinancialSummaryService.
 */
@Injectable()
export class GoalsService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly accounts: AccountsService,
    private readonly summary: FinancialSummaryService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(user: AuthUser, dto: CreateGoalDto) {
    return this.db.transaction().execute(async (trx) => {
      if (dto.accountId) await this.accounts.findOwned(trx, user.userId, dto.accountId);
      const g = await trx
        .insertInto('financial_goals')
        .values({
          owner_id: user.userId,
          organization_id: user.organizationId,
          name: dto.name.trim(),
          kind: dto.kind ?? 'custom',
          target_amount: fmt(dto.targetAmount),
          target_date: dto.targetDate ?? null,
          monthly_contribution: dto.monthlyContribution ? fmt(dto.monthlyContribution) : null,
          priority: dto.priority ?? 2,
          allocation_mode: dto.allocationMode ?? 'track_only',
          account_id: dto.accountId ?? null,
          completed_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'financial_goal', entityId: g.id, action: 'created', after: g });
      if (dto.initialAmount && money(dto.initialAmount).gt(0)) {
        await trx.insertInto('goal_contributions').values({ owner_id: user.userId, goal_id: g.id, amount: fmt(dto.initialAmount), contributed_on: today(), note: null, is_opening: true, transaction_id: null, reverses_contribution_id: null }).execute();
        await this.syncCompletion(trx, g.id);
      }
      return { goal: await this.present(trx, await this.findOwned(trx, user.userId, g.id)), position: await this.position(trx, user.userId) };
    });
  }

  async list(user: AuthUser, includeArchived = false) {
    let q = this.db.selectFrom('financial_goals').selectAll().where('owner_id', '=', user.userId);
    if (!includeArchived) q = q.where('status', '!=', 'archived');
    const rows = await q.orderBy('priority').orderBy('created_at').execute();
    return Promise.all(rows.map((g) => this.present(this.db, g)));
  }

  async get(user: AuthUser, id: string) {
    const g = await this.findOwned(this.db, user.userId, id);
    const contributions = await this.db.selectFrom('goal_contributions').selectAll().where('goal_id', '=', id).orderBy('contributed_on', 'desc').orderBy('created_at', 'desc').execute();
    return {
      ...(await this.present(this.db, g)),
      contributions: contributions.map((c) => ({
        id: c.id,
        amount: c.amount,
        type: c.reverses_contribution_id ? 'reversal' : money(c.amount).isNegative() ? 'withdrawal' : 'contribution',
        date: c.contributed_on,
        note: c.note,
        transactionId: c.transaction_id,
        reversesContributionId: c.reverses_contribution_id,
        reversed: contributions.some((x) => x.reverses_contribution_id === c.id),
      })),
    };
  }

  async update(user: AuthUser, id: string, dto: UpdateGoalDto) {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.findOwned(trx, user.userId, id, true);
      if (before.status === 'archived') throw new DomainError('goal_archived', 'This goal is archived.', HttpStatus.CONFLICT);
      if (dto.accountId) await this.accounts.findOwned(trx, user.userId, dto.accountId);
      const after = await trx
        .updateTable('financial_goals')
        .set({
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.kind !== undefined && { kind: dto.kind }),
          ...(dto.targetAmount !== undefined && { target_amount: fmt(dto.targetAmount) }),
          ...(dto.targetDate !== undefined && { target_date: dto.targetDate }),
          ...(dto.monthlyContribution !== undefined && { monthly_contribution: dto.monthlyContribution === null ? null : fmt(dto.monthlyContribution) }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          ...(dto.allocationMode !== undefined && { allocation_mode: dto.allocationMode }),
          ...(dto.accountId !== undefined && { account_id: dto.accountId }),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'financial_goal', entityId: id, action: 'updated', before, after });
      await this.syncCompletion(trx, id);
      return { goal: await this.present(trx, await this.findOwned(trx, user.userId, id)), position: await this.position(trx, user.userId) };
    });
  }

  async contribute(user: AuthUser, id: string, dto: ContributionDto, idempotencyKey?: string) {
    const { replayed, body } = await this.db.transaction().execute((trx) =>
      this.idempotency.run(trx, user.userId, idempotencyKey, `POST /goals/${id}/contributions`, dto, () => this.contributeIn(trx, user, id, dto)),
    );
    return { ...body, idempotentReplay: replayed };
  }

  private async contributeIn(trx: Executor, user: AuthUser, id: string, dto: ContributionDto) {
      const g = await this.findOwned(trx, user.userId, id, true);
      if (g.status === 'archived') throw new DomainError('goal_archived', 'This goal is archived.', HttpStatus.CONFLICT);
      if (dto.transactionId) {
        await this.assertBankMovement(trx, user.userId, g, dto);
      }
      const amount = money(dto.amount);
      if (dto.type === 'withdrawal') {
        const saved = await this.saved(trx, id);
        if (amount.gt(saved)) throw new DomainError('withdrawal_exceeds_saved', `You can take out up to ₹${fmt(saved)} from this goal.`);
      }
      const c = await trx
        .insertInto('goal_contributions')
        .values({ owner_id: user.userId, goal_id: id, amount: fmt(dto.type === 'withdrawal' ? amount.neg() : amount), contributed_on: dto.date ?? today(), note: dto.note?.trim() || null, transaction_id: dto.transactionId ?? null, reverses_contribution_id: null })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'goal_contribution', entityId: c.id, action: dto.type, after: c });
      await this.syncCompletion(trx, id);
      return { goal: await this.present(trx, await this.findOwned(trx, user.userId, id)), position: await this.position(trx, user.userId) };
  }

  /** Mark a goal done before reaching the target (e.g. the user changed plans). */
  async complete(user: AuthUser, id: string) {
    return this.setStatus(user, id, 'completed');
  }

  /**
   * Reverse a contribution or withdrawal by recording its exact opposite (history is never edited).
   * A reversal cannot itself be reversed, and nothing can be reversed twice.
   */
  async reverseContribution(user: AuthUser, goalId: string, contributionId: string) {
    return this.db.transaction().execute(async (trx) => {
      const g = await this.findOwned(trx, user.userId, goalId, true);
      if (g.status === 'archived') throw new DomainError('goal_archived', 'This goal is archived.', HttpStatus.CONFLICT);
      const c = await trx.selectFrom('goal_contributions').selectAll().where('id', '=', contributionId).where('goal_id', '=', goalId).executeTakeFirst();
      if (!c) throw notFound('Contribution');
      if (c.reverses_contribution_id) throw new DomainError('cannot_reverse_reversal', 'This entry is already a reversal.', HttpStatus.CONFLICT);
      const already = await trx.selectFrom('goal_contributions').select('id').where('reverses_contribution_id', '=', c.id).executeTakeFirst();
      if (already) throw new DomainError('already_reversed', 'This entry was already reversed.', HttpStatus.CONFLICT);
      const opposite = money(c.amount).neg();
      if ((await this.saved(trx, goalId)).plus(opposite).isNegative()) {
        throw new DomainError('reversal_exceeds_saved', 'Reversing this would take the goal below zero. Reverse the later withdrawals first.');
      }
      const r = await trx
        .insertInto('goal_contributions')
        .values({ owner_id: user.userId, goal_id: goalId, amount: fmt(opposite), contributed_on: today(), note: 'Reversal', is_opening: c.is_opening, transaction_id: null, reverses_contribution_id: c.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'goal_contribution', entityId: r.id, action: 'reversed', before: c, after: r });
      await this.syncCompletion(trx, goalId);
      return { goal: await this.present(trx, await this.findOwned(trx, user.userId, goalId)), position: await this.position(trx, user.userId) };
    });
  }

  /**
   * A linked bank movement must be a confirmed transfer into (contribution) or out of (withdrawal)
   * the goal's own account for the same amount. Each transfer can back only one contribution
   * (unique index), so progress cannot be counted twice.
   */
  private async assertBankMovement(trx: Executor, ownerId: string, g: GoalRow, dto: ContributionDto) {
    if (!g.account_id) throw new DomainError('goal_has_no_account', 'Link this goal to an account before attaching a transfer.');
    const t = await trx.selectFrom('transactions').selectAll().where('id', '=', dto.transactionId!).where('owner_id', '=', ownerId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('Transaction');
    const intoGoal = t.destination_account_id === g.account_id;
    const outOfGoal = t.account_id === g.account_id;
    if (t.type !== 'transfer' || t.status !== 'confirmed' || (dto.type === 'contribution' ? !intoGoal : !outOfGoal)) {
      throw new DomainError('invalid_bank_movement', dto.type === 'contribution' ? "Attach a confirmed transfer into this goal's account." : "Attach a confirmed transfer out of this goal's account.");
    }
    if (!money(t.amount).eq(dto.amount)) throw new DomainError('bank_movement_amount_mismatch', `The transfer was ₹${fmt(t.amount)}, not ₹${fmt(dto.amount)}.`);
    const used = await trx.selectFrom('goal_contributions').select('id').where('transaction_id', '=', t.id).executeTakeFirst();
    if (used) throw new DomainError('bank_movement_already_linked', 'This transfer is already linked to a goal contribution.', HttpStatus.CONFLICT);
  }

  /** Archiving releases the goal's savings back into available-to-spend. */
  async archive(user: AuthUser, id: string) {
    return this.setStatus(user, id, 'archived');
  }

  // --- internals -----------------------------------------------------------------------------

  private async setStatus(user: AuthUser, id: string, status: 'completed' | 'archived') {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.findOwned(trx, user.userId, id, true);
      if (before.status === 'archived') throw new DomainError('goal_archived', 'This goal is archived.', HttpStatus.CONFLICT);
      const after = await trx
        .updateTable('financial_goals')
        .set({ status, completed_at: status === 'completed' ? new Date() : before.completed_at, updated_at: new Date() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'financial_goal', entityId: id, action: status, before, after });
      return { goal: await this.present(trx, after), position: await this.position(trx, user.userId) };
    });
  }

  /** Active goals become completed when the target is reached, and active again if money is withdrawn. */
  private async syncCompletion(trx: Executor, id: string) {
    const g = await trx.selectFrom('financial_goals').select(['status', 'target_amount']).where('id', '=', id).executeTakeFirstOrThrow();
    const reached = (await this.saved(trx, id)).gte(g.target_amount);
    if (g.status === 'active' && reached) {
      await trx.updateTable('financial_goals').set({ status: 'completed', completed_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
    } else if (g.status === 'completed' && !reached) {
      await trx.updateTable('financial_goals').set({ status: 'active', completed_at: null, updated_at: new Date() }).where('id', '=', id).execute();
    }
  }

  private async saved(db: Executor, goalId: string) {
    const r = await db.selectFrom('goal_contributions').select(sql<string>`COALESCE(SUM(amount), 0)`.as('total')).where('goal_id', '=', goalId).executeTakeFirstOrThrow();
    return money(r.total);
  }

  private async present(db: Executor, g: GoalRow, asOf = today()) {
    const saved = await this.saved(db, g.id);
    // Three separate figures: progress (saved), virtual allocation, and money actually moved by linked transfers.
    const accountLiquid = g.account_id
      ? (await db.selectFrom('bank_accounts').select('is_liquid').where('id', '=', g.account_id).executeTakeFirst())?.is_liquid ?? false
      : true;
    const allocated = g.allocation_mode === 'reserve' && g.status !== 'archived' && accountLiquid ? saved : new Decimal(0);
    const moved = await db
      .selectFrom('goal_contributions')
      .select(sql<string>`COALESCE(SUM(amount), 0)`.as('total'))
      .where('goal_id', '=', g.id)
      .where('transaction_id', 'is not', null)
      .executeTakeFirstOrThrow();
    const recent = await db
      .selectFrom('goal_contributions')
      .select(sql<string>`COALESCE(SUM(amount), 0)`.as('total'))
      .where('goal_id', '=', g.id)
      .where('contributed_on', '>', addDays(asOf, -90))
      .where('is_opening', '=', false)
      .executeTakeFirstOrThrow();
    const p = projectGoal({
      target: money(g.target_amount),
      saved,
      targetDate: g.target_date,
      monthlyContribution: g.monthly_contribution ? money(g.monthly_contribution) : null,
      recentMonthlyPace: Decimal.max(money(recent.total).div(3), 0).toDecimalPlaces(2),
      asOf,
    });
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      targetAmount: g.target_amount,
      currency: g.currency,
      targetDate: g.target_date,
      monthlyContribution: g.monthly_contribution,
      priority: g.priority,
      accountId: g.account_id,
      allocationMode: g.allocation_mode,
      status: g.status,
      completedAt: g.completed_at,
      saved: fmt(saved),
      /** Amount this goal currently subtracts from available-to-spend. */
      allocated: fmt(allocated),
      /** Portion of `saved` backed by linked transfers (actual bank movement). */
      movedByTransfers: fmt(moved.total),
      remaining: fmt(p.remaining),
      progressPercent: p.progressPercent.toFixed(2),
      recommendedMonthly: p.recommendedMonthly ? fmt(p.recommendedMonthly) : null,
      estimatedCompletionDate: p.estimatedCompletionDate,
      estimateBasis: p.paceSource,
      onTrack: p.onTrack,
      targetDatePassed: p.targetPassed && !p.reached,
      daysToTarget: g.target_date ? daysBetween(asOf, g.target_date) : null,
    };
  }

  private async findOwned(db: Executor, ownerId: string, id: string, lock = false): Promise<GoalRow> {
    let q = db.selectFrom('financial_goals').selectAll().where('id', '=', id).where('owner_id', '=', ownerId);
    if (lock) q = q.forUpdate();
    const g = await q.executeTakeFirst();
    if (!g) throw notFound('Goal');
    return g;
  }

  private async position(trx: Executor, ownerId: string) {
    const p = await this.summary.spendable(ownerId, trx);
    return { liquidBalance: fmt(p.liquidBalance), reserved: fmt(p.reserved), allocated: fmt(p.allocated), availableToSpend: fmt(p.available), overcommitted: p.available.isNegative() };
  }
}
