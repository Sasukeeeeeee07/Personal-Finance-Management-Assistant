import '../../../core/money/money.dart';

/// Typed models for the dashboard endpoints. Field names and formats follow the frozen OpenAPI
/// contract (docs/api/openapi-v1.json). Money fields are [Money]; nothing is parsed as double.

typedef Json = Map<String, dynamic>;

Money _m(Json j, String k) => Money.fromApi(j[k] as String);
Money? _mOrNull(Json j, String k) => j[k] == null ? null : Money.fromApi(j[k] as String);
List<T> _list<T>(Json j, String k, T Function(Json) f) => (j[k] as List).map((e) => f(e as Json)).toList();

class MonthlyBudgetSnapshot {
  const MonthlyBudgetSnapshot({required this.budgetId, required this.limit, required this.spent, required this.remaining, required this.utilizationPercent, required this.dailyTarget});

  final String budgetId;
  final Money limit;
  final Money spent;
  final Money remaining;

  /// Percentage string from the API, e.g. "62.50". Not money; used for progress bars.
  final String utilizationPercent;
  final Money dailyTarget;

  factory MonthlyBudgetSnapshot.fromJson(Json j) => MonthlyBudgetSnapshot(
        budgetId: j['budgetId'] as String,
        limit: _m(j, 'limit'),
        spent: _m(j, 'spent'),
        remaining: _m(j, 'remaining'),
        utilizationPercent: j['utilizationPercent'] as String,
        dailyTarget: _m(j, 'dailyTarget'),
      );
}

class UpcomingPayment {
  const UpcomingPayment({required this.reservationId, required this.name, required this.amount, required this.reserved, required this.dueDate, required this.overdue});

  final String reservationId;
  final String name;
  final Money amount;
  final Money reserved;
  final String dueDate;
  final bool overdue;

  bool get fullyReserved => reserved.compareTo(amount) >= 0;

  factory UpcomingPayment.fromJson(Json j) => UpcomingPayment(
        reservationId: j['reservationId'] as String,
        name: j['name'] as String,
        amount: _m(j, 'amount'),
        reserved: _m(j, 'reserved'),
        dueDate: j['dueDate'] as String,
        overdue: j['overdue'] as bool,
      );
}

class DashboardSummary {
  const DashboardSummary({
    required this.asOf,
    required this.totalBalance,
    required this.netPosition,
    required this.liquidBalance,
    required this.reserved,
    required this.allocated,
    required this.availableToSpend,
    required this.overcommitted,
    required this.creditCardOutstanding,
    required this.monthIncome,
    required this.monthExpenses,
    required this.monthNet,
    required this.needsReviewCount,
    required this.savings,
    required this.monthlyBudget,
    required this.upcomingPayments,
    required this.calculationNotes,
  });

  final String asOf;
  final Money totalBalance;
  final Money netPosition;
  final Money liquidBalance;
  final Money reserved;
  final Money allocated;
  final Money availableToSpend;
  final bool overcommitted;
  final Money creditCardOutstanding;
  final Money monthIncome;
  final Money monthExpenses;
  final Money monthNet;
  final int needsReviewCount;
  final Money savings;
  final MonthlyBudgetSnapshot? monthlyBudget;
  final List<UpcomingPayment> upcomingPayments;
  final List<String> calculationNotes;

  factory DashboardSummary.fromJson(Json j) => DashboardSummary(
        asOf: j['asOf'] as String,
        totalBalance: _m(j, 'totalBalance'),
        netPosition: _m(j, 'netPosition'),
        liquidBalance: _m(j, 'liquidBalance'),
        reserved: _m(j, 'reserved'),
        allocated: _m(j, 'allocated'),
        availableToSpend: _m(j, 'availableToSpend'),
        overcommitted: j['overcommitted'] as bool,
        creditCardOutstanding: _m(j, 'creditCardOutstanding'),
        monthIncome: _m(j, 'monthIncome'),
        monthExpenses: _m(j, 'monthExpenses'),
        monthNet: _m(j, 'monthNet'),
        needsReviewCount: j['needsReviewCount'] as int,
        savings: _m(j, 'savings'),
        monthlyBudget: j['monthlyBudget'] == null ? null : MonthlyBudgetSnapshot.fromJson(j['monthlyBudget'] as Json),
        upcomingPayments: _list(j, 'upcomingPayments', UpcomingPayment.fromJson),
        calculationNotes: ((j['calculation'] as Json)['notes'] as List).cast<String>(),
      );
}

