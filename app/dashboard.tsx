"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  DatePicker,
  Dropdown,
  Drawer,
  Empty,
  Flex,
  Form,
  Grid,
  Image,
  Input,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tabs,
  Typography,
} from "antd";
import {
  BankOutlined,
  BellOutlined,
  CalendarOutlined,
  CreditCardOutlined,
  CopyOutlined,
  DashboardOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SettingOutlined,
  TeamOutlined,
  UnlockOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";
import { currentPeriodStart, financialPeriodLabel, financialPeriodShortLabel, type FinancialPeriod } from "@/lib/financial-periods";
import { createPeriodXlsx, downloadPeriodXlsx } from "@/lib/period-xlsx";
import { ExpensesView, MembersView, PaymentQrManagement, PeopleCostsView, ReportView, RoomsView, type OrganizationUser } from "./management-views";
import SupportFloatingActions, { SupportSettingsManagement } from "./support-floating-actions";

type DashboardData = { organization_id: string; property_id: string; property_name: string };
type AccountProfileForm = { username: string; full_name: string; phone?: string; bank_account?: string; bank_name?: string; new_password?: string; confirm_password?: string };

const emptyData: DashboardData = { organization_id: "", property_id: "", property_name: "708 La Thành" };
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

const menuItems = [
  { key: "Tổng quan", icon: <DashboardOutlined />, label: "Tổng quan" },
  { key: "Phòng", icon: <HomeOutlined />, label: "Phòng" },
  { key: "Chi phí", icon: <WalletOutlined />, label: "Chi phí" },
  { key: "Chi phí từng người", icon: <UserOutlined />, label: "Chi phí từng người" },
  { key: "Báo cáo", icon: <FileTextOutlined />, label: "Báo cáo" },
];

const adminMenuItem = { key: "Quản trị", icon: <SettingOutlined />, label: "Quản trị" };

const tabRoutes: Record<string, string> = {
  "Tổng quan": "/dashboard",
  "Phòng": "/room",
  "Chi phí": "/expenses",
  "Chi phí từng người": "/people-costs",
  "Báo cáo": "/reports",
  "Quản trị": "/admin",
};

const routeTabs = {
  ...Object.fromEntries(Object.entries(tabRoutes).map(([tab, route]) => [route, tab])),
  "/members": "Quản trị",
} as Record<string, string>;

export default function Dashboard({ userId, userEmail, userName, avatarUrl }: { userId: string; userEmail: string; userName: string; avatarUrl: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const periodFromUrl = searchParams.get("period");
  const [activeTab, setActiveTab] = useState(() => routeTabs[pathname] ?? "Tổng quan");
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [organizationUsers, setOrganizationUsers] = useState<OrganizationUser[]>([]);
  const [currentRole, setCurrentRole] = useState<"admin" | "member">("member");
  const [accountUsername, setAccountUsername] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileForm] = Form.useForm<AccountProfileForm>();
  const [periods, setPeriods] = useState<FinancialPeriod[]>([]);
  const [selectedPeriodStart, setSelectedPeriodStart] = useState(currentPeriodStart);
  const [periodMonth, setPeriodMonth] = useState(() => dayjs(currentPeriodStart()));
  const [periodSaving, setPeriodSaving] = useState(false);
  const periodSelectionReady = useRef(false);
  const screens = Grid.useBreakpoint();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: setupError } = await supabase.rpc("bootstrap_current_user");
    if (setupError) {
      setError(setupError.message.includes("access was removed")
        ? "Quyền truy cập của tài khoản này đã bị quản trị viên thu hồi."
        : setupError.message.includes("waiting for an administrator")
          ? "Tài khoản đã đăng ký nhưng chưa được gán với thành viên. Hãy liên hệ quản trị viên."
          : "Chưa thể khởi tạo dữ liệu. Hãy chạy lần lượt các migration đến 0010 trong Supabase.");
      setLoading(false);
      return;
    }
    const { data: result, error: dataError } = await supabase.rpc("get_dashboard_data");
    if (dataError || !result) setError("Không tải được số liệu. Vui lòng thử lại.");
    else setData(result as DashboardData);

    const { data: membership } = await supabase.rpc("get_current_membership");
    const role = (membership as { role?: string } | null)?.role;
    const normalizedRole = role === "admin" ? "admin" : "member";
    const { data: users, error: usersError } = await supabase.rpc("get_household_members");
    if (usersError) {
      setError(`Không tải được danh sách thành viên: ${usersError.message}`);
      setOrganizationUsers([]);
    }
    if (Array.isArray(users)) {
      const uniqueUsers = Array.from(new Map((users as OrganizationUser[]).map((user) => [user.user_id, {
        ...user,
        auth_user_id: user.auth_user_id ?? null,
        role: user.role ?? "member",
        phone: user.phone ?? "",
        bank_account: user.bank_account ?? "",
        bank_name: user.bank_name ?? "",
        is_linked: Boolean(user.is_linked),
      }])).values());
      setOrganizationUsers(uniqueUsers);
    }
    const { data: accountProfile } = await supabase.from("user_profiles").select("username").eq("user_id", userId).maybeSingle();
    setAccountUsername((accountProfile as { username?: string } | null)?.username ?? "");
    setCurrentRole(normalizedRole);
    setLoading(false);
  }, [userId]);

  const loadFinancialPeriods = useCallback(async () => {
    if (!data.property_id) return;
    const { data: rows, error: periodError } = await createClient().rpc("get_financial_periods", { target_property_id: data.property_id });
    if (periodError) {
      setError("Không tải được danh sách kỳ tài chính. Hãy chạy migration 0013.");
      setPeriods([]);
      return;
    }
    const normalized = ((rows ?? []) as FinancialPeriod[]).map((period) => ({
      ...period,
      is_default: Boolean(period.is_default),
      expense_count: Number(period.expense_count),
      total_amount: Number(period.total_amount),
    }));
    setPeriods(normalized);
    setSelectedPeriodStart((current) => {
      const urlPeriodIsAvailable = Boolean(periodFromUrl) && (
        normalized.some((period) => period.period_start === periodFromUrl)
        || periodFromUrl === currentPeriodStart()
      );
      if (urlPeriodIsAvailable && periodFromUrl) {
        periodSelectionReady.current = true;
        return periodFromUrl;
      }
      const preferred = normalized.find((period) => period.is_default)?.period_start
        ?? normalized[0]?.period_start
        ?? currentPeriodStart();
      if (!periodSelectionReady.current) {
        periodSelectionReady.current = true;
        return preferred;
      }
      const currentIsAvailable = normalized.some((period) => period.period_start === current)
        || current === currentPeriodStart();
      return currentIsAvailable ? current : preferred;
    });
  }, [data.property_id, periodFromUrl]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { void loadFinancialPeriods(); }, [loadFinancialPeriods]);
  useEffect(() => { if (screens.lg) setMobileMenuOpen(false); }, [screens.lg]);
  useEffect(() => { setActiveTab(routeTabs[pathname] ?? "Tổng quan"); }, [pathname]);
  useEffect(() => {
    if (!loading && currentRole !== "admin" && activeTab === "Quản trị") {
      router.replace(`/dashboard?period=${encodeURIComponent(selectedPeriodStart)}`);
    }
  }, [activeTab, currentRole, loading, router, selectedPeriodStart]);

  const currentMember = useMemo(() => organizationUsers.find((user) => user.email.toLowerCase() === userEmail.toLowerCase()) ?? null, [organizationUsers, userEmail]);
  const displayName = currentMember?.full_name || userName || userEmail.split("@")[0] || "Chủ trọ";
  const initials = displayName.split(" ").filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();
  const selectedPeriod = periods.find((period) => period.period_start === selectedPeriodStart) ?? null;
  const periodLabel = financialPeriodLabel(selectedPeriodStart);
  const periodOptions = useMemo(() => {
    const options = periods.map((period) => ({
      value: period.period_start,
      label: `${financialPeriodShortLabel(period.period_start)}${period.status === "closed" ? " · Đã đóng" : ""}`,
    }));
    if (!options.some((option) => option.value === currentPeriodStart())) {
      options.unshift({ value: currentPeriodStart(), label: `${financialPeriodShortLabel(currentPeriodStart())} · Chưa tạo` });
    }
    return options;
  }, [periods]);
  const visibleMenuItems = currentRole === "admin" ? [...menuItems, adminMenuItem] : menuItems;

  function selectViewingPeriod(periodStart: string) {
    setSelectedPeriodStart(periodStart);
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", periodStart);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function openAccountProfile() {
    setProfileError("");
    profileForm.setFieldsValue({
      username: accountUsername,
      full_name: currentMember?.full_name || displayName,
      phone: currentMember?.phone || "",
      bank_account: currentMember?.bank_account || "",
      bank_name: currentMember?.bank_name || "",
      new_password: "",
      confirm_password: "",
    });
    setProfileOpen(true);
  }

  async function saveAccountProfile(values: AccountProfileForm) {
    setProfileSaving(true);
    setProfileError("");
    const supabase = createClient();
    const { error: profileUpdateError } = await supabase.rpc("update_my_account_profile", {
      target_username: values.username.trim(),
      target_full_name: values.full_name.trim(),
      target_phone: values.phone?.trim() || "",
      target_bank_account: values.bank_account?.trim() || "",
      target_bank_name: values.bank_name?.trim() || "",
    });
    if (profileUpdateError) {
      setProfileSaving(false);
      setProfileError(profileUpdateError.code === "23505" || profileUpdateError.message.includes("duplicate") ? "Tên đăng nhập này đã được sử dụng." : profileUpdateError.message.includes("Invalid username") ? "Tên đăng nhập chưa đúng định dạng." : "Không thể cập nhật hồ sơ. Hãy chạy migration 0012.");
      return;
    }

    const authPayload: { data: { full_name: string; username: string }; password?: string } = {
      data: { full_name: values.full_name.trim(), username: values.username.trim() },
    };
    if (values.new_password) authPayload.password = values.new_password;
    const { error: authUpdateError } = await supabase.auth.updateUser(authPayload);
    setProfileSaving(false);
    if (authUpdateError) {
      setProfileError(authUpdateError.message.includes("same password") ? "Mật khẩu mới phải khác mật khẩu hiện tại." : authUpdateError.message);
      return;
    }

    setAccountUsername(values.username.trim());
    setProfileOpen(false);
    setNotice(values.new_password ? "Đã cập nhật hồ sơ và mật khẩu. Lần sau bạn có thể đăng nhập bằng tên tài khoản." : "Đã cập nhật thông tin tài khoản.");
    await loadDashboard();
    router.refresh();
  }

  async function createFinancialPeriod() {
    if (!data.property_id || currentRole !== "admin") return;
    setPeriodSaving(true);
    const periodStart = periodMonth.startOf("month").format("YYYY-MM-DD");
    const { error: createError } = await createClient().rpc("create_financial_period", {
      target_property_id: data.property_id,
      target_period_start: periodStart,
    });
    setPeriodSaving(false);
    if (createError) {
      setNotice("Không thể tạo kỳ tài chính. Hãy kiểm tra quyền quản trị và migration 0013.");
      return;
    }
    selectViewingPeriod(periodStart);
    setNotice(`Đã tạo kỳ ${financialPeriodShortLabel(periodStart)}.`);
    await loadFinancialPeriods();
  }

  async function setPeriodStatus(period: FinancialPeriod) {
    const nextStatus = period.status === "open" ? "closed" : "open";
    setPeriodSaving(true);
    const { error: statusError } = await createClient().rpc("set_financial_period_status", {
      target_period_id: period.id,
      target_status: nextStatus,
    });
    setPeriodSaving(false);
    if (statusError) {
      setNotice("Không thể cập nhật trạng thái kỳ.");
      return;
    }
    setNotice(nextStatus === "closed" ? `Đã đóng kỳ ${financialPeriodShortLabel(period.period_start)}.` : `Đã mở lại kỳ ${financialPeriodShortLabel(period.period_start)}.`);
    await loadFinancialPeriods();
  }

  async function setDefaultFinancialPeriod(period: FinancialPeriod) {
    setPeriodSaving(true);
    const { error: defaultError } = await createClient().rpc("set_default_financial_period", {
      target_period_id: period.id,
    });
    setPeriodSaving(false);
    if (defaultError) {
      setNotice("Không thể đặt kỳ mặc định. Hãy kiểm tra migration mới nhất.");
      return;
    }
    selectViewingPeriod(period.period_start);
    setNotice(`Đã đặt kỳ ${financialPeriodShortLabel(period.period_start)} làm mặc định.`);
    await loadFinancialPeriods();
  }

  async function exportFinancialPeriod(period: FinancialPeriod) {
    setPeriodSaving(true);
    const supabase = createClient();
    const [{ data: expenseRows, error: expenseError }, { data: settlementRows, error: settlementError }] = await Promise.all([
      supabase.from("expenses")
        .select("id, category, amount, expense_date, payer_member_id, status, reference_code, note, expense_member_participants(member_id, allocated_amount)")
        .eq("financial_period_id", period.id)
        .order("expense_date"),
      supabase.from("household_member_settlements")
        .select("member_id, is_settled")
        .eq("financial_period_id", period.id),
    ]);
    if (expenseError || settlementError) {
      setPeriodSaving(false);
      setNotice("Không tải được dữ liệu để xuất Excel.");
      return;
    }

    const nameByMember = new Map(organizationUsers.map((user) => [user.user_id, user.full_name]));
    const expenses = ((expenseRows ?? []) as Array<{
      category: string; amount: number; expense_date: string; payer_member_id: string | null;
      status: string; reference_code: string | null; note: string | null;
      expense_member_participants: Array<{ member_id: string; allocated_amount: number }>;
    }>).map((expense) => ({
      ...expense,
      amount: Number(expense.amount),
      expense_member_participants: (expense.expense_member_participants ?? []).map((participant) => ({ ...participant, allocated_amount: Number(participant.allocated_amount) })),
    }));
    const paidMap = new Map(((settlementRows ?? []) as Array<{ member_id: string; is_settled: boolean }>).map((settlement) => [settlement.member_id, settlement.is_settled]));
    const people = organizationUsers.filter((user) => user.role !== "admin").map((user) => {
      const allocated = expenses.reduce((sum, expense) => sum + (expense.expense_member_participants.find((participant) => participant.member_id === user.user_id)?.allocated_amount ?? 0), 0);
      const advanced = expenses.filter((expense) => expense.payer_member_id === user.user_id).reduce((sum, expense) => sum + expense.amount, 0);
      return { full_name: user.full_name, allocated, advanced, balance: allocated - advanced, paid: paidMap.get(user.user_id) ?? false, bank_account: user.bank_account, bank_name: user.bank_name };
    });
    const xlsxContent = createPeriodXlsx({
      propertyName: data.property_name || "708 La Thành",
      periodLabel: financialPeriodLabel(period.period_start),
      expenses: expenses.map((expense) => ({
        category: expense.category,
        amount: expense.amount,
        expense_date: expense.expense_date,
        payer: nameByMember.get(expense.payer_member_id ?? "") ?? "—",
        participants: expense.expense_member_participants.map((participant) => nameByMember.get(participant.member_id)).filter(Boolean).join(", "),
        status: expense.status === "completed" ? "Hoàn thành" : "Chờ xử lý",
        reference_code: expense.reference_code ?? "",
        note: expense.note ?? "",
      })),
      people,
    });
    downloadPeriodXlsx(xlsxContent, `708-la-thanh-${dayjs(period.period_start).format("YYYY-MM")}.xlsx`);
    const { error: markError } = await supabase.rpc("mark_financial_period_exported", { target_period_id: period.id });
    setPeriodSaving(false);
    if (markError) {
      setNotice("Đã tải Excel nhưng chưa ghi nhận được thời điểm xuất kỳ.");
      return;
    }
    setNotice(`Đã xuất Excel kỳ ${financialPeriodShortLabel(period.period_start)}.`);
    await loadFinancialPeriods();
  }

  async function deleteFinancialPeriod(period: FinancialPeriod) {
    setPeriodSaving(true);
    const { error: deleteError } = await createClient().rpc("delete_financial_period", { target_period_id: period.id });
    setPeriodSaving(false);
    if (deleteError) {
      setNotice(deleteError.message.includes("Export") ? "Cần xuất Excel trước khi xóa kỳ." : "Không thể xóa kỳ tài chính.");
      return;
    }
    if (selectedPeriodStart === period.period_start) {
      selectViewingPeriod(periods.find((item) => item.is_default && item.id !== period.id)?.period_start ?? currentPeriodStart());
    }
    setNotice(`Đã xóa kỳ ${financialPeriodShortLabel(period.period_start)} và dữ liệu chi phí liên quan.`);
    await loadFinancialPeriods();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function chooseTab(label: string) {
    setActiveTab(label);
    setMobileMenuOpen(false);
    const targetRoute = tabRoutes[label] ?? "/dashboard";
    const periodInAddressBar = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("period")
      : null;
    const viewingPeriod = periodInAddressBar || periodFromUrl || selectedPeriodStart;
    router.push(`${targetRoute}?period=${encodeURIComponent(viewingPeriod)}`);
  }

  const navigation = (
    <Menu
      mode="inline"
      selectedKeys={[activeTab]}
      items={visibleMenuItems}
      onClick={({ key }) => chooseTab(key)}
      className="main-menu"
    />
  );

  const brand = (
    <div className="app-brand">
      <span className="brand-badge">708</span>
      <span>La Thành</span>
    </div>
  );

  const accountMenu = {
    items: [
      { key: "summary", label: <div className="account-menu-summary"><Avatar size={38} src={avatarUrl || undefined}>{initials}</Avatar><div><Typography.Text strong>{displayName}</Typography.Text><Typography.Text type="secondary">@{accountUsername || "tài-khoản"}</Typography.Text></div></div> },
      { type: "divider" as const },
      { key: "profile", icon: <UserOutlined />, label: "Thông tin tài khoản" },
      { key: "logout", icon: <LogoutOutlined />, label: "Đăng xuất", danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "summary" || key === "profile") openAccountProfile();
      if (key === "logout") void signOut();
    },
  };

  return (
    <Layout className="dashboard-layout">
      <Layout.Sider width={256} className="desktop-sider" theme="light">
        {brand}
        {navigation}
        <div className="sider-account">
          <Flex align="center" gap={10}>
            <Avatar src={avatarUrl || undefined} style={{ background: "#dff3ea", color: "#087a58", fontWeight: 800 }}>{initials}</Avatar>
            <div className="account-copy">
              <Typography.Text strong>{displayName}</Typography.Text>
              <Tag variant="filled" color={currentRole === "admin" ? "success" : "default"}>{currentRole === "admin" ? "Quản trị viên" : "Thành viên"}</Tag>
            </div>
          </Flex>
        </div>
      </Layout.Sider>

      <Drawer
        placement="left"
        size={286}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        title={brand}
        className="mobile-drawer"
      >
        {navigation}
      </Drawer>

      <Layout>
        <Layout.Content className="dashboard-content">
          <header className="page-header">
            <Flex align="center" gap={14}>
              <Button className="mobile-menu-button" icon={<MenuOutlined />} onClick={() => setMobileMenuOpen(true)} />
              <div>
                <Flex align="center" gap={8} wrap className="period-header-row">
                  <Typography.Text className="period-label">{periodLabel}</Typography.Text>
                  <Select
                    size="small"
                    value={selectedPeriodStart}
                    onChange={selectViewingPeriod}
                    options={periodOptions}
                    className="period-switcher"
                    aria-label="Chọn kỳ tài chính"
                  />
                </Flex>
                <Typography.Title level={2}>{activeTab}</Typography.Title>
                <Typography.Text className="page-subtitle">
                  {activeTab === "Tổng quan" ? "Theo dõi vận hành và tài chính tại một nơi" : data.property_name}
                </Typography.Text>
              </div>
            </Flex>
            <Space className="header-actions">
              <Button shape="circle" icon={<BellOutlined />} aria-label="Thông báo" />
              <Dropdown menu={accountMenu} trigger={["click"]} placement="bottomRight">
                <Button type="text" shape="circle" className="account-menu-trigger" aria-label="Mở thông tin tài khoản"><Avatar src={avatarUrl || undefined} className="header-avatar">{initials}</Avatar></Button>
              </Dropdown>
            </Space>
          </header>

          {notice && <Alert className="page-alert" type="success" showIcon closable title={notice} onClose={() => setNotice("")} />}
          {error && <Alert className="page-alert" type="error" showIcon title={error} action={<Button size="small" onClick={() => void loadDashboard()}>Thử lại</Button>} />}

          {activeTab === "Tổng quan" && (
            <Overview
              organizationId={data.organization_id}
              propertyId={data.property_id}
              currentMember={currentMember}
              users={organizationUsers}
              displayName={displayName}
              currentRole={currentRole}
              financialPeriod={selectedPeriod}
              periodStart={selectedPeriodStart}
              onNotice={setNotice}
            />
          )}
          {activeTab === "Phòng" && <RoomsView onNotice={setNotice} organizationId={data.organization_id} propertyId={data.property_id} users={organizationUsers} />}
          {activeTab === "Chi phí" && <ExpensesView onNotice={setNotice} users={organizationUsers} currentUserEmail={userEmail} organizationId={data.organization_id} propertyId={data.property_id} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Chi phí từng người" && <PeopleCostsView onNotice={setNotice} users={organizationUsers} organizationId={data.organization_id} propertyId={data.property_id} currentMemberId={currentMember?.user_id ?? null} canManageSettlements={currentRole === "admin"} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Báo cáo" && <ReportView users={organizationUsers} organizationId={data.organization_id} propertyId={data.property_id} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Quản trị" && currentRole === "admin" && (
            <AdminManagementView
              organizationId={data.organization_id}
              propertyId={data.property_id}
              users={organizationUsers}
              currentUserEmail={userEmail}
              periods={periods}
              selectedPeriodStart={selectedPeriodStart}
              periodMonth={periodMonth}
              periodSaving={periodSaving}
              onPeriodMonthChange={setPeriodMonth}
              onSelectPeriod={selectViewingPeriod}
              onCreatePeriod={() => void createFinancialPeriod()}
              onSetDefaultPeriod={(period) => void setDefaultFinancialPeriod(period)}
              onSetPeriodStatus={(period) => void setPeriodStatus(period)}
              onExportPeriod={(period) => void exportFinancialPeriod(period)}
              onDeletePeriod={(period) => void deleteFinancialPeriod(period)}
              onNotice={setNotice}
              onMembersChanged={() => void loadDashboard()}
            />
          )}
        </Layout.Content>
      </Layout>

      <Modal title="Thông tin tài khoản" open={profileOpen} onCancel={() => setProfileOpen(false)} footer={null} centered width={620} className="account-profile-modal" forceRender>
        <div className="account-profile-heading">
          <Avatar size={58} src={avatarUrl || undefined}>{initials}</Avatar>
          <div><Typography.Title level={4}>{displayName}</Typography.Title><Typography.Text type="secondary">{userEmail}</Typography.Text></div>
        </div>
        {profileError && <Alert type="error" showIcon title={profileError} className="account-profile-error" />}
        <Form form={profileForm} layout="vertical" onFinish={saveAccountProfile} requiredMark={false}>
          <Row gutter={14}>
            <Col xs={24} sm={12}><Form.Item name="full_name" label="Tên hiển thị" rules={[{ required: true, message: "Nhập tên hiển thị" }, { max: 120 }]}><Input prefix={<UserOutlined />} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="username" label="Tên đăng nhập" extra="Dùng tên này để đăng nhập thay cho Google" rules={[{ required: true, message: "Nhập tên đăng nhập" }, { pattern: /^[a-zA-Z0-9._-]{3,32}$/, message: "Dùng 3–32 ký tự: chữ, số, dấu chấm, gạch ngang hoặc gạch dưới" }]}><Input autoComplete="username" /></Form.Item></Col>
          </Row>
          <Row gutter={14}>
            <Col xs={24} sm={12}><Form.Item name="phone" label="Số điện thoại"><Input inputMode="tel" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="bank_name" label="Ngân hàng"><Input placeholder="Ví dụ: Vietcombank" /></Form.Item></Col>
          </Row>
          <Form.Item name="bank_account" label="Số tài khoản ngân hàng"><Input inputMode="numeric" /></Form.Item>
          <div className="account-password-section"><Typography.Text strong>Thiết lập mật khẩu đăng nhập</Typography.Text><Typography.Text type="secondary">Tài khoản Google có thể tạo mật khẩu để đăng nhập bằng tên tài khoản vào lần sau.</Typography.Text></div>
          <Row gutter={14}>
            <Col xs={24} sm={12}><Form.Item name="new_password" label="Mật khẩu mới" rules={[{ min: 6, message: "Mật khẩu cần ít nhất 6 ký tự" }]}><Input.Password autoComplete="new-password" placeholder="Để trống nếu không đổi" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="confirm_password" label="Nhập lại mật khẩu" dependencies={["new_password"]} rules={[({ getFieldValue }) => ({ validator(_, value) { if (!getFieldValue("new_password") || value === getFieldValue("new_password")) return Promise.resolve(); return Promise.reject(new Error("Mật khẩu nhập lại chưa khớp")); } })]}><Input.Password autoComplete="new-password" /></Form.Item></Col>
          </Row>
          <Flex justify="space-between" gap={12} wrap>
            <Button danger icon={<LogoutOutlined />} onClick={() => void signOut()}>Đăng xuất</Button>
            <Space><Button onClick={() => setProfileOpen(false)}>Hủy</Button><Button type="primary" htmlType="submit" loading={profileSaving}>Lưu thay đổi</Button></Space>
          </Flex>
        </Form>
      </Modal>

      <SupportFloatingActions
        organizationId={data.organization_id}
        propertyId={data.property_id}
        canManage={false}
        onNotice={setNotice}
      />
    </Layout>
  );
}

