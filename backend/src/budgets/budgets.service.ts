import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Selectable } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser } from '../common/auth-context';
import { today } from '../common/dates';
import { DomainError, notFound } from '../common/errors';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { BudgetsTable, DB, Executor } from '../database/schema';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories';
import { computeFigures, periodContaining, PeriodRule, PeriodWindow, previousPeriod } from './budget-period';
import { CreateBudgetDto, UpdateBudgetDto } from './budget.dto';

type BudgetRow = Selectable<BudgetsTable>;
const IST = '+05:30';
const DEFAULT_THRESHOLDS = [50, 75, 90, 100];

const rule = (b: BudgetRow): PeriodRule => ({ period: b.period, periodDays: b.period_days, startDate: b.start_date });

/**
 * Budgets are limits on confirmed expense transactions (D-009). Transfers are never expenses,
 * so moving money between your own accounts or paying a card bill never consumes a budget.
 */
@Injectable()
export class BudgetsService {
  private readonly logger = new Logger('Budgets');

  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, dto: CreateBudgetDto) {
    const now = today();
    const startDate = dto.startDate ?? (dto.period === 'monthly' ? `${now.slice(0, 7)}-01` : now);
    try {
      const row = await this.db.transaction().execute(async (trx) => {
        if (dto.categoryId) await this.categories.assertUsable(trx, user.userId, dto.categoryId, 'expense');
        const b = await trx
          .insertInto('budgets')
          .values({
            owner_id: user.userId,
            organization_id: user.organizationId,
            name: dto.name.trim(),
            scope: dto.categoryId ? 'category' : 'overall',
            category_id: dto.categoryId ?? null,
            period: dto.period,
            period_days: dto.period === 'custom' ? dto.periodDays! : null,
            amount: fmt(dto.amount),
            start_date: startDate,
            rollover: dto.rollover ?? false,
            alert_thresholds: [...(dto.alertThresholds ?? DEFAULT_THRESHOLDS)].sort((a, b) => a - b),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'budget', entityId: b.id, action: 'created', after: b });
        return b;
      });
      return this.present(this.db, row, today());
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new DomainError('budget_exists', `You already have an active ${dto.period} budget for ${dto.categoryId ? 'this category' : 'overall spending'}. Edit it instead.`, HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  async list(user: AuthUser, asOf = today()) {
    const rows = await this.db.selectFrom('budgets').selectAll().where('owner_id', '=', user.userId).where('status', '=', 'active').orderBy('scope').orderBy('name').execute();
    return Promise.all(rows.map((b) => this.present(this.db, b, asOf)));
  }

  async get(user: AuthUser, id: string, asOf = today()) {
    return this.present(this.db, await this.findOwned(this.db, user.userId, id), asOf);
  }

  /** Period and start date are fixed; to change them, archive and create a new budget so history stays correct. */
  async update(user: AuthUser, id: string, dto: UpdateBudgetDto) {
    const after = await this.db.transaction().execute(async (trx) => {
      const before = await this.findOwned(trx, user.userId, id, true);
      if (before.status !== 'active') throw new DomainError('budget_archived', 'This budget is archived.', HttpStatus.CONFLICT);
      const row = await trx
        .updateTable('budgets')
        .set({
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.amount !== undefined && { amount: fmt(dto.amount) }),
          ...(dto.rollover !== undefined && { rollover: dto.rollover }),
          ...(dto.alertThresholds !== undefined && { alert_thresholds: [...dto.alertThresholds].sort((a, b) => a - b) }),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'budget', entityId: id, action: 'updated', before, after: row });
      return row;
    });
    return this.present(this.db, after, today());
  }

  async archive(user: AuthUser, id: string) {
    await this.db.transaction().execute(async (trx) => {
      await this.findOwned(trx, user.userId, id, true);
      await trx.updateTable('budgets').set({ status: 'archived', updated_at: new Date() }).where('id', '=', id).execute();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'budget', entityId: id, action: 'archived' });
    });
  }

  async alerts(user: AuthUser, limit = 50) {
    const rows = await this.db
      .selectFrom('budget_alerts as a')
      .innerJoin('budgets as b', 'b.id', 'a.budget_id')
      .select(['a.id', 'a.budget_id', 'b.name', 'a.kind', 'a.threshold', 'a.spent', 'a.limit_amount', 'a.period_start', 'a.created_at'])
      .where('a.owner_id', '=', user.userId)
      .orderBy('a.created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      budgetId: r.budget_id,
      kind: r.kind,
      threshold: r.threshold,
      spent: r.spent,
      limit: r.limit_amount,
      periodStart: r.period_start,
      createdAt: r.created_at,
      message: alertMessage(r.name, r.kind, r.threshold, r.spent, r.limit_amount),
    }));
  }

  /**
   * Records any thresholds newly crossed in the current period. Each (budget, period, threshold)
   * fires once (unique key). Returns only the alerts created by this call.
   */
  async evaluateAlerts(ownerId: string, asOf = today()) {
    const budgets = await this.db.selectFrom('budgets').selectAll().where('owner_id', '=', ownerId).where('status', '=', 'active').execute();
    const created: { budgetId: string; kind: 'threshold' | 'exceeded'; threshold: number; message: string }[] = [];
    for (const b of budgets) {
      const { figures, window } = await this.figures(this.db, b, asOf);
      const events: { kind: 'threshold' | 'exceeded'; threshold: number }[] = figures.thresholdsReached.map((t) => ({ kind: 'threshold', threshold: t }));
      if (figures.exceeded) events.push({ kind: 'exceeded', threshold: 100 });
      if (!events.length) continue;
      const rows = await this.db
        .insertInto('budget_alerts')
        .values(events.map((e) => ({ owner_id: ownerId, budget_id: b.id, period_start: window.start, kind: e.kind, threshold: e.threshold, spent: fmt(figures.spent), limit_amount: fmt(figures.limit), delivered_at: null })))
        .onConflict((oc) => oc.columns(['budget_id', 'period_start', 'kind', 'threshold']).doNothing())
        .returning(['kind', 'threshold'])
        .execute();
      for (const r of rows) created.push({ budgetId: b.id, kind: r.kind, threshold: r.threshold, message: alertMessage(b.name, r.kind, r.threshold, fmt(figures.spent), fmt(figures.limit)) });
    }
    return created;
  }

  /** Alerts are a side effect of recording spending; a failure here must never fail the transaction itself. */
  async evaluateAlertsSafely(ownerId: string) {
    try {
      return await this.evaluateAlerts(ownerId);
    } catch (e: any) {
      this.logger.error(`Budget alert evaluation failed: ${e?.message?.split('\n')[0]}`);
      return [];
    }
  }

  /** The category budget an expense counts against (for expense intelligence). */
  async impactFor(ownerId: string, categoryId: string, occurredOn: string) {
    const b = await this.db
      .selectFrom('budgets')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'active')
      .where('category_id', '=', categoryId)
      .orderBy(sql`CASE period WHEN 'monthly' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END`)
      .executeTakeFirst();
    return b ? this.present(this.db, b, occurredOn) : null;
  }

  /** Total of active overall monthly budgets' remaining amounts, for the dashboard. */
  async overallMonthly(ownerId: string, asOf = today(), db: Executor = this.db) {
    const b = await db.selectFrom('budgets').selectAll().where('owner_id', '=', ownerId).where('status', '=', 'active').where('scope', '=', 'overall').where('period', '=', 'monthly').executeTakeFirst();
    return b ? this.present(db, b, asOf) : null;
  }

  // --- internals -----------------------------------------------------------------------------

  private async figures(db: Executor, b: BudgetRow, asOf: string) {
    const window = periodContaining(rule(b), asOf);
    const spent = await this.spent(db, b, window);
    const prev = b.rollover ? previousPeriod(rule(b), window) : null;
    const previousSpent = prev ? await this.spent(db, b, prev) : null;
    const figures = computeFigures({ amount: money(b.amount), spent, previousSpent, rollover: b.rollover, thresholds: b.alert_thresholds, window, asOf });
    return { window, figures };
  }

  private async spent(db: Executor, b: BudgetRow, w: PeriodWindow) {
    let q = db
      .selectFrom('transactions')
      .select(sql<string>`COALESCE(SUM(amount), 0)`.as('total'))
      .where('owner_id', '=', b.owner_id)
      .where('type', '=', 'expense')
      .where('status', '=', 'confirmed')
      .where('deleted_at', 'is', null)
      .where('occurred_at', '>=', new Date(`${w.start}T00:00:00${IST}`))
      .where('occurred_at', '<', new Date(`${w.end}T00:00:00${IST}`));
    if (b.category_id) q = q.where('category_id', '=', b.category_id);
    return money((await q.executeTakeFirstOrThrow()).total);
  }

  private async present(db: Executor, b: BudgetRow, asOf: string) {
    const { window, figures: f } = await this.figures(db, b, asOf);
    return {
      id: b.id,
      name: b.name,
      scope: b.scope,
      categoryId: b.category_id,
      period: b.period,
      periodDays: b.period_days,
      amount: b.amount,
      currency: b.currency,
      startDate: b.start_date,
      rollover: b.rollover,
      alertThresholds: b.alert_thresholds,
      status: b.status,
      current: {
        asOf,
        periodStart: window.start,
        periodEnd: window.end,
        /** Use with GET /transactions?from=&to= to list the transactions behind this figure. */
        transactionsFrom: `${window.start}T00:00:00${IST}`,
        transactionsTo: `${window.end}T00:00:00${IST}`,
        limit: fmt(f.limit),
        carriedOver: fmt(f.carriedOver),
        spent: fmt(f.spent),
        remaining: fmt(f.remaining),
        utilizationPercent: f.utilizationPercent.toFixed(2),
        daysLeft: f.daysLeft,
        dailyTarget: fmt(f.dailyTarget),
        thresholdsReached: f.thresholdsReached,
        exceeded: f.exceeded,
        health: f.status,
      },
    };
  }

  private async findOwned(db: Executor, ownerId: string, id: string, lock = false) {
    let q = db.selectFrom('budgets').selectAll().where('id', '=', id).where('owner_id', '=', ownerId);
    if (lock) q = q.forUpdate();
    const b = await q.executeTakeFirst();
    if (!b) throw notFound('Budget');
    return b;
  }
}

function alertMessage(name: string, kind: 'threshold' | 'exceeded', threshold: number, spent: string, limit: string) {
  if (kind === 'exceeded') return `You've gone over your ${name} budget: ₹${spent} spent of ₹${limit}.`;
  const left = money(limit).minus(spent);
  return `You've used ${threshold}% of your ${name} budget. ₹${fmt(Decimal.max(left, 0))} left.`;
}