enum BudgetHealth { onTrack, warning, exceeded }

class BudgetStatus {
  const BudgetStatus({
    required this.id,
    required this.name,
    required this.scope,
    required this.categoryId,
    required this.period,
    required this.limit,
    required this.spent,
    required this.remaining,
    required this.utilizationPercent,
    required this.daysLeft,
    required this.dailyTarget,
    required this.thresholdsReached,
    required this.health,
    required this.periodEnd,
  });

  final String id;
  final String name;
  final String scope;
  final String? categoryId;
  final String period;
  final Money limit;
  final Money spent;
  final Money remaining;
  final String utilizationPercent;
  final int daysLeft;
  final Money dailyTarget;
  final List<int> thresholdsReached;
  final BudgetHealth health;
  final String periodEnd;

  bool get isOverall => scope == 'overall';

  factory BudgetStatus.fromJson(Json j) {
    final c = j['current'] as Json;
    return BudgetStatus(
      id: j['id'] as String,
      name: j['name'] as String,
      scope: j['scope'] as String,
      categoryId: j['categoryId'] as String?,
      period: j['period'] as String,
      limit: _m(c, 'limit'),
      spent: _m(c, 'spent'),
      remaining: _m(c, 'remaining'),
      utilizationPercent: c['utilizationPercent'] as String,
      daysLeft: c['daysLeft'] as int,
      dailyTarget: _m(c, 'dailyTarget'),
      thresholdsReached: (c['thresholdsReached'] as List).cast<int>(),
      health: switch (c['health'] as String) {
        'exceeded' => BudgetHealth.exceeded,
        'warning' => BudgetHealth.warning,
        _ => BudgetHealth.onTrack,
      },
      periodEnd: c['periodEnd'] as String,
    );
  }
}

class Forecast {
  const Forecast({
    required this.asOf,
    required this.monthEnd,
    required this.daysLeft,
    required this.estimatedMonthEndBalance,
    required this.estimatedAvailableAtMonthEnd,
    required this.availableNow,
    required this.availableChangeByMonthEnd,
    required this.shortfallRisk,
    required this.confidence,
    required this.assumptions,
    required this.expectedIncome,
    required this.scheduledPayments,
    required this.recurringExpenses,
    required this.variableSpending,
    required this.startingLiquidBalance,
  });

  final String asOf;
  final String monthEnd;
  final int daysLeft;
  final Money estimatedMonthEndBalance;
  final Money estimatedAvailableAtMonthEnd;
  final Money availableNow;
  final Money availableChangeByMonthEnd;
  final bool shortfallRisk;
  final String confidence;
  final List<String> assumptions;
  final Money expectedIncome;
  final Money scheduledPayments;
  final Money recurringExpenses;
  final Money variableSpending;
  final Money startingLiquidBalance;

  factory Forecast.fromJson(Json j) => Forecast(
        asOf: j['asOf'] as String,
        monthEnd: j['monthEnd'] as String,
        daysLeft: j['daysLeft'] as int,
        estimatedMonthEndBalance: _m(j, 'estimatedMonthEndBalance'),
        estimatedAvailableAtMonthEnd: _m(j, 'estimatedAvailableAtMonthEnd'),
        availableNow: _m(j, 'availableNow'),
        availableChangeByMonthEnd: _m(j, 'availableChangeByMonthEnd'),
        shortfallRisk: j['shortfallRisk'] as bool,
        confidence: j['confidence'] as String,
        assumptions: (j['assumptions'] as List).cast<String>(),
        expectedIncome: _m(j['expectedIncome'] as Json, 'total'),
        scheduledPayments: _m(j['scheduledPayments'] as Json, 'total'),
        recurringExpenses: _m(j['expectedRecurringExpenses'] as Json, 'total'),
        variableSpending: _m(j['variableSpending'] as Json, 'total'),
        startingLiquidBalance: _m(j, 'startingLiquidBalance'),
      );
}

