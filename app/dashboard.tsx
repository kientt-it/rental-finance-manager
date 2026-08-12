"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  Layout,
  Menu,
  Modal,
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
  CreditCardOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileTextOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";
import { ExpensesView, PeopleCostsView, ReportView, RoomsView, type OrganizationUser } from "./management-views";

type RoomStatus = "vacant" | "occupied" | "leaving" | "maintenance";
type Room = { id: string; code: string; tenant: string | null; rent: number; due: number; status: RoomStatus; invoice_id: string | null };
type DashboardData = { organization_id: string; property_id: string; property_name: string; rooms: Room[]; revenue: number; expenses: number };

const emptyData: DashboardData = { organization_id: "", property_id: "", property_name: "708 La Thành", rooms: [], revenue: 0, expenses: 0 };
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const month = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(new Date());

const menuItems = [
  { key: "Tổng quan", icon: <DashboardOutlined />, label: "Tổng quan" },
  { key: "Phòng", icon: <HomeOutlined />, label: "Phòng" },
  { key: "Chi phí", icon: <WalletOutlined />, label: "Chi phí" },
  { key: "Chi phí từng người", icon: <UserOutlined />, label: "Chi phí từng người" },
  { key: "Báo cáo", icon: <FileTextOutlined />, label: "Báo cáo" },
];

