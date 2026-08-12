"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Input,
  Modal,
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
  Typography,
  type TableColumnsType,
} from "antd";
import {
  BankOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  EditOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
  UserAddOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";

const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const compactVnd = new Intl.NumberFormat("vi-VN", { notation: "compact", style: "currency", currency: "VND", maximumFractionDigits: 1 });
const currentPeriod = dayjs().startOf("month");

export type OrganizationUser = {
  user_id: string;
  full_name: string;
  email: string;
  role: "admin" | "member" | string;
  phone: string;
  bank_account: string;
  bank_name: string;
};

type NoticeHandler = (message: string) => void;
type SharedProps = { organizationId: string; propertyId: string; onNotice: NoticeHandler };

type RentalRoom = {
  id: string;
  code: string;
  floor: number;
  room_type: string;
  residents: string[];
  base_rent: number;
  coefficient: number;
  status: "vacant" | "occupied" | "leaving" | "maintenance";
};

type RoomFormValues = {
  code: string;
  floor: number;
  room_type: string;
  coefficient: string;
  residents?: string;
  base_rent: string;
  status: RentalRoom["status"];
};

type ExpenseParticipant = { user_id: string; allocated_amount: number };
type ExpenseRecord = {
  id: string;
  category: string;
  amount: number;
  expense_date: string;
  payer_user_id: string | null;
  status: "pending" | "completed";
  reference_code: string | null;
  note: string | null;
  expense_participants: ExpenseParticipant[];
};

type ExpenseFormValues = {
  category: string;
  amount: string;
  expense_date: Dayjs;
  payer_user_id: string;
  participant_ids: string[];
  status: ExpenseRecord["status"];
  reference_code?: string;
  note?: string;
};

type Settlement = { user_id: string; is_settled: boolean };
type PersonCost = OrganizationUser & { allocated: number; advanced: number; balance: number; paid: boolean };

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

export function RoomsView({ organizationId, propertyId, onNotice }: SharedProps) {
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
    const { data, error } = await supabase
      .from("rooms")
      .select("id, code, floor, room_type, residents, base_rent, coefficient, status")
      .eq("property_id", propertyId)
      .order("floor", { ascending: false })
      .order("code");
    if (error) onNotice("Không tải được danh sách phòng. Hãy chạy migration 0006.");
    setRooms(((data ?? []) as RentalRoom[]).map((room) => ({ ...room, base_rent: Number(room.base_rent), coefficient: Number(room.coefficient), residents: room.residents ?? [] })));
    setLoading(false);
  }, [onNotice, propertyId]);

  useEffect(() => { void loadRooms(); }, [loadRooms]);

  const totalRent = rooms.reduce((sum, room) => sum + room.base_rent, 0);
  const occupiedRooms = rooms.filter((room) => room.status === "occupied").length;
  const residentCount = rooms.reduce((sum, room) => sum + room.residents.length, 0);
  const floors = Array.from(new Set(rooms.map((room) => room.floor))).sort((a, b) => b - a);

  function openCreate() {
    setEditingRoom(null);
    form.setFieldsValue({ code: "", floor: 1, room_type: "Phòng tiêu chuẩn", coefficient: "1", residents: "", base_rent: "", status: "vacant" });
    setModalOpen(true);
  }

  function openEdit(room: RentalRoom) {
    setEditingRoom(room);
    form.setFieldsValue({
      code: room.code,
      floor: room.floor,
      room_type: room.room_type,
      coefficient: String(room.coefficient),
      residents: room.residents.join(", "),
      base_rent: room.base_rent.toLocaleString("vi-VN"),
      status: room.status,
    });
    setModalOpen(true);
  }

  async function saveRoom(values: RoomFormValues) {
    const residents = (values.residents ?? "").split(/[,;\n]/).map((name) => name.trim()).filter(Boolean);
    const payload = {
      organization_id: organizationId,
      property_id: propertyId,
      code: values.code.trim().toUpperCase(),
      floor: values.floor,
      room_type: values.room_type.trim(),
      coefficient: Number(values.coefficient.replace(",", ".")),
      residents,
      base_rent: parseMoney(values.base_rent),
      status: values.status,
    };
    if (!payload.code || !payload.base_rent || !payload.coefficient) return onNotice("Vui lòng nhập đầy đủ thông tin phòng.");
    setSaving(true);
    const supabase = createClient();
    const result = editingRoom
      ? await supabase.from("rooms").update(payload).eq("id", editingRoom.id)
      : await supabase.from("rooms").insert(payload);
    setSaving(false);
    if (result.error) return onNotice(errorMessage(result.error, "Không thể lưu phòng. Vui lòng kiểm tra lại dữ liệu."));
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
        { label: "Tổng tiền phòng", value: vnd.format(totalRent), note: `${rooms.length} phòng`, icon: <WalletOutlined /> },
        { label: "Phòng đang ở", value: `${occupiedRooms}/${rooms.length}`, note: rooms.length ? `${Math.round(occupiedRooms / rooms.length * 100)}% lấp đầy` : "Chưa có phòng", icon: <HomeOutlined /> },
        { label: "Người đang ở", value: `${residentCount} người`, note: "Theo thông tin phòng", icon: <TeamOutlined /> },
        { label: "Giá bình quân", value: rooms.length ? compactVnd.format(totalRent / rooms.length) : "0 ₫", note: "Mỗi phòng / tháng", icon: <BankOutlined /> },
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
          <Form.Item name="residents" label="Người đang ở" extra="Ngăn cách tên bằng dấu phẩy"><Input.TextArea rows={3} placeholder="Ví dụ: Minh, An" /></Form.Item>
          <Form.Item name="base_rent" label="Giá thuê tháng (VNĐ)" rules={[{ required: true }]}><Input inputMode="numeric" placeholder="3.500.000" /></Form.Item>
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
          <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit}>Sửa</Button>
          <Popconfirm title="Xóa phòng này?" description="Dữ liệu không thể khôi phục." okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={onDelete}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`Xóa ${room.code}`} />
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

