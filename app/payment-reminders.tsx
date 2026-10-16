"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Badge, Button, Card, Col, DatePicker, Drawer, Dropdown, Empty, Flex, Form, Input, InputNumber, Modal, Pagination, Row, Select, Skeleton, Space, Spin, Switch, Tabs, Tag, Typography } from "antd";
import { BellOutlined, CheckOutlined, ClockCircleOutlined, DeleteOutlined, HomeOutlined, MailOutlined, MoreOutlined, ReloadOutlined, SendOutlined, UndoOutlined, WalletOutlined } from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";

const { TextArea } = Input;
const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
type ReminderScope = "living_expense" | "rent";
type ReminderEventScope = ReminderScope | "legacy_combined";
type ReminderSettings = {
  organization_id: string; property_id: string; enabled: boolean; email_enabled: boolean; in_app_enabled: boolean;
  settlement_due_day: number; living_send_day: number; reminder_before_days: number; reminder_on_due_date: boolean; reminder_after_days: number;
  sender_name: string; sender_email: string; reply_to: string; email_subject_template: string; email_body_template: string;
  rent_enabled: boolean; rent_email_enabled: boolean; rent_in_app_enabled: boolean; rent_due_day: number; rent_send_day: number;
  rent_reminder_before_days: number; rent_reminder_on_due_date: boolean; rent_reminder_after_days: number;
  rent_email_subject_template: string; rent_email_body_template: string;
};
type ReminderEvent = {
  id: string; member_name: string; recipient_email: string; amount: number; items: string; period_start: string; due_date: string;
  reminder_type: "before" | "due" | "overdue"; in_app_enabled: boolean; email_status: "pending" | "sending" | "sent" | "failed" | "skipped";
  reminder_scope: ReminderEventScope; email_error: string | null; attempt_count: number; read_at: string | null; created_at: string; sent_at: string | null;
};
type RecipientAudit = {
  member_id: string; member_name: string; recipient_email: string; reminder_scope: ReminderScope; amount: number;
  send_date: string | null; due_date: string; status_code: string;
  last_email_status: ReminderEvent["email_status"] | null; last_email_error: string | null; last_event_at: string | null;
};
type RentCycleRoom = { id: string; code: string; base_rent: number; rent_billing_cycle_months: number; rent_cycle_start_month: string };
const rentCycleOptions = [
  { value: 1, label: "Hàng tháng" },
  { value: 3, label: "3 tháng/lần" },
  { value: 6, label: "6 tháng/lần" },
  { value: 12, label: "12 tháng/lần" },
];
const defaults = (organization_id: string, property_id: string): ReminderSettings => ({
  organization_id, property_id, enabled: false, email_enabled: false, in_app_enabled: true, settlement_due_day: 5, living_send_day: 2,
  reminder_before_days: 3, reminder_on_due_date: true, reminder_after_days: 3, sender_name: "708 La Thành",
  sender_email: "", reply_to: "", email_subject_template: "Nhắc thanh toán chi phí sinh hoạt kỳ {{period}}",
  email_body_template: "Chào {{name}},\n\nBạn còn khoản {{items}} của kỳ {{period}}, tổng cộng {{amount}}. Hạn thanh toán là {{due_date}}.\n\nVui lòng mở ứng dụng để xem chi tiết và xác nhận thanh toán.\n\n708 La Thành",
  rent_enabled: false, rent_email_enabled: false, rent_in_app_enabled: true, rent_due_day: 5, rent_send_day: 2,
  rent_reminder_before_days: 3, rent_reminder_on_due_date: true, rent_reminder_after_days: 3,
  rent_email_subject_template: "Nhắc đóng tiền phòng kỳ {{period}} trước hạn {{due_date}}",
  rent_email_body_template: "Chào {{name}},\n\nBạn cần đóng {{items}} của kỳ {{period}}, số tiền {{amount}}. Hạn thanh toán là {{due_date}}.\n\nVui lòng mở ứng dụng để xem chi tiết và xác nhận đã đóng tiền.\n\n708 La Thành",
});
const fields = "id, member_name, recipient_email, amount, items, period_start, due_date, reminder_type, reminder_scope, in_app_enabled, email_status, email_error, attempt_count, read_at, created_at, sent_at";
function reminderLabel(type: ReminderEvent["reminder_type"]) { return type === "before" ? "Sắp đến hạn" : type === "due" ? "Đến hạn hôm nay" : "Quá hạn"; }
function scopeLabel(scope: ReminderEventScope) { return scope === "rent" ? "Tiền phòng" : scope === "legacy_combined" ? "Email gộp cũ" : "Chi phí sinh hoạt"; }
function statusTag(status: ReminderEvent["email_status"]) {
  if (status === "sent") return <Tag color="success">Đã gửi</Tag>;
  if (status === "sending") return <Tag color="warning">Cần kiểm tra</Tag>;
  if (status === "failed") return <Tag color="error">Gửi lỗi</Tag>;
  if (status === "pending") return <Tag color="processing">Đang chờ</Tag>;
  return <Tag>Không gửi email</Tag>;
}
function auditStatusTag(code: string) {
  const labels: Record<string, [string, string]> = {
    ready: ["Đến mốc gửi hôm nay", "success"], scheduled: ["Chờ mốc tiếp theo", "processing"],
    outside_window: ["Đã qua lịch kỳ này", "default"], disabled: ["Đã tắt lịch", "default"],
    unlinked: ["Chưa liên kết tài khoản", "warning"], no_email: ["Thiếu email", "warning"],
    no_expense: ["Chưa có chi phí phân bổ", "default"], no_room: ["Chưa có phòng thu tiền", "default"],
    not_cycle: ["Chưa đến chu kỳ phòng", "default"], paid: ["Đã thanh toán hoặc không còn nợ", "success"],
    email_off: ["Đã tắt email", "default"],
  };
  const [label, color] = labels[code] ?? ["Cần kiểm tra", "warning"];
  return <Tag color={color}>{label}</Tag>;
}
async function functionErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const body = await context.clone().json().catch(() => null) as { error?: string } | null;
      if (body?.error) return body.error;
    }
  }
  return error instanceof Error ? error.message : "Không gửi được email thử. Hãy kiểm tra cấu hình Gmail API trong Supabase.";
}

