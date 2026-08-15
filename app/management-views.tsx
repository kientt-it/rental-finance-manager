"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  Modal,
  Popover,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from "antd";
import {
  BankOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  DisconnectOutlined,
  DownloadOutlined,
  EditOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SearchOutlined,
  TeamOutlined,
  UserAddOutlined,
  UploadOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";
import { formatMoneyInput } from "@/lib/money";
import { financialPeriodEnd, financialPeriodShortLabel, type FinancialPeriod } from "@/lib/financial-periods";

const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
type SummaryTone = "neutral" | "green" | "blue" | "orange" | "danger";

export type OrganizationUser = {
  user_id: string;
  auth_user_id: string | null;
  full_name: string;
  email: string;
  role: "admin" | "member" | string;
  phone: string;
  bank_account: string;
  bank_name: string;
  is_linked: boolean;
};

type NoticeHandler = (message: string) => void;
type SharedProps = { organizationId: string; propertyId: string; onNotice: NoticeHandler };
type PeriodProps = { financialPeriod: FinancialPeriod | null; periodStart: string };

type RentalRoom = {
  id: string;
  code: string;
  floor: number;
  room_type: string;
  residents: string[];
  member_ids: string[];
  base_rent: number;
  coefficient: number;
  status: "vacant" | "occupied" | "leaving" | "maintenance";
};

type RoomFormValues = {
  code: string;
  floor: number;
  room_type: string;
  coefficient: string;
  member_ids: string[];
  base_rent: string;
  status: RentalRoom["status"];
};

type ExpenseParticipant = { member_id: string; allocated_amount: number };
type ExpenseRecord = {
  id: string;
  category: string;
  amount: number;
  expense_date: string;
  payer_member_id: string | null;
  status: "pending" | "completed";
  reference_code: string | null;
  note: string | null;
  expense_member_participants: ExpenseParticipant[];
};

type ExpenseFormValues = {
  category: string;
  amount: string;
  expense_date: Dayjs;
  payer_member_id: string;
  participant_ids: string[];
  status: ExpenseRecord["status"];
  reference_code?: string;
  note?: string;
};

type Settlement = { member_id: string; is_settled: boolean };
type PersonCost = OrganizationUser & { allocated: number; advanced: number; balance: number; paid: boolean };
type PaymentQrSetting = { qr_image_data: string; file_name: string | null };

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không thể đọc ảnh mã QR."));
    reader.readAsDataURL(file);
  });
}

function chargeableMembers(users: OrganizationUser[]) {
  return users.filter((user) => user.role !== "admin");
}

function parseMoney(value: string) {
  return Number(value.replace(/[^0-9]/g, ""));
}

function errorMessage(error: { message?: string } | null, fallback: string) {
  if (!error?.message) return fallback;
  if (error.message.includes("duplicate")) return "Dữ liệu này đã tồn tại.";
  if (error.message.includes("Account not found")) return "Tài khoản chưa tồn tại. Thành viên cần đăng ký trước khi được thêm.";
  if (error.message.includes("Administrator permission")) return "Bạn không có quyền quản trị viên.";
  return fallback;
}

