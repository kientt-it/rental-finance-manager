"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dayjs from "dayjs";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
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
  Progress,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  BankOutlined,
  BellOutlined,
  CalendarOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  DollarOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ThunderboltOutlined,
  TeamOutlined,
  UnlockOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";
import { formatMoneyInput } from "@/lib/money";
import { currentPeriodStart, financialPeriodLabel, financialPeriodShortLabel, type FinancialPeriod } from "@/lib/financial-periods";
import { createPeriodExcelXml, downloadPeriodExcel } from "@/lib/period-excel";
import { ExpensesView, MembersView, PeopleCostsView, ReportView, RoomsView, type OrganizationUser } from "./management-views";

type RoomStatus = "vacant" | "occupied" | "leaving" | "maintenance";
type Room = { id: string; code: string; tenant: string | null; rent: number; due: number; status: RoomStatus; invoice_id: string | null };
type DashboardData = { organization_id: string; property_id: string; property_name: string; rooms: Room[]; revenue: number; expenses: number };
type AccountProfileForm = { username: string; full_name: string; phone?: string; bank_account?: string; bank_name?: string; new_password?: string; confirm_password?: string };

const emptyData: DashboardData = { organization_id: "", property_id: "", property_name: "708 La Thành", rooms: [], revenue: 0, expenses: 0 };
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

const menuItems = [
  { key: "Tổng quan", icon: <DashboardOutlined />, label: "Tổng quan" },
  { key: "Phòng", icon: <HomeOutlined />, label: "Phòng" },
  { key: "Chi phí", icon: <WalletOutlined />, label: "Chi phí" },
  { key: "Chi phí từng người", icon: <UserOutlined />, label: "Chi phí từng người" },
  { key: "Báo cáo", icon: <FileTextOutlined />, label: "Báo cáo" },
];

const memberMenuItem = { key: "Quản lý thành viên", icon: <TeamOutlined />, label: "Quản lý thành viên" };

const tabRoutes: Record<string, string> = {
  "Tổng quan": "/dashboard",
  "Phòng": "/room",
  "Chi phí": "/expenses",
  "Chi phí từng người": "/people-costs",
  "Báo cáo": "/reports",
  "Quản lý thành viên": "/members",
};

const routeTabs = Object.fromEntries(Object.entries(tabRoutes).map(([tab, route]) => [route, tab])) as Record<string, string>;

