import '../../core/money/money.dart';
import '../dashboard/data/dashboard_models.dart';

/// Models for the management screens. Field names and formats follow the frozen OpenAPI contract
/// (docs/api/openapi-v1.json). Money is [Money]; nothing financial is parsed as double.

Money _m(Json j, String k) => Money.fromApi(j[k] as String);
Money? _mn(Json j, String k) => j[k] == null ? null : Money.fromApi(j[k] as String);

const accountTypeLabels = {
  'savings': 'Savings account',
  'current': 'Current account',
  'cash': 'Cash',
  'upi_bank': 'UPI-linked bank account',
  'wallet': 'Digital wallet',
  'credit_card': 'Credit card',
  'fixed_deposit': 'Fixed deposit',
  'other': 'Other',
};

class Account {
  const Account({
    required this.id,
    required this.name,
    required this.type,
    required this.institutionName,
    required this.accountMask,
    required this.isLiquid,
    required this.isLiability,
    required this.creditLimit,
    required this.trackingStartDate,
    required this.archived,
    required this.balance,
    required this.outstanding,
    required this.availableCredit,
  });

  final String id;
  final String name;
  final String type;
  final String? institutionName;
  final String? accountMask;
  final bool isLiquid;
  final bool isLiability;
  final Money? creditLimit;
  final String trackingStartDate;
  final bool archived;

  /// Signed ledger balance from the backend; negative on a credit card means money owed.
  final Money balance;
  final Money? outstanding;
  final Money? availableCredit;

  String get label => accountMask == null ? name : '$name ••$accountMask';
  String get typeLabel => accountTypeLabels[type] ?? type;

  factory Account.fromJson(Json j) => Account(
    id: j['id'] as String,
    name: j['name'] as String,
    type: j['type'] as String,
    institutionName: j['institutionName'] as String?,
    accountMask: j['accountMask'] as String?,
    isLiquid: j['isLiquid'] as bool,
    isLiability: j['isLiability'] as bool,
    creditLimit: _mn(j, 'creditLimit'),
    trackingStartDate: j['trackingStartDate'] as String,
    archived: j['archived'] as bool,
    balance: _m(j, 'balance'),
    outstanding: _mn(j, 'outstanding'),
    availableCredit: _mn(j, 'availableCredit'),
  );
}

class TransactionPage {
  const TransactionPage({required this.items, required this.page, required this.total});

  final List<TransactionItem> items;
  final int page;
  final int total;

  bool get hasMore => items.length < total;
}

class Commitment {
  const Commitment({
    required this.id,
    required this.name,
    required this.amount,
    required this.accountId,
    required this.categoryId,
    required this.frequency,
    required this.intervalCount,
    required this.nextDueDate,
  });

  final String id;
  final String name;
  final Money amount;
  final String accountId;
  final String? categoryId;
  final String frequency;
  final int intervalCount;
  final String nextDueDate;

  String get frequencyLabel => switch (frequency) {
    'once' => 'One-time',
    'weekly' => intervalCount == 1 ? 'Every week' : 'Every $intervalCount weeks',
    'monthly' => intervalCount == 1 ? 'Every month' : 'Every $intervalCount months',
    'yearly' => intervalCount == 1 ? 'Every year' : 'Every $intervalCount years',
    _ => 'Every $intervalCount days',
  };

  factory Commitment.fromJson(Json j) => Commitment(
    id: j['id'] as String,
    name: j['name'] as String,
    amount: _m(j, 'amount'),
    accountId: j['accountId'] as String,
    categoryId: j['categoryId'] as String?,
    frequency: j['frequency'] as String,
    intervalCount: j['intervalCount'] as int,
    nextDueDate: j['nextDueDate'] as String,
  );
}

class Reservation {
  const Reservation({
    required this.id,
    required this.commitmentId,
    required this.accountId,
    required this.name,
    required this.targetAmount,
    required this.reservedAmount,
    required this.shortfall,
    required this.fullyReserved,
    required this.dueDate,
    required this.status,
    required this.overdue,
  });