export default function Dashboard({ userEmail, userName }: { userEmail: string; userName: string }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("Tổng quan");
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
  const screens = Grid.useBreakpoint();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: setupError } = await supabase.rpc("bootstrap_current_user");
    if (setupError) {
      setError("Chưa thể khởi tạo dữ liệu. Hãy chạy migration 0002_dashboard_functions.sql trong Supabase.");
      setLoading(false);
      return;
    }
    const { data: result, error: dataError } = await supabase.rpc("get_dashboard_data");
    if (dataError || !result) setError("Không tải được số liệu. Vui lòng thử lại.");
    else setData(result as DashboardData);

    const { data: users } = await supabase.rpc("get_organization_users");
    if (Array.isArray(users)) {
      const uniqueUsers = Array.from(new Map((users as OrganizationUser[]).map((user) => [user.user_id || user.email, user])).values());
      setOrganizationUsers(uniqueUsers);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { if (screens.lg) setMobileMenuOpen(false); }, [screens.lg]);

  const debt = useMemo(() => data.rooms.reduce((sum, room) => sum + Number(room.due), 0), [data.rooms]);
  const occupied = data.rooms.filter((room) => room.status !== "vacant").length;
  const occupancy = data.rooms.length ? Math.round(occupied / data.rooms.length * 100) : 0;
  const debtorRooms = data.rooms.filter((room) => room.due > 0 && room.invoice_id);
  const displayName = userName || userEmail.split("@")[0] || "Chủ trọ";
  const initials = displayName.split(" ").filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();
  const periodLabel = activeTab.startsWith("Chi phí") ? "KỲ THÁNG 05, 2026" : month.toUpperCase();

  function parseMoney(value: string) { return Number(value.replace(/[^0-9]/g, "")); }

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
  }

  const navigation = (
    <Menu
      mode="inline"
      selectedKeys={[activeTab]}
      items={menuItems}
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

  return (
    <Layout className="dashboard-layout">
      <Layout.Sider width={256} className="desktop-sider" theme="light">
        {brand}
        {navigation}
        <div className="sider-account">
          <Button type="text" icon={<LogoutOutlined />} onClick={signOut} block className="logout-button">Đăng xuất</Button>
          <Flex align="center" gap={10}>
            <Avatar style={{ background: "#dff3ea", color: "#087a58", fontWeight: 800 }}>{initials}</Avatar>
            <div className="account-copy">
              <Typography.Text strong>{displayName}</Typography.Text>
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
        <Button type="text" danger icon={<LogoutOutlined />} onClick={signOut} block>Đăng xuất</Button>
      </Drawer>

      <Layout>
        <Layout.Content className="dashboard-content">
          <header className="page-header">
            <Flex align="center" gap={14}>
              <Button className="mobile-menu-button" icon={<MenuOutlined />} onClick={() => setMobileMenuOpen(true)} />
              <div>
                <Typography.Text className="period-label">{periodLabel}</Typography.Text>
                <Typography.Title level={2}>{activeTab}</Typography.Title>
              </div>
            </Flex>
            <Space className="header-actions">
              <Button shape="circle" icon={<BellOutlined />} aria-label="Thông báo" />
              <Avatar className="header-avatar">{initials}</Avatar>
            </Space>
          </header>

          {notice && <Alert className="page-alert" type="success" showIcon closable title={notice} onClose={() => setNotice("")} />}
          {error && <Alert className="page-alert" type="error" showIcon title={error} action={<Button size="small" onClick={() => void loadDashboard()}>Thử lại</Button>} />}

          {activeTab === "Tổng quan" && (
            <Overview
              data={data}
              debt={debt}
              occupied={occupied}
              occupancy={occupancy}
              debtorRooms={debtorRooms}
              loading={loading}
              onPayment={() => setModal("payment")}
              onAddRoom={() => setModal("room")}
              onNotice={setNotice}
            />
          )}
          {activeTab === "Phòng" && <RoomsView onNotice={setNotice} />}
          {activeTab === "Chi phí" && <ExpensesView onNotice={setNotice} users={organizationUsers} currentUserEmail={userEmail} />}
          {activeTab === "Chi phí từng người" && <PeopleCostsView onNotice={setNotice} />}
          {activeTab === "Báo cáo" && <ReportView />}
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
            <Input autoFocus inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Ví dụ: 1.250.000" prefix={<DollarOutlined />} />
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
            <Input inputMode="numeric" value={roomRent} onChange={(event) => setRoomRent(event.target.value)} placeholder="Ví dụ: 3.500.000" prefix={<DollarOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block>Thêm phòng</Button>
        </Form>
      </Modal>
    </Layout>
  );
}

function Overview({
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
  return (
    <div className="page-stack">
      <Row gutter={[16, 16]}>
        <MetricCard loading={loading} title="Doanh thu tháng này" value={data.revenue} note="Thanh toán đã ghi nhận" icon={<BankOutlined />} tone="green" />
        <MetricCard loading={loading} title="Cần thu" value={debt} note={`${debtorRooms.length} phòng còn công nợ`} icon={<CreditCardOutlined />} tone="orange" />
        <MetricCard loading={loading} title="Chi phí tháng này" value={data.expenses} note="Tổng chi phí đã ghi nhận" icon={<WalletOutlined />} tone="blue" />
        <Col xs={12} sm={12} xl={6} className="summary-col">
          <Card className="summary-card">
            <Flex justify="space-between" align="flex-start">
              <Statistic title="Tỷ lệ lấp đầy" value={occupancy} suffix="%" />
              <span className="metric-icon purple"><AppstoreOutlined /></span>
            </Flex>
            <Progress percent={occupancy} showInfo={false} size="small" strokeColor="#7c5ce0" />
            <Typography.Text type="secondary">{occupied}/{data.rooms.length} phòng đang sử dụng</Typography.Text>
          </Card>
        </Col>
      </Row>

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
          <Card title="Tình trạng phòng" extra={<Button type="link" icon={<PlusOutlined />} onClick={onAddRoom}>Thêm phòng</Button>} className="section-card">
            {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : data.rooms.length ? (
              <div className="overview-room-list">{data.rooms.map((room) => <RoomRow key={room.id} room={room} />)}</div>
            ) : (
              <Empty description="Chưa có phòng nào"><Button type="primary" onClick={onAddRoom}>Thêm phòng đầu tiên</Button></Empty>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="Dòng tiền tháng này" extra={<Tag color="success">TRỰC TIẾP</Tag>} className="section-card cashflow-card">
            <Statistic title="Dòng tiền ròng" value={data.revenue - data.expenses} formatter={(value) => money.format(Number(value))} />
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
      <Card className="summary-card">
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