export function ExpensesView({ organizationId, propertyId, onNotice, users, currentUserEmail }: SharedProps & { users: OrganizationUser[]; currentUserEmail: string }) {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState<Dayjs | null>(currentPeriod);
  const [statusFilter, setStatusFilter] = useState<"all" | ExpenseRecord["status"]>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ExpenseFormValues>();
  const selectedParticipants = Form.useWatch("participant_ids", form) ?? [];
  const userMap = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);

  const loadExpenses = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data, error } = await createClient().from("expenses")
      .select("id, category, amount, expense_date, payer_user_id, status, reference_code, note, expense_participants(user_id, allocated_amount)")
      .eq("organization_id", organizationId)
      .order("expense_date", { ascending: false });
    if (error) onNotice("Không tải được chi phí. Hãy chạy migration 0006.");
    const normalized = ((data ?? []) as unknown as ExpenseRecord[]).map((expense) => ({
      ...expense,
      amount: Number(expense.amount),
      expense_participants: (expense.expense_participants ?? []).map((participant) => ({ ...participant, allocated_amount: Number(participant.allocated_amount) })),
    }));
    setExpenses(normalized);
    setLoading(false);
  }, [onNotice, organizationId]);

  useEffect(() => { void loadExpenses(); }, [loadExpenses]);

  const filtered = expenses.filter((expense) => {
    const matchesQuery = expense.category.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"));
    const matchesMonth = !monthFilter || dayjs(expense.expense_date).format("YYYY-MM") === monthFilter.format("YYYY-MM");
    return matchesQuery && matchesMonth && (statusFilter === "all" || expense.status === statusFilter);
  });
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const completedTotal = expenses.filter((expense) => expense.status === "completed").reduce((sum, expense) => sum + expense.amount, 0);
  const filteredTotal = filtered.reduce((sum, expense) => sum + expense.amount, 0);

  function openCreate() {
    const currentUser = users.find((user) => user.email === currentUserEmail) ?? users[0];
    setEditingExpense(null);
    form.setFieldsValue({ category: "", amount: "", expense_date: dayjs(), payer_user_id: currentUser?.user_id, participant_ids: users.map((user) => user.user_id), status: "completed", reference_code: "", note: "" });
    setModalOpen(true);
  }

  function openEdit(expense: ExpenseRecord) {
    setEditingExpense(expense);
    form.setFieldsValue({
      category: expense.category,
      amount: expense.amount.toLocaleString("vi-VN"),
      expense_date: dayjs(expense.expense_date),
      payer_user_id: expense.payer_user_id ?? users[0]?.user_id,
      participant_ids: expense.expense_participants.map((participant) => participant.user_id),
      status: expense.status,
      reference_code: expense.reference_code ?? "",
      note: expense.note ?? "",
    });
    setModalOpen(true);
  }

  async function saveExpense(values: ExpenseFormValues) {
    const amount = parseMoney(values.amount);
    if (!amount || !values.participant_ids.length) return onNotice("Nhập số tiền và chọn ít nhất một thành viên.");
    setSaving(true);
    const { error } = await createClient().rpc("save_expense", {
      target_expense_id: editingExpense?.id ?? null,
      target_property_id: propertyId,
      target_category: values.category.trim(),
      target_amount: amount,
      target_expense_date: values.expense_date.format("YYYY-MM-DD"),
      target_payer_user_id: values.payer_user_id,
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
    const { error } = await createClient().from("expenses").delete().eq("id", expense.id);
    if (error) return onNotice("Không thể xóa khoản chi này.");
    onNotice(`Đã xóa ${expense.category}.`);
    await loadExpenses();
  }

  const columns: TableColumnsType<ExpenseRecord> = [
    { title: "Ngày", dataIndex: "expense_date", width: 115, render: (date: string) => dayjs(date).format("DD/MM/YYYY") },
    { title: "Nội dung", dataIndex: "category", width: 190, render: (name: string, expense) => <div><Typography.Text strong>{name}</Typography.Text>{expense.reference_code && <Typography.Text type="secondary" className="cell-subtext">Mã: {expense.reference_code}</Typography.Text>}</div> },
    { title: "Người thanh toán", dataIndex: "payer_user_id", width: 170, render: (id: string) => userMap.get(id)?.full_name ?? "—" },
    { title: "Người tham gia", width: 220, render: (_, expense) => expense.expense_participants.map((item) => userMap.get(item.user_id)?.full_name).filter(Boolean).join(", ") || "—" },
    { title: "Tổng chi", dataIndex: "amount", width: 140, align: "right", render: (amount: number) => <Typography.Text strong>{vnd.format(amount)}</Typography.Text> },
    { title: "Trạng thái", dataIndex: "status", width: 125, render: (status: ExpenseRecord["status"]) => <Tag color={status === "completed" ? "success" : "warning"}>{status === "completed" ? "Hoàn thành" : "Chờ xử lý"}</Tag> },
    { title: "Thao tác", width: 120, fixed: "right", render: (_, expense) => <Space size={2}><Button type="text" icon={<EditOutlined />} onClick={() => openEdit(expense)} /><Popconfirm title="Xóa khoản chi?" okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={() => void deleteExpense(expense)}><Button type="text" danger icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];

  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng chi phí", value: vnd.format(total), note: `${expenses.length} khoản`, icon: <WalletOutlined /> },
        { label: "Đã hoàn thành", value: vnd.format(completedTotal), note: `${expenses.filter((item) => item.status === "completed").length} khoản`, icon: <CheckCircleFilled /> },
        { label: "Chờ xử lý", value: vnd.format(total - completedTotal), note: `${expenses.filter((item) => item.status === "pending").length} khoản`, icon: <InfoCircleOutlined /> },
        { label: "Thành viên", value: `${users.length} người`, note: "Có thể tham gia chia phí", icon: <TeamOutlined /> },
      ]} />
      <Card className="section-card" title={<div><span>Chi phí sinh hoạt</span><Typography.Text type="secondary" className="card-title-note">Dữ liệu được lưu trực tiếp trên Supabase</Typography.Text></div>} extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!users.length}>Thêm chi phí</Button>}>
        <Flex className="table-toolbar" gap={10} wrap>
          <Input allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm khoản chi..." className="table-search" />
          <DatePicker picker="month" allowClear value={monthFilter} onChange={setMonthFilter} format="MM/YYYY" placeholder="Tất cả thời gian" className="month-filter" />
          <Select className="status-filter" value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)} options={[{ value: "all", label: "Tất cả trạng thái" }, { value: "completed", label: "Hoàn thành" }, { value: "pending", label: "Chờ xử lý" }]} />
        </Flex>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={filtered} pagination={false} scroll={{ x: 1050 }} locale={{ emptyText: <Empty description="Chưa có khoản chi nào" /> }} summary={() => filtered.length ? <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={4} align="right">Tổng theo bộ lọc</Table.Summary.Cell><Table.Summary.Cell index={4} align="right"><Typography.Text strong>{vnd.format(filteredTotal)}</Typography.Text></Table.Summary.Cell><Table.Summary.Cell index={5} colSpan={2} /></Table.Summary.Row> : null} />
      </Card>

      <Modal title={editingExpense ? "Chỉnh sửa chi phí" : "Thêm chi phí"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={680} forceRender>
        <Form form={form} layout="vertical" onFinish={saveExpense}>
          <Row gutter={12}>
            <Col xs={24} sm={14}><Form.Item name="category" label="Nội dung" rules={[{ required: true }]}><Input placeholder="Ví dụ: Tiền điện" /></Form.Item></Col>
            <Col xs={24} sm={10}><Form.Item name="amount" label="Số tiền (VNĐ)" rules={[{ required: true }]}><Input inputMode="numeric" placeholder="1.500.000" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="expense_date" label="Ngày chi" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}><Select options={[{ value: "completed", label: "Hoàn thành" }, { value: "pending", label: "Chờ xử lý" }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="payer_user_id" label="Người thanh toán" rules={[{ required: true }]}><Select options={users.map((user) => ({ value: user.user_id, label: `${user.full_name} — ${user.email}` }))} /></Form.Item>
          <div className="participant-field-heading"><Typography.Text strong><span className="required-mark">*</span> Người tham gia</Typography.Text><Button type="link" size="small" onClick={() => form.setFieldValue("participant_ids", selectedParticipants.length === users.length ? [] : users.map((user) => user.user_id))}>{selectedParticipants.length === users.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}</Button></div>
          <Form.Item name="participant_ids" rules={[{ required: true, message: "Chọn ít nhất một người" }]} extra={`Đã chọn ${selectedParticipants.length}/${users.length} người`}><Checkbox.Group className="participant-grid" options={users.map((user) => ({ value: user.user_id, label: user.full_name }))} /></Form.Item>
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

function usePeopleCosts(organizationId: string, propertyId: string, users: OrganizationUser[], onError?: NoticeHandler) {
  const [people, setPeople] = useState<PersonCost[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId || !propertyId) return;
    setLoading(true);
    const supabase = createClient();
    const [{ data: expenseRows, error: expenseError }, { data: settlementRows, error: settlementError }] = await Promise.all([
      supabase.from("expenses").select("id, category, amount, expense_date, payer_user_id, status, reference_code, note, expense_participants(user_id, allocated_amount)").eq("organization_id", organizationId).gte("expense_date", currentPeriod.format("YYYY-MM-DD")).lt("expense_date", currentPeriod.add(1, "month").format("YYYY-MM-DD")),
      supabase.from("member_settlements").select("user_id, is_settled").eq("property_id", propertyId).eq("period", currentPeriod.format("YYYY-MM-DD")),
    ]);
    if (expenseError || settlementError) onError?.("Không tải được dữ liệu đối soát. Hãy chạy migration 0006.");
    const normalizedExpenses = ((expenseRows ?? []) as unknown as ExpenseRecord[]).map((expense) => ({ ...expense, amount: Number(expense.amount), expense_participants: (expense.expense_participants ?? []).map((item) => ({ ...item, allocated_amount: Number(item.allocated_amount) })) }));
    const paidMap = new Map(((settlementRows ?? []) as Settlement[]).map((item) => [item.user_id, item.is_settled]));
    setExpenses(normalizedExpenses);
    setPeople(users.map((user) => {
      const allocated = normalizedExpenses.reduce((sum, expense) => sum + (expense.expense_participants.find((item) => item.user_id === user.user_id)?.allocated_amount ?? 0), 0);
      const advanced = normalizedExpenses.filter((expense) => expense.payer_user_id === user.user_id).reduce((sum, expense) => sum + expense.amount, 0);
      return { ...user, allocated, advanced, balance: allocated - advanced, paid: paidMap.get(user.user_id) ?? false };
    }));
    setLoading(false);
  }, [onError, organizationId, propertyId, users]);

  useEffect(() => { void load(); }, [load]);
  return { people, expenses, loading, reload: load };
}