function AdminManagementView({
  organizationId,
  propertyId,
  users,
  currentUserEmail,
  periods,
  selectedPeriodStart,
  periodMonth,
  periodSaving,
  onPeriodMonthChange,
  onSelectPeriod,
  onCreatePeriod,
  onSetDefaultPeriod,
  onSetPeriodStatus,
  onExportPeriod,
  onDeletePeriod,
  onNotice,
  onMembersChanged,
}: {
  organizationId: string;
  propertyId: string;
  users: OrganizationUser[];
  currentUserEmail: string;
  periods: FinancialPeriod[];
  selectedPeriodStart: string;
  periodMonth: ReturnType<typeof dayjs>;
  periodSaving: boolean;
  onPeriodMonthChange: (value: ReturnType<typeof dayjs>) => void;
  onSelectPeriod: (periodStart: string) => void;
  onCreatePeriod: () => void;
  onSetDefaultPeriod: (period: FinancialPeriod) => void;
  onSetPeriodStatus: (period: FinancialPeriod) => void;
  onExportPeriod: (period: FinancialPeriod) => void;
  onDeletePeriod: (period: FinancialPeriod) => void;
  onNotice: (message: string) => void;
  onMembersChanged: () => void;
}) {
  const periodManagement = (
    <Card
      className="section-card admin-hub-card"
      title={<div><span>Quản lý kỳ tài chính</span><Typography.Text type="secondary" className="card-title-note">Kỳ mặc định sẽ tự động được chọn mỗi khi mở ứng dụng</Typography.Text></div>}
    >
      <Alert type="info" showIcon title="Xuất Excel trước khi xóa kỳ để lưu bản đối soát." />
      <Flex gap={10} wrap className="period-create-row">
        <DatePicker picker="month" allowClear={false} value={periodMonth} onChange={(value) => value && onPeriodMonthChange(value)} format="MM/YYYY" />
        <Button type="primary" icon={<PlusOutlined />} loading={periodSaving} onClick={onCreatePeriod}>Tạo kỳ</Button>
      </Flex>
      <div className="period-manager-list admin-period-list">
        {periods.length ? periods.map((period) => (
          <div className={`period-manager-item ${period.period_start === selectedPeriodStart ? "selected" : ""}`} key={period.id}>
            <div className="period-manager-main">
              <Flex align="center" gap={8} wrap>
                <Typography.Text strong>{financialPeriodLabel(period.period_start)}</Typography.Text>
                <Tag color={period.status === "open" ? "success" : "default"}>{period.status === "open" ? "Đang mở" : "Đã đóng"}</Tag>
                {period.is_default && <Tag color="gold">Mặc định</Tag>}
                {period.exported_at && <Tag color="blue">Đã xuất Excel</Tag>}
              </Flex>
              <Typography.Text type="secondary">{period.expense_count} khoản · {money.format(period.total_amount)}</Typography.Text>
            </div>
            <Space wrap>
              <Button size="small" onClick={() => onSelectPeriod(period.period_start)}>{period.period_start === selectedPeriodStart ? "Đang xem" : "Xem kỳ"}</Button>
              <Button size="small" type={period.is_default ? "primary" : "default"} ghost={period.is_default} icon={<CalendarOutlined />} disabled={period.is_default} loading={periodSaving} onClick={() => onSetDefaultPeriod(period)}>{period.is_default ? "Kỳ mặc định" : "Đặt mặc định"}</Button>
              <Button size="small" icon={<UnlockOutlined />} onClick={() => onSetPeriodStatus(period)} loading={periodSaving}>{period.status === "open" ? "Đóng kỳ" : "Mở lại"}</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => onExportPeriod(period)} loading={periodSaving}>Xuất Excel</Button>
              <Popconfirm
                title="Xóa toàn bộ dữ liệu kỳ này?"
                description={period.exported_at ? "Khoản chi và trạng thái đối soát của kỳ sẽ bị xóa vĩnh viễn." : "Bạn cần xuất Excel trước khi xóa."}
                okText="Xóa kỳ"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
                disabled={!period.exported_at || period.is_default}
                onConfirm={() => onDeletePeriod(period)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} disabled={!period.exported_at || period.is_default} loading={periodSaving}>Xóa</Button>
              </Popconfirm>
            </Space>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có kỳ tài chính" />}
      </div>
    </Card>
  );

  return (
    <div className="page-stack admin-management-page">
      <Tabs
        className="admin-management-tabs"
        defaultActiveKey="periods"
        items={[
          { key: "periods", label: <Space><CalendarOutlined />Kỳ tài chính</Space>, children: periodManagement },
          { key: "rooms", label: <Space><HomeOutlined />Phòng</Space>, children: <RoomsView organizationId={organizationId} propertyId={propertyId} users={users} onNotice={onNotice} canManage /> },
          { key: "members", label: <Space><TeamOutlined />Thành viên</Space>, children: <MembersView users={users} currentUserEmail={currentUserEmail} onNotice={onNotice} onChanged={onMembersChanged} /> },
          { key: "qr", label: <Space><QrcodeOutlined />Mã QR</Space>, children: <PaymentQrManagement organizationId={organizationId} propertyId={propertyId} onNotice={onNotice} /> },
          { key: "support", label: <Space><SettingOutlined />Hỗ trợ</Space>, children: <SupportSettingsManagement organizationId={organizationId} propertyId={propertyId} onNotice={onNotice} /> },
        ]}
      />
    </div>
  );
}

type PersonalExpenseParticipant = { member_id: string; allocated_amount: number };
type PersonalExpense = {
  id: string;
  category: string;
  amount: number;
  expense_date: string;
  payer_member_id: string | null;
  status: "pending" | "completed";
  reference_code: string | null;
  expense_member_participants: PersonalExpenseParticipant[];
};

function Overview({ organizationId, propertyId, currentMember, users, displayName, currentRole, financialPeriod, periodStart, onNotice }: {
  organizationId: string;
  propertyId: string;
  currentMember: OrganizationUser | null;
  users: OrganizationUser[];
  displayName: string;
  currentRole: "admin" | "member";
  financialPeriod: FinancialPeriod | null;
  periodStart: string;
  onNotice: (message: string) => void;
}) {
  const [expenses, setExpenses] = useState<PersonalExpense[]>([]);
  const [previousExpenses, setPreviousExpenses] = useState<PersonalExpense[]>([]);
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrFileName, setQrFileName] = useState<string | null>(null);
  const [qrAccountName, setQrAccountName] = useState("");
  const [qrBankAccount, setQrBankAccount] = useState("");
  const [qrBankName, setQrBankName] = useState("");
  const [qrLoading, setQrLoading] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);
  const [settlementSaving, setSettlementSaving] = useState(false);

  useEffect(() => {
    async function loadPersonalOverview() {
      if (!organizationId || !propertyId) return;
      setLoading(true);
      setLoadError("");
      const supabase = createClient();
      const previousPeriodStart = dayjs(periodStart).subtract(1, "month").format("YYYY-MM-DD");
      const nextPeriodStart = dayjs(periodStart).add(1, "month").format("YYYY-MM-DD");
      const { data: expenseRows, error: expenseError } = await supabase.from("expenses")
        .select("id, category, amount, expense_date, payer_member_id, status, reference_code, expense_member_participants(member_id, allocated_amount)")
        .eq("organization_id", organizationId)
        .eq("property_id", propertyId)
        .gte("expense_date", previousPeriodStart)
        .lt("expense_date", nextPeriodStart)
        .order("expense_date", { ascending: false });

      let settlementRow: { is_settled?: boolean } | null = null;
      let settlementError: { message?: string } | null = null;
      if (currentMember && currentRole !== "admin" && financialPeriod) {
        const settlementResult = await supabase.from("household_member_settlements")
          .select("is_settled")
          .eq("property_id", propertyId)
          .eq("member_id", currentMember.user_id)
          .eq("financial_period_id", financialPeriod.id)
          .maybeSingle();
        settlementRow = settlementResult.data;
        settlementError = settlementResult.error;
      }

      if (expenseError || settlementError) {
        setLoadError("Không tải được số liệu chi tiêu để so sánh hai kỳ.");
      }
      const normalizedExpenses = ((expenseRows ?? []) as unknown as PersonalExpense[]).map((expense) => ({
        ...expense,
        amount: Number(expense.amount),
        expense_member_participants: (expense.expense_member_participants ?? []).map((participant) => ({
          ...participant,
          allocated_amount: Number(participant.allocated_amount),
        })),
      }));
      setExpenses(normalizedExpenses.filter((expense) => expense.expense_date >= periodStart));
      setPreviousExpenses(normalizedExpenses.filter((expense) => expense.expense_date < periodStart));
      setSettled(Boolean(settlementRow?.is_settled));
      setLoading(false);
    }

    void loadPersonalOverview();
  }, [currentMember, currentRole, financialPeriod, organizationId, periodStart, propertyId]);

  useEffect(() => {
    async function loadPaymentQr() {
      if (!propertyId) return;
      setQrLoading(true);
      const { data, error } = await createClient().from("payment_qr_settings")
        .select("qr_image_data, file_name, account_name, bank_account, bank_name")
        .eq("property_id", propertyId)
        .maybeSingle();
      if (error || !data) {
        setQrImage(null);
        setQrFileName(null);
        setQrAccountName("");
        setQrBankAccount("");
        setQrBankName("");
      } else {
        const setting = data as { qr_image_data: string | null; file_name: string | null; account_name: string | null; bank_account: string | null; bank_name: string | null };
        setQrImage(setting.qr_image_data);
        setQrFileName(setting.file_name);
        setQrAccountName(setting.account_name ?? "");
        setQrBankAccount(setting.bank_account ?? "");
        setQrBankName(setting.bank_name ?? "");
      }
      setQrLoading(false);
    }

    void loadPaymentQr();
  }, [propertyId]);

  const memberMap = useMemo(() => new Map(users.map((user) => [user.user_id, user.full_name])), [users]);
  const participatingExpenses = useMemo(() => currentMember ? expenses.filter((expense) => expense.expense_member_participants.some((participant) => participant.member_id === currentMember.user_id)) : [], [currentMember, expenses]);
  const allocated = participatingExpenses.reduce((sum, expense) => sum + (expense.expense_member_participants.find((participant) => participant.member_id === currentMember?.user_id)?.allocated_amount ?? 0), 0);
  const advanced = currentMember ? expenses.filter((expense) => expense.payer_member_id === currentMember.user_id).reduce((sum, expense) => sum + expense.amount, 0) : 0;
  const balance = allocated - advanced;
  const remaining = settled ? 0 : Math.max(balance, 0);
  const receivable = Math.max(-balance, 0);
  const currentSpending = currentRole === "admin"
    ? expenses.reduce((sum, expense) => sum + expense.amount, 0)
    : allocated;
  const previousSpending = currentRole === "admin"
    ? previousExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    : currentMember
      ? previousExpenses.reduce((sum, expense) => sum + (expense.expense_member_participants.find((participant) => participant.member_id === currentMember.user_id)?.allocated_amount ?? 0), 0)
      : 0;
  const receiver = useMemo(() => {
    const chargeableUsers = users.filter((user) => user.role !== "admin");
    const balances = chargeableUsers.map((user) => {
      const userAllocated = expenses.reduce((sum, expense) => sum + (expense.expense_member_participants.find((participant) => participant.member_id === user.user_id)?.allocated_amount ?? 0), 0);
      const userAdvanced = expenses.filter((expense) => expense.payer_member_id === user.user_id).reduce((sum, expense) => sum + expense.amount, 0);
      return { ...user, balance: userAllocated - userAdvanced };
    });
    return balances.sort((left, right) => left.balance - right.balance)[0] ?? null;
  }, [expenses, users]);

  function downloadPaymentQr() {
    if (!qrImage) return;
    const link = document.createElement("a");
    link.href = qrImage;
    link.download = qrFileName?.replace(/[\\/:*?"<>|]/g, "-") || "ma-qr-thanh-toan.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copyText(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      onNotice(`Đã sao chép ${label}.`);
    } catch {
      onNotice(`Không thể sao chép ${label}.`);
    }
  }

  async function confirmOwnPayment() {
    if (!currentMember || !financialPeriod) return;
    if (financialPeriod.status === "closed") return onNotice("Kỳ đã đóng nên không thể cập nhật thanh toán.");
    setSettlementSaving(true);
    const supabase = createClient();
    const nextSettled = !settled;
    const { error } = await supabase.from("household_member_settlements").upsert({
      organization_id: organizationId,
      property_id: propertyId,
      member_id: currentMember.user_id,
      period: periodStart,
      financial_period_id: financialPeriod.id,
      is_settled: nextSettled,
      settled_at: nextSettled ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "property_id,member_id,period" });
    setSettlementSaving(false);
    if (error) return onNotice("Không thể cập nhật trạng thái thanh toán.");
    await supabase.rpc("mark_financial_period_dirty", { target_period_id: financialPeriod.id });
    setSettled(nextSettled);
    onNotice(nextSettled ? `Đã xác nhận bạn thanh toán ${money.format(Math.max(balance, 0))}.` : "Đã chuyển trạng thái của bạn về chưa thanh toán.");
  }

  return (
    <div className="page-stack personal-overview-page">
      <section className="personal-overview-hero">
        <div>
          <span className="hero-eyebrow">TỔNG QUAN CÁ NHÂN · {financialPeriodLabel(periodStart, false)}</span>
          <Typography.Title level={3}>Xin chào, {displayName}</Typography.Title>
          <Typography.Paragraph>Theo dõi những khoản bạn đã chi, được chia và cần đối soát trong tháng này.</Typography.Paragraph>
        </div>
        <div className="personal-balance-card">
          <span>{settled ? "TRẠNG THÁI THÁNG NÀY" : "CÒN PHẢI ĐÓNG"}</span>
          <strong>{loading ? "—" : settled ? "Đã đóng đủ" : money.format(remaining)}</strong>
          <small>{settled ? "Bạn đã xác nhận hoàn tất thanh toán" : remaining > 0 ? `Bạn cần thanh toán cho ${receiver?.full_name ?? "người nhận hoàn"}` : receivable > 0 ? `Được nhận lại ${money.format(receivable)}` : "Không còn khoản phải đóng"}</small>
        </div>
      </section>

      {currentRole === "admin" && <Alert type="info" showIcon title="Tài khoản quản trị viên không tham gia chia chi phí và không có số liệu cá nhân." />}
      {!financialPeriod && <Alert type="warning" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} chưa được quản trị viên tạo.`} />}
      {!currentMember && currentRole !== "admin" && <Alert type="warning" showIcon title="Tài khoản này chưa được gán với hồ sơ thành viên." />}
      {loadError && <Alert type="error" showIcon title={loadError} />}

      <Row gutter={[16, 16]}>
        <MetricCard loading={loading} title="Số tiền đã chi" value={advanced} note={`${expenses.filter((expense) => expense.payer_member_id === currentMember?.user_id).length} khoản bạn thanh toán`} icon={<WalletOutlined />} tone="blue" />
        <MetricCard loading={loading} title="Phần chi phí của bạn" value={allocated} note={`${participatingExpenses.length} khoản bạn tham gia`} icon={<TeamOutlined />} tone="neutral" />
        <MetricCard loading={loading} title="Còn phải đóng" value={remaining} note={settled ? "Đã xác nhận đóng đủ" : "Sau khi trừ số tiền đã ứng"} icon={<CreditCardOutlined />} tone="orange" />
        <MetricCard loading={loading} title="Được nhận lại" value={receivable} note={receivable > 0 ? "Số tiền các thành viên hoàn lại" : "Không phát sinh hoàn tiền"} icon={<BankOutlined />} tone="green" />
      </Row>

      <Card className="section-card personal-qr-overview-card">
        <Flex align="center" justify="space-between" gap={18} wrap>
          <Flex align="center" gap={14} className="personal-qr-summary">
            <span className="personal-qr-icon"><QrcodeOutlined /></span>
            <div>
              <Typography.Title level={5}>Mã QR thanh toán</Typography.Title>
              <Typography.Text type="secondary">
                {remaining > 0 ? `Chuyển khoản cho ${receiver?.full_name ?? "người nhận hoàn"}` : settled ? "Khoản thanh toán đã được xác nhận" : "Bạn không có khoản cần thanh toán"}
              </Typography.Text>
            </div>
          </Flex>
          <Flex align="center" gap={20} wrap className="personal-qr-action">
            <div><Typography.Text type="secondary">Số tiền cần chuyển</Typography.Text><Typography.Text strong>{money.format(remaining)}</Typography.Text></div>
            {receiver?.bank_account && <Button icon={<CopyOutlined />} onClick={() => void copyText(receiver.bank_account, "số tài khoản")}>Sao chép STK</Button>}
            <Button type="primary" icon={<QrcodeOutlined />} disabled={!qrImage || remaining <= 0} loading={qrLoading} onClick={() => setQrOpen(true)}>Quét QR để thanh toán</Button>
            {currentMember && financialPeriod && balance > 0 && <Popconfirm title={settled ? "Chuyển về chưa thanh toán?" : "Bạn đã chuyển khoản xong?"} description={settled ? "Trạng thái sẽ được mở lại." : "Chỉ xác nhận sau khi giao dịch đã hoàn tất."} okText="Xác nhận" cancelText="Hủy" onConfirm={() => void confirmOwnPayment()}><Button loading={settlementSaving} disabled={financialPeriod.status === "closed"}>{settled ? "Đã xác nhận thanh toán" : "Đã chuyển khoản"}</Button></Popconfirm>}
          </Flex>
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card className="section-card personal-expense-card" title={<div><span>Khoản chi bạn tham gia</span><Typography.Text type="secondary" className="card-title-note">Các khoản được chia trong kỳ {financialPeriodShortLabel(periodStart)}</Typography.Text></div>} extra={<Tag color="success">{participatingExpenses.length} khoản</Tag>}>
            {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : participatingExpenses.length ? (
              <div className="personal-expense-list">
                <div className="personal-expense-header"><span>Khoản chi</span><span>Người thanh toán</span><span>Tổng chi</span><span>Phần của bạn</span><span>Trạng thái</span></div>
                {participatingExpenses.map((expense) => {
                  const personalShare = expense.expense_member_participants.find((participant) => participant.member_id === currentMember?.user_id)?.allocated_amount ?? 0;
                  return <div className="personal-expense-row" key={expense.id}>
                    <div className="personal-expense-main"><Typography.Text strong>{expense.category}</Typography.Text><Typography.Text type="secondary">{new Intl.DateTimeFormat("vi-VN").format(new Date(`${expense.expense_date}T00:00:00`))}{expense.reference_code ? ` · Mã ${expense.reference_code}` : ""}</Typography.Text></div>
                    <div data-label="Người thanh toán"><Typography.Text>{memberMap.get(expense.payer_member_id ?? "") ?? "—"}</Typography.Text></div>
                    <div data-label="Tổng chi"><Typography.Text>{money.format(expense.amount)}</Typography.Text></div>
                    <div data-label="Phần của bạn"><Typography.Text strong>{money.format(personalShare)}</Typography.Text></div>
                    <div data-label="Trạng thái"><Tag color={expense.status === "completed" ? "success" : "warning"}>{expense.status === "completed" ? "Hoàn thành" : "Chờ xử lý"}</Tag></div>
                  </div>;
                })}
              </div>
            ) : <Empty description="Bạn chưa tham gia khoản chi nào trong tháng này" />}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <SpendingComparison
            current={currentSpending}
            previous={previousSpending}
            periodStart={periodStart}
            scope={currentRole === "admin" ? "TẤT CẢ" : "CÁ NHÂN"}
            loading={loading}
          />
        </Col>
      </Row>

      <Modal title={<Space><QrcodeOutlined /><span>Mã QR thanh toán</span></Space>} open={qrOpen} onCancel={() => setQrOpen(false)} centered width={460} className="payment-qr-modal" footer={<Button onClick={() => setQrOpen(false)}>Đóng</Button>}>
        <div className="qr-content">
          {qrImage ? <div className="payment-qr-frame"><Image src={qrImage} alt="Mã QR thanh toán" preview /></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có mã QR thanh toán" />}
          <Statistic title="Số tiền cần chuyển" value={remaining} formatter={(value) => money.format(Number(value))} />
          {(qrAccountName || qrBankAccount || qrBankName || receiver) && <div className="qr-payment-info">
            <Typography.Text type="secondary">Thông tin nhận thanh toán</Typography.Text>
            <Typography.Text strong>{qrAccountName || receiver?.full_name}</Typography.Text>
            {(qrBankName || qrBankAccount || receiver?.bank_account) && <Typography.Text>{[qrBankName || receiver?.bank_name || "Ngân hàng", qrBankAccount || receiver?.bank_account].filter(Boolean).join(" · ")}</Typography.Text>}
          </div>}
          <Space wrap>
            {(qrBankAccount || receiver?.bank_account) && <Button icon={<CopyOutlined />} onClick={() => void copyText(qrBankAccount || receiver?.bank_account || "", "số tài khoản")}>Sao chép STK</Button>}
            {remaining > 0 && <Button icon={<CopyOutlined />} onClick={() => void copyText(String(Math.round(remaining)), "số tiền")}>Sao chép số tiền</Button>}
          </Space>
          {qrImage && <Button icon={<DownloadOutlined />} onClick={downloadPaymentQr}>Tải QR về máy</Button>}
        </div>
      </Modal>
    </div>
  );
}

function SpendingComparison({ current, previous, periodStart, scope, loading }: { current: number; previous: number; periodStart: string; scope: string; loading: boolean }) {
  const maximum = Math.max(current, previous, 1);
  const difference = current - previous;
  const percentChange = previous > 0 ? Math.round(Math.abs(difference) / previous * 100) : current > 0 ? 100 : 0;
  const currentLabel = `Tháng ${dayjs(periodStart).format("MM")}`;
  const previousLabel = `Tháng ${dayjs(periodStart).subtract(1, "month").format("MM")}`;

  return (
    <Card className="section-card spending-comparison-card" title="So sánh chi tiêu" extra={<Tag color={difference <= 0 ? "success" : "warning"}>{scope}</Tag>}>
      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : (
        <>
          <div className={`spending-delta ${difference > 0 ? "increase" : "decrease"}`}>
            <Typography.Text type="secondary">So với tháng trước</Typography.Text>
            <strong>{difference === 0 ? "Không đổi" : `${difference > 0 ? "Tăng" : "Giảm"} ${percentChange}%`}</strong>
            <span>{difference === 0 ? money.format(0) : `${difference > 0 ? "+" : "−"}${money.format(Math.abs(difference))}`}</span>
          </div>
          <div className="spending-bars" role="img" aria-label={`${currentLabel}: ${money.format(current)}; ${previousLabel}: ${money.format(previous)}`}>
            <SpendingBar label={currentLabel} value={current} percent={current / maximum * 100} current />
            <SpendingBar label={previousLabel} value={previous} percent={previous / maximum * 100} />
          </div>
        </>
      )}
    </Card>
  );
}

function SpendingBar({ label, value, percent, current = false }: { label: string; value: number; percent: number; current?: boolean }) {
  return (
    <div className="spending-bar-row">
      <Flex justify="space-between" gap={12}><Typography.Text strong={current}>{label}</Typography.Text><Typography.Text strong>{money.format(value)}</Typography.Text></Flex>
      <div className="spending-bar-track"><span className={current ? "current" : "previous"} style={{ width: `${Math.max(value ? 7 : 0, percent)}%` }} /></div>
    </div>
  );
}

function MetricCard({ loading, title, value, note, icon, tone }: { loading: boolean; title: string; value: number; note: string; icon: React.ReactNode; tone: string }) {
  return (
    <Col xs={24} sm={12} xxl={6} className="summary-col">
      <Card className={`summary-card summary-card-${tone}`}>
        <Flex justify="space-between" align="flex-start">
          <Statistic title={title} value={loading ? 0 : value} formatter={(current) => loading ? "—" : money.format(Number(current))} />
          <span className={`metric-icon ${tone}`}>{icon}</span>
        </Flex>
        <Typography.Text type="secondary">{note}</Typography.Text>
      </Card>
    </Col>
  );
}