export function RoomsView({ organizationId, propertyId, onNotice, users }: SharedProps & { users: OrganizationUser[] }) {
  const [display, setDisplay] = useState<"Danh sách" | "Sơ đồ tầng">("Danh sách");
  const [rooms, setRooms] = useState<RentalRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RentalRoom | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<RoomFormValues>();

  const loadRooms = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    const supabase = createClient();
    const [{ data, error }, { data: assignments, error: assignmentError }] = await Promise.all([
      supabase.from("rooms").select("id, code, floor, room_type, residents, base_rent, coefficient, status").eq("property_id", propertyId).order("floor", { ascending: false }).order("code"),
      supabase.from("room_member_assignments").select("room_id, member_id").eq("organization_id", organizationId),
    ]);
    if (error || assignmentError) onNotice("Không tải được danh sách phòng. Hãy chạy migration 0009.");
    const idsByRoom = new Map<string, string[]>();
    (assignments ?? []).forEach((item) => idsByRoom.set(item.room_id, [...(idsByRoom.get(item.room_id) ?? []), item.member_id]));
    const namesById = new Map(users.map((user) => [user.user_id, user.full_name]));
    setRooms(((data ?? []) as Omit<RentalRoom, "member_ids">[]).map((room) => {
      const member_ids = idsByRoom.get(room.id) ?? [];
      return { ...room, member_ids, base_rent: Number(room.base_rent), coefficient: Number(room.coefficient), residents: member_ids.map((id) => namesById.get(id)).filter(Boolean) as string[] };
    }));
    setLoading(false);
  }, [onNotice, organizationId, propertyId, users]);

  useEffect(() => { void loadRooms(); }, [loadRooms]);

  const totalRent = rooms.reduce((sum, room) => sum + room.base_rent, 0);
  const occupiedRooms = rooms.filter((room) => room.status === "occupied").length;
  const residentCount = rooms.reduce((sum, room) => sum + room.residents.length, 0);
  const floors = Array.from(new Set(rooms.map((room) => room.floor))).sort((a, b) => b - a);

  function openCreate() {
    setEditingRoom(null);
    form.setFieldsValue({ code: "", floor: 1, room_type: "Phòng tiêu chuẩn", coefficient: "1", member_ids: [], base_rent: "", status: "vacant" });
    setModalOpen(true);
  }

  function openEdit(room: RentalRoom) {
    setEditingRoom(room);
    form.setFieldsValue({
      code: room.code,
      floor: room.floor,
      room_type: room.room_type,
      coefficient: String(room.coefficient),
      member_ids: room.member_ids,
      base_rent: room.base_rent.toLocaleString("vi-VN"),
      status: room.status,
    });
    setModalOpen(true);
  }

  async function saveRoom(values: RoomFormValues) {
    const residents = users.filter((user) => values.member_ids.includes(user.user_id)).map((user) => user.full_name);
    const payload = {
      organization_id: organizationId,
      property_id: propertyId,
      code: values.code.trim().toUpperCase(),
      floor: values.floor,
      room_type: values.room_type.trim(),
      coefficient: Number(values.coefficient.replace(",", ".")),
      residents,
      base_rent: parseMoney(values.base_rent),
      status: values.member_ids.length
        ? (values.status === "vacant" ? "occupied" : values.status)
        : (values.status === "occupied" ? "vacant" : values.status),
    };
    if (!payload.code || !payload.base_rent || !payload.coefficient) return onNotice("Vui lòng nhập đầy đủ thông tin phòng.");
    setSaving(true);
    const supabase = createClient();
    const result = editingRoom
      ? await supabase.from("rooms").update(payload).eq("id", editingRoom.id).select("id").single()
      : await supabase.from("rooms").insert(payload).select("id").single();
    if (result.error) {
      setSaving(false);
      return onNotice(errorMessage(result.error, "Không thể lưu phòng. Vui lòng kiểm tra lại dữ liệu."));
    }
    const roomId = result.data.id;
    const { error: clearError } = await supabase.from("room_member_assignments").delete().eq("room_id", roomId);
    const assignmentResult = values.member_ids.length
      ? await supabase.from("room_member_assignments").insert(values.member_ids.map((memberId) => ({ room_id: roomId, member_id: memberId, organization_id: organizationId })))
      : { error: null };
    setSaving(false);
    if (clearError || assignmentResult.error) return onNotice("Đã lưu phòng nhưng chưa thể cập nhật thành viên đang ở.");
    setModalOpen(false);
    onNotice(editingRoom ? `Đã cập nhật phòng ${payload.code}.` : `Đã thêm phòng ${payload.code}.`);
    await loadRooms();
  }

  async function deleteRoom(room: RentalRoom) {
    const { error } = await createClient().from("rooms").delete().eq("id", room.id);
    if (error) return onNotice("Không thể xóa phòng đang có hợp đồng hoặc hóa đơn liên quan.");
    onNotice(`Đã xóa phòng ${room.code}.`);
    await loadRooms();
  }

  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng tiền phòng", value: vnd.format(totalRent), note: `${rooms.length} phòng`, icon: <WalletOutlined />, tone: "neutral" },
        { label: "Phòng đang ở", value: `${occupiedRooms}/${rooms.length}`, note: rooms.length ? `${Math.round(occupiedRooms / rooms.length * 100)}% đang sử dụng` : "Chưa có phòng", icon: <HomeOutlined />, tone: "blue" },
        { label: "Người đang ở", value: `${residentCount} người`, note: "Theo thông tin phòng", icon: <TeamOutlined />, tone: "neutral" },
        { label: "Giá bình quân", value: rooms.length ? vnd.format(totalRent / rooms.length) : vnd.format(0), note: "Mỗi phòng / tháng", icon: <BankOutlined />, tone: "neutral" },
      ]} />

      <Flex className="view-actions" justify="space-between" align="center" gap={12} wrap>
        <Segmented value={display} options={["Danh sách", "Sơ đồ tầng"]} onChange={(value) => setDisplay(value as typeof display)} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm phòng</Button>
      </Flex>

      {loading ? <Skeleton active paragraph={{ rows: 7 }} /> : !rooms.length ? (
        <Card className="section-card"><Empty description="Chưa có phòng nào"><Button type="primary" onClick={openCreate}>Thêm phòng đầu tiên</Button></Empty></Card>
      ) : display === "Danh sách" ? (
        <Row gutter={[16, 16]}>
          {rooms.map((room) => <Col xs={24} md={12} xl={8} key={room.id}><RoomCard room={room} onEdit={() => openEdit(room)} onDelete={() => void deleteRoom(room)} /></Col>)}
        </Row>
      ) : (
        <div className="floor-board">
          {floors.map((floor) => (
            <section className="floor-line" key={floor}>
              <div className="floor-number"><Typography.Text>TẦNG</Typography.Text><strong>{floor}</strong></div>
              <div className="floor-rooms">{rooms.filter((room) => room.floor === floor).map((room) => <RoomCard key={room.id} room={room} compact onEdit={() => openEdit(room)} onDelete={() => void deleteRoom(room)} />)}</div>
            </section>
          ))}
        </div>
      )}

      <Modal title={editingRoom ? `Chỉnh sửa ${editingRoom.code}` : "Thêm phòng mới"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} forceRender>
        <Form form={form} layout="vertical" onFinish={saveRoom}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="Mã phòng" rules={[{ required: true }]}><Input placeholder="P.101" /></Form.Item></Col>
            <Col span={12}><Form.Item name="floor" label="Tầng" rules={[{ required: true }]}><Input type="number" min={1} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="room_type" label="Loại phòng" rules={[{ required: true }]}><Input placeholder="Phòng tiêu chuẩn" /></Form.Item></Col>
            <Col span={12}><Form.Item name="coefficient" label="Hệ số" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item></Col>
          </Row>
          <Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}>
            <Select options={[{ value: "vacant", label: "Trống" }, { value: "occupied", label: "Đang ở" }, { value: "leaving", label: "Sắp trống" }, { value: "maintenance", label: "Bảo trì" }]} />
          </Form.Item>
          <Form.Item name="member_ids" label="Thành viên đang ở" extra="Tạo hồ sơ trước tại mục Quản lý thành viên">
            <Select mode="multiple" allowClear optionFilterProp="label" placeholder="Chọn thành viên" options={users.map((user) => ({ value: user.user_id, label: user.full_name }))} />
          </Form.Item>
          <Form.Item name="base_rent" label="Giá thuê tháng (VNĐ)" normalize={(value) => formatMoneyInput(String(value ?? ""))} rules={[{ required: true }]}><Input inputMode="numeric" placeholder="3.500.000" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block>{editingRoom ? "Lưu thay đổi" : "Thêm phòng"}</Button>
        </Form>
      </Modal>
    </div>
  );
}

function RoomCard({ room, compact = false, onEdit, onDelete }: { room: RentalRoom; compact?: boolean; onEdit: () => void; onDelete: () => void }) {
  const statusMap = { vacant: ["Trống", "default"], occupied: ["Đang ở", "success"], leaving: ["Sắp trống", "warning"], maintenance: ["Bảo trì", "purple"] } as const;
  const [statusLabel, statusColor] = statusMap[room.status];
  return (
    <Card className={`rental-card ${compact ? "compact" : ""}`} hoverable={!compact}>
      <Flex justify="space-between" align="center">
        <Tag color="gold">Tầng {room.floor}</Tag>
        <Space size={2}>
          <Tag color={statusColor}>{statusLabel}</Tag>
          <Tooltip title="Chỉnh sửa phòng">
            <Button className="room-action-button" type="text" icon={<EditOutlined />} onClick={onEdit} aria-label={`Chỉnh sửa ${room.code}`}>Sửa</Button>
          </Tooltip>
          <Popconfirm title="Xóa phòng này?" description="Dữ liệu không thể khôi phục." okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={onDelete}>
            <Tooltip title="Xóa phòng"><Button className="room-action-button room-delete-button" type="text" icon={<DeleteOutlined />} aria-label={`Xóa ${room.code}`} /></Tooltip>
          </Popconfirm>
        </Space>
      </Flex>
      <Flex className="room-title-line" justify="space-between" align="end">
        <div><Typography.Text type="secondary">{room.room_type}</Typography.Text><Typography.Title level={3}>{room.code}</Typography.Title></div>
        <div className="room-rent"><Typography.Text strong>{vnd.format(room.base_rent)}</Typography.Text><span>/ tháng</span></div>
      </Flex>
      <Flex gap={6} wrap className="resident-list">
        {room.residents.length ? room.residents.map((resident) => <Tag key={resident} icon={<Avatar size={18}>{resident.slice(0, 1)}</Avatar>}>{resident}</Tag>) : <Typography.Text type="secondary">Chưa có người ở</Typography.Text>}
      </Flex>
      <Flex justify="space-between" className="room-card-meta">
        <Typography.Text type="secondary">Hệ số <b>{room.coefficient}</b></Typography.Text>
        <Typography.Text type="secondary">Mỗi người <b>{room.residents.length ? vnd.format(room.base_rent / room.residents.length) : "—"}</b></Typography.Text>
      </Flex>
    </Card>
  );
}