  final String id;
  final String? commitmentId;
  final String accountId;
  final String name;
  final Money targetAmount;
  final Money reservedAmount;
  final Money shortfall;
  final bool fullyReserved;
  final String dueDate;
  final String status;
  final bool overdue;

  factory Reservation.fromJson(Json j) => Reservation(
    id: j['id'] as String,
    commitmentId: j['commitmentId'] as String?,
    accountId: j['accountId'] as String,
    name: j['name'] as String,
    targetAmount: _m(j, 'targetAmount'),
    reservedAmount: _m(j, 'reservedAmount'),
    shortfall: _m(j, 'shortfall'),
    fullyReserved: j['fullyReserved'] as bool,
    dueDate: j['dueDate'] as String,
    status: j['status'] as String,
    overdue: j['overdue'] as bool,
  );
}

const goalKindLabels = {
  'emergency_fund': 'Emergency fund',
  'gadget': 'Gadget',
  'vacation': 'Vacation',
  'education': 'Education',
  'vehicle': 'Vehicle',
  'savings': 'Savings',
  'custom': 'Other',
};

class Goal {
  const Goal({
    required this.id,
    required this.name,
    required this.kind,
    required this.targetAmount,
    required this.targetDate,
    required this.monthlyContribution,
    required this.priority,
    required this.accountId,
    required this.allocationMode,
    required this.status,
    required this.saved,
    required this.allocated,
    required this.remaining,
    required this.progressPercent,
    required this.recommendedMonthly,
    required this.estimatedCompletionDate,
    required this.onTrack,
    required this.targetDatePassed,
  });

  final String id;
  final String name;
  final String kind;
  final Money targetAmount;
  final String? targetDate;
  final Money? monthlyContribution;
  final int priority;
  final String? accountId;
  final String allocationMode;
  final String status;
  final Money saved;
  final Money allocated;
  final Money remaining;

  /// Percentage string from the API, e.g. "40.00". Not money; used for the progress bar.
  final String progressPercent;
  final Money? recommendedMonthly;
  final String? estimatedCompletionDate;
  final bool? onTrack;
  final bool targetDatePassed;

  bool get reserves => allocationMode == 'reserve';
  String get kindLabel => goalKindLabels[kind] ?? kind;

  factory Goal.fromJson(Json j) => Goal(
    id: j['id'] as String,
    name: j['name'] as String,
    kind: j['kind'] as String,
    targetAmount: _m(j, 'targetAmount'),
    targetDate: j['targetDate'] as String?,
    monthlyContribution: _mn(j, 'monthlyContribution'),
    priority: j['priority'] as int,
    accountId: j['accountId'] as String?,
    allocationMode: j['allocationMode'] as String,
    status: j['status'] as String,
    saved: _m(j, 'saved'),
    allocated: _m(j, 'allocated'),
    remaining: _m(j, 'remaining'),
    progressPercent: j['progressPercent'] as String,
    recommendedMonthly: _mn(j, 'recommendedMonthly'),
    estimatedCompletionDate: j['estimatedCompletionDate'] as String?,
    onTrack: j['onTrack'] as bool?,
    targetDatePassed: j['targetDatePassed'] as bool,
  );
}

class GoalContribution {
  const GoalContribution({required this.id, required this.amount, required this.type, required this.date, required this.note, required this.reversed});

  final String id;
  final Money amount;
  final String type;
  final String date;
  final String? note;
  final bool reversed;

  factory GoalContribution.fromJson(Json j) => GoalContribution(
    id: j['id'] as String,
    amount: _m(j, 'amount'),
    type: j['type'] as String,
    date: j['date'] as String,
    note: j['note'] as String?,
    reversed: j['reversed'] as bool,
  );
}

class GoalDetail {
  const GoalDetail({required this.goal, required this.contributions});

