// شبكات ترتيب الامتياز. "أضيق أو مساوٍ" هو الاختبار الوحيد المسموح به عند الانتقال
// من الواصف إلى الاستدعاء ثم إلى قرار السياسة. أي توسيع في أي محور هو تصعيد امتياز.

export const NETWORK_RANK: Readonly<Record<string, number>> = {
  NONE: 0,
  BROKERED_EGRESS: 1,
  UNRESTRICTED: 2,
};

export const FILESYSTEM_RANK: Readonly<Record<string, number>> = {
  NONE: 0,
  EXPLICIT_GRANT: 1,
  USER_SCOPE: 2,
  UNRESTRICTED: 3,
};

export const CONFINEMENT_RANK: Readonly<Record<string, number>> = {
  CONFINED: 0,
  NONE: 1,
};

export const PROCESS_TREE_RANK: Readonly<Record<string, number>> = {
  CONFINED_KILL_ON_CLOSE: 0,
  UNCONSTRAINED: 1,
};

export const HANDLE_RANK: Readonly<Record<string, number>> = {
  NONE: 0,
  EXPLICIT_ONLY: 1,
};

export const ENVIRONMENT_RANK: Readonly<Record<string, number>> = {
  EXPLICIT_ONLY: 0,
  INHERITED: 1,
};

/** رتبة قيمة غير معروفة تُعامل كأعلى امتياز ممكن، حتى لا يمر المجهول بوصفه آمنًا. */
function rank(table: Readonly<Record<string, number>>, value: unknown): number {
  if (typeof value !== "string") return Number.POSITIVE_INFINITY;
  const found = table[value];
  return found === undefined ? Number.POSITIVE_INFINITY : found;
}

export interface AxisWidening {
  readonly axis: string;
  readonly from: unknown;
  readonly to: unknown;
}

/** يعيد المحاور التي وسّع فيها `candidate` امتيازات `baseline`. القائمة الفارغة تعني عدم التصعيد. */
export function widenedAxes(
  baseline: Record<string, unknown> | undefined,
  candidate: Record<string, unknown> | undefined,
): AxisWidening[] {
  if (baseline === undefined || candidate === undefined) return [];

  const axes: ReadonlyArray<readonly [string, Readonly<Record<string, number>>]> = [
    ["confinement", CONFINEMENT_RANK],
    ["filesystem_scope", FILESYSTEM_RANK],
    ["process_tree", PROCESS_TREE_RANK],
    ["network", NETWORK_RANK],
    ["handle_inheritance", HANDLE_RANK],
    ["environment", ENVIRONMENT_RANK],
  ];

  const widened: AxisWidening[] = [];
  for (const [axis, table] of axes) {
    if (rank(table, candidate[axis]) > rank(table, baseline[axis])) {
      widened.push({ axis, from: baseline[axis], to: candidate[axis] });
    }
  }
  return widened;
}