export function ExpensesView({ organizationId, propertyId, onNotice, users, currentUserEmail, financialPeriod, periodStart }: SharedProps & PeriodProps & { users: OrganizationUser[]; currentUserEmail: string }) {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ExpenseRecord["status"]>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ExpenseFormValues>();
  const selectedParticipants = Form.useWatch("participant_ids", form) ?? [];
  const expenseUsers = useMemo(() => chargeableMembers(users), [users]);
  const userMap = useMemo(() => new Map(expenseUsers.map((user) => [user.user_id, user])), [expenseUsers]);

  const loadExpenses = useCallback(async () => {
    if (!organizationId) return;
    if (!financialPeriod) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await createClient().from("expenses")
      .select("id, category, amount, expense_date, payer_member_id, status, reference_code, note, expense_member_participants(member_id, allocated_amount)")
      .eq("organization_id", organizationId)
      .eq("financial_period_id", financialPeriod.id)
      .order("expense_date", { ascending: false });
    if (error) onNotice("Không tải được chi phí. Hãy chạy migration 0006.");
    const normalized = ((data ?? []) as unknown as ExpenseRecord[]).map((expense) => ({
      ...expense,
      amount: Number(expense.amount),
      expense_member_participants: (expense.expense_member_participants ?? []).map((participant) => ({ ...participant, allocated_amount: Number(participant.allocated_amount) })),
    }));
    setExpenses(normalized);
    setLoading(false);
  }, [financialPeriod, onNotice, organizationId]);

  useEffect(() => { void loadExpenses(); }, [loadExpenses]);

  const filtered = expenses.filter((expense) => {
    const matchesQuery = expense.category.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"));
    return matchesQuery && (statusFilter === "all" || expense.status === statusFilter);
  });
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const completedTotal = expenses.filter((expense) => expense.status === "completed").reduce((sum, expense) => sum + expense.amount, 0);
  const filteredTotal = filtered.reduce((sum, expense) => sum + expense.amount, 0);

  function openCreate() {
    if (!financialPeriod) return onNotice("Kỳ tài chính này chưa được tạo.");
    if (financialPeriod.status === "closed") return onNotice("Kỳ đã chốt nên không thể thêm chi phí.");
    const currentUser = expenseUsers.find((user) => user.email === currentUserEmail) ?? expenseUsers[0];
    const defaultExpenseDate = dayjs(periodStart).isSame(dayjs(), "month") ? dayjs() : dayjs(periodStart);
    setEditingExpense(null);
    form.setFieldsValue({ category: "", amount: "", expense_date: defaultExpenseDate, payer_member_id: currentUser?.user_id, participant_ids: expenseUsers.map((user) => user.user_id), status: "completed", reference_code: "", note: "" });
    setModalOpen(true);
  }

  function openEdit(expense: ExpenseRecord) {
    setEditingExpense(expense);
    form.setFieldsValue({
      category: expense.category,
      amount: expense.amount.toLocaleString("vi-VN"),
      expense_date: dayjs(expense.expense_date),
      payer_member_id: userMap.has(expense.payer_member_id ?? "") ? expense.payer_member_id! : expenseUsers[0]?.user_id,
      participant_ids: expense.expense_member_participants.map((participant) => participant.member_id).filter((id) => userMap.has(id)),
      status: expense.status,
      reference_code: expense.reference_code ?? "",
      note: expense.note ?? "",
    });
    setModalOpen(true);
  }

  async function saveExpense(values: ExpenseFormValues) {
    const amount = parseMoney(values.amount);
    if (!amount || !values.participant_ids.length) return onNotice("Nhập số tiền và chọn ít nhất một thành viên.");
    if (!financialPeriod) return onNotice("Kỳ tài chính này chưa được tạo.");
    if (financialPeriod.status === "closed") return onNotice("Kỳ đã chốt nên không thể chỉnh sửa chi phí.");
    setSaving(true);
    const { error } = await createClient().rpc("save_household_expense", {
      target_expense_id: editingExpense?.id ?? null,
      target_property_id: propertyId,
      target_financial_period_id: financialPeriod.id,
      target_category: values.category.trim(),
      target_amount: amount,
      target_expense_date: values.expense_date.format("YYYY-MM-DD"),
      target_payer_member_id: values.payer_member_id,
      target_participant_ids: values.participant_ids,
      target_status: values.status,
      target_reference_code: values.reference_code?.trim() || null,
      target_note: values.note?.trim() || null,
    });
    setSaving(false);
    if (error) return onNotice(errorMessage(error, "Không thể lưu khoản chi."));
    setModalOpen(false);
    onNotice(editingExpense ? "Đã cập nhật khoản chi." : "Đã thêm khoản chi mới.");
    await loadExpenses();
  }

  async function deleteExpense(expense: ExpenseRecord) {
    const supabase = createClient();
    const { error } = await supabase.from("expenses").delete().eq("id", expense.id);
    if (error) return onNotice("Không thể xóa khoản chi này.");
    if (financialPeriod) await supabase.rpc("mark_financial_period_dirty", { target_period_id: financialPeriod.id });
    onNotice(`Đã xóa ${expense.category}.`);
    await loadExpenses();
  }

  const columns: TableColumnsType<ExpenseRecord> = [
    { title: "Ngày", dataIndex: "expense_date", width: 115, render: (date: string) => dayjs(date).format("DD/MM/YYYY") },
    { title: "Nội dung", dataIndex: "category", width: 190, render: (name: string, expense) => <div><Typography.Text strong>{name}</Typography.Text>{expense.reference_code && <Typography.Text type="secondary" className="cell-subtext">Mã: {expense.reference_code}</Typography.Text>}</div> },
    { title: "Người thanh toán", dataIndex: "payer_member_id", width: 170, render: (id: string) => userMap.get(id)?.full_name ?? "—" },
    { title: "Người tham gia", width: 220, render: (_, expense) => {
      const names = expense.expense_member_participants.map((item) => userMap.get(item.member_id)?.full_name).filter((name): name is string => Boolean(name));
      if (!names.length) return "—";
      return <Flex gap={4} wrap className="participant-preview">
        {names.slice(0, 3).map((name) => <Tag key={name}>{name}</Tag>)}
        {names.length > 3 && <Popover title={`${names.length} người tham gia`} content={<div className="participant-popover">{names.map((name) => <span key={name}>{name}</span>)}</div>}><Tag className="participant-more">+{names.length - 3}</Tag></Popover>}
      </Flex>;
    } },
    { title: "Tổng chi", dataIndex: "amount", width: 140, align: "right", render: (amount: number) => <Typography.Text strong>{vnd.format(amount)}</Typography.Text> },
    { title: "Trạng thái", dataIndex: "status", width: 125, render: (status: ExpenseRecord["status"]) => <Tag color={status === "completed" ? "success" : "warning"}>{status === "completed" ? "Hoàn thành" : "Chờ xử lý"}</Tag> },
    { title: "Thao tác", width: 120, fixed: "right", render: (_, expense) => <Space size={2}><Button type="text" icon={<EditOutlined />} disabled={financialPeriod?.status === "closed"} onClick={() => openEdit(expense)} /><Popconfirm title="Xóa khoản chi?" okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} disabled={financialPeriod?.status === "closed"} onConfirm={() => void deleteExpense(expense)}><Button type="text" danger icon={<DeleteOutlined />} disabled={financialPeriod?.status === "closed"} /></Popconfirm></Space> },
  ];

  return (
    <div className="page-stack">
      {!financialPeriod && <Alert type="warning" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} chưa được tạo.`} />}
      {financialPeriod?.status === "closed" && <Alert type="info" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} đã chốt. Dữ liệu đang ở chế độ chỉ đọc.`} />}
      <ViewSummary items={[
        { label: "Tổng chi phí", value: vnd.format(total), note: `${expenses.length} khoản`, icon: <WalletOutlined />, tone: "neutral" },
        { label: "Đã hoàn thành", value: vnd.format(completedTotal), note: `${expenses.filter((item) => item.status === "completed").length} khoản`, icon: <CheckCircleFilled />, tone: "green" },
        { label: "Chờ xử lý", value: vnd.format(total - completedTotal), note: `${expenses.filter((item) => item.status === "pending").length} khoản`, icon: <InfoCircleOutlined />, tone: "orange" },
        { label: "Thành viên", value: `${expenseUsers.length} người`, note: "Tham gia", icon: <TeamOutlined />, tone: "neutral" },
      ]} />
      <Card className="section-card" title={<div><span>Chi phí sinh hoạt</span><Typography.Text type="secondary" className="card-title-note">Tổng hợp chi phí trong kỳ {financialPeriodShortLabel(periodStart)}</Typography.Text></div>} extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!expenseUsers.length || !financialPeriod || financialPeriod.status === "closed"}>Thêm chi phí</Button>}>
        <Flex className="table-toolbar" gap={10} wrap>
          <Input allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm khoản chi..." className="table-search" />
          <Select className="status-filter" value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)} options={[{ value: "all", label: "Tất cả trạng thái" }, { value: "completed", label: "Hoàn thành" }, { value: "pending", label: "Chờ xử lý" }]} />
        </Flex>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={filtered} pagination={false} scroll={{ x: 1050 }} locale={{ emptyText: <Empty description="Chưa có khoản chi nào" /> }} summary={() => filtered.length ? <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={4} align="right">Tổng theo bộ lọc</Table.Summary.Cell><Table.Summary.Cell index={4} align="right"><Typography.Text strong>{vnd.format(filteredTotal)}</Typography.Text></Table.Summary.Cell><Table.Summary.Cell index={5} colSpan={2} /></Table.Summary.Row> : null} />
      </Card>

      <Modal title={editingExpense ? "Chỉnh sửa chi phí" : "Thêm chi phí"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={680} forceRender>
        <Form form={form} layout="vertical" onFinish={saveExpense}>
          <Row gutter={12}>
            <Col xs={24} sm={14}><Form.Item name="category" label="Nội dung" rules={[{ required: true }]}><Input placeholder="Ví dụ: Tiền điện" /></Form.Item></Col>
            <Col xs={24} sm={10}><Form.Item name="amount" label="Số tiền (VNĐ)" normalize={(value) => formatMoneyInput(String(value ?? ""))} rules={[{ required: true }]}><Input inputMode="numeric" placeholder="1.500.000" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="expense_date" label="Ngày chi" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} disabledDate={(date) => date.isBefore(dayjs(periodStart), "day") || !date.isBefore(dayjs(financialPeriodEnd(periodStart)), "day")} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}><Select options={[{ value: "completed", label: "Hoàn thành" }, { value: "pending", label: "Chờ xử lý" }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="payer_member_id" label="Người thanh toán" rules={[{ required: true }]}><Select options={expenseUsers.map((user) => ({ value: user.user_id, label: `${user.full_name}${user.is_linked ? "" : " — chưa liên kết tài khoản"}` }))} /></Form.Item>
          <div className="participant-field-heading"><Typography.Text strong><span className="required-mark">*</span> Người tham gia</Typography.Text><Button type="link" size="small" onClick={() => form.setFieldValue("participant_ids", selectedParticipants.length === expenseUsers.length ? [] : expenseUsers.map((user) => user.user_id))}>{selectedParticipants.length === expenseUsers.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}</Button></div>
          <Form.Item name="participant_ids" rules={[{ required: true, message: "Chọn ít nhất một người" }]} extra={`Đã chọn ${selectedParticipants.length}/${expenseUsers.length} người`}><Checkbox.Group className="participant-grid" options={expenseUsers.map((user) => ({ value: user.user_id, label: user.full_name }))} /></Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="reference_code" label="Mã tham chiếu"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="note" label="Ghi chú"><Input /></Form.Item></Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={saving} block>{editingExpense ? "Lưu thay đổi" : "Thêm chi phí"}</Button>
        </Form>
      </Modal>
    </div>
  );
}