export function PeopleCostsView({ organizationId, propertyId, users, onNotice }: SharedProps & { users: OrganizationUser[] }) {
  const [filter, setFilter] = useState<"Tất cả" | "Chưa đóng" | "Đã đóng">("Tất cả");
  const { people, expenses, loading, reload } = usePeopleCosts(organizationId, propertyId, users, onNotice);
  const visible = people.filter((person) => filter === "Tất cả" || (filter === "Đã đóng" ? person.paid : !person.paid));
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const unpaid = people.filter((person) => !person.paid && person.balance > 0);
  const unpaidTotal = unpaid.reduce((sum, person) => sum + person.balance, 0);
  const paidPercent = people.length ? Math.round(people.filter((person) => person.paid).length / people.length * 100) : 0;
  const receiver = [...people].sort((a, b) => a.balance - b.balance)[0];

  async function togglePaid(person: PersonCost, paid: boolean) {
    const { error } = await createClient().from("member_settlements").upsert({ organization_id: organizationId, property_id: propertyId, user_id: person.user_id, period: currentPeriod.format("YYYY-MM-DD"), is_settled: paid, settled_at: paid ? new Date().toISOString() : null, updated_at: new Date().toISOString() }, { onConflict: "property_id,user_id,period" });
    if (error) return onNotice("Không thể cập nhật trạng thái thanh toán.");
    onNotice(paid ? `Đã xác nhận ${person.full_name} thanh toán.` : `Đã chuyển ${person.full_name} về chưa thanh toán.`);
    await reload();
  }

  const columns: TableColumnsType<PersonCost> = [
    { title: "Thành viên", dataIndex: "full_name", width: 180, render: (name: string) => <Space><Avatar>{name.slice(0, 1).toUpperCase()}</Avatar><Typography.Text strong>{name}</Typography.Text></Space> },
    { title: "Phần chi phí", dataIndex: "allocated", width: 145, render: (amount: number) => vnd.format(amount) },
    { title: "Đã ứng", dataIndex: "advanced", width: 145, render: (amount: number) => vnd.format(amount) },
    { title: "Đối soát", dataIndex: "balance", width: 175, render: (balance: number) => <div><Typography.Text type="secondary" className="cell-subtext">{balance < 0 ? "Được nhận lại" : "Cần đóng"}</Typography.Text><Typography.Text strong type={balance < 0 ? "success" : "danger"}>{vnd.format(Math.abs(balance))}</Typography.Text></div> },
    { title: "STK - Ngân hàng", width: 190, render: (_, person) => <div><Typography.Text strong>{person.bank_account || "—"}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">{person.bank_name || "Chưa cập nhật"}</Typography.Text></div> },
    { title: "Đã đóng", dataIndex: "paid", width: 145, render: (paid: boolean, person) => <Checkbox checked={paid} onChange={(event) => void togglePaid(person, event.target.checked)}><Tag color={paid ? "success" : "warning"}>{paid ? "Đã đóng" : "Chưa đóng"}</Tag></Checkbox> },
  ];

  return (
    <div className="page-stack">
      <Card className="payment-banner"><Row align="middle" gutter={[20, 20]}><Col flex="auto"><Typography.Text className="banner-eyebrow">KỲ THANH TOÁN {currentPeriod.format("MM/YYYY")}</Typography.Text><Typography.Title level={3}>Đối soát chi phí thành viên</Typography.Title><Typography.Paragraph>Dữ liệu được tính tự động từ các khoản chi trong tháng.</Typography.Paragraph></Col><Col><div className="payment-progress"><Progress type="circle" percent={paidPercent} size={90} strokeColor="#ffffff" railColor="rgba(255,255,255,.2)" /><span>đã thanh toán</span></div></Col></Row></Card>
      <ViewSummary items={[
        { label: "Chi phí cần chia", value: vnd.format(total), note: `${expenses.length} khoản trong tháng`, icon: <WalletOutlined /> },
        { label: "Thành viên", value: `${people.length} người`, note: "Tham gia tổ chức", icon: <TeamOutlined /> },
        { label: "Chưa thanh toán", value: `${unpaid.length} người`, note: vnd.format(unpaidTotal), icon: <InfoCircleOutlined /> },
        { label: "Người nhận hoàn", value: receiver && receiver.balance < 0 ? receiver.full_name : "—", note: receiver && receiver.balance < 0 ? vnd.format(Math.abs(receiver.balance)) : "Không có", icon: <BankOutlined /> },
      ]} />
      <Card className="section-card" title={<div><span>Chi phí từng người</span><Typography.Text type="secondary" className="card-title-note">Tick để cập nhật trạng thái đã thanh toán</Typography.Text></div>} extra={<Segmented value={filter} options={["Tất cả", "Chưa đóng", "Đã đóng"]} onChange={(value) => setFilter(value as typeof filter)} />}>
        <Table rowKey="user_id" loading={loading} columns={columns} dataSource={visible} pagination={false} scroll={{ x: 950 }} locale={{ emptyText: <Empty description="Chưa có dữ liệu đối soát" /> }} />
      </Card>
    </div>
  );
}

export function ReportView({ organizationId, propertyId, users }: { organizationId: string; propertyId: string; users: OrganizationUser[] }) {
  const { people, expenses, loading } = usePeopleCosts(organizationId, propertyId, users);
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const collected = people.filter((person) => person.paid && person.balance > 0).reduce((sum, person) => sum + person.balance, 0);
  const outstanding = people.filter((person) => !person.paid && person.balance > 0).reduce((sum, person) => sum + person.balance, 0);
  const collectionRate = collected + outstanding ? Math.round(collected / (collected + outstanding) * 100) : 0;
  const largest = [...expenses].sort((a, b) => b.amount - a.amount)[0];
  const topPayer = [...people].sort((a, b) => b.advanced - a.advanced)[0];

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng chi kỳ này", value: vnd.format(total), note: currentPeriod.format("MM/YYYY"), icon: <WalletOutlined /> },
        { label: "Đã thu", value: vnd.format(collected), note: `${collectionRate}% cần thu`, icon: <CheckCircleFilled /> },
        { label: "Còn tồn đọng", value: vnd.format(outstanding), note: "Cần tiếp tục đối soát", icon: <InfoCircleOutlined /> },
        { label: "Số thành viên", value: `${users.length} người`, note: "Trong tổ chức", icon: <TeamOutlined /> },
      ]} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}><Card title="Tiến độ thu chi" className="section-card"><Flex vertical gap={22}><div><Flex justify="space-between"><Typography.Text>Tiến độ đã thu</Typography.Text><Typography.Text strong>{collectionRate}%</Typography.Text></Flex><Progress percent={collectionRate} strokeColor="#087a58" /></div>{expenses.length ? expenses.map((expense) => <div key={expense.id}><Flex justify="space-between"><Typography.Text>{expense.category}</Typography.Text><Typography.Text strong>{vnd.format(expense.amount)}</Typography.Text></Flex><Progress percent={total ? Math.round(expense.amount / total * 100) : 0} showInfo={false} strokeColor="#68ae92" /></div>) : <Empty description="Chưa có chi phí trong tháng" />}</Flex></Card></Col>
        <Col xs={24} lg={10}><Card title={`Tóm tắt kỳ ${currentPeriod.format("MM/YYYY")}`} className="section-card"><Descriptions column={1} bordered><Descriptions.Item label="Khoản chi lớn nhất">{largest?.category ?? "—"}</Descriptions.Item><Descriptions.Item label="Người ứng nhiều nhất">{topPayer?.advanced ? topPayer.full_name : "—"}</Descriptions.Item><Descriptions.Item label="Số người đã đóng">{people.filter((person) => person.paid).length}/{people.length}</Descriptions.Item><Descriptions.Item label="Trạng thái"><Tag color={outstanding > 0 ? "warning" : "success"}>{outstanding > 0 ? "Còn tồn đọng" : "Đã hoàn tất"}</Tag></Descriptions.Item></Descriptions></Card></Col>
      </Row>
    </div>
  );
}

