import dayjs from "dayjs";

export type FinancialPeriod = {
  id: string;
  period_start: string;
  status: "open" | "closed";
  exported_at: string | null;
  expense_count: number;
  total_amount: number;
};

export function currentPeriodStart() {
  return dayjs().startOf("month").format("YYYY-MM-DD");
}

export function financialPeriodLabel(periodStart: string, prefix = true) {
  const label = `THÁNG ${dayjs(periodStart).format("M")} NĂM ${dayjs(periodStart).format("YYYY")}`;
  return prefix ? `KỲ ${label}` : label;
}

export function financialPeriodShortLabel(periodStart: string) {
  return dayjs(periodStart).format("MM/YYYY");
}

export function financialPeriodEnd(periodStart: string) {
  return dayjs(periodStart).add(1, "month").format("YYYY-MM-DD");
}