function usePeopleCosts(organizationId: string, propertyId: string, users: OrganizationUser[], financialPeriod: FinancialPeriod | null, onError?: NoticeHandler) {
  const [people, setPeople] = useState<PersonCost[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId || !propertyId) return;
    if (!financialPeriod) {
      setExpenses([]);
      setPeople(chargeableMembers(users).map((user) => ({ ...user, allocated: 0, advanced: 0, balance: 0, paid: false })));
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const [{ data: expenseRows, error: expenseError }, { data: settlementRows, error: settlementError }] = await Promise.all([
      supabase.from("expenses").select("id, category, amount, expense_date, payer_member_id, status, reference_code, note, expense_member_participants(member_id, allocated_amount)").eq("organization_id", organizationId).eq("financial_period_id", financialPeriod.id),
      supabase.from("household_member_settlements").select("member_id, is_settled").eq("property_id", propertyId).eq("financial_period_id", financialPeriod.id),
    ]);
    if (expenseError || settlementError) onError?.("Không tải được dữ liệu đối soát. Hãy chạy migration 0013.");
    const normalizedExpenses = ((expenseRows ?? []) as unknown as ExpenseRecord[]).map((expense) => ({ ...expense, amount: Number(expense.amount), expense_member_participants: (expense.expense_member_participants ?? []).map((item) => ({ ...item, allocated_amount: Number(item.allocated_amount) })) }));
    const paidMap = new Map(((settlementRows ?? []) as Settlement[]).map((item) => [item.member_id, item.is_settled]));
    setExpenses(normalizedExpenses);
    setPeople(chargeableMembers(users).map((user) => {
      const allocated = normalizedExpenses.reduce((sum, expense) => sum + (expense.expense_member_participants.find((item) => item.member_id === user.user_id)?.allocated_amount ?? 0), 0);
      const advanced = normalizedExpenses.filter((expense) => expense.payer_member_id === user.user_id).reduce((sum, expense) => sum + expense.amount, 0);
      return { ...user, allocated, advanced, balance: allocated - advanced, paid: paidMap.get(user.user_id) ?? false };
    }));
    setLoading(false);
  }, [financialPeriod, onError, organizationId, propertyId, users]);

  useEffect(() => { void load(); }, [load]);
  return { people, expenses, loading, reload: load };
}