type MemberFormValues = { account_identifier?: string; full_name: string; role: "admin" | "member"; phone?: string; bank_account?: string; bank_name?: string };

export function MembersView({ users, onNotice, onChanged }: { users: OrganizationUser[]; currentUserEmail: string; onNotice: NoticeHandler; onChanged: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<OrganizationUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<MemberFormValues>();

  useEffect(() => {
    if (!modalOpen) return;
    if (editingUser) {
      form.setFieldsValue({ full_name: editingUser.full_name, role: editingUser.role === "admin" ? "admin" : "member", phone: editingUser.phone, bank_account: editingUser.bank_account, bank_name: editingUser.bank_name });
    } else {
      form.resetFields();
      form.setFieldValue("role", "member");
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

  async function saveMember(values: MemberFormValues) {
    setSaving(true);
    const supabase = createClient();
    const { error } = editingUser
      ? await supabase.rpc("update_organization_member", { target_user_id: editingUser.user_id, target_full_name: values.full_name, target_phone: values.phone ?? "", target_bank_account: values.bank_account ?? "", target_bank_name: values.bank_name ?? "", target_role: values.role })
      : await supabase.rpc("add_organization_member_by_login", { target_identifier: values.account_identifier ?? "", target_full_name: values.full_name, target_role: values.role });
    setSaving(false);
    if (error) return onNotice(errorMessage(error, "Không thể lưu thành viên."));
    setModalOpen(false);
    onNotice(editingUser ? "Đã cập nhật thành viên." : "Đã thêm thành viên vào tổ chức.");
    onChanged();
  }

  async function deleteMember(user: OrganizationUser) {
    const { error } = await createClient().rpc("delete_organization_member", { target_user_id: user.user_id });
    if (error) return onNotice(errorMessage(error, "Không thể xóa thành viên."));
    onNotice(`Đã xóa ${user.full_name} khỏi tổ chức.`);
    onChanged();
  }

  const columns: TableColumnsType<OrganizationUser> = [
    { title: "Thành viên", dataIndex: "full_name", render: (name: string, user) => <Space><Avatar>{name.slice(0, 1).toUpperCase()}</Avatar><div><Typography.Text strong>{name}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">{user.email || "Không có email liên hệ"}</Typography.Text></div></Space> },
    { title: "Vai trò", dataIndex: "role", width: 150, render: (role: string) => <Tag color={role === "admin" ? "success" : "default"}>{role === "admin" ? "Quản trị viên" : "Thành viên"}</Tag> },
    { title: "Số điện thoại", dataIndex: "phone", width: 150, render: (value: string) => value || "—" },
    { title: "Ngân hàng", width: 200, render: (_, user) => user.bank_account ? <div><Typography.Text>{user.bank_account}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">{user.bank_name}</Typography.Text></div> : "—" },
    { title: "Thao tác", width: 130, render: (_, user) => { const isCurrentUser = user.user_id === users[0]?.user_id; return <Space size={2}><Button type="text" icon={<EditOutlined />} onClick={() => openEdit(user)} /><Popconfirm title="Xóa thành viên?" description="Thành viên sẽ mất quyền truy cập tổ chức." okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} disabled={isCurrentUser} onConfirm={() => void deleteMember(user)}><Button type="text" danger disabled={isCurrentUser} icon={<DeleteOutlined />} /></Popconfirm></Space>; } },
  ];

  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng thành viên", value: `${users.length} người`, note: "Đang có quyền truy cập", icon: <TeamOutlined /> },
        { label: "Quản trị viên", value: `${users.filter((user) => user.role === "admin").length} người`, note: "Có toàn quyền quản lý", icon: <UserAddOutlined /> },
        { label: "Thành viên", value: `${users.filter((user) => user.role !== "admin").length} người`, note: "Tự động thêm khi đăng ký", icon: <Avatar size={20}>M</Avatar> },
        { label: "Đã cập nhật ngân hàng", value: `${users.filter((user) => user.bank_account).length} người`, note: "Phục vụ đối soát", icon: <BankOutlined /> },
      ]} />
      <Card className="section-card" title={<div><span>Quản lý thành viên</span><Typography.Text type="secondary" className="card-title-note">Chỉ quản trị viên có thể thay đổi vai trò và thông tin thành viên</Typography.Text></div>} extra={<Button type="primary" icon={<UserAddOutlined />} onClick={openAdd}>Thêm thành viên</Button>}>
        <Alert type="info" showIcon className="member-help" title="Tài khoản mới và tài khoản Google sẽ tự động xuất hiện tại đây sau lần đăng nhập đầu tiên." />
        <Table rowKey="user_id" columns={columns} dataSource={users} pagination={false} scroll={{ x: 850 }} locale={{ emptyText: <Empty description="Chưa có thành viên" /> }} />
      </Card>

      <Modal title={editingUser ? "Chỉnh sửa thành viên" : "Thêm thành viên"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} forceRender>
        <Form form={form} layout="vertical" onFinish={saveMember}>
          {!editingUser && <Form.Item name="account_identifier" label="Tên tài khoản hoặc email" extra="Tài khoản cần đăng ký ít nhất một lần trước khi được thêm." rules={[{ required: true, message: "Nhập tên tài khoản hoặc email" }]}><Input autoComplete="off" /></Form.Item>}
          <Form.Item name="full_name" label="Tên hiển thị" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="role" label="Vai trò" rules={[{ required: true }]}><Select options={[{ value: "admin", label: "Quản trị viên" }, { value: "member", label: "Thành viên" }]} /></Form.Item>
          <Form.Item name="phone" label="Số điện thoại"><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="bank_account" label="Số tài khoản"><Input /></Form.Item></Col><Col span={12}><Form.Item name="bank_name" label="Ngân hàng"><Input /></Form.Item></Col></Row>
          <Button type="primary" htmlType="submit" loading={saving} block>{editingUser ? "Lưu thay đổi" : "Thêm thành viên"}</Button>
        </Form>
      </Modal>
    </div>
  );
}

function ViewSummary({ items }: { items: { label: string; value: string; note: string; icon: React.ReactNode }[] }) {
  return <Row gutter={[16, 16]}>{items.map((item, index) => <Col xs={12} sm={12} xl={6} key={item.label} className="summary-col"><Card className={`summary-card summary-card-${["green", "blue", "orange", "purple"][index % 4]}`}><Flex justify="space-between" align="flex-start"><Statistic title={item.label} value={item.value} /><span className={`metric-icon ${["green", "blue", "orange", "purple"][index % 4]}`}>{item.icon}</span></Flex><Typography.Text type="secondary">{item.note}</Typography.Text></Card></Col>)}</Row>;
}