export default function Dashboard({ userId, userEmail, userName, avatarUrl }: { userId: string; userEmail: string; userName: string; avatarUrl: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState(() => routeTabs[pathname] ?? "Tổng quan");
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"payment" | "room" | null>(null);
  const [amount, setAmount] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomRent, setRoomRent] = useState("");
  const [saving, setSaving] = useState(false);
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
  const [periodManagerOpen, setPeriodManagerOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(() => dayjs(currentPeriodStart()));
  const [periodSaving, setPeriodSaving] = useState(false);
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
      expense_count: Number(period.expense_count),
      total_amount: Number(period.total_amount),
    }));
    setPeriods(normalized);
  }, [data.property_id]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { void loadFinancialPeriods(); }, [loadFinancialPeriods]);
  useEffect(() => {
    const saved = window.localStorage.getItem("708-financial-period");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { periodStart?: string; calendarMonth?: string };
      if (parsed.calendarMonth === currentPeriodStart() && parsed.periodStart) setSelectedPeriodStart(parsed.periodStart);
    } catch {
      window.localStorage.removeItem("708-financial-period");
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem("708-financial-period", JSON.stringify({ periodStart: selectedPeriodStart, calendarMonth: currentPeriodStart() }));
  }, [selectedPeriodStart]);
  useEffect(() => { if (screens.lg) setMobileMenuOpen(false); }, [screens.lg]);
  useEffect(() => { setActiveTab(routeTabs[pathname] ?? "Tổng quan"); }, [pathname]);
  useEffect(() => {
    if (!loading && currentRole !== "admin" && activeTab === "Quản lý thành viên") router.replace("/dashboard");
  }, [activeTab, currentRole, loading, router]);

  const debt = useMemo(() => data.rooms.reduce((sum, room) => sum + Number(room.due), 0), [data.rooms]);
  const debtorRooms = data.rooms.filter((room) => room.due > 0 && room.invoice_id);
  const currentMember = useMemo(() => organizationUsers.find((user) => user.email.toLowerCase() === userEmail.toLowerCase()) ?? null, [organizationUsers, userEmail]);
  const displayName = currentMember?.full_name || userName || userEmail.split("@")[0] || "Chủ trọ";
  const initials = displayName.split(" ").filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();
  const selectedPeriod = periods.find((period) => period.period_start === selectedPeriodStart) ?? null;
  const periodLabel = financialPeriodLabel(selectedPeriodStart);
  const periodOptions = useMemo(() => {
    const options = periods.map((period) => ({
      value: period.period_start,
      label: `${financialPeriodShortLabel(period.period_start)}${period.status === "closed" ? " · Đã chốt" : ""}`,
    }));
    if (!options.some((option) => option.value === currentPeriodStart())) {
      options.unshift({ value: currentPeriodStart(), label: `${financialPeriodShortLabel(currentPeriodStart())} · Chưa tạo` });
    }
    return options;
  }, [periods]);
  const visibleMenuItems = currentRole === "admin" ? [...menuItems, memberMenuItem] : menuItems;

  function parseMoney(value: string) { return Number(value.replace(/[^0-9]/g, "")); }

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
    setSelectedPeriodStart(periodStart);
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
    setNotice(nextStatus === "closed" ? `Đã chốt kỳ ${financialPeriodShortLabel(period.period_start)}.` : `Đã mở lại kỳ ${financialPeriodShortLabel(period.period_start)}.`);
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
    const xmlContent = createPeriodExcelXml({
      propertyName: data.property_name || "708 La Thành",
      periodLabel: financialPeriodLabel(period.period_start),
      expenses: expenses.map((expense) => ({
        category: expense.category,
        amount: expense.amount,
        expense_date: dayjs(expense.expense_date).format("DD/MM/YYYY"),
        payer: nameByMember.get(expense.payer_member_id ?? "") ?? "—",
        participants: expense.expense_member_participants.map((participant) => nameByMember.get(participant.member_id)).filter(Boolean).join(", "),
        status: expense.status === "completed" ? "Hoàn thành" : "Chờ xử lý",
        reference_code: expense.reference_code ?? "",
        note: expense.note ?? "",
      })),
      people,
    });
    downloadPeriodExcel(xmlContent, `708-la-thanh-${dayjs(period.period_start).format("YYYY-MM")}.xls`);
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
    if (selectedPeriodStart === period.period_start) setSelectedPeriodStart(currentPeriodStart());
    setNotice(`Đã xóa kỳ ${financialPeriodShortLabel(period.period_start)} và dữ liệu chi phí liên quan.`);
    await loadFinancialPeriods();
  }

  async function savePayment() {
    const value = parseMoney(amount);
    if (!invoiceId || !value) { setNotice("Chọn phòng và nhập số tiền hợp lệ."); return; }
    setSaving(true);
    const supabase = createClient();
    const { error: paymentError } = await supabase.rpc("record_invoice_payment", {
      target_invoice_id: invoiceId,
      payment_amount: value,
      payment_method_value: "bank_transfer",
    });
    setSaving(false);
    if (paymentError) {
      setNotice(paymentError.message.includes("exceeds") ? "Số tiền vượt quá công nợ hiện tại." : "Chưa lưu được thanh toán. Vui lòng thử lại.");
      return;
    }
    setModal(null);
    setAmount("");
    setInvoiceId("");
    setNotice(`Đã ghi nhận ${money.format(value)}.`);
    void loadDashboard();
  }

  async function addRoom() {
    const rent = parseMoney(roomRent);
    if (!roomCode.trim() || !rent) { setNotice("Nhập mã phòng và giá thuê hợp lệ."); return; }
    setSaving(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("rooms").insert({
      organization_id: data.organization_id,
      property_id: data.property_id,
      code: roomCode.trim(),
      base_rent: rent,
    });
    setSaving(false);
    if (insertError) {
      setNotice(insertError.code === "23505" ? "Mã phòng này đã tồn tại." : "Chưa thêm được phòng. Vui lòng thử lại.");
      return;
    }
    setModal(null);
    setRoomCode("");
    setRoomRent("");
    setNotice("Đã thêm phòng mới.");
    void loadDashboard();
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
    router.push(tabRoutes[label] ?? "/dashboard");
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
              <Typography.Text type="secondary">{userEmail}</Typography.Text>
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
                    onChange={setSelectedPeriodStart}
                    options={periodOptions}
                    className="period-switcher"
                    aria-label="Chọn kỳ tài chính"
                  />
                  {currentRole === "admin" && <Button size="small" type="text" icon={<CalendarOutlined />} onClick={() => setPeriodManagerOpen(true)}>Quản lý kỳ</Button>}
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
            />
          )}
          {activeTab === "Phòng" && <RoomsView onNotice={setNotice} organizationId={data.organization_id} propertyId={data.property_id} users={organizationUsers} />}
          {activeTab === "Chi phí" && <ExpensesView onNotice={setNotice} users={organizationUsers} currentUserEmail={userEmail} organizationId={data.organization_id} propertyId={data.property_id} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Chi phí từng người" && <PeopleCostsView onNotice={setNotice} users={organizationUsers} organizationId={data.organization_id} propertyId={data.property_id} canManageQr={currentRole === "admin"} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Báo cáo" && <ReportView users={organizationUsers} organizationId={data.organization_id} propertyId={data.property_id} financialPeriod={selectedPeriod} periodStart={selectedPeriodStart} />}
          {activeTab === "Quản lý thành viên" && currentRole === "admin" && <MembersView users={organizationUsers} currentUserEmail={userEmail} onNotice={setNotice} onChanged={() => void loadDashboard()} />}
        </Layout.Content>
      </Layout>

      <Modal title="Ghi nhận thanh toán" open={modal === "payment"} onCancel={() => setModal(null)} footer={null} destroyOnHidden>
        <Typography.Paragraph type="secondary">Ghi nhận khoản thu từ phòng còn công nợ.</Typography.Paragraph>
        <Form layout="vertical" onFinish={savePayment}>
          <Form.Item label="Phòng / công nợ" required>
            <Select
              value={invoiceId || undefined}
              onChange={setInvoiceId}
              placeholder="Chọn phòng"
              options={debtorRooms.map((room) => ({ value: room.invoice_id!, label: `${room.code} — còn ${money.format(room.due)}` }))}
            />
          </Form.Item>
          <Form.Item label="Số tiền (VNĐ)" required>
            <Input autoFocus inputMode="numeric" value={amount} onChange={(event) => setAmount(formatMoneyInput(event.target.value))} placeholder="Ví dụ: 1.250.000" prefix={<DollarOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block>Lưu thanh toán</Button>
        </Form>
      </Modal>

      <Modal title="Thêm phòng mới" open={modal === "room"} onCancel={() => setModal(null)} footer={null} destroyOnHidden>
        <Typography.Paragraph type="secondary">Tạo phòng mới tại 708 La Thành.</Typography.Paragraph>
        <Form layout="vertical" onFinish={addRoom}>
          <Form.Item label="Mã phòng" required>
            <Input autoFocus value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder="Ví dụ: P.101" prefix={<HomeOutlined />} />
          </Form.Item>
          <Form.Item label="Giá thuê tháng (VNĐ)" required>
            <Input inputMode="numeric" value={roomRent} onChange={(event) => setRoomRent(formatMoneyInput(event.target.value))} placeholder="Ví dụ: 3.500.000" prefix={<DollarOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block>Thêm phòng</Button>
        </Form>
      </Modal>

      <Modal title="Quản lý kỳ tài chính" open={periodManagerOpen} onCancel={() => setPeriodManagerOpen(false)} footer={null} centered width={760} className="period-manager-modal">
        <Alert type="info" showIcon title="Mỗi tháng là một kỳ riêng. Hãy xuất Excel trước khi xóa để lưu bản đối soát." />
        <Flex gap={10} wrap className="period-create-row">
          <DatePicker picker="month" allowClear={false} value={periodMonth} onChange={(value) => value && setPeriodMonth(value)} format="MM/YYYY" />
          <Button type="primary" icon={<PlusOutlined />} loading={periodSaving} onClick={() => void createFinancialPeriod()}>Tạo kỳ</Button>
        </Flex>
        <div className="period-manager-list">
          {periods.length ? periods.map((period) => (
            <div className={`period-manager-item ${period.period_start === selectedPeriodStart ? "selected" : ""}`} key={period.id}>
              <div className="period-manager-main">
                <Flex align="center" gap={8} wrap>
                  <Typography.Text strong>{financialPeriodLabel(period.period_start)}</Typography.Text>
                  <Tag color={period.status === "open" ? "success" : "default"}>{period.status === "open" ? "Đang mở" : "Đã chốt"}</Tag>
                  {period.exported_at && <Tag color="blue">Đã xuất Excel</Tag>}
                </Flex>
                <Typography.Text type="secondary">{period.expense_count} khoản · {money.format(period.total_amount)}</Typography.Text>
              </div>
              <Space wrap>
                <Button size="small" onClick={() => { setSelectedPeriodStart(period.period_start); setPeriodManagerOpen(false); }}>Chọn kỳ</Button>
                <Button size="small" icon={<UnlockOutlined />} onClick={() => void setPeriodStatus(period)} loading={periodSaving}>{period.status === "open" ? "Chốt kỳ" : "Mở lại"}</Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => void exportFinancialPeriod(period)} loading={periodSaving}>Xuất Excel</Button>
                <Popconfirm
                  title="Xóa toàn bộ dữ liệu kỳ này?"
                  description={period.exported_at ? "Khoản chi và trạng thái đối soát của kỳ sẽ bị xóa vĩnh viễn." : "Bạn cần xuất Excel trước khi xóa."}
                  okText="Xóa kỳ"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                  disabled={!period.exported_at}
                  onConfirm={() => void deleteFinancialPeriod(period)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} disabled={!period.exported_at} loading={periodSaving}>Xóa</Button>
                </Popconfirm>
              </Space>
            </div>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có kỳ tài chính" />}
        </div>
      </Modal>

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
    </Layout>
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

function Overview({ organizationId, propertyId, currentMember, users, displayName, currentRole, financialPeriod, periodStart }: {
  organizationId: string;
  propertyId: string;
  currentMember: OrganizationUser | null;
  users: OrganizationUser[];
  displayName: string;
  currentRole: "admin" | "member";
  financialPeriod: FinancialPeriod | null;
  periodStart: string;
}) {
  const [expenses, setExpenses] = useState<PersonalExpense[]>([]);
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrFileName, setQrFileName] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    async function loadPersonalOverview() {
      if (!organizationId || !propertyId) return;
      if (!currentMember || currentRole === "admin") {
        setExpenses([]);
        setSettled(false);
        setLoading(false);
        return;
      }
      if (!financialPeriod) {
        setExpenses([]);
        setSettled(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError("");
      const supabase = createClient();
      const [{ data: expenseRows, error: expenseError }, { data: settlementRow, error: settlementError }] = await Promise.all([
        supabase.from("expenses")
          .select("id, category, amount, expense_date, payer_member_id, status, reference_code, expense_member_participants(member_id, allocated_amount)")
          .eq("organization_id", organizationId)
          .eq("financial_period_id", financialPeriod.id)
          .order("expense_date", { ascending: false }),
        supabase.from("household_member_settlements")
          .select("is_settled")
          .eq("property_id", propertyId)
          .eq("member_id", currentMember.user_id)
          .eq("financial_period_id", financialPeriod.id)
          .maybeSingle(),
      ]);

      if (expenseError || settlementError) {
        setLoadError("Không tải được số liệu cá nhân trong tháng này.");
      }
      setExpenses(((expenseRows ?? []) as unknown as PersonalExpense[]).map((expense) => ({
        ...expense,
        amount: Number(expense.amount),
        expense_member_participants: (expense.expense_member_participants ?? []).map((participant) => ({
          ...participant,
          allocated_amount: Number(participant.allocated_amount),
        })),
      })));
      setSettled(Boolean((settlementRow as { is_settled?: boolean } | null)?.is_settled));
      setLoading(false);
    }

    void loadPersonalOverview();
  }, [currentMember, currentRole, financialPeriod, organizationId, propertyId]);

  useEffect(() => {
    async function loadPaymentQr() {
      if (!propertyId) return;
      setQrLoading(true);
      const { data, error } = await createClient().from("payment_qr_settings")
        .select("qr_image_data, file_name")
        .eq("property_id", propertyId)
        .maybeSingle();
      if (error || !data) {
        setQrImage(null);
        setQrFileName(null);
      } else {
        const setting = data as { qr_image_data: string; file_name: string | null };
        setQrImage(setting.qr_image_data);
        setQrFileName(setting.file_name);
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
  const netCashflow = advanced - allocated;
  const flowTotal = advanced + allocated;
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
          <small>{settled ? "Đã được xác nhận thanh toán" : remaining > 0 ? "Cần chuyển cho người nhận hoàn" : receivable > 0 ? `Được nhận lại ${money.format(receivable)}` : "Không còn khoản phải đóng"}</small>
        </div>
      </section>

      {currentRole === "admin" && <Alert type="info" showIcon title="Tài khoản quản trị viên không tham gia chia chi phí và không có số liệu cá nhân." />}
      {!financialPeriod && <Alert type="warning" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} chưa được quản trị viên tạo.`} />}
      {!currentMember && currentRole !== "admin" && <Alert type="warning" showIcon title="Tài khoản này chưa được gán với hồ sơ thành viên." />}
      {loadError && <Alert type="error" showIcon title={loadError} />}

      <Row gutter={[16, 16]}>
        <MetricCard loading={loading} title="Số tiền đã chi" value={advanced} note={`${expenses.filter((expense) => expense.payer_member_id === currentMember?.user_id).length} khoản bạn thanh toán`} icon={<WalletOutlined />} tone="green" />
        <MetricCard loading={loading} title="Phần được chia" value={allocated} note={`${participatingExpenses.length} khoản bạn tham gia`} icon={<TeamOutlined />} tone="blue" />
        <MetricCard loading={loading} title="Còn phải đóng" value={remaining} note={settled ? "Đã xác nhận đóng đủ" : "Sau khi trừ số tiền đã ứng"} icon={<CreditCardOutlined />} tone="orange" />
        <MetricCard loading={loading} title="Được nhận lại" value={receivable} note={receivable > 0 ? "Số tiền các thành viên hoàn lại" : "Không phát sinh hoàn tiền"} icon={<BankOutlined />} tone="purple" />
      </Row>

      <Card className="section-card personal-qr-overview-card">
        <Flex align="center" justify="space-between" gap={18} wrap>
          <Flex align="center" gap={14} className="personal-qr-summary">
            <span className="personal-qr-icon"><QrcodeOutlined /></span>
            <div>
              <Typography.Title level={5}>Mã QR thanh toán</Typography.Title>
              <Typography.Text type="secondary">
                Chuyển khoản cho Dương Thế Hải
              </Typography.Text>
            </div>
          </Flex>
          <Flex align="center" gap={20} wrap className="personal-qr-action">
            <div><Typography.Text type="secondary">Số tiền của bạn</Typography.Text><Typography.Text strong>{money.format(remaining)}</Typography.Text></div>
            <Button type="primary" icon={<QrcodeOutlined />} disabled={!qrImage} loading={qrLoading} onClick={() => setQrOpen(true)}>Xem mã QR</Button>
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
          <Card className="section-card personal-cashflow-card" title="Dòng tiền tháng này" extra={<Tag color={netCashflow >= 0 ? "success" : "warning"}>CÁ NHÂN</Tag>}>
            <Statistic title="Dòng tiền ròng" value={netCashflow} formatter={(value) => money.format(Number(value))} />
            <Typography.Text type="secondary">Số tiền đã chi trừ phần chi phí của bạn</Typography.Text>
            <Progress percent={flowTotal ? Math.round(advanced / flowTotal * 100) : 0} showInfo={false} strokeColor="#087a58" railColor="#f6d9b9" />
            <Flex vertical gap={16} className="personal-flow-lines">
              <CashflowLine color="#087a58" label="Bạn đã chi" value={advanced} />
              <CashflowLine color="#e09036" label="Phần được chia" value={allocated} />
              <CashflowLine color={netCashflow >= 0 ? "#087a58" : "#d14343"} label={netCashflow >= 0 ? "Chênh lệch được nhận" : "Chênh lệch cần đóng"} value={Math.abs(netCashflow)} />
            </Flex>
          </Card>
        </Col>
      </Row>

      <Modal title={<Space><QrcodeOutlined /><span>Mã QR thanh toán</span></Space>} open={qrOpen} onCancel={() => setQrOpen(false)} centered width={460} className="payment-qr-modal" footer={<Button onClick={() => setQrOpen(false)}>Đóng</Button>}>
        <div className="qr-content">
          {qrImage ? <div className="payment-qr-frame"><Image src={qrImage} alt="Mã QR thanh toán" preview /></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có mã QR thanh toán" />}
          <Statistic title="Số tiền cần chuyển" value={remaining} formatter={(value) => money.format(Number(value))} />
          {qrImage && <Button icon={<DownloadOutlined />} onClick={downloadPaymentQr}>Tải QR về máy</Button>}
        </div>
      </Modal>
    </div>
  );
}

function LegacyOverview({
  data,
  debt,
  occupied,
  occupancy,
  debtorRooms,
  loading,
  onPayment,
  onAddRoom,
  onNotice,
}: {
  data: DashboardData;
  debt: number;
  occupied: number;
  occupancy: number;
  debtorRooms: Room[];
  loading: boolean;
  onPayment: () => void;
  onAddRoom: () => void;
  onNotice: (message: string) => void;
}) {
  const netCashflow = data.revenue - data.expenses;

  return (
    <div className="page-stack overview-page">
      <section className="overview-hero">
        <div className="overview-hero-copy">
          <span className="hero-eyebrow">BỨC TRANH THÁNG NÀY</span>
          <Typography.Title level={3}>Quản lý nhà trọ nhẹ nhàng hơn mỗi ngày.</Typography.Title>
          <Typography.Paragraph>
            Nắm nhanh tiền thu, công nợ và tình trạng phòng của <strong>{data.property_name || "708 La Thành"}</strong>.
          </Typography.Paragraph>
          <Flex gap={10} wrap className="hero-status-list">
            <span><i className="status-dot online" /> Dữ liệu đang đồng bộ</span>
            <span>{data.rooms.length} phòng đang quản lý</span>
          </Flex>
        </div>
        <div className="hero-balance-card">
          <span className="hero-balance-label">DÒNG TIỀN RÒNG</span>
          <strong>{loading ? "—" : money.format(netCashflow)}</strong>
          <span className={`hero-balance-note ${netCashflow < 0 ? "negative" : ""}`}>
            {netCashflow < 0 ? "Chi đang cao hơn thu" : "Thu trừ chi phí trong tháng"}
          </span>
          <div className="hero-balance-decoration" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
        </div>
      </section>

      <Row gutter={[16, 16]}>
        <MetricCard loading={loading} title="Doanh thu tháng này" value={data.revenue} note="Thanh toán đã ghi nhận" icon={<BankOutlined />} tone="green" />
        <MetricCard loading={loading} title="Cần thu" value={debt} note={`${debtorRooms.length} phòng còn công nợ`} icon={<CreditCardOutlined />} tone="orange" />
        <MetricCard loading={loading} title="Chi phí tháng này" value={data.expenses} note="Tổng chi phí đã ghi nhận" icon={<WalletOutlined />} tone="blue" />
        <Col xs={12} sm={12} xl={6} className="summary-col">
          <Card className="summary-card summary-card-purple">
            <Flex justify="space-between" align="flex-start">
              <Statistic title="Tỷ lệ sử dụng" value={occupancy} suffix="%" />
              <span className="metric-icon purple"><AppstoreOutlined /></span>
            </Flex>
            <Progress percent={occupancy} showInfo={false} size="small" strokeColor="#7c5ce0" />
            <Typography.Text type="secondary">{occupied}/{data.rooms.length} phòng đang sử dụng</Typography.Text>
          </Card>
        </Col>
      </Row>

      <div className="overview-section-heading">
        <div>
          <Typography.Title level={4}>Thao tác nhanh</Typography.Title>
          <Typography.Text type="secondary">Những việc thường dùng trong kỳ</Typography.Text>
        </div>
      </div>
      <Row gutter={[16, 16]}>
        <QuickAction
          icon={<PlusOutlined />}
          title="Ghi nhận thu tiền"
          description={debtorRooms.length ? "Tiền mặt hoặc chuyển khoản" : "Chưa có hóa đơn cần thu"}
          primary
          disabled={!debtorRooms.length}
          onClick={onPayment}
        />
        <QuickAction icon={<HomeOutlined />} title="Thêm phòng" description="Tạo phòng mới trong nhà trọ" onClick={onAddRoom} />
        <QuickAction icon={<ThunderboltOutlined />} title="Chốt điện nước" description="Cập nhật chỉ số tháng này" onClick={() => onNotice("Luồng chốt điện nước và tạo hóa đơn sẽ được bổ sung tiếp.")} />
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title={<div><span>Tình trạng phòng</span><Typography.Text type="secondary" className="card-title-note">Cập nhật tình trạng thuê và công nợ</Typography.Text></div>} extra={<Button type="link" icon={<PlusOutlined />} onClick={onAddRoom}>Thêm phòng</Button>} className="section-card room-status-card">
            {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : data.rooms.length ? (
              <div className="overview-room-list">{data.rooms.map((room) => <RoomRow key={room.id} room={room} />)}</div>
            ) : (
              <Empty description="Chưa có phòng nào"><Button type="primary" onClick={onAddRoom}>Thêm phòng đầu tiên</Button></Empty>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="Dòng tiền tháng này" extra={<Tag color="success">TRỰC TIẾP</Tag>} className="section-card cashflow-card">
            <Statistic title="Dòng tiền ròng" value={netCashflow} formatter={(value) => money.format(Number(value))} />
            <Typography.Text className="cashflow-caption" type="secondary">Tổng hợp từ các khoản đã ghi nhận</Typography.Text>
            <Progress
              className="cashflow-progress"
              percent={data.revenue + data.expenses ? Math.round(data.revenue / (data.revenue + data.expenses) * 100) : 0}
              showInfo={false}
              strokeColor="#087a58"
              railColor="#f7d8b3"
            />
            <Flex vertical gap={14}>
              <CashflowLine color="#087a58" label="Khoản thu" value={data.revenue} />
              <CashflowLine color="#e09036" label="Khoản chi" value={data.expenses} />
            </Flex>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function MetricCard({ loading, title, value, note, icon, tone }: { loading: boolean; title: string; value: number; note: string; icon: React.ReactNode; tone: string }) {
  return (
    <Col xs={12} sm={12} xl={6} className="summary-col">
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

function QuickAction({ icon, title, description, primary, disabled, onClick }: { icon: React.ReactNode; title: string; description: string; primary?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Col xs={24} md={8} className="quick-action-col">
      <Card hoverable={!disabled} className={`quick-card ${primary ? "primary" : ""} ${disabled ? "disabled" : ""}`} onClick={disabled ? undefined : onClick}>
        <Flex align="center" gap={14}>
          <span className="quick-icon">{icon}</span>
          <div><Typography.Text strong>{title}</Typography.Text><Typography.Text type={primary ? undefined : "secondary"}>{description}</Typography.Text></div>
        </Flex>
      </Card>
    </Col>
  );
}

function RoomRow({ room }: { room: Room }) {
  const labels: Record<RoomStatus, { label: string; color: string }> = {
    vacant: { label: "Trống", color: "default" },
    occupied: { label: "Đã thuê", color: "success" },
    leaving: { label: "Sắp trống", color: "warning" },
    maintenance: { label: "Bảo trì", color: "purple" },
  };
  return (
    <div className="overview-room-row">
      <Flex align="center" gap={12} className="overview-room-main"><Avatar shape="square" icon={<HomeOutlined />} /><div className="overview-room-copy"><Flex gap={8} align="center"><Typography.Text strong>{room.code}</Typography.Text><Tag color={labels[room.status].color}>{labels[room.status].label}</Tag></Flex><Typography.Text type="secondary">{room.tenant ? `${room.tenant} · ${money.format(room.rent)} / tháng` : "Sẵn sàng cho thuê"}</Typography.Text></div></Flex>
      <div className="room-balance">
        {room.due > 0 ? <><Typography.Text type="secondary">Còn nợ</Typography.Text><Typography.Text type="danger" strong>{money.format(room.due)}</Typography.Text></> : room.status !== "vacant" ? <Tag color="success">Đã thanh toán</Tag> : null}
      </div>
    </div>
  );
}

function CashflowLine({ color, label, value }: { color: string; label: string; value: number }) {
  return <Flex justify="space-between" align="center"><Space><span className="legend-dot" style={{ background: color }} />{label}</Space><Typography.Text strong>{money.format(value)}</Typography.Text></Flex>;
}
