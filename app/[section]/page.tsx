import { notFound } from "next/navigation";
import AuthenticatedDashboard from "../authenticated-dashboard";

const dashboardSections = new Set(["dashboard", "room", "expenses", "people-costs", "reports", "members"]);

export default async function DashboardSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!dashboardSections.has(section)) notFound();
  return <AuthenticatedDashboard />;
}
