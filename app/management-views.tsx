"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Empty,
  Col,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Image,
  Input,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
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
  EditOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SearchOutlined,
  TeamOutlined,
  WalletOutlined,
} from "@ant-design/icons";

const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const compactVnd = new Intl.NumberFormat("vi-VN", { notation: "compact", style: "currency", currency: "VND", maximumFractionDigits: 1 });

type RentalRoom = {
  code: string;
  floor: number;
  size: string;
  residents: string[];
  rent: number;
  coefficient: number;
};

const roomData: RentalRoom[] = [
  { code: "P.401", floor: 4, size: "Phòng nhỏ", residents: ["Đức"], rent: 2_440_000, coefficient: 0.855 },
  { code: "P.402", floor: 4, size: "Phòng to", residents: ["Hải", "Kiên"], rent: 2_710_000, coefficient: 0.95 },
  { code: "P.301", floor: 3, size: "Phòng nhỏ", residents: ["Trường"], rent: 2_570_000, coefficient: 0.9 },
  { code: "P.302", floor: 3, size: "Phòng to", residents: ["NA", "Tuấn"], rent: 2_860_000, coefficient: 1 },
  { code: "P.201", floor: 2, size: "Phòng nhỏ", residents: ["Liên", "Dung"], rent: 2_570_000, coefficient: 0.9 },
  { code: "P.202", floor: 2, size: "Phòng to", residents: ["Việt", "Phương"], rent: 2_860_000, coefficient: 1 },
];

export type OrganizationUser = { user_id: string; full_name: string; email: string };

type Expense = {
  id: number;
  date: string;
  name: string;
  amount: number;
  payer: string;
  participants: string[];
  reference?: string;
  status: "done" | "pending";
};

type PersonCost = {
  name: string;
  total: number;
  advanced: number;
  balance: number;
  paid: boolean;
  account: string;
  bank: string;
};

const originalExpenses: Expense[] = [
  { id: 1, date: "05/2026", name: "Tiền điện", amount: 6_007_090, payer: "Hải", participants: ["A Hải", "Kiên", "Dung", "C Liên", "A Thái", "Tuấn", "NA", "A Trường", "Đức"], reference: "PD03000029784", status: "done" },
  { id: 2, date: "05/2026", name: "Tiền nước", amount: 856_350, payer: "Hải", participants: ["A Hải", "Kiên", "Dung", "C Liên", "A Thái", "Tuấn", "NA", "A Trường", "Đức"], reference: "111252812", status: "done" },
  { id: 3, date: "08/05/2026", name: "Tiền internet", amount: 380_000, payer: "Hải", participants: ["A Hải", "Kiên", "Dung", "C Liên", "A Thái", "Tuấn", "NA", "A Trường", "Đức"], status: "done" },
];

const peopleData: PersonCost[] = [
  { name: "A Hải", total: 804_826.6667, advanced: 7_243_440, balance: -6_438_613.333, paid: true, account: "1041702775", bank: "Vietcombank" },
  { name: "Kiên", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: false, account: "1065069205", bank: "Vietcombank" },
  { name: "Dung", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: true, account: "0335390581", bank: "MB Bank" },
  { name: "C Liên", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: false, account: "1031906128", bank: "Vietcombank" },
  { name: "A Thái", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: false, account: "", bank: "Chưa cập nhật" },
  { name: "Tuấn", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: true, account: "0386107787", bank: "MB Bank" },
  { name: "NA", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: true, account: "1515902", bank: "VPBank" },
  { name: "A Trường", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: true, account: "9971803568", bank: "Vietcombank" },
  { name: "Đức", total: 804_826.6667, advanced: 0, balance: 804_826.6667, paid: true, account: "4650581798", bank: "BIDV" },
];

type NoticeHandler = (message: string) => void;
type RoomFormValues = { code: string; floor: number; size: string; coefficient: string; residents: string; rent: string };
function uniqueOrganizationUsers(users: OrganizationUser[]) {
  const unique = new Map<string, OrganizationUser>();
  users.forEach((user) => {
    const key = user.user_id || user.email.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, user);
  });
  return Array.from(unique.values());
}

