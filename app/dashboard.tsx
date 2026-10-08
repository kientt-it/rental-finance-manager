"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import {
  App,
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
  Popover,
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
  CalendarOutlined,
  CheckOutlined,
  CreditCardOutlined,
  CopyOutlined,
  DashboardOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  MoreOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SettingOutlined,
  SunOutlined,
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
import { NotificationCenter, PaymentReminderSettings } from "./payment-reminders";
import { useAppTheme } from "./antd-provider";

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
  const [onlineUserIds, setOnlineUserIds] = useState<string[] | null>(null);
  const periodSelectionReady = useRef(false);
  const screens = Grid.useBreakpoint();
  const { message, modal } = App.useApp();
  const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useAppTheme();
  const notify = useCallback((content: string) => {
    message.success({ content });
  }, [message]);

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
    const supabase = createClient();
    const { error: ensureError } = await supabase.rpc("ensure_current_financial_period", { target_property_id: data.property_id });
    if (ensureError) {
      setError("Không thể tự động khởi tạo kỳ tài chính tháng hiện tại. Hãy chạy migration 0018.");
    }
    const { data: rows, error: periodError } = await supabase.rpc("get_financial_periods", { target_property_id: data.property_id });
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
  useEffect(() => {
    if (!data.organization_id) {
      setOnlineUserIds(null);
      return;
    }

    const supabase = createClient();
    const channel = supabase.channel(`presence:organization:${data.organization_id}`, {
      config: { presence: { key: userId } },
    });
    const updateOnlineUsers = () => {
      const presenceState = channel.presenceState<{ user_id?: string }>();
      const onlineUserIds = new Set(
        Object.values(presenceState)
          .flat()
          .map((presence) => presence.user_id)
          .filter((presenceUserId): presenceUserId is string => Boolean(presenceUserId)),
      );
      setOnlineUserIds(Array.from(onlineUserIds));
    };

    channel
      .on("presence", { event: "sync" }, updateOnlineUsers)
      .on("presence", { event: "join" }, updateOnlineUsers)
      .on("presence", { event: "leave" }, updateOnlineUsers)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: userId });
          updateOnlineUsers();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data.organization_id, userId]);
  useEffect(() => { if (screens.lg) setMobileMenuOpen(false); }, [screens.lg]);
  useEffect(() => { setActiveTab(routeTabs[pathname] ?? "Tổng quan"); }, [pathname]);
  useEffect(() => {
    if (!loading && currentRole !== "admin" && activeTab === "Quản trị") {
      router.replace(`/dashboard?period=${encodeURIComponent(selectedPeriodStart)}`);
    }
  }, [activeTab, currentRole, loading, router, selectedPeriodStart]);

  const currentMember = useMemo(
    () => organizationUsers.find((user) => user.auth_user_id === userId)
      ?? organizationUsers.find((user) => user.email.toLowerCase() === userEmail.toLowerCase())
      ?? null,
    [organizationUsers, userEmail, userId],
  );
  const displayName = currentMember?.full_name || userName || userEmail.split("@")[0] || "Chủ trọ";
  const initials = displayName.split(" ").filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();
  const onlineUserCount = onlineUserIds?.length ?? null;
  const onlineUsers = (onlineUserIds ?? []).map((onlineId) => {
    const member = organizationUsers.find((user) => user.auth_user_id === onlineId);
    const isCurrentUser = onlineId === userId;
    return {
      id: onlineId,
      name: member?.full_name || (isCurrentUser ? displayName : "Thành viên"),
      role: member?.role ?? (isCurrentUser ? currentRole : "member"),
      isCurrentUser,
    };
  });
  const selectedPeriod = periods.find((period) => period.period_start === selectedPeriodStart) ?? null;
  const periodLabel = financialPeriodLabel(selectedPeriodStart);
  const periodOptions = useMemo(() => {
    const options = periods.map((period) => ({
      value: period.period_start,
      label: financialPeriodShortLabel(period.period_start),
    }));
    if (!options.some((option) => option.value === currentPeriodStart())) {
      options.unshift({ value: currentPeriodStart(), label: financialPeriodShortLabel(currentPeriodStart()) });
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
    notify(values.new_password ? "Đã cập nhật hồ sơ và mật khẩu. Lần sau bạn có thể đăng nhập bằng tên tài khoản." : "Đã cập nhật thông tin tài khoản.");
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
      notify("Không thể tạo kỳ tài chính. Hãy kiểm tra quyền quản trị và migration 0013.");
      return;
    }
    selectViewingPeriod(periodStart);
    notify(`Đã tạo kỳ ${financialPeriodShortLabel(periodStart)}.`);
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
      notify("Không thể cập nhật trạng thái kỳ.");
      return;
    }
    notify(nextStatus === "closed" ? `Đã đóng kỳ ${financialPeriodShortLabel(period.period_start)}.` : `Đã mở lại kỳ ${financialPeriodShortLabel(period.period_start)}.`);
    await loadFinancialPeriods();
  }

  async function setDefaultFinancialPeriod(period: FinancialPeriod) {
    setPeriodSaving(true);
    const { error: defaultError } = await createClient().rpc("set_default_financial_period", {
      target_period_id: period.id,
    });
    setPeriodSaving(false);
    if (defaultError) {
      notify("Không thể đặt kỳ mặc định. Hãy kiểm tra migration mới nhất.");
      return;
    }
    selectViewingPeriod(period.period_start);
    notify(`Đã đặt kỳ ${financialPeriodShortLabel(period.period_start)} làm mặc định.`);
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
      notify("Không tải được dữ liệu để xuất Excel.");
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
      notify("Đã tải Excel nhưng chưa ghi nhận được thời điểm xuất kỳ.");
      return;
    }
    notify(`Đã xuất Excel kỳ ${financialPeriodShortLabel(period.period_start)}.`);
    await loadFinancialPeriods();
  }

  async function deleteFinancialPeriod(period: FinancialPeriod) {
    setPeriodSaving(true);
    const { error: deleteError } = await createClient().rpc("delete_financial_period", { target_period_id: period.id });
    setPeriodSaving(false);
    if (deleteError) {
      notify(deleteError.message.includes("Export") ? "Cần xuất Excel trước khi xóa kỳ." : "Không thể xóa kỳ tài chính.");
      return;
    }
    if (selectedPeriodStart === period.period_start) {
      selectViewingPeriod(periods.find((item) => item.is_default && item.id !== period.id)?.period_start ?? currentPeriodStart());
    }
    notify(`Đã xóa kỳ ${financialPeriodShortLabel(period.period_start)} và dữ liệu chi phí liên quan.`);
    await loadFinancialPeriods();
  }

  function confirmDeleteFinancialPeriod(period: FinancialPeriod) {
    modal.confirm({
      title: `Xóa kỳ ${financialPeriodShortLabel(period.period_start)}?`,
      content: period.exported_at
        ? "Khoản chi và trạng thái đối soát của kỳ sẽ bị xóa vĩnh viễn."
        : "Bạn cần xuất Excel trước khi xóa kỳ.",
      okText: "Xóa kỳ",
      cancelText: "Hủy",
      okButtonProps: { danger: true, disabled: !period.exported_at || period.is_default },
      onOk: () => deleteFinancialPeriod(period),
    });
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

  const themeMenu = {
    items: [
      { key: "system", label: <>Theo hệ thống {themeMode === "system" && <CheckOutlined className="theme-option-check" />}</> },
      { key: "light", label: <>Sáng {themeMode === "light" && <CheckOutlined className="theme-option-check" />}</> },
      { key: "dark", label: <>Tối {themeMode === "dark" && <CheckOutlined className="theme-option-check" />}</> },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "system" || key === "light" || key === "dark") setThemeMode(key);
    },
  };

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
              <Tag className={currentRole === "admin" ? "admin-role-tag" : undefined} variant="filled" color={currentRole === "admin" ? "success" : "default"}>{currentRole === "admin" ? "Quản trị viên" : "Thành viên"}</Tag>
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
              <Button className="mobile-menu-button" icon={<MenuOutlined />} aria-label="Mở menu điều hướng" onClick={() => setMobileMenuOpen(true)} />
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
                  <Tag color={!selectedPeriod ? "warning" : selectedPeriod.status === "closed" ? "default" : "success"}>
                    {!selectedPeriod ? "Chưa tạo" : selectedPeriod.status === "closed" ? "Đã đóng" : "Đang mở"}
                  </Tag>
                </Flex>
                <Typography.Title level={2}>{activeTab}</Typography.Title>
                <Typography.Text className="page-subtitle">
                  {activeTab === "Tổng quan" ? "Theo dõi vận hành và tài chính tại một nơi" : data.property_name}
                </Typography.Text>
              </div>
            </Flex>
            <Space className="header-actions">
              <NotificationCenter userId={userId} onNotice={notify} />
              <Dropdown menu={themeMenu} trigger={["click"]} placement="bottomRight">
                <Button type="text" shape="circle" className="theme-trigger" icon={resolvedTheme === "dark" ? <MoonOutlined /> : <SunOutlined />} aria-label="Chọn giao diện sáng, tối hoặc theo hệ thống" />
              </Dropdown>
              <Popover trigger="click" placement="bottomRight" title={`Đang truy cập (${onlineUserCount ?? "—"})`} content={
                <div className="online-users-list" aria-live="polite">
                  {onlineUserIds === null ? <Typography.Text type="secondary">Đang kết nối…</Typography.Text> : onlineUsers.length ? onlineUsers.map((person) => <div className="online-user-row" key={person.id}>
                    <Avatar className="online-user-avatar" size={32} src={person.isCurrentUser ? avatarUrl || undefined : undefined}>{person.name.slice(0, 1).toUpperCase()}</Avatar>
                    <span className="online-user-info"><Typography.Text strong>{person.name}{person.isCurrentUser ? " (Bạn)" : ""}</Typography.Text><Typography.Text type="secondary">{person.role === "admin" ? "Quản trị viên" : "Thành viên"}</Typography.Text></span>
                    <span className="online-user-status" aria-label="Đang online" />
                  </div>) : <Typography.Text type="secondary">Chưa có ai đang truy cập.</Typography.Text>}
                </div>
              }>
                <button type="button" className="online-presence" aria-label={`Xem danh sách ${onlineUserCount ?? 0} người đang truy cập`}>
                  <span className={`online-presence-dot${onlineUserCount === null ? " is-loading" : ""}`} aria-hidden="true" />
                  <TeamOutlined />
                  <span className="online-presence-count" aria-live="polite">{onlineUserCount ?? "—"}</span>
                  <span className="online-presence-label">đang truy cập</span>
                </button>
              </Popover>
              <Dropdown menu={accountMenu} trigger={["click"]} placement="bottomRight">
                <Button type="text" shape="circle" className="account-menu-trigger" aria-label="Mở thông tin tài khoản"><Avatar src={avatarUrl || undefined} className="header-avatar">{initials}</Avatar></Button>
              </Dropdown>
            </Space>
          </header>

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
              onNotice={notify}
            />
          )}
          {activeTab === "Phòng" && <RoomsView onNotice={notify} organizationId={data.organization_id} propertyId={data.property_id} users={organizationUsers} currentMemberId={currentMember?.user_id ?? null} canManageRent={currentRole === "admin"} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Chi phí" && <ExpensesView onNotice={notify} users={organizationUsers} currentUserEmail={userEmail} organizationId={data.organization_id} propertyId={data.property_id} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Chi phí từng người" && <PeopleCostsView onNotice={notify} users={organizationUsers} organizationId={data.organization_id} propertyId={data.property_id} currentMemberId={currentMember?.user_id ?? null} canManageSettlements={currentRole === "admin"} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Báo cáo" && <ReportView users={organizationUsers} organizationId={data.organization_id} propertyId={data.property_id} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Quản trị" && currentRole === "admin" && (
            <AdminManagementView
              organizationId={data.organization_id}
              propertyId={data.property_id}
              users={organizationUsers}
              currentUserEmail={userEmail}
              periods={periods}
              selectedPeriod={selectedPeriod}
              selectedPeriodStart={selectedPeriodStart}
              periodMonth={periodMonth}
              periodSaving={periodSaving}
              onPeriodMonthChange={setPeriodMonth}
              onSelectPeriod={selectViewingPeriod}
              onCreatePeriod={() => void createFinancialPeriod()}
              onSetDefaultPeriod={(period) => void setDefaultFinancialPeriod(period)}
              onSetPeriodStatus={(period) => void setPeriodStatus(period)}
              onExportPeriod={(period) => void exportFinancialPeriod(period)}
              onDeletePeriod={confirmDeleteFinancialPeriod}
              onNotice={notify}
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
        onNotice={notify}
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
  selectedPeriod,
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
  selectedPeriod: FinancialPeriod | null;
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
  const [rentCycleRevision, setRentCycleRevision] = useState(0);
  const periodMonthStart = periodMonth.startOf("month").format("YYYY-MM-DD");
  const periodAlreadyExists = periods.some((period) => period.period_start === periodMonthStart);
  const periodManagement = (
    <Card
      className="section-card admin-hub-card"
      title={<div><span>Quản lý kỳ tài chính</span><Typography.Text type="secondary" className="card-title-note">Kỳ tháng hiện tại được tự động tạo và đặt làm mặc định</Typography.Text></div>}
    >
      <Alert type="info" showIcon title="Xuất Excel trước khi xóa kỳ để lưu bản đối soát." />
      <Flex gap={10} wrap className="period-create-row">
        <DatePicker picker="month" allowClear={false} value={periodMonth} onChange={(value) => value && onPeriodMonthChange(value)} format="MM/YYYY" />
        <Button type="primary" icon={<PlusOutlined />} loading={periodSaving} disabled={periodAlreadyExists} onClick={onCreatePeriod}>{periodAlreadyExists ? "Đã có kỳ" : "Tạo kỳ"}</Button>
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
            <Space wrap className="period-actions">
              <Button size="small" onClick={() => onSelectPeriod(period.period_start)}>{period.period_start === selectedPeriodStart ? "Đang xem" : "Xem kỳ"}</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => onExportPeriod(period)} loading={periodSaving}>Xuất Excel</Button>
              <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                  items: [
                    { key: "default", icon: <CalendarOutlined />, label: period.is_default ? "Đang là kỳ mặc định" : "Đặt làm mặc định", disabled: period.is_default },
                    { key: "status", icon: <UnlockOutlined />, label: period.status === "open" ? "Đóng kỳ" : "Mở lại kỳ" },
                    { type: "divider" },
                    { key: "delete", icon: <DeleteOutlined />, label: "Xóa kỳ", danger: true, disabled: !period.exported_at || period.is_default },
                  ],
                  onClick: ({ key }) => {
                    if (key === "default") onSetDefaultPeriod(period);
                    if (key === "status") onSetPeriodStatus(period);
                    if (key === "delete") onDeletePeriod(period);
                  },
                }}
              >
                <Button size="small" icon={<MoreOutlined />} loading={periodSaving}>Thêm</Button>
              </Dropdown>
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
          { key: "rooms", label: <Space><HomeOutlined />Phòng</Space>, children: <RoomsView key={rentCycleRevision} organizationId={organizationId} propertyId={propertyId} users={users} onNotice={onNotice} canManage financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} /> },
          { key: "members", label: <Space><TeamOutlined />Thành viên</Space>, children: <MembersView users={users} currentUserEmail={currentUserEmail} onNotice={onNotice} onChanged={onMembersChanged} /> },
          { key: "qr", label: <Space><QrcodeOutlined />Mã QR</Space>, children: <PaymentQrManagement organizationId={organizationId} propertyId={propertyId} onNotice={onNotice} /> },
          { key: "notifications", label: <Space><CalendarOutlined />Thông báo</Space>, children: <PaymentReminderSettings organizationId={organizationId} propertyId={propertyId} onNotice={onNotice} onRentCyclesChanged={() => setRentCycleRevision((revision) => revision + 1)} /> },
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
  const [settledMemberIds, setSettledMemberIds] = useState<Set<string>>(new Set());
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

      let settlementRows: Array<{ member_id: string; is_settled: boolean }> = [];
      let settlementError: { message?: string } | null = null;
      if (financialPeriod) {
        let settlementQuery = supabase.from("household_member_settlements")
          .select("member_id, is_settled")
          .eq("property_id", propertyId)
          .eq("financial_period_id", financialPeriod.id);
        if (currentRole !== "admin" && currentMember) {
          settlementQuery = settlementQuery.eq("member_id", currentMember.user_id);
        }
        const settlementResult = await settlementQuery;
        settlementRows = (settlementResult.data ?? []) as Array<{ member_id: string; is_settled: boolean }>;
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
      setSettledMemberIds(new Set(settlementRows.filter((row) => row.is_settled).map((row) => row.member_id)));
      setSettled(Boolean(currentMember && settlementRows.find((row) => row.member_id === currentMember.user_id)?.is_settled));
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
  const memberBalances = useMemo(() => {
    const chargeableUsers = users.filter((user) => user.role !== "admin");
    return chargeableUsers.map((user) => {
      const userAllocated = expenses.reduce((sum, expense) => sum + (expense.expense_member_participants.find((participant) => participant.member_id === user.user_id)?.allocated_amount ?? 0), 0);
      const userAdvanced = expenses.filter((expense) => expense.payer_member_id === user.user_id).reduce((sum, expense) => sum + expense.amount, 0);
      return { ...user, balance: userAllocated - userAdvanced };
    });
  }, [expenses, users]);
  const receiver = useMemo(() => [...memberBalances].sort((left, right) => left.balance - right.balance)[0] ?? null, [memberBalances]);
  const debtors = memberBalances.filter((member) => member.balance > 0);
  const unsettledDebtors = debtors.filter((member) => !settledMemberIds.has(member.user_id));
  const settledDebtors = debtors.filter((member) => settledMemberIds.has(member.user_id));
  const outstandingTotal = unsettledDebtors.reduce((sum, member) => sum + member.balance, 0);
  const completedExpenseTotal = expenses.filter((expense) => expense.status === "completed").reduce((sum, expense) => sum + expense.amount, 0);

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

  if (currentRole === "admin") {
    return (
      <div className="page-stack personal-overview-page admin-overview-page">
        <section className="personal-overview-hero admin-overview-hero">
          <div>
            <span className="hero-eyebrow">TỔNG QUAN NHÀ TRỌ · {financialPeriodLabel(periodStart, false)}</span>
            <Typography.Title level={3}>Tài chính và đối soát trong tháng</Typography.Title>
            <Typography.Paragraph>Theo dõi chi phí của nhà và những thành viên còn cần hoàn tất thanh toán.</Typography.Paragraph>
          </div>
          <div className="personal-balance-card">
            <span>CÒN CẦN THU</span>
            <strong>{loading ? "—" : money.format(outstandingTotal)}</strong>
            <small>{unsettledDebtors.length ? `${unsettledDebtors.length} người chưa xác nhận đã đóng` : "Mọi khoản cần thu đã được xác nhận"}</small>
          </div>
        </section>

        {!financialPeriod && <Alert type="warning" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} chưa được tạo.`} />}
        {financialPeriod?.status === "closed" && <Alert type="info" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} đã đóng. Không thể thêm hoặc sửa chi phí; trạng thái “Đã đóng” vẫn có thể cập nhật.`} />}
        {loadError && <Alert type="error" showIcon title={loadError} />}

        <Row gutter={[16, 16]}>
          <MetricCard loading={loading} title="Tổng chi phí" value={currentSpending} note={`${expenses.length} khoản trong kỳ`} icon={<WalletOutlined />} tone="blue" />
          <MetricCard loading={loading} title="Đã hoàn thành" value={completedExpenseTotal} note={`${expenses.filter((expense) => expense.status === "completed").length} khoản`} icon={<CreditCardOutlined />} tone="green" />
          <MetricCard loading={loading} title="Chưa đóng" value={`${unsettledDebtors.length} người`} format="plain" note={money.format(outstandingTotal)} icon={<TeamOutlined />} tone="orange" />
          <MetricCard loading={loading} title="Đã đối soát" value={`${settledDebtors.length}/${debtors.length}`} format="plain" note="Thành viên có khoản cần đóng" icon={<BankOutlined />} tone="neutral" />
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <Card className="section-card admin-overview-expense-card" title={<div><span>Khoản chi gần đây</span><Typography.Text type="secondary" className="card-title-note">Các khoản phát sinh trong kỳ {financialPeriodShortLabel(periodStart)}</Typography.Text></div>} extra={<Tag color="success">{expenses.length} khoản</Tag>}>
              {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : expenses.length ? (
                <div className="admin-overview-expense-list">
                  {expenses.slice(0, 6).map((expense) => (
                    <div className="admin-overview-expense-row" key={expense.id}>
                      <div><Typography.Text strong>{expense.category}</Typography.Text><Typography.Text type="secondary">{new Intl.DateTimeFormat("vi-VN").format(new Date(`${expense.expense_date}T00:00:00`))}</Typography.Text></div>
                      <Typography.Text>{memberMap.get(expense.payer_member_id ?? "") ?? "—"}</Typography.Text>
                      <Typography.Text strong>{money.format(expense.amount)}</Typography.Text>
                      <Tag color={expense.status === "completed" ? "success" : "warning"}>{expense.status === "completed" ? "Hoàn thành" : "Chờ xử lý"}</Tag>
                    </div>
                  ))}
                </div>
              ) : <Empty description="Chưa có khoản chi nào trong tháng này" />}
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <SpendingComparison
              current={currentSpending}
              previous={previousSpending}
              periodStart={periodStart}
              scope="TẤT CẢ"
              loading={loading}
              hasCurrentPeriod={Boolean(financialPeriod)}
            />
          </Col>
        </Row>
      </div>
    );
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

      {!financialPeriod && <Alert type="warning" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} chưa được quản trị viên tạo.`} />}
      {!currentMember && <Alert type="warning" showIcon title="Tài khoản này chưa được gán với hồ sơ thành viên." />}
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
            {currentMember && financialPeriod && balance > 0 && <Popconfirm title={settled ? "Chuyển về chưa thanh toán?" : "Bạn đã chuyển khoản xong?"} description={settled ? "Trạng thái sẽ được mở lại." : "Chỉ xác nhận sau khi giao dịch đã hoàn tất."} okText="Xác nhận" cancelText="Hủy" onConfirm={() => void confirmOwnPayment()}><Button loading={settlementSaving}>{settled ? "Đã xác nhận thanh toán" : "Đã chuyển khoản"}</Button></Popconfirm>}
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
            scope="CÁ NHÂN"
            loading={loading}
            hasCurrentPeriod={Boolean(financialPeriod)}
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

function SpendingComparison({ current, previous, periodStart, scope, loading, hasCurrentPeriod }: { current: number; previous: number; periodStart: string; scope: string; loading: boolean; hasCurrentPeriod: boolean }) {
  const maximum = Math.max(current, previous, 1);
  const difference = current - previous;
  const percentChange = previous > 0 ? Math.round(Math.abs(difference) / previous * 100) : current > 0 ? 100 : 0;
  const currentLabel = `Tháng ${dayjs(periodStart).format("MM")}`;
  const previousLabel = `Tháng ${dayjs(periodStart).subtract(1, "month").format("MM")}`;

  return (
    <Card className="section-card spending-comparison-card" title="So sánh chi tiêu" extra={<Tag color={difference <= 0 ? "success" : "warning"}>{scope}</Tag>}>
      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : !hasCurrentPeriod ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu kỳ này" />
      ) : (
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

function MetricCard({ loading, title, value, note, icon, tone, format = "money" }: { loading: boolean; title: string; value: number | string; note: string; icon: React.ReactNode; tone: string; format?: "money" | "plain" }) {
  return (
    <Col xs={24} sm={12} xl={6} className="summary-col">
      <Card className={`summary-card summary-card-${tone}`}>
        <Flex justify="space-between" align="flex-start">
          <Statistic title={title} value={loading ? 0 : value} formatter={(current) => loading ? "—" : format === "money" ? money.format(Number(current)) : String(current)} />
          <span className={`metric-icon ${tone}`}>{icon}</span>
        </Flex>
        <Typography.Text type="secondary">{note}</Typography.Text>
      </Card>
    </Col>
  );
}