  final Goal goal;
  final List<GoalContribution> contributions;

  factory GoalDetail.fromJson(Json j) =>
      GoalDetail(goal: Goal.fromJson(j), contributions: (j['contributions'] as List).map((c) => GoalContribution.fromJson(c as Json)).toList());
}

class CategoryTotal {
  const CategoryTotal({required this.name, required this.total, required this.sharePercent, required this.count});

  final String name;
  final Money total;
  final String sharePercent;
  final int count;

  factory CategoryTotal.fromJson(Json j) =>
      CategoryTotal(name: j['name'] as String, total: _m(j, 'total'), sharePercent: j['sharePercent'] as String, count: j['count'] as int);
}

class MonthlyReport {
  const MonthlyReport({
    required this.month,
    required this.income,
    required this.expenses,
    required this.net,
    required this.savingsRatePercent,
    required this.expenseCount,
    required this.essential,
    required this.nonEssential,
    required this.planned,
    required this.unplanned,
    required this.expensesByCategory,
    required this.incomeByCategory,
    required this.largestExpenses,
    required this.previousMonth,
    required this.previousIncome,
    required this.previousExpenses,
    required this.incomeChange,
    required this.expensesChange,
    required this.notes,
  });

  final String month;
  final Money income;
  final Money expenses;
  final Money net;
  final String? savingsRatePercent;
  final int expenseCount;
  final Money essential;
  final Money nonEssential;
  final Money planned;
  final Money unplanned;
  final List<CategoryTotal> expensesByCategory;
  final List<CategoryTotal> incomeByCategory;
  final List<(String label, Money amount, String? category, DateTime at)> largestExpenses;
  final String previousMonth;
  final Money previousIncome;
  final Money previousExpenses;
  final Money incomeChange;
  final Money expensesChange;
  final List<String> notes;

  factory MonthlyReport.fromJson(Json j) {
    final prev = j['previousMonth'] as Json;
    return MonthlyReport(
      month: j['month'] as String,
      income: _m(j, 'income'),
      expenses: _m(j, 'expenses'),
      net: _m(j, 'net'),
      savingsRatePercent: j['savingsRatePercent'] as String?,
      expenseCount: j['expenseCount'] as int,
      essential: _m(j, 'essential'),
      nonEssential: _m(j, 'nonEssential'),
      planned: _m(j, 'planned'),
      unplanned: _m(j, 'unplanned'),
      expensesByCategory: (j['expensesByCategory'] as List).map((c) => CategoryTotal.fromJson(c as Json)).toList(),
      incomeByCategory: (j['incomeByCategory'] as List).map((c) => CategoryTotal.fromJson(c as Json)).toList(),
      largestExpenses: [
        for (final e in (j['largestExpenses'] as List).cast<Json>())
          (e['label'] as String, _m(e, 'amount'), e['category'] as String?, DateTime.parse(e['occurredAt'] as String)),
      ],
      previousMonth: prev['month'] as String,
      previousIncome: _m(prev, 'income'),
      previousExpenses: _m(prev, 'expenses'),
      incomeChange: _m(prev, 'incomeChange'),
      expensesChange: _m(prev, 'expensesChange'),
      notes: (j['notes'] as List).cast<String>(),
    );
  }
}

/// Result of creating a transaction: the backend's own record plus any budget alerts it raised.
class CreatedTransaction {
  const CreatedTransaction({required this.transaction, required this.duplicate, required this.budgetAlerts});

  final TransactionItem transaction;
  final bool duplicate;
  final List<String> budgetAlerts;

  factory CreatedTransaction.fromJson(Json j) => CreatedTransaction(
    transaction: TransactionItem.fromJson(j['transaction'] as Json),
    duplicate: (j['transaction'] as Json)['status'] == 'duplicate',
    budgetAlerts: [for (final a in (j['budgetAlerts'] as List? ?? const []).cast<Json>()) a['message'] as String],
  );
}