class TransactionItem {
  const TransactionItem({
    required this.id,
    required this.type,
    required this.status,
    required this.amount,
    required this.accountId,
    required this.destinationAccountId,
    required this.categoryId,
    required this.occurredAt,
    required this.merchant,
    required this.sourceName,
    required this.description,
    required this.source,
    required this.isHistorical,
  });

  final String id;
  final String type;
  final String status;
  final Money amount;
  final String accountId;
  final String? destinationAccountId;
  final String? categoryId;
  final DateTime occurredAt;
  final String? merchant;
  final String? sourceName;
  final String? description;
  final String source;
  final bool isHistorical;

  bool get isIncome => type == 'income';
  bool get isExpense => type == 'expense';
  bool get isTransfer => type == 'transfer';

  /// The most meaningful label the API provides for this transaction.
  String? get counterparty => merchant ?? sourceName ?? description;

  factory TransactionItem.fromJson(Json j) => TransactionItem(
        id: j['id'] as String,
        type: j['type'] as String,
        status: j['status'] as String,
        amount: _m(j, 'amount'),
        accountId: j['accountId'] as String,
        destinationAccountId: j['destinationAccountId'] as String?,
        categoryId: j['categoryId'] as String?,
        occurredAt: DateTime.parse(j['occurredAt'] as String),
        merchant: j['merchant'] as String?,
        sourceName: j['sourceName'] as String?,
        description: j['description'] as String?,
        source: j['source'] as String,
        isHistorical: j['isHistorical'] as bool,
      );
}

class TransactionInsight {
  const TransactionInsight({required this.spentThisMonth, required this.spentLastMonth, required this.changeFromLastMonth, required this.budget});

  final Money spentThisMonth;
  final Money spentLastMonth;
  final Money changeFromLastMonth;
  final BudgetStatus? budget;

  factory TransactionInsight.fromJson(Json j) => TransactionInsight(
        spentThisMonth: _m(j, 'categorySpentThisMonth'),
        spentLastMonth: _m(j, 'categorySpentLastMonth'),
        changeFromLastMonth: _m(j, 'changeFromLastMonth'),
        budget: j['budget'] == null ? null : BudgetStatus.fromJson(j['budget'] as Json),
      );
}

class TransactionDetail {
  const TransactionDetail({required this.item, required this.notes, required this.paymentMethod, required this.externalReference, required this.isPlanned, required this.isEssential, required this.isRecurring, required this.insight});

  final TransactionItem item;
  final String? notes;
  final String? paymentMethod;
  final String? externalReference;
  final bool? isPlanned;
  final bool? isEssential;
  final bool isRecurring;
  final TransactionInsight? insight;

  factory TransactionDetail.fromJson(Json j) => TransactionDetail(
        item: TransactionItem.fromJson(j),
        notes: j['notes'] as String?,
        paymentMethod: j['paymentMethod'] as String?,
        externalReference: j['externalReference'] as String?,
        isPlanned: j['isPlanned'] as bool?,
        isEssential: j['isEssential'] as bool?,
        isRecurring: j['isRecurring'] as bool,
        insight: j['insight'] == null ? null : TransactionInsight.fromJson(j['insight'] as Json),
      );
}

class AccountRef {
  const AccountRef({required this.id, required this.name, required this.type, required this.accountMask, required this.balance, required this.outstanding});

  final String id;
  final String name;
  final String type;
  final String? accountMask;
  final Money balance;
  final Money? outstanding;

  String get label => accountMask == null ? name : '$name ••$accountMask';

  factory AccountRef.fromJson(Json j) => AccountRef(
        id: j['id'] as String,
        name: j['name'] as String,
        type: j['type'] as String,
        accountMask: j['accountMask'] as String?,
        balance: _m(j, 'balance'),
        outstanding: _mOrNull(j, 'outstanding'),
      );
}

class CategoryRef {
  const CategoryRef({required this.id, required this.name, required this.kind});

  final String id;
  final String name;
  final String kind;

  factory CategoryRef.fromJson(Json j) => CategoryRef(id: j['id'] as String, name: j['name'] as String, kind: j['kind'] as String);
}

/// Id → name lookups for accounts and categories shown next to transactions and budgets.
class Lookups {
  const Lookups({required this.accounts, required this.categories});

  final Map<String, AccountRef> accounts;
  final Map<String, CategoryRef> categories;

  static const empty = Lookups(accounts: {}, categories: {});
}