export function PaymentReminderSettings({ organizationId, propertyId, onNotice, onRentCyclesChanged }: { organizationId: string; propertyId: string; onNotice: (message: string, kind?: "error" | "success") => void; onRentCyclesChanged?: () => void }) {
  const [settings, setSettings] = useState(() => defaults(organizationId, propertyId));
  const [events, setEvents] = useState<ReminderEvent[]>([]);
  const [recipientAudit, setRecipientAudit] = useState<RecipientAudit[]>([]);
  const [auditError, setAuditError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyScope, setHistoryScope] = useState<ReminderScope | "all">("all");
  const [historyStatus, setHistoryStatus] = useState<ReminderEvent["email_status"] | "all">("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [activeScope, setActiveScope] = useState<ReminderScope>("living_expense");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingScope, setTestingScope] = useState<ReminderScope | null>(null);
  const [testRecipientEmail, setTestRecipientEmail] = useState("");
  const [rentRooms, setRentRooms] = useState<RentCycleRoom[]>([]);
  const [rentCycleDrafts, setRentCycleDrafts] = useState<Record<string, { months: number; startMonth: Dayjs | null }>>({});
  const [savingRentCycleId, setSavingRentCycleId] = useState<string | null>(null);
  const [form] = Form.useForm<ReminderSettings>();
  const load = useCallback(async () => {
    if (!organizationId || !propertyId) return;
    setLoading(true);
    const supabase = createClient();
    const [settingResult, historyResult, roomResult, auditResult] = await Promise.all([
      supabase.from("payment_reminder_settings").select("*").eq("property_id", propertyId).maybeSingle(),
      supabase.from("payment_reminder_events").select(fields).eq("property_id", propertyId).order("created_at", { ascending: false }).limit(200),
      supabase.from("rooms").select("id, code, base_rent, rent_billing_cycle_months, rent_cycle_start_month").eq("property_id", propertyId).order("code"),
      supabase.rpc("get_payment_reminder_recipient_audit", { target_property_id: propertyId }),
    ]);
    if (settingResult.error || historyResult.error) onNotice("Không tải được cấu hình hoặc lịch sử nhắc hạn. Hãy kiểm tra quyền quản trị và migration 0024.", "error");
    if (roomResult.error) onNotice("Không tải được chu kỳ tiền phòng. Hãy kiểm tra migration 0021_room_rent_billing_cycles.sql.");
    setAuditError(Boolean(auditResult.error));
    setHistoryError(Boolean(historyResult.error));
    setRecipientAudit(((auditResult.data ?? []) as RecipientAudit[]).map((row) => ({ ...row, amount: Number(row.amount) })));
    const normalized = settingResult.data ? { ...defaults(organizationId, propertyId), ...settingResult.data } as ReminderSettings : defaults(organizationId, propertyId);
    setSettings(normalized); form.setFieldsValue(normalized);
    setTestRecipientEmail((current) => current || normalized.sender_email);
    setEvents(((historyResult.data ?? []) as ReminderEvent[]).map((event) => ({ ...event, reminder_scope: event.reminder_scope || "living_expense", amount: Number(event.amount) })));
    setHistoryPage(1);
    const normalizedRooms = ((roomResult.data ?? []) as RentCycleRoom[]).map((room) => ({ ...room, base_rent: Number(room.base_rent), rent_billing_cycle_months: Number(room.rent_billing_cycle_months || 1) }));
    setRentRooms(normalizedRooms);
    setRentCycleDrafts(Object.fromEntries(normalizedRooms.map((room) => [room.id, { months: room.rent_billing_cycle_months, startMonth: dayjs(room.rent_cycle_start_month).startOf("month") }])));
    setLoading(false);
  }, [form, onNotice, organizationId, propertyId]);
  useEffect(() => { void load(); }, [load]);

  async function save(values: ReminderSettings): Promise<boolean> {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("payment_reminder_settings").upsert({ ...settings, ...values, organization_id: organizationId, property_id: propertyId, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "property_id" });
    setSaving(false);
    if (error) { onNotice("Không thể lưu cấu hình. Hãy kiểm tra quyền quản trị và migration 0024."); return false; }
    const normalized = { ...settings, ...values }; setSettings(normalized); form.setFieldsValue(normalized); onNotice("Đã lưu cấu hình nhắc hạn.");
    const auditResult = await supabase.rpc("get_payment_reminder_recipient_audit", { target_property_id: propertyId });
    setAuditError(Boolean(auditResult.error));
    if (!auditResult.error) setRecipientAudit(((auditResult.data ?? []) as RecipientAudit[]).map((row) => ({ ...row, amount: Number(row.amount) })));
    return true;
  }
  async function sendTest(scope: ReminderScope) {
    let values: ReminderSettings;
    try { values = await form.validateFields(); } catch { return; }
    if (!values.sender_email) return onNotice("Hãy nhập email gửi và lưu cấu hình trước.");
    const recipient = testRecipientEmail.trim();
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient)) return onNotice("Hãy nhập địa chỉ email nhận thử hợp lệ.");
    if (!(await save(values))) return;
    setTestingScope(scope);
    const { data, error } = await createClient().functions.invoke("payment-reminders", { body: { action: "test", reminder_scope: scope, property_id: propertyId, test_recipient_email: recipient } });
    setTestingScope(null);
    if (error) return onNotice(await functionErrorMessage(error), "error");
    if (data?.error) return onNotice(data.error, "error");
    onNotice(`Đã gửi thử email ${scopeLabel(scope).toLowerCase()} đến ${recipient}.`);
  }
  async function saveRentCycle(room: RentCycleRoom) {
    const draft = rentCycleDrafts[room.id];
    if (!draft?.startMonth) return onNotice("Hãy chọn tháng bắt đầu chu kỳ.");
    setSavingRentCycleId(room.id);
    const { data, error } = await createClient().from("rooms").update({
      rent_billing_cycle_months: draft.months,
      rent_cycle_start_month: draft.startMonth.startOf("month").format("YYYY-MM-DD"),
    }).eq("id", room.id).eq("property_id", propertyId).select("id").maybeSingle();
    setSavingRentCycleId(null);
    if (error || !data) return onNotice("Không thể lưu chu kỳ tiền phòng. Hãy kiểm tra quyền quản trị và migration 0021.");
    const updatedRoom = { ...room, rent_billing_cycle_months: draft.months, rent_cycle_start_month: draft.startMonth.startOf("month").format("YYYY-MM-DD") };
    setRentRooms((current) => current.map((item) => item.id === room.id ? updatedRoom : item));
    onRentCyclesChanged?.();
    onNotice(`Đã cập nhật chu kỳ tiền phòng ${room.code}.`);
  }
  const previews = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "01";
    const year = part("year"); const month = part("month");
    const dueDateFor = (configuredDay: number) => {
      const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
      const actualDay = Math.min(configuredDay, lastDay);
      return new Date(Date.UTC(Number(year), Number(month) - 1, actualDay)).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
    };
    const fillTemplate = (template: string, values: Record<string, string>) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll("{{" + key + "}}", value), template);
    const livingValues = { name: "Người nhận thử", items: "Chi phí sinh hoạt: điện, nước", period: `${month}/${year}`, amount: "1.050.000 đ", due_date: dueDateFor(settings.settlement_due_day) };
    const rentValues = { name: "Người nhận thử", items: "Tiền phòng P.101 (3 tháng)", period: `${month}/${year}`, amount: "4.065.000 đ", due_date: dueDateFor(settings.rent_due_day) };
    return {
      living_expense: { subject: fillTemplate(settings.email_subject_template, livingValues), body: fillTemplate(settings.email_body_template, livingValues) },
      rent: { subject: fillTemplate(settings.rent_email_subject_template, rentValues), body: fillTemplate(settings.rent_email_body_template, rentValues) },
    };
  }, [settings.email_body_template, settings.email_subject_template, settings.rent_email_body_template, settings.rent_email_subject_template, settings.settlement_due_day, settings.rent_due_day]);

  function channelPanel(scope: ReminderScope) {
    const rent = scope === "rent";
    const config = rent ? {
      enabled: "rent_enabled" as const, emailEnabled: "rent_email_enabled" as const, inAppEnabled: "rent_in_app_enabled" as const,
      dueDay: "rent_due_day" as const, sendDay: "rent_send_day" as const, onDueDate: "rent_reminder_on_due_date" as const,
      afterDays: "rent_reminder_after_days" as const, subject: "rent_email_subject_template" as const, body: "rent_email_body_template" as const,
    } : {
      enabled: "enabled" as const, emailEnabled: "email_enabled" as const, inAppEnabled: "in_app_enabled" as const,
      dueDay: "settlement_due_day" as const, sendDay: "living_send_day" as const, onDueDate: "reminder_on_due_date" as const,
      afterDays: "reminder_after_days" as const, subject: "email_subject_template" as const, body: "email_body_template" as const,
    };
    const enabled = Boolean(settings[config.enabled]);
    const preview = previews[scope];
    return <div className="reminder-channel-panel">
      {rent && <Card size="small" title="Chu kỳ tiền phòng theo phòng" className="reminder-subcard reminder-rent-cycle-card">
        <Typography.Text type="secondary" className="reminder-form-hint">Cấu hình chu kỳ và tháng bắt đầu tại đây. Tab Phòng chỉ hiển thị kỳ thu, không chỉnh sửa chu kỳ.</Typography.Text>
        {rentRooms.length ? <div className="reminder-rent-cycle-list">{rentRooms.map((room) => {
          const draft = rentCycleDrafts[room.id];
          const changed = Boolean(draft && (draft.months !== room.rent_billing_cycle_months || !draft.startMonth?.isSame(dayjs(room.rent_cycle_start_month), "month")));
          return <div className="reminder-rent-cycle-row" key={room.id}>
            <div className="reminder-rent-cycle-room"><Typography.Text strong>{room.code}</Typography.Text><Typography.Text type="secondary">{vnd.format(room.base_rent)} / tháng</Typography.Text></div>
            <Select aria-label={`Chu kỳ đóng tiền phòng ${room.code}`} value={draft?.months} options={rentCycleOptions} onChange={(months) => setRentCycleDrafts((current) => ({ ...current, [room.id]: { ...current[room.id], months } }))} />
            <DatePicker aria-label={`Tháng bắt đầu chu kỳ phòng ${room.code}`} picker="month" format="MM/YYYY" allowClear={false} value={draft?.startMonth} onChange={(startMonth) => setRentCycleDrafts((current) => ({ ...current, [room.id]: { ...current[room.id], startMonth } }))} />
            <Button type="primary" aria-label={`Lưu chu kỳ tiền phòng ${room.code}`} disabled={!changed} loading={savingRentCycleId === room.id} onClick={() => void saveRentCycle(room)}>Lưu</Button>
          </div>;
        })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có phòng để cấu hình chu kỳ." />}
      </Card>}
      <Row gutter={[16, 12]}>
        <Col xs={24} lg={12}><Card size="small" title={<Space><ClockCircleOutlined />Lịch nhắc {rent ? "tiền phòng" : "sinh hoạt"}</Space>} className="reminder-subcard">
          <div className="reminder-setting-row"><div><Typography.Text strong>Bật nhắc {rent ? "tiền phòng" : "chi phí sinh hoạt"}</Typography.Text><Typography.Text type="secondary">{rent ? "Chỉ chạy ở tháng đến kỳ của từng phòng" : "Chạy riêng mỗi tháng, không gộp tiền phòng"}</Typography.Text></div><Form.Item name={config.enabled} valuePropName="checked" noStyle><Switch aria-label={`Bật nhắc ${scopeLabel(scope).toLowerCase()}`} /></Form.Item></div>
          <div className="reminder-setting-row"><div><Typography.Text strong>Thông báo trong ứng dụng</Typography.Text><Typography.Text type="secondary">Hiển thị ở biểu tượng chuông của người nhận</Typography.Text></div><Form.Item name={config.inAppEnabled} valuePropName="checked" noStyle><Switch aria-label={`Bật thông báo ${scopeLabel(scope).toLowerCase()} trong ứng dụng`} /></Form.Item></div>
          <div className="reminder-setting-row"><div><Typography.Text strong>Gửi email riêng</Typography.Text><Typography.Text type="secondary">Mỗi người nhận một email chỉ chứa {rent ? "tiền phòng" : "chi phí sinh hoạt"}</Typography.Text></div><Form.Item name={config.emailEnabled} valuePropName="checked" noStyle><Switch aria-label={`Bật email ${scopeLabel(scope).toLowerCase()}`} /></Form.Item></div>
          <Row gutter={12} className="reminder-number-row">
            <Col xs={24} sm={8}><Form.Item name={config.dueDay} label="Ngày đến hạn" rules={[{ required: true }]}><InputNumber min={1} max={31} precision={0} addonAfter="trong tháng" /></Form.Item></Col>
            <Col xs={12} sm={8}><Form.Item name={config.sendDay} label="Ngày gửi nhắc đầu tiên" dependencies={[config.dueDay]} rules={[{ required: true }, ({ getFieldValue }) => ({
              validator: (_, value: number) => value === 0 || (value > 0 && value < Number(getFieldValue(config.dueDay)))
                ? Promise.resolve() : Promise.reject(new Error("Ngày gửi phải trước ngày đến hạn; nhập 0 để tắt nhắc trước.")),
            })]}><InputNumber min={0} max={31} precision={0} addonAfter="trong tháng" /></Form.Item></Col>
            <Col xs={12} sm={8}><Form.Item name={config.afterDays} label="Nhắc quá hạn" rules={[{ required: true }]}><InputNumber min={0} max={30} precision={0} addonAfter="ngày" /></Form.Item></Col>
          </Row>
          <Form.Item className="reminder-due-toggle"><Form.Item name={config.onDueDate} valuePropName="checked" noStyle><Switch aria-label="Nhắc đúng ngày đến hạn" /></Form.Item> <Typography.Text>Nhắc đúng ngày đến hạn</Typography.Text></Form.Item>
          <Typography.Text type="secondary" className="reminder-form-hint">{rent ? "Chỉ gửi ở tháng đến chu kỳ của phòng." : "Gửi hằng tháng."} Nhập 0 ở ngày gửi đầu tiên hoặc nhắc quá hạn để tắt mốc tương ứng. Tháng ngắn hơn ngày đã chọn sẽ gửi vào ngày liền trước hạn.</Typography.Text>
        </Card></Col>
        <Col xs={24} lg={12}><Card size="small" title={`Template email ${rent ? "tiền phòng" : "sinh hoạt"}`} className="reminder-subcard">
          <Form.Item name={config.subject} label="Tiêu đề email" rules={[{ required: true, max: 180 }]}><Input maxLength={180} /></Form.Item>
          <Form.Item name={config.body} label="Nội dung" rules={[{ required: true, max: 5000 }]}><TextArea rows={7} maxLength={5000} /></Form.Item>
          <Typography.Text type="secondary" className="reminder-form-hint">Biến: <code>{"{{name}}"}</code>, <code>{"{{items}}"}</code>, <code>{"{{period}}"}</code>, <code>{"{{amount}}"}</code>, <code>{"{{due_date}}"}</code>.</Typography.Text>
        </Card></Col>
      </Row>
      <Card size="small" title={`Xem trước email ${rent ? "tiền phòng" : "sinh hoạt"}`} extra={<Button icon={<SendOutlined />} onClick={() => void sendTest(scope)} loading={testingScope === scope} disabled={!settings.sender_email}>Gửi email thử</Button>} className="reminder-subcard email-preview-card reminder-channel-preview">
        <div className="email-preview-from">Từ: {settings.sender_name || "708 La Thành"} &lt;{settings.sender_email || "ten.tai.khoan@gmail.com"}&gt;</div><div className="email-preview-from">Đến thử: {testRecipientEmail || "nhập email nhận thử ở trên"}</div><div className="email-preview-subject">{preview.subject}</div><pre className="email-preview-body">{preview.body}</pre>
        {!enabled && <Typography.Text type="secondary" className="reminder-form-hint">Đây chỉ là bản xem trước. Hãy bật lịch nhắc ở khối bên trên để hệ thống gửi tự động.</Typography.Text>}
      </Card>
    </div>;
  }

  const enabledCount = Number(settings.enabled) + Number(settings.rent_enabled);
  const auditRows = recipientAudit.filter((row) => row.reminder_scope === activeScope);
  const filteredHistory = events.filter((event) =>
    (historyScope === "all" || event.reminder_scope === historyScope) &&
    (historyStatus === "all" || event.email_status === historyStatus));
  const historyPageRows = filteredHistory.slice((historyPage - 1) * 20, historyPage * 20);

  return <div className="page-stack payment-reminder-settings">
    <Card className="section-card admin-hub-card" title={<div><span>Nhắc hạn thanh toán</span><Typography.Text type="secondary" className="card-title-note">Tiền phòng và chi phí sinh hoạt được gửi thành hai email độc lập</Typography.Text></div>} extra={<Tag color={enabledCount ? "success" : "default"}>{enabledCount}/2 loại đang bật</Tag>}>
      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : <>
        <Form form={form} layout="vertical" onFinish={(values) => void save(values)} initialValues={settings} onValuesChange={(_, values) => setSettings((current) => ({ ...current, ...values }))}>
          <Card size="small" title={<Space><MailOutlined />Tài khoản Gmail gửi</Space>} extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>Tải lại</Button>} className="reminder-subcard reminder-sender-card">
            <Row gutter={12} className="reminder-email-fields">
              <Col xs={24} sm={12}><Form.Item name="sender_name" label="Tên người gửi" rules={[{ required: true, max: 100 }]}><Input placeholder="708 La Thành" /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="sender_email" label="Tài khoản Gmail gửi" rules={[{ required: true, type: "email", message: "Nhập địa chỉ Gmail đã cấp quyền gửi" }]}><Input placeholder="ten.tai.khoan@gmail.com" /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="reply_to" label="Email nhận phản hồi" rules={[{ type: "email", message: "Email chưa đúng định dạng" }]}><Input placeholder="quanly@tenmien.vn" /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item label="Gửi email thử đến"><Input type="email" value={testRecipientEmail} onChange={(event) => setTestRecipientEmail(event.target.value)} placeholder="email-ban-muon-nhan@gmail.com" /><Typography.Text type="secondary" className="reminder-form-hint">Dùng chung cho hai nút gửi thử; không đổi email của thành viên.</Typography.Text></Form.Item></Col>
            </Row>
          </Card>
          <Tabs activeKey={activeScope} onChange={(key) => setActiveScope(key as ReminderScope)} className="reminder-scope-tabs" items={[
            { key: "living_expense", label: <Space><WalletOutlined />Sinh hoạt · hằng tháng</Space>, children: channelPanel("living_expense") },
            { key: "rent", label: <Space><HomeOutlined />Tiền phòng · theo chu kỳ</Space>, children: channelPanel("rent") },
          ]} />
          <Flex justify="flex-end" className="reminder-save-row"><Button type="primary" htmlType="submit" loading={saving}>Lưu cấu hình</Button></Flex>
        </Form>
        <Card size="small" title={`Kiểm tra người nhận · ${scopeLabel(activeScope)}`} extra={<Button type="link" onClick={() => void load()}>Tải lại</Button>} className="reminder-history-card reminder-audit-card">
          <Typography.Text type="secondary" className="reminder-form-hint">Kỳ hiện tại: {dayjs().format("MM/YYYY")}. Danh sách gồm cả thành viên chưa được tạo email; lý do nằm cạnh từng người.</Typography.Text>
          {auditError ? <Alert type="error" showIcon message="Không tải được danh sách người nhận" description="Hãy chạy migration 0024 và kiểm tra quyền quản trị, sau đó bấm Tải lại." />
            : auditRows.length ? <div className="reminder-history-list">{auditRows.map((row) => <div className="reminder-history-row reminder-audit-row" key={`${row.reminder_scope}-${row.member_id}`}>
              <div className="reminder-history-person"><Typography.Text strong>{row.member_name}</Typography.Text><Typography.Text type="secondary">{row.recipient_email || "Chưa có email"}</Typography.Text></div>
              <div className="reminder-history-info"><Typography.Text>{vnd.format(row.amount)} · Hạn {dayjs(row.due_date).format("DD/MM/YYYY")}</Typography.Text><Typography.Text type="secondary">{row.send_date ? `Nhắc đầu tiên ${dayjs(row.send_date).format("DD/MM/YYYY")}` : "Không nhắc trước hạn"}</Typography.Text></div>
              <div className="reminder-audit-outcome">{auditStatusTag(row.status_code)}{row.last_email_status && <span>{statusTag(row.last_email_status)}{row.last_event_at && <Typography.Text type="secondary">{dayjs(row.last_event_at).format("DD/MM HH:mm")}</Typography.Text>}</span>}{row.last_email_error && <Typography.Text type="danger" className="reminder-history-error">{row.last_email_error}</Typography.Text>}</div>
            </div>)}</div>
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có thành viên hoặc chưa lưu cấu hình nhắc hạn" />}
        </Card>
        <Card size="small" title="Lịch sử gửi gần đây" extra={<Button type="link" onClick={() => void load()}>Tải lại</Button>} className="reminder-history-card">
          {historyError ? <Alert type="error" showIcon message="Không tải được lịch sử gửi" description="Kiểm tra quyền quản trị và kết nối Supabase, rồi bấm Tải lại." /> : <>
          <div className="reminder-history-filters"><Select aria-label="Lọc lịch sử theo loại" value={historyScope} onChange={(value) => { setHistoryScope(value); setHistoryPage(1); }} options={[{ value: "all", label: "Tất cả loại" }, { value: "living_expense", label: "Sinh hoạt" }, { value: "rent", label: "Tiền phòng" }]} /><Select aria-label="Lọc lịch sử theo trạng thái" value={historyStatus} onChange={(value) => { setHistoryStatus(value); setHistoryPage(1); }} options={[{ value: "all", label: "Tất cả trạng thái" }, { value: "sent", label: "Đã gửi" }, { value: "sending", label: "Cần kiểm tra" }, { value: "failed", label: "Gửi lỗi" }, { value: "pending", label: "Đang chờ" }, { value: "skipped", label: "Không gửi email" }]} /><Typography.Text type="secondary">{filteredHistory.length} kết quả trong 200 lần gần nhất</Typography.Text></div>
          {historyPageRows.length ? <div className="reminder-history-list">{historyPageRows.map((event) => <div className="reminder-history-row" key={event.id}>
            <div className="reminder-history-person"><Typography.Text strong>{event.member_name}</Typography.Text><Typography.Text type="secondary">{event.recipient_email || "Chưa có email · chỉ thông báo trong ứng dụng"}</Typography.Text></div>
            <div className="reminder-history-info"><Typography.Text>{event.items} · {vnd.format(event.amount)}</Typography.Text><Typography.Text type="secondary"><Tag>{scopeLabel(event.reminder_scope)}</Tag>{reminderLabel(event.reminder_type)} · Hạn {dayjs(event.due_date).format("DD/MM/YYYY")} · Tạo {dayjs(event.created_at).format("DD/MM HH:mm")}</Typography.Text></div>
            <div>{statusTag(event.email_status)}{event.email_status === "failed" && <Typography.Text type="secondary" className="reminder-history-error">Đã thử {event.attempt_count}/3 lần</Typography.Text>}{event.email_status === "sending" && <Typography.Text type="secondary" className="reminder-history-error">Không tự gửi lại để tránh trùng email</Typography.Text>}{event.email_error && <Typography.Text type="danger" className="reminder-history-error">{event.email_error}</Typography.Text>}</div>
          </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có lần gửi nào khớp bộ lọc" />}
          {filteredHistory.length > 20 && <Pagination className="reminder-history-pagination" current={historyPage} pageSize={20} total={filteredHistory.length} showSizeChanger={false} onChange={setHistoryPage} />}
          </>}
        </Card>
      </>}
    </Card>
  </div>;
}

export function NotificationCenter({ userId, onNotice }: { userId: string; onNotice: (message: string, kind?: "error" | "success") => void }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ReminderEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [openMenuEventId, setOpenMenuEventId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(50);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const load = useCallback(async (showLoading = true) => {
    if (!userId) return;
    if (showLoading) setLoading(true);
    const supabase = createClient();
    const base = () => supabase.from("payment_reminder_events").select(fields, { count: "exact" }).eq("auth_user_id", userId).eq("in_app_enabled", true).is("dismissed_at", null);
    const [listResult, unreadResult] = await Promise.all([
      base().order("created_at", { ascending: false }).limit(visibleLimit),
      supabase.from("payment_reminder_events").select("id", { count: "exact", head: true }).eq("auth_user_id", userId).eq("in_app_enabled", true).is("dismissed_at", null).is("read_at", null),
    ]);
    if (showLoading) setLoading(false);
    if (listResult.error || unreadResult.error) return onNotice("Không tải được thông báo. Hãy chạy migration 0027_notification_inbox_actions.sql.", "error");
    setEvents(((listResult.data ?? []) as ReminderEvent[]).map((event) => ({ ...event, reminder_scope: event.reminder_scope || "living_expense", amount: Number(event.amount) })));
    setTotalCount(listResult.count ?? 0);
    setUnreadCount(unreadResult.count ?? 0);
  }, [onNotice, userId, visibleLimit]);
  useEffect(() => { void load(); }, [load]);
  async function manageNotification(action: "mark_read" | "mark_unread" | "dismiss", eventId: string) {
    if (pendingAction) return;
    setPendingAction(eventId ?? action);
    const { error } = await createClient().rpc("manage_payment_reminder_notification", { action_name: action, target_event_id: eventId ?? null });
    if (error) {
      setPendingAction(null);
      onNotice("Không thể cập nhật thông báo. Hãy kiểm tra migration 0027 và thử lại.", "error");
      return;
    }
    await load(false);
    setPendingAction(null);
  }
  function confirmDismiss(event: ReminderEvent) {
    setOpenMenuEventId(null);
    Modal.confirm({
      title: "Xóa thông báo?",
      content: "Thông báo này sẽ không còn xuất hiện trong danh sách của bạn.",
      okText: "Xóa thông báo",
      okButtonProps: { danger: true },
      cancelText: "Hủy",
      onOk: () => manageNotification("dismiss", event.id),
    });
  }
  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }
  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>, item: ReminderEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || pendingAction) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    event.preventDefault();
    if (deltaX > 0) {
      setOpenMenuEventId(null);
      if (!item.read_at) void manageNotification("mark_read", item.id);
    } else {
      setOpenMenuEventId(item.id);
    }
  }
  function notificationContent(item: ReminderEvent) {
    return <>
      <span className="notification-item-heading">{!item.read_at && <span className="notification-unread-label">Chưa đọc · </span>}{reminderLabel(item.reminder_type)}: {item.items}</span>
      <span className="notification-item-description">Kỳ {dayjs(item.period_start).format("MM/YYYY")} · Còn {vnd.format(item.amount)} cần đóng</span>
      <span className="notification-item-meta">Hạn {dayjs(item.due_date).format("DD/MM/YYYY")} · {dayjs(item.created_at).format("DD/MM HH:mm")}</span>
    </>;
  }
  return <>
    <Badge count={unreadCount} size="small" offset={[-3, 3]}><Button type="text" shape="circle" className="notification-center-trigger" aria-label={`Thông báo, ${unreadCount} chưa đọc`} onClick={() => { setOpen(true); void load(); }} icon={<BellOutlined />} /></Badge>
    <Drawer title={<div><Typography.Text strong>Thông báo</Typography.Text><Typography.Text type="secondary" className="notification-drawer-subtitle">{unreadCount} thông báo chưa đọc</Typography.Text><Typography.Text type="secondary" className="notification-swipe-hint">Vuốt phải để đọc · vuốt trái để xem tùy chọn</Typography.Text></div>} open={open} onClose={() => setOpen(false)} width={440} className="notification-center-drawer" extra={<Button type="text" icon={<ReloadOutlined />} aria-label="Tải lại thông báo" title="Tải lại" onClick={() => void load()} loading={loading} />}>
      {loading ? <div className="notification-loading"><Spin /></div> : events.length ? <div className="notification-list">{events.map((event) => <div key={event.id} onTouchStart={handleTouchStart} onTouchEnd={(touchEvent) => handleTouchEnd(touchEvent, event)} className={"notification-item " + (event.read_at ? "is-read" : "is-unread")}>
        <span className="notification-unread-dot" aria-hidden="true" />
        {event.read_at ? <span className="notification-item-main notification-item-content">{notificationContent(event)}</span>
          : <button type="button" className="notification-item-main notification-item-content" disabled={Boolean(pendingAction)} onClick={() => void manageNotification("mark_read", event.id)}>{notificationContent(event)}</button>}
        <Dropdown trigger={["click"]} placement="bottomRight" open={openMenuEventId === event.id} onOpenChange={(visible) => setOpenMenuEventId(visible ? event.id : null)} menu={{ items: [
          { key: "toggle", icon: event.read_at ? <UndoOutlined /> : <CheckOutlined />, label: event.read_at ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc" },
          { type: "divider" },
          { key: "dismiss", icon: <DeleteOutlined />, label: "Xóa thông báo", danger: true },
        ], onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); if (key === "dismiss") confirmDismiss(event); else void manageNotification(event.read_at ? "mark_unread" : "mark_read", event.id); } }}>
          <Button type="text" className="notification-item-more" icon={<MoreOutlined />} aria-label={`Thao tác với thông báo ${event.items}`} title="Thao tác" disabled={Boolean(pendingAction)} onClick={(clickEvent) => clickEvent.stopPropagation()} />
        </Dropdown>
      </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bạn chưa có thông báo nào" />}
      {totalCount > events.length && <Button type="text" className="notification-load-more" onClick={() => setVisibleLimit((current) => current + 50)}>Xem thêm thông báo ({events.length}/{totalCount})</Button>}
    </Drawer>
  </>;
}