function expenseMonthKey(date: string) {
  if (date === "Hôm nay") return dayjs().format("YYYY-MM");
  const parts = date.split("/");
  if (parts.length === 2) return `${parts[1]}-${parts[0]}`;
  if (parts.length === 3) return `${parts[2]}-${parts[1]}`;
  return "";
}

type ExpenseFormValues = { name: string; amount: string; payerId: string; participantIds: string[] };

export function RoomsView({ onNotice }: { onNotice: NoticeHandler }) {
  const [display, setDisplay] = useState<"Danh sách" | "Sơ đồ tầng">("Danh sách");
  const [rooms, setRooms] = useState(roomData);
  const [editingRoom, setEditingRoom] = useState<RentalRoom | null>(null);
  const [form] = Form.useForm<RoomFormValues>();

  useEffect(() => {
    const saved = window.localStorage.getItem("708-la-thanh-rooms");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as RentalRoom[];
      if (Array.isArray(parsed) && parsed.length) setRooms(parsed);
    } catch {
      window.localStorage.removeItem("708-la-thanh-rooms");
    }
  }, []);

  const totalRent = rooms.reduce((sum, room) => sum + room.rent, 0);
  const residentCount = rooms.reduce((sum, room) => sum + room.residents.length, 0);

  function editRoom(room: RentalRoom) {
    setEditingRoom(room);
    form.setFieldsValue({
      code: room.code,
      floor: room.floor,
      size: room.size,
      coefficient: String(room.coefficient),
      residents: room.residents.join(", "),
      rent: room.rent.toLocaleString("vi-VN"),
    });
  }

  function saveRoom(values: RoomFormValues) {
    if (!editingRoom) return;
    const code = values.code.trim().toUpperCase();
    const residents = values.residents.split(/[,;\n]/).map((name) => name.trim()).filter(Boolean);
    const rent = Number(values.rent.replace(/[^0-9]/g, ""));
    const coefficient = Number(values.coefficient.replace(",", "."));

    if (!code || !values.floor || !residents.length || !rent || !coefficient) {
      onNotice("Vui lòng nhập đủ thông tin phòng và ít nhất một người ở.");
      return;
    }
    if (rooms.some((room) => room.code !== editingRoom.code && room.code === code)) {
      onNotice("Mã phòng này đã tồn tại.");
      return;
    }

    const updated: RentalRoom = { code, floor: values.floor, size: values.size, residents, rent, coefficient };
    const nextRooms = rooms.map((room) => room.code === editingRoom.code ? updated : room);
    setRooms(nextRooms);
    window.localStorage.setItem("708-la-thanh-rooms", JSON.stringify(nextRooms));
    setEditingRoom(null);
    onNotice(`Đã cập nhật chi tiết ${code}.`);
  }

  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng tiền nhà", value: vnd.format(totalRent), note: "Cập nhật theo chi tiết phòng", icon: <WalletOutlined /> },
        { label: "Phòng đang ở", value: `${rooms.length}/6`, note: "100% lấp đầy", icon: <HomeOutlined /> },
        { label: "Thành viên", value: `${residentCount} người`, note: "Theo danh sách phòng", icon: <TeamOutlined /> },
        { label: "Giá bình quân", value: compactVnd.format(totalRent / rooms.length), note: "Mỗi phòng / tháng", icon: <BankOutlined /> },
      ]} />

      <Flex className="view-actions" justify="space-between" align="center" gap={12} wrap>
        <Segmented value={display} options={["Danh sách", "Sơ đồ tầng"]} onChange={(value) => setDisplay(value as typeof display)} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => onNotice("Chức năng thêm phòng sẽ lưu vào Supabase ở bước tiếp theo.")}>Thêm phòng</Button>
      </Flex>

      {display === "Danh sách" ? (
        <Row gutter={[16, 16]}>
          {rooms.map((room) => (
            <Col xs={24} md={12} xl={8} key={room.code}>
              <RoomCard room={room} onEdit={() => editRoom(room)} />
            </Col>
          ))}
        </Row>
      ) : (
        <div className="floor-board">
          {[4, 3, 2, 1].map((floor) => (
            <section className="floor-line" key={floor}>
              <div className="floor-number"><Typography.Text>TẦNG</Typography.Text><strong>{floor}</strong></div>
              <div className="floor-rooms">
                {floor === 1 ? (
                  <>
                    <Card className="utility-card"><HomeOutlined /><strong>Bếp chung</strong><span>Khu sinh hoạt</span></Card>
                    <Card className="utility-card"><HomeOutlined /><strong>Để xe</strong><span>Khu dùng chung</span></Card>
                  </>
                ) : rooms.filter((room) => room.floor === floor).map((room) => <RoomCard key={room.code} room={room} compact onEdit={() => editRoom(room)} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      <Alert
        type="info"
        showIcon
        title="Cách tính từ file Excel"
        description="Giá phòng = Tổng giá nhà × hệ số tầng × hệ số kích thước / tổng hệ số. Phòng nhiều người được chia đều cho số người trong phòng."
      />

      <Modal title={editingRoom ? `Chỉnh sửa ${editingRoom.code}` : "Chỉnh sửa phòng"} open={Boolean(editingRoom)} onCancel={() => setEditingRoom(null)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={saveRoom}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="Mã phòng" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="floor" label="Tầng" rules={[{ required: true }]}><Select options={[2, 3, 4].map((floor) => ({ value: floor, label: `Tầng ${floor}` }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="size" label="Loại phòng" rules={[{ required: true }]}><Select options={["Phòng to", "Phòng nhỏ"].map((value) => ({ value, label: value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="coefficient" label="Hệ số" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item></Col>
          </Row>
          <Form.Item name="residents" label="Người đang ở" extra="Ngăn cách tên bằng dấu phẩy" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="Ví dụ: Hải, Kiên" />
          </Form.Item>
          <Form.Item name="rent" label="Giá thuê tháng (VNĐ)" rules={[{ required: true }]}>
            <Input inputMode="numeric" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Lưu thay đổi</Button>
        </Form>
      </Modal>
    </div>
  );
}

function RoomCard({ room, compact = false, onEdit }: { room: RentalRoom; compact?: boolean; onEdit: () => void }) {
  const perPerson = room.rent / room.residents.length;
  return (
    <Card className={`rental-card ${compact ? "compact" : ""}`} hoverable={!compact}>
      <Flex justify="space-between" align="center">
        <Tag color="gold">Tầng {room.floor}</Tag>
        <Space size={4}>
          <Tag color="success">Đang ở</Tag>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit}>Sửa</Button>
        </Space>
      </Flex>
      <Flex className="room-title-line" justify="space-between" align="end">
        <div><Typography.Text type="secondary">{room.size}</Typography.Text><Typography.Title level={3}>{room.code}</Typography.Title></div>
        <div className="room-rent"><Typography.Text strong>{vnd.format(room.rent)}</Typography.Text><span>/ tháng</span></div>
      </Flex>
      <Flex gap={6} wrap className="resident-list">
        {room.residents.map((resident) => <Tag key={resident} icon={<Avatar size={18}>{resident.slice(0, 1)}</Avatar>}>{resident}</Tag>)}
      </Flex>
      <Flex justify="space-between" className="room-card-meta">
        <Typography.Text type="secondary">Hệ số <b>{room.coefficient}</b></Typography.Text>
        <Typography.Text type="secondary">Mỗi người <b>{vnd.format(perPerson)}</b></Typography.Text>
      </Flex>
    </Card>
  );
}

export function ExpensesView({ onNotice, users, currentUserEmail }: { onNotice: NoticeHandler; users: OrganizationUser[]; currentUserEmail: string }) {
  const availableUsers = useMemo(() => {
    const fallbackUsers: OrganizationUser[] = peopleData.map((person, index) => ({ user_id: `demo-${index}`, full_name: person.name, email: "" }));
    return uniqueOrganizationUsers(users.length ? users : fallbackUsers);
  }, [users]);
  const currentUser = availableUsers.find((user) => user.email === currentUserEmail) ?? availableUsers[0];
  const [expenses, setExpenses] = useState(originalExpenses);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [monthFilter, setMonthFilter] = useState<Dayjs | null>(dayjs("2026-05-01"));
  const [statusFilter, setStatusFilter] = useState<"all" | Expense["status"]>("all");
  const [settlementStates, setSettlementStates] = useState<Record<string, boolean>>(
    Object.fromEntries(peopleData.map((person) => [person.name, person.paid])),
  );
  const [form] = Form.useForm<ExpenseFormValues>();
  const selectedParticipants = Form.useWatch("participantIds", form) ?? [];

  useEffect(() => {
    const saved = window.localStorage.getItem("708-la-thanh-settlements");
    if (!saved) return;
    try {
      const states = JSON.parse(saved) as Record<string, boolean>;
      setSettlementStates((current) => ({ ...current, ...states }));
    } catch {
      window.localStorage.removeItem("708-la-thanh-settlements");
    }
  }, []);

  const filtered = expenses.filter((expense) => {
    const matchesQuery = expense.name.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"));
    const matchesMonth = !monthFilter || expenseMonthKey(expense.date) === monthFilter.format("YYYY-MM");
    const matchesStatus = statusFilter === "all" || expense.status === statusFilter;
    return matchesQuery && matchesMonth && matchesStatus;
  });
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const filteredTotal = filtered.reduce((sum, expense) => sum + expense.amount, 0);
  const paidPeople = peopleData.filter((person) => settlementStates[person.name]);
  const unpaidPeople = peopleData.filter((person) => !settlementStates[person.name]);
  const paidAmount = paidPeople.reduce((sum, person) => sum + person.total, 0);
  const unpaidAmount = unpaidPeople.reduce((sum, person) => sum + person.total, 0);

  function openExpenseForm() {
    form.setFieldsValue({
      name: "",
      amount: "",
      payerId: currentUser?.user_id ?? "",
      participantIds: availableUsers.map((user) => user.user_id),
    });
    setShowForm(true);
  }

  function addExpense(values: ExpenseFormValues) {
    const value = Number(values.amount.replace(/[^0-9]/g, ""));
    const payer = availableUsers.find((user) => user.user_id === values.payerId);
    const participantNames = availableUsers.filter((user) => values.participantIds.includes(user.user_id)).map((user) => user.full_name);
    if (!values.name.trim() || !value || !payer || !participantNames.length) {
      onNotice("Hãy nhập khoản chi, chọn người thanh toán và ít nhất một người tham gia.");
      return;
    }
    setExpenses((current) => [...current, { id: Date.now(), date: "Hôm nay", name: values.name.trim(), amount: value, payer: payer.full_name, participants: participantNames, status: "done" }]);
    setShowForm(false);
    onNotice(`Đã thêm ${values.name.trim()} và chia cho ${participantNames.length} người.`);
  }

  const columns: TableColumnsType<Expense> = [
    { title: "Ngày", dataIndex: "date", width: 110 },
    {
      title: "Nội dung",
      dataIndex: "name",
      width: 190,
      render: (name: string, expense) => <div><Typography.Text strong>{name}</Typography.Text>{expense.reference && <Typography.Text type="secondary" className="cell-subtext">Mã: {expense.reference}</Typography.Text>}</div>,
    },
    {
      title: "Người thanh toán",
      dataIndex: "payer",
      width: 160,
      render: (payer: string) => <Space><Avatar size="small">{payer.slice(0, 1)}</Avatar><Typography.Text>{payer}</Typography.Text></Space>,
    },
    {
      title: "Người tham gia",
      dataIndex: "participants",
      width: 250,
      render: (participants: string[]) => <div><Typography.Text strong>{participants.length} người</Typography.Text><Typography.Text type="secondary" className="cell-subtext ellipsis">{participants.join(", ")}</Typography.Text></div>,
    },
    { title: "Mỗi người", width: 130, render: (_, expense) => vnd.format(expense.amount / expense.participants.length) },
    { title: "Tổng chi", dataIndex: "amount", width: 140, align: "right", render: (amount: number) => <Typography.Text strong>{vnd.format(amount)}</Typography.Text> },
    { title: "Trạng thái", dataIndex: "status", width: 130, render: (status: Expense["status"]) => <Tag color={status === "done" ? "success" : "warning"} icon={status === "done" ? <CheckCircleFilled /> : undefined}>{status === "done" ? "Hoàn thành" : "Chờ xử lý"}</Tag> },
  ];

  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng chi phí", value: vnd.format(total), note: `${expenses.length} khoản trong kỳ`, icon: <WalletOutlined /> },
        { label: "Số tiền đã đóng", value: vnd.format(paidAmount), note: `${paidPeople.length}/${peopleData.length} người đã đóng`, icon: <CheckCircleFilled /> },
        { label: "Số tiền chưa đóng", value: vnd.format(unpaidAmount), note: `${unpaidPeople.length}/${peopleData.length} người chưa đóng`, icon: <BankOutlined /> },
        { label: "Trạng thái", value: unpaidPeople.length ? "Còn tồn đọng" : "Đã đóng đủ", note: unpaidPeople.length ? `Còn ${vnd.format(unpaidAmount)} cần thu` : "Tất cả thành viên đã hoàn tất", icon: <InfoCircleOutlined /> },
      ]} />

      <Card
        className="section-card"
        title={<div><span>Chi phí sinh hoạt</span><Typography.Text type="secondary" className="card-title-note">Dữ liệu kỳ tháng 05/2026 từ file SINH HOẠT CHUNG</Typography.Text></div>}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openExpenseForm}>Thêm chi phí</Button>}
      >
        <Flex className="table-toolbar" gap={10} wrap>
          <Input allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm khoản chi..." className="table-search" />
          <DatePicker
            picker="month"
            allowClear
            value={monthFilter}
            onChange={setMonthFilter}
            format="MM/YYYY"
            placeholder="Tất cả thời gian"
            className="month-filter"
          />
          <Select
            className="status-filter"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as typeof statusFilter)}
            options={[{ value: "all", label: "Tất cả trạng thái" }, { value: "done", label: "Hoàn thành" }, { value: "pending", label: "Chờ xử lý" }]}
          />
        </Flex>
        <div className="desktop-data-table">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={false}
          scroll={{ x: 1110 }}
          summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={5} align="right"><Typography.Text>Tổng cộng theo bộ lọc</Typography.Text></Table.Summary.Cell><Table.Summary.Cell index={5} align="right"><Typography.Text strong>{vnd.format(filteredTotal)}</Typography.Text></Table.Summary.Cell><Table.Summary.Cell index={6} /></Table.Summary.Row>}
        />
        </div>
        <div className="mobile-data-list" aria-label="Danh s?ch chi ph?">
          {filtered.length ? filtered.map((expense) => (
            <Card key={expense.id} size="small" className="mobile-record-card">
              <Flex justify="space-between" align="flex-start" gap={12}>
                <div className="mobile-record-title">
                  <Typography.Text strong>{expense.name}</Typography.Text>
                  <Typography.Text type="secondary">{expense.date}{expense.reference ? ` ? ${expense.reference}` : ""}</Typography.Text>
                </div>
                <Tag color={expense.status === "done" ? "success" : "warning"}>{expense.status === "done" ? "Ho?n th?nh" : "Ch? x? l?"}</Tag>
              </Flex>
              <div className="mobile-record-grid">
                <MobileField label="Ng??i thanh to?n" value={expense.payer} />
                <MobileField label="Ng??i tham gia" value={`${expense.participants.length} ng??i`} />
                <MobileField label="M?i ng??i" value={vnd.format(expense.amount / expense.participants.length)} />
                <MobileField label="T?ng chi" value={vnd.format(expense.amount)} strong />
              </div>
              <Typography.Text type="secondary" className="mobile-participants">{expense.participants.join(", ")}</Typography.Text>
            </Card>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kh?ng c? kho?n chi ph? h?p" />}
          <Flex className="mobile-list-total" justify="space-between" align="center">
            <Typography.Text type="secondary">T?ng theo b? l?c</Typography.Text>
            <Typography.Text strong>{vnd.format(filteredTotal)}</Typography.Text>
          </Flex>
        </div>
      </Card>

      <Modal title="Thêm chi phí sinh hoạt" open={showForm} onCancel={() => setShowForm(false)} footer={null} width={650} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={addExpense}>
          <Form.Item name="name" label="Nội dung" rules={[{ required: true, message: "Nhập nội dung khoản chi" }]}>
            <Input autoFocus placeholder="Ví dụ: Tiền gas" />
          </Form.Item>
          <Form.Item name="amount" label="Số tiền (VNĐ)" rules={[{ required: true, message: "Nhập số tiền" }]}>
            <Input inputMode="numeric" placeholder="Ví dụ: 450.000" />
          </Form.Item>
          <Form.Item name="payerId" label="Người thanh toán" rules={[{ required: true, message: "Chọn người thanh toán" }]} extra={users.length ? "Danh sách thành viên lấy từ Supabase" : "Đang dùng danh sách mẫu"}>
            <Select options={availableUsers.map((user) => ({ value: user.user_id, label: user.email ? `${user.full_name} — ${user.email}` : user.full_name }))} />
          </Form.Item>
          <div className="participant-field-heading">
            <Typography.Text strong><span className="required-mark">*</span> Người tham gia</Typography.Text>
            <Button type="link" size="small" onClick={() => form.setFieldValue("participantIds", selectedParticipants.length === availableUsers.length ? [] : availableUsers.map((user) => user.user_id))}>{selectedParticipants.length === availableUsers.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}</Button>
          </div>
          <Form.Item name="participantIds" rules={[{ required: true, message: "Chọn ít nhất một người" }]} extra={`Đã chọn ${selectedParticipants.length}/${availableUsers.length} người`}>
            <Checkbox.Group className="participant-grid" options={availableUsers.map((user) => ({ value: user.user_id, label: user.full_name }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Lưu khoản chi</Button>
        </Form>
      </Modal>
    </div>
  );
}

export function PeopleCostsView({ onNotice }: { onNotice: NoticeHandler }) {
  const [people, setPeople] = useState(peopleData);
  const [filter, setFilter] = useState<"Tất cả" | "Chưa đóng" | "Đã đóng">("Tất cả");
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("708-la-thanh-settlements");
    if (!saved) return;
    try {
      const states = JSON.parse(saved) as Record<string, boolean>;
      setPeople((current) => current.map((person) => states[person.name] === undefined ? person : { ...person, paid: states[person.name] }));
    } catch {
      window.localStorage.removeItem("708-la-thanh-settlements");
    }
  }, []);

  const visible = useMemo(() => people.filter((person) => filter === "Tất cả" || (filter === "Đã đóng" ? person.paid : !person.paid)), [filter, people]);
  const unpaidCount = people.filter((person) => !person.paid).length;
  const unpaidTotal = people.filter((person) => !person.paid).reduce((sum, person) => sum + person.total, 0);
  const paidPercent = Math.round((people.length - unpaidCount) / people.length * 100);

  function togglePaid(name: string, paid: boolean) {
    const next = people.map((person) => person.name === name ? { ...person, paid } : person);
    setPeople(next);
    window.localStorage.setItem("708-la-thanh-settlements", JSON.stringify(Object.fromEntries(next.map((person) => [person.name, person.paid]))));
    onNotice(paid ? `Đã xác nhận ${name} đóng tiền.` : `Đã chuyển ${name} về trạng thái chưa đóng.`);
  }

  const sharedAmount = Math.round(peopleData[0].total);
  const qrUrl = `https://img.vietqr.io/image/VCB-1041702775-compact2.png?amount=${sharedAmount}&addInfo=${encodeURIComponent("708 LT T5 2026")}`;

  const columns: TableColumnsType<PersonCost> = [
    {
      title: "Thành viên",
      dataIndex: "name",
      width: 170,
      render: (name: string) => <Space><Avatar>{name.replace(/^(A |C )/, "").slice(0, 1)}</Avatar><Typography.Text strong>{name}</Typography.Text></Space>,
    },
    { title: "Phần chi phí", dataIndex: "total", width: 140, render: (amount: number) => vnd.format(amount) },
    { title: "Đã ứng", dataIndex: "advanced", width: 140, render: (amount: number) => vnd.format(amount) },
    {
      title: "Đối soát",
      dataIndex: "balance",
      width: 170,
      render: (balance: number) => <div><Typography.Text type="secondary" className="cell-subtext">{balance < 0 ? "Được nhận lại" : "Cần đóng"}</Typography.Text><Typography.Text strong type={balance < 0 ? "success" : "danger"}>{vnd.format(Math.abs(balance))}</Typography.Text></div>,
    },
    {
      title: "STK - Ngân hàng",
      width: 190,
      render: (_, person) => <div><Typography.Text strong>{person.account || "—"}</Typography.Text><Typography.Text type="secondary" className="cell-subtext">{person.bank}</Typography.Text></div>,
    },
    {
      title: "Đã đóng",
      dataIndex: "paid",
      width: 140,
      render: (paid: boolean, person) => <Checkbox checked={paid} onChange={(event) => togglePaid(person.name, event.target.checked)}><Tag color={paid ? "success" : "warning"}>{paid ? "Đã đóng" : "Chưa đóng"}</Tag></Checkbox>,
    },
  ];

  return (
    <div className="page-stack">
      <Card className="payment-banner">
        <Row align="middle" gutter={[20, 20]}>
          <Col flex="auto">
            <Typography.Text className="banner-eyebrow">KỲ THANH TOÁN THÁNG 05/2026</Typography.Text>
            <Typography.Title level={3}>Thanh toán từ ngày 15 đến ngày 20</Typography.Title>
            <Typography.Paragraph>Quét QR đúng số tiền, sau đó quản lý tick xác nhận đã đóng.</Typography.Paragraph>
          </Col>
          <Col>
            <div className="payment-progress"><Progress type="circle" percent={paidPercent} size={90} strokeColor="#ffffff" railColor="rgba(255,255,255,.2)" format={() => `${people.length - unpaidCount}/${people.length}`} /><span>đã thanh toán</span></div>
          </Col>
        </Row>
      </Card>

      <ViewSummary items={[
        { label: "Chi phí cần chia", value: vnd.format(7_243_440), note: "Điện, nước, internet", icon: <WalletOutlined /> },
        { label: "Mỗi người", value: vnd.format(804_826.6667), note: "9 người tham gia", icon: <TeamOutlined /> },
        { label: "Chưa thanh toán", value: `${unpaidCount} người`, note: vnd.format(unpaidTotal), icon: <InfoCircleOutlined /> },
        { label: "Người nhận hoàn", value: "A Hải", note: vnd.format(6_438_613.333), icon: <BankOutlined /> },
      ]} />

      <Card
        className="section-card"
        title={<div><span>Chi phí từng người</span><Typography.Text type="secondary" className="card-title-note">Sau khi nhận tiền, quản lý tự tick xác nhận đã đóng</Typography.Text></div>}
        extra={<Space wrap><Button type="primary" icon={<QrcodeOutlined />} onClick={() => setShowQr(true)}>Mã QR thanh toán</Button><Segmented value={filter} options={["Tất cả", "Chưa đóng", "Đã đóng"]} onChange={(value) => setFilter(value as typeof filter)} /></Space>}
      >
        <div className="desktop-data-table">
          <Table rowKey="name" columns={columns} dataSource={visible} pagination={false} scroll={{ x: 920 }} />
        </div>
        <Alert className="table-note" type="info" showIcon title="Số âm trong cột đối soát nghĩa là thành viên đã ứng trước và cần được nhận lại tiền." />
        <div className="mobile-data-list" aria-label="Chi ph? t?ng ng??i">
          {visible.map((person) => (
            <Card key={person.name} size="small" className={`mobile-record-card person-record ${person.paid ? "is-paid" : ""}`}>
              <Flex justify="space-between" align="center" gap={12}>
                <Space size={9}>
                  <Avatar>{person.name.replace(/^(A |C )/, "").slice(0, 1)}</Avatar>
                  <div className="mobile-record-title"><Typography.Text strong>{person.name}</Typography.Text><Typography.Text type="secondary">{person.bank}</Typography.Text></div>
                </Space>
                <Checkbox checked={person.paid} onChange={(event) => togglePaid(person.name, event.target.checked)} aria-label={`X?c nh?n ${person.name} ?? ??ng`} />
              </Flex>
              <div className="mobile-record-grid three-fields">
                <MobileField label="Ph?n chi ph?" value={vnd.format(person.total)} />
                <MobileField label="?? ?ng" value={vnd.format(person.advanced)} />
                <MobileField label={person.balance < 0 ? "???c nh?n l?i" : "C?n ??ng"} value={vnd.format(Math.abs(person.balance))} strong tone={person.balance < 0 ? "positive" : "negative"} />
              </div>
              <Flex justify="space-between" align="center" className="mobile-record-footer">
                <Typography.Text type="secondary">{person.account || "Ch?a c? s? t?i kho?n"}</Typography.Text>
                <Tag color={person.paid ? "success" : "warning"}>{person.paid ? "?? ??ng" : "Ch?a ??ng"}</Tag>
              </Flex>
            </Card>
          ))}
        </div>
      </Card>

      <Modal title="Thanh toán chi phí tháng 05/2026" open={showQr} onCancel={() => setShowQr(false)} footer={<Button type="primary" onClick={() => setShowQr(false)}>Đóng</Button>} width={440}>
        <div className="qr-content">
          <Typography.Text type="secondary">MÃ QR DÙNG CHUNG</Typography.Text>
          <Image preview={false} src={qrUrl} alt="Mã QR thanh toán chi phí tháng 05/2026" width={250} />
          <Statistic title="Số tiền mỗi người" value={sharedAmount} formatter={(value) => vnd.format(Number(value))} />
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Người nhận">A Hải</Descriptions.Item>
            <Descriptions.Item label="Ngân hàng">Vietcombank · 1041702775</Descriptions.Item>
            <Descriptions.Item label="Nội dung">708 LT T5 2026</Descriptions.Item>
          </Descriptions>
          <Alert type="warning" showIcon title="Mở hoặc đóng mã QR không thay đổi trạng thái. Sau khi nhận tiền, hãy tick thủ công ở bảng." />
        </div>
      </Modal>
    </div>
  );
}

export function ReportView() {
  const total = originalExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const paid = peopleData.filter((person) => person.paid).reduce((sum, person) => sum + person.total, 0);
  const outstanding = total - paid;
  const collectionRate = Math.round(paid / total * 100);

  return (
    <div className="page-stack">
      <ViewSummary items={[
        { label: "Tổng chi kỳ này", value: vnd.format(total), note: "Tháng 05/2026", icon: <WalletOutlined /> },
        { label: "Đã thu", value: vnd.format(paid), note: `${collectionRate}% tổng chi`, icon: <CheckCircleFilled /> },
        { label: "Còn tồn đọng", value: vnd.format(outstanding), note: "Cần tiếp tục đối soát", icon: <InfoCircleOutlined /> },
        { label: "Số thành viên", value: `${peopleData.length} người`, note: "Cùng tham gia kỳ này", icon: <TeamOutlined /> },
      ]} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Tiến độ thu chi" className="section-card">
            <Flex vertical gap={22}>
              <div><Flex justify="space-between"><Typography.Text>Tiến độ đã thu</Typography.Text><Typography.Text strong>{collectionRate}%</Typography.Text></Flex><Progress percent={collectionRate} strokeColor="#087a58" /></div>
              {originalExpenses.map((expense) => <div key={expense.id}><Flex justify="space-between"><Typography.Text>{expense.name}</Typography.Text><Typography.Text strong>{vnd.format(expense.amount)}</Typography.Text></Flex><Progress percent={Math.round(expense.amount / total * 100)} showInfo={false} strokeColor="#68ae92" /></div>)}
            </Flex>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Tóm tắt kỳ tháng 05/2026" className="section-card">
            <Descriptions column={1} bordered>
              <Descriptions.Item label="Khoản chi lớn nhất">Tiền điện</Descriptions.Item>
              <Descriptions.Item label="Người ứng tiền">A Hải</Descriptions.Item>
              <Descriptions.Item label="Số người đã đóng">{peopleData.filter((person) => person.paid).length}/{peopleData.length}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái"><Tag color={outstanding > 0 ? "warning" : "success"}>{outstanding > 0 ? "Còn tồn đọng" : "Đã đóng đủ"}</Tag></Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function ViewSummary({ items }: { items: { label: string; value: string; note: string; icon: React.ReactNode }[] }) {
  return (
    <Row gutter={[16, 16]}>
      {items.map((item, index) => (
        <Col xs={12} sm={12} xl={6} key={item.label} className="summary-col">
          <Card className="summary-card">
            <Flex justify="space-between" align="flex-start">
              <Statistic title={item.label} value={item.value} />
              <span className={`metric-icon ${["green", "blue", "orange", "purple"][index % 4]}`}>{item.icon}</span>
            </Flex>
            <Typography.Text type="secondary">{item.note}</Typography.Text>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function MobileField({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: "positive" | "negative" }) {
  return (
    <div className={`mobile-field ${tone ?? ""}`}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong={strong}>{value}</Typography.Text>
    </div>
  );
}