export function PeopleCostsView({ organizationId, propertyId, users, onNotice, canManageQr, currentMemberId, financialPeriod, periodStart }: SharedProps & PeriodProps & { users: OrganizationUser[]; canManageQr: boolean; currentMemberId: string | null }) {
  const [filter, setFilter] = useState<"Tất cả" | "Chưa đóng" | "Đã đóng">("Tất cả");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrFileName, setQrFileName] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrSaving, setQrSaving] = useState(false);
  const [qrError, setQrError] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const { people, expenses, loading, reload } = usePeopleCosts(organizationId, propertyId, users, financialPeriod, onNotice);
  const visible = people.filter((person) => filter === "Tất cả" || (filter === "Đã đóng" ? person.paid : !person.paid));
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const unpaid = people.filter((person) => !person.paid && person.balance > 0);
  const unpaidTotal = unpaid.reduce((sum, person) => sum + person.balance, 0);
  const collectedTotal = people.filter((person) => person.paid && person.balance > 0).reduce((sum, person) => sum + person.balance, 0);
  const collectibleTotal = people.filter((person) => person.balance > 0).reduce((sum, person) => sum + person.balance, 0);
  const paidPercent = collectibleTotal ? Math.round(collectedTotal / collectibleTotal * 100) : 0;
  const receiver = [...people].sort((a, b) => a.balance - b.balance)[0];

  const loadPaymentQr = useCallback(async () => {
    if (!propertyId) return;
    setQrLoading(true);
    setQrError("");
    const { data, error } = await createClient()
      .from("payment_qr_settings")
      .select("qr_image_data, file_name")
      .eq("property_id", propertyId)
      .maybeSingle();
    if (error) {
      setQrImage(null);
      setQrFileName(null);
      setQrError("Không tải được mã QR. Quản trị viên cần chạy migration 0011_payment_qr_settings.sql.");
    } else {
      const setting = data as PaymentQrSetting | null;
      setQrImage(setting?.qr_image_data ?? null);
      setQrFileName(setting?.file_name ?? null);
    }
    setQrLoading(false);
  }, [propertyId]);

  useEffect(() => { void loadPaymentQr(); }, [loadPaymentQr]);

  async function importPaymentQr(file: File) {
    if (!canManageQr) {
      onNotice("Chỉ quản trị viên mới được thay đổi mã QR.");
      return;
    }
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      onNotice("Chỉ hỗ trợ ảnh QR định dạng PNG, JPG hoặc WebP.");
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      onNotice("Ảnh QR tối đa 1,5 MB. Hãy chọn ảnh nhỏ hơn.");
      return;
    }

    setQrSaving(true);
    try {
      const imageData = await fileToDataUrl(file);
      const { error } = await createClient().from("payment_qr_settings").upsert({
        property_id: propertyId,
        organization_id: organizationId,
        qr_image_data: imageData,
        file_name: file.name.slice(0, 160),
        updated_at: new Date().toISOString(),
      }, { onConflict: "property_id" });
      if (error) {
        setQrError("Không thể lưu ảnh QR. Hãy kiểm tra migration 0011 và quyền quản trị viên.");
        onNotice("Không thể lưu ảnh mã QR.");
        return;
      }
      setQrImage(imageData);
      setQrFileName(file.name);
      setQrError("");
      onNotice("Đã cập nhật mã QR thanh toán.");
    } catch {
      onNotice("Không thể đọc ảnh mã QR.");
    } finally {
      setQrSaving(false);
    }
  }

  async function removePaymentQr() {
    if (!canManageQr) {
      onNotice("Chỉ quản trị viên mới được xóa mã QR.");
      return;
    }
    setQrSaving(true);
    const { error } = await createClient().from("payment_qr_settings").delete().eq("property_id", propertyId);
    setQrSaving(false);
    if (error) {
      onNotice("Không thể xóa mã QR.");
      return;
    }
    setQrImage(null);
    setQrFileName(null);
    setQrError("");
    onNotice("Đã xóa mã QR thanh toán.");
  }

  function downloadPaymentQr() {
    if (!qrImage) return;
    const link = document.createElement("a");
    link.href = qrImage;
    link.download = qrFileName?.replace(/[\\/:*?"<>|]/g, "-") || "ma-qr-thanh-toan.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function togglePaid(person: PersonCost, paid: boolean) {
    if (!currentMemberId || person.user_id !== currentMemberId) return onNotice("Bạn chỉ có thể xác nhận thanh toán cho chính mình.");
    if (!financialPeriod) return onNotice("Kỳ tài chính này chưa được tạo.");
    if (financialPeriod.status === "closed") return onNotice("Kỳ đã chốt nên không thể cập nhật thanh toán.");
    const supabase = createClient();
    const { error } = await supabase.from("household_member_settlements").upsert({ organization_id: organizationId, property_id: propertyId, member_id: person.user_id, period: periodStart, financial_period_id: financialPeriod.id, is_settled: paid, settled_at: paid ? new Date().toISOString() : null, updated_at: new Date().toISOString() }, { onConflict: "property_id,member_id,period" });
    if (error) return onNotice("Không thể cập nhật trạng thái thanh toán.");
    await supabase.rpc("mark_financial_period_dirty", { target_period_id: financialPeriod.id });
    onNotice(paid ? `Đã xác nhận bạn thanh toán ${vnd.format(Math.max(person.balance, 0))}.` : "Đã chuyển trạng thái của bạn về chưa thanh toán.");
    if (paid) {
      setCelebrating(false);
      window.setTimeout(() => setCelebrating(true), 20);
      window.setTimeout(() => setCelebrating(false), 2400);
    }
    await reload();
  }

  const columns: TableColumnsType<PersonCost> = [
    { title: "Thành viên", dataIndex: "full_name", width: 180, fixed: "left", render: (name: string) => <Space><Avatar>{name.slice(0, 1).toUpperCase()}</Avatar><Typography.Text strong>{name}</Typography.Text></Space> },
    { title: "Phần chi phí", dataIndex: "allocated", width: 145, responsive: ["md"], render: (amount: number) => vnd.format(amount) },
    { title: "Đã ứng", dataIndex: "advanced", width: 145, responsive: ["md"], render: (amount: number) => vnd.format(amount) },
    { title: "Đối soát", dataIndex: "balance", width: 185, responsive: ["md"], render: (balance: number) => <div className="balance-cell"><Typography.Text type="secondary" className="cell-subtext">{balance < 0 ? "Được nhận lại" : "Cần đóng"}</Typography.Text><Typography.Text strong type={balance < 0 ? "success" : "danger"}>{vnd.format(Math.abs(balance))}</Typography.Text></div> },
    { title: "STK - Ngân hàng", width: 190, responsive: ["md"], render: (_, person) => <div><Typography.Text strong>{person.bank_account || "—"}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">{person.bank_name || "Chưa cập nhật"}</Typography.Text></div> },
    { title: "Đã đóng", dataIndex: "paid", width: 165, render: (paid: boolean, person) => {
      const isOwnRow = person.user_id === currentMemberId;
      return <div className={isOwnRow ? "own-settlement" : "locked-settlement"} title={isOwnRow ? "Xác nhận trạng thái thanh toán của bạn" : "Chỉ thành viên này mới được xác nhận"}><Checkbox checked={paid} disabled={!isOwnRow || !financialPeriod || financialPeriod.status === "closed"} onChange={(event) => void togglePaid(person, event.target.checked)}><Tag color={paid ? "success" : "warning"}>{paid ? "Đã đóng" : "Chưa đóng"}</Tag></Checkbox></div>;
    } },
  ];

  return (
    <div className="page-stack">
      {celebrating && <div className="confetti-layer" aria-hidden="true">{Array.from({ length: 42 }, (_, index) => <i key={index} style={{ "--confetti-x": `${(index * 47) % 100}vw`, "--confetti-drift": `${((index * 31) % 180) - 90}px`, "--confetti-delay": `${(index % 9) * 0.055}s`, "--confetti-rotate": `${(index * 73) % 360}deg`, "--confetti-color": ["#087a58", "#f5b942", "#e85d75", "#4f8ee8", "#8f63d8"][index % 5] } as CSSProperties} />)}</div>}
      {!financialPeriod && <Alert type="warning" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} chưa được tạo.`} />}
      {financialPeriod?.status === "closed" && <Alert type="info" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} đã chốt. Trạng thái thanh toán đang ở chế độ chỉ đọc.`} />}
      <Card className="payment-banner"><Row align="middle" gutter={[20, 20]}><Col flex="auto"><Typography.Text className="banner-eyebrow">KỲ THANH TOÁN {financialPeriodShortLabel(periodStart)}</Typography.Text><Typography.Title level={3}>Đối soát chi phí thành viên</Typography.Title><Typography.Paragraph>Dữ liệu chỉ được tính từ các khoản chi thuộc kỳ đang chọn.</Typography.Paragraph></Col><Col><div className="payment-progress"><Progress type="circle" percent={paidPercent} size={90} strokeColor="#ffffff" railColor="rgba(255,255,255,.2)" styles={{ indicator: { color: "#ffffff" } }} /><span>đã thanh toán</span></div></Col></Row></Card>
      <ViewSummary items={[
        { label: "Chi phí cần chia", value: vnd.format(total), note: `${expenses.length} khoản trong kỳ`, icon: <WalletOutlined />, tone: "neutral" },
        { label: "Thành viên", value: `${people.length} người`, note: "Tham gia đối soát", icon: <TeamOutlined />, tone: "neutral" },
        { label: "Chưa thanh toán", value: `${unpaid.length} người`, note: vnd.format(unpaidTotal), icon: <InfoCircleOutlined />, tone: "orange" },
        { label: "Người nhận hoàn", value: receiver && receiver.balance < 0 ? receiver.full_name : "—", note: receiver && receiver.balance < 0 ? vnd.format(Math.abs(receiver.balance)) : "Không có", icon: <BankOutlined />, tone: "green" },
      ]} />
      <Card className="section-card" title={<div><span>Đối soát thành viên</span><Typography.Text type="secondary" className="card-title-note">Mỗi thành viên chỉ xác nhận được trạng thái thanh toán của chính mình</Typography.Text></div>} extra={<Space wrap className="people-cost-actions"><Button icon={<QrcodeOutlined />} onClick={() => setQrOpen(true)}>Mã QR</Button><Segmented value={filter} options={["Tất cả", "Chưa đóng", "Đã đóng"]} onChange={(value) => setFilter(value as typeof filter)} /></Space>}>
        <Table className="people-cost-table" rowKey="user_id" loading={loading} columns={columns} dataSource={visible} pagination={false} scroll={{ x: "max-content" }} locale={{ emptyText: <Empty description="Chưa có dữ liệu đối soát" /> }} />
      </Card>

      <Modal
        title={<Space><QrcodeOutlined /><span>Mã QR thanh toán</span></Space>}
        open={qrOpen}
        onCancel={() => setQrOpen(false)}
        centered
        width={460}
        className="payment-qr-modal"
        footer={<Button onClick={() => setQrOpen(false)}>Đóng</Button>}
      >
        <div className="qr-content">
          {qrLoading ? <Skeleton.Image active className="payment-qr-skeleton" /> : qrImage ? (
            <>
              <div className="payment-qr-frame"><Image src={qrImage} alt="Mã QR thanh toán" preview /></div>
            </>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={canManageQr ? "Chưa có mã QR. Hãy tải ảnh QR lên." : "Quản trị viên chưa cập nhật mã QR."} />}

          {qrError && <Alert type="error" showIcon title={qrError} />}

          {(qrImage || canManageQr) && (
            <Space wrap className="payment-qr-controls">
              {qrImage && <Button icon={<DownloadOutlined />} onClick={downloadPaymentQr}>Tải QR về máy</Button>}
              {canManageQr && (
                <>
                  <input
                    ref={qrInputRef}
                    className="visually-hidden-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importPaymentQr(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button type="primary" icon={<UploadOutlined />} loading={qrSaving} onClick={() => qrInputRef.current?.click()}>{qrImage ? "Thay ảnh QR" : "Tải ảnh QR lên"}</Button>
                  {qrImage && <Popconfirm title="Xóa mã QR hiện tại?" okText="Xóa" cancelText="Hủy" onConfirm={() => void removePaymentQr()}><Button danger icon={<DeleteOutlined />} loading={qrSaving}>Xóa ảnh</Button></Popconfirm>}
                </>
              )}
            </Space>
          )}
        </div>
      </Modal>
    </div>
  );
}

export function ReportView({ organizationId, propertyId, users, financialPeriod, periodStart }: { organizationId: string; propertyId: string; users: OrganizationUser[] } & PeriodProps) {
  const { people, expenses, loading } = usePeopleCosts(organizationId, propertyId, users, financialPeriod);
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const collected = people.filter((person) => person.paid && person.balance > 0).reduce((sum, person) => sum + person.balance, 0);
  const outstanding = people.filter((person) => !person.paid && person.balance > 0).reduce((sum, person) => sum + person.balance, 0);
  const collectibleTotal = collected + outstanding;
  const collectionRate = collectibleTotal ? Math.round(collected / collectibleTotal * 100) : 0;
  const largest = [...expenses].sort((a, b) => b.amount - a.amount)[0];
  const topPayer = [...people].sort((a, b) => b.advanced - a.advanced)[0];

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  return (
    <div className="page-stack">
      {!financialPeriod && <Alert type="warning" showIcon title={`Kỳ ${financialPeriodShortLabel(periodStart)} chưa được tạo.`} />}
      <ViewSummary items={[
        { label: "Tổng chi kỳ này", value: vnd.format(total), note: financialPeriodShortLabel(periodStart), icon: <WalletOutlined />, tone: "neutral" },
        { label: "Tổng cần thu", value: vnd.format(collectibleTotal), note: `${people.filter((person) => person.balance > 0).length} thành viên cần đóng`, icon: <TeamOutlined />, tone: "blue" },
        { label: "Đã thu", value: vnd.format(collected), note: `${collectionRate}% trên tổng cần thu`, icon: <CheckCircleFilled />, tone: "green" },
        { label: "Còn tồn đọng", value: vnd.format(outstanding), note: "Cần tiếp tục đối soát", icon: <InfoCircleOutlined />, tone: outstanding > 0 ? "orange" : "green" },
      ]} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}><Card title="Tiến độ thu chi" className="section-card"><Flex vertical gap={22}><div className="collection-progress"><Flex justify="space-between" gap={16} wrap><div><Typography.Text strong>Đã thu {vnd.format(collected)}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">Trên tổng cần thu {vnd.format(collectibleTotal)}</Typography.Text></div><Typography.Text strong className="collection-rate">{collectionRate}%</Typography.Text></Flex><Progress percent={collectionRate} showInfo={false} strokeColor="#087a58" /></div>{expenses.length ? expenses.map((expense) => <div key={expense.id}><Flex justify="space-between"><Typography.Text>{expense.category}</Typography.Text><Typography.Text strong>{vnd.format(expense.amount)}</Typography.Text></Flex><Progress percent={total ? Math.round(expense.amount / total * 100) : 0} showInfo={false} strokeColor="#68ae92" /></div>) : <Empty description="Chưa có chi phí trong tháng" />}</Flex></Card></Col>
        <Col xs={24} lg={10}><Card title={`Tóm tắt kỳ ${financialPeriodShortLabel(periodStart)}`} className="section-card"><Descriptions column={1} bordered><Descriptions.Item label="Khoản chi lớn nhất">{largest?.category ?? "—"}</Descriptions.Item><Descriptions.Item label="Người ứng nhiều nhất">{topPayer?.advanced ? topPayer.full_name : "—"}</Descriptions.Item><Descriptions.Item label="Số người đã đóng">{people.filter((person) => person.paid).length}/{people.length}</Descriptions.Item><Descriptions.Item label="Trạng thái"><Tag color={outstanding > 0 ? "warning" : "success"}>{outstanding > 0 ? "Còn tồn đọng" : "Đã hoàn tất"}</Tag></Descriptions.Item></Descriptions></Card></Col>
      </Row>
    </div>
  );
}

type MemberFormValues = { full_name: string; phone?: string; bank_account?: string; bank_name?: string };
type LinkFormValues = { account_identifier: string; role: "admin" | "member" };

export function MembersView({ users, currentUserEmail, onNotice, onChanged }: { users: OrganizationUser[]; currentUserEmail: string; onNotice: NoticeHandler; onChanged: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<OrganizationUser | null>(null);
  const [linkingUser, setLinkingUser] = useState<OrganizationUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<MemberFormValues>();
  const [linkForm] = Form.useForm<LinkFormValues>();

  useEffect(() => {
    if (!modalOpen) return;
    if (editingUser) {
      form.setFieldsValue({ full_name: editingUser.full_name, phone: editingUser.phone, bank_account: editingUser.bank_account, bank_name: editingUser.bank_name });
    } else {
      form.resetFields();
    }
  }, [editingUser, form, modalOpen]);

  function openAdd() {
    setEditingUser(null);
    setModalOpen(true);
  }

  function openEdit(user: OrganizationUser) {
    setEditingUser(user);
    setModalOpen(true);
  }

  function openLink(user: OrganizationUser) {
    setLinkingUser(user);
    linkForm.setFieldsValue({ account_identifier: "", role: "member" });
    setLinkModalOpen(true);
  }

  async function saveMember(values: MemberFormValues) {
    setSaving(true);
    const supabase = createClient();
    const { error } = editingUser
      ? await supabase.rpc("update_household_member", { target_member_id: editingUser.user_id, target_full_name: values.full_name, target_phone: values.phone ?? "", target_bank_account: values.bank_account ?? "", target_bank_name: values.bank_name ?? "" })
      : await supabase.rpc("create_household_member", { target_full_name: values.full_name, target_phone: values.phone ?? "", target_bank_account: values.bank_account ?? "", target_bank_name: values.bank_name ?? "" });
    setSaving(false);
    if (error) return onNotice(errorMessage(error, "Không thể lưu thành viên."));
    setModalOpen(false);
    onNotice(editingUser ? "Đã cập nhật thành viên." : "Đã tạo thành viên. Có thể xếp phòng và chia tiền ngay.");
    onChanged();
  }

  async function linkAccount(values: LinkFormValues) {
    if (!linkingUser) return;
    setSaving(true);
    const { error } = await createClient().rpc("link_household_member_account", { target_member_id: linkingUser.user_id, target_identifier: values.account_identifier, target_role: values.role });
    setSaving(false);
    if (error) return onNotice(errorMessage(error, error.message.includes("already linked") ? "Tài khoản này đã được gán cho thành viên khác." : "Không thể liên kết tài khoản."));
    setLinkModalOpen(false);
    onNotice(`Đã liên kết tài khoản với ${linkingUser.full_name}.`);
    onChanged();
  }

  async function unlinkAccount(user: OrganizationUser) {
    const { error } = await createClient().rpc("unlink_household_member_account", { target_member_id: user.user_id });
    if (error) return onNotice(errorMessage(error, "Không thể bỏ liên kết tài khoản."));
    onNotice(`Đã bỏ liên kết tài khoản của ${user.full_name}. Dữ liệu chi phí và phòng vẫn được giữ nguyên.`);
    onChanged();
  }

  async function deleteMember(user: OrganizationUser) {
    const { error } = await createClient().rpc("archive_household_member", { target_member_id: user.user_id });
    if (error) return onNotice(errorMessage(error, "Không thể xóa thành viên."));
    onNotice(`Đã xóa ${user.full_name} khỏi tổ chức.`);
    onChanged();
  }

  const columns: TableColumnsType<OrganizationUser> = [
    { title: "Thành viên", dataIndex: "full_name", render: (name: string, user) => <Space><Avatar>{name.slice(0, 1).toUpperCase()}</Avatar><div><Typography.Text strong>{name}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">{user.is_linked ? user.email || "Tài khoản đã liên kết" : "Chưa liên kết tài khoản"}</Typography.Text></div></Space> },
    { title: "Tài khoản", width: 155, render: (_, user) => <Tag color={user.is_linked ? "success" : "warning"} icon={user.is_linked ? <LinkOutlined /> : undefined}>{user.is_linked ? (user.role === "admin" ? "Quản trị viên" : "Đã liên kết") : "Chưa liên kết"}</Tag> },
    { title: "Số điện thoại", dataIndex: "phone", width: 150, render: (value: string) => value || "—" },
    { title: "Ngân hàng", width: 200, render: (_, user) => user.bank_account ? <div><Typography.Text>{user.bank_account}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">{user.bank_name}</Typography.Text></div> : "—" },
    { title: "Thao tác", width: 180, render: (_, user) => { const isCurrentUser = user.email === currentUserEmail; return <Space size={2}><Button type="text" icon={<EditOutlined />} onClick={() => openEdit(user)} />{user.is_linked ? <Popconfirm title="Bỏ liên kết tài khoản?" description="Dữ liệu thành viên vẫn được giữ nguyên." okText="Bỏ liên kết" cancelText="Hủy" disabled={isCurrentUser} onConfirm={() => void unlinkAccount(user)}><Button type="text" disabled={isCurrentUser} icon={<DisconnectOutlined />} /></Popconfirm> : <Button type="text" icon={<LinkOutlined />} onClick={() => openLink(user)}>Gán</Button>}<Popconfirm title="Ngừng sử dụng thành viên?" description="Hồ sơ sẽ ẩn nhưng lịch sử chi phí vẫn được giữ." okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} disabled={isCurrentUser} onConfirm={() => void deleteMember(user)}><Button type="text" danger disabled={isCurrentUser} icon={<DeleteOutlined />} /></Popconfirm></Space>; } },
  ];

  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng thành viên", value: `${users.length} người`, note: "Có thể xếp phòng và chia phí", icon: <TeamOutlined /> },
        { label: "Đã liên kết", value: `${users.filter((user) => user.is_linked).length} người`, note: "Có tài khoản đăng nhập", icon: <LinkOutlined /> },
        { label: "Chờ liên kết", value: `${users.filter((user) => !user.is_linked).length} người`, note: "Đã dùng được trong nghiệp vụ", icon: <Avatar size={20}>M</Avatar> },
        { label: "Đã cập nhật ngân hàng", value: `${users.filter((user) => user.bank_account).length} người`, note: "Phục vụ đối soát", icon: <BankOutlined /> },
      ]} />
      <Card className="section-card" title={<div><span>Quản lý thành viên</span><Typography.Text type="secondary" className="card-title-note">Tạo hồ sơ trước, gán tài khoản sau khi người đó đăng ký</Typography.Text></div>} extra={<Button type="primary" icon={<UserAddOutlined />} onClick={openAdd}>Thêm thành viên</Button>}>
        <Alert type="info" showIcon className="member-help" title="Thành viên chưa liên kết vẫn có thể được xếp phòng, chọn làm người thanh toán và tham gia chia chi phí." />
        <Table rowKey="user_id" columns={columns} dataSource={users} pagination={false} scroll={{ x: 850 }} locale={{ emptyText: <Empty description="Chưa có thành viên" /> }} />
      </Card>

      <Modal title={editingUser ? "Chỉnh sửa thành viên" : "Thêm thành viên"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} forceRender>
        <Form form={form} layout="vertical" onFinish={saveMember}>
          <Form.Item name="full_name" label="Tên hiển thị" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phone" label="Số điện thoại"><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="bank_account" label="Số tài khoản"><Input /></Form.Item></Col><Col span={12}><Form.Item name="bank_name" label="Ngân hàng"><Input /></Form.Item></Col></Row>
          <Button type="primary" htmlType="submit" loading={saving} block>{editingUser ? "Lưu thay đổi" : "Thêm thành viên"}</Button>
        </Form>
      </Modal>
      <Modal title={`Gán tài khoản cho ${linkingUser?.full_name ?? "thành viên"}`} open={linkModalOpen} onCancel={() => setLinkModalOpen(false)} footer={null} forceRender>
        <Alert type="info" showIcon title="Người này cần đăng ký tài khoản trước. Việc gán không làm thay đổi dữ liệu phòng hoặc chi phí đã có." />
        <Form form={linkForm} layout="vertical" onFinish={linkAccount} className="link-account-form">
          <Form.Item name="account_identifier" label="Tên đăng nhập hoặc email đã đăng ký" rules={[{ required: true, message: "Nhập tài khoản cần gán" }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="role" label="Quyền truy cập" rules={[{ required: true }]}><Select options={[{ value: "member", label: "Thành viên" }, { value: "admin", label: "Quản trị viên" }]} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} icon={<LinkOutlined />} block>Liên kết tài khoản</Button>
        </Form>
      </Modal>
    </div>
  );
}

function ViewSummary({ items }: { items: { label: string; value: string; note: string; icon: React.ReactNode; tone?: SummaryTone }[] }) {
  return <Row gutter={[16, 16]}>{items.map((item) => {
    const tone = item.tone ?? "neutral";
    return <Col xs={24} sm={12} xxl={6} key={item.label} className="summary-col"><Card className={`summary-card summary-card-${tone}`}><Flex justify="space-between" align="flex-start"><Statistic title={item.label} value={item.value} /><span className={`metric-icon ${tone}`}>{item.icon}</span></Flex><Typography.Text type="secondary">{item.note}</Typography.Text></Card></Col>;
  })}</Row>;
}
