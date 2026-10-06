"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Badge, Button, Card, Col, DatePicker, Drawer, Empty, Flex, Form, Input, InputNumber, Row, Select, Skeleton, Space, Spin, Switch, Tabs, Tag, Typography } from "antd";
import { BellOutlined, CheckOutlined, ClockCircleOutlined, HomeOutlined, MailOutlined, ReloadOutlined, SendOutlined, WalletOutlined } from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";

const { TextArea } = Input;
const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
type ReminderScope = "living_expense" | "rent";
type ReminderEventScope = ReminderScope | "legacy_combined";
type ReminderSettings = {
  organization_id: string; property_id: string; enabled: boolean; email_enabled: boolean; in_app_enabled: boolean;
  settlement_due_day: number; reminder_before_days: number; reminder_on_due_date: boolean; reminder_after_days: number;
  sender_name: string; sender_email: string; reply_to: string; email_subject_template: string; email_body_template: string;
  rent_enabled: boolean; rent_email_enabled: boolean; rent_in_app_enabled: boolean; rent_due_day: number;
  rent_reminder_before_days: number; rent_reminder_on_due_date: boolean; rent_reminder_after_days: number;
  rent_email_subject_template: string; rent_email_body_template: string;
};
type ReminderEvent = {
  id: string; member_name: string; recipient_email: string; amount: number; items: string; period_start: string; due_date: string;
  reminder_type: "before" | "due" | "overdue"; in_app_enabled: boolean; email_status: "pending" | "sent" | "failed" | "skipped";
  reminder_scope: ReminderEventScope; email_error: string | null; read_at: string | null; created_at: string;
};
type RentCycleRoom = { id: string; code: string; base_rent: number; rent_billing_cycle_months: number; rent_cycle_start_month: string };
const rentCycleOptions = [
  { value: 1, label: "Hàng tháng" },
  { value: 3, label: "3 tháng/lần" },
  { value: 6, label: "6 tháng/lần" },
  { value: 12, label: "12 tháng/lần" },
];
const defaults = (organization_id: string, property_id: string): ReminderSettings => ({
  organization_id, property_id, enabled: false, email_enabled: false, in_app_enabled: true, settlement_due_day: 5,
  reminder_before_days: 3, reminder_on_due_date: true, reminder_after_days: 3, sender_name: "708 La Thành",
  sender_email: "", reply_to: "", email_subject_template: "Nhắc thanh toán chi phí sinh hoạt kỳ {{period}}",
  email_body_template: "Chào {{name}},\n\nBạn còn khoản {{items}} của kỳ {{period}}, tổng cộng {{amount}}. Hạn thanh toán là {{due_date}}.\n\nVui lòng mở ứng dụng để xem chi tiết và xác nhận thanh toán.\n\n708 La Thành",
  rent_enabled: false, rent_email_enabled: false, rent_in_app_enabled: true, rent_due_day: 5,
  rent_reminder_before_days: 3, rent_reminder_on_due_date: true, rent_reminder_after_days: 3,
  rent_email_subject_template: "Nhắc đóng tiền phòng kỳ {{period}} trước hạn {{due_date}}",
  rent_email_body_template: "Chào {{name}},\n\nBạn cần đóng {{items}} của kỳ {{period}}, số tiền {{amount}}. Hạn thanh toán là {{due_date}}.\n\nVui lòng mở ứng dụng để xem chi tiết và xác nhận đã đóng tiền.\n\n708 La Thành",
});
const fields = "id, member_name, recipient_email, amount, items, period_start, due_date, reminder_type, reminder_scope, in_app_enabled, email_status, email_error, read_at, created_at";
function reminderLabel(type: ReminderEvent["reminder_type"]) { return type === "before" ? "Sắp đến hạn" : type === "due" ? "Đến hạn hôm nay" : "Quá hạn"; }
function scopeLabel(scope: ReminderEventScope) { return scope === "rent" ? "Tiền phòng" : scope === "legacy_combined" ? "Email gộp cũ" : "Chi phí sinh hoạt"; }
function statusTag(status: ReminderEvent["email_status"]) {
  if (status === "sent") return <Tag color="success">Đã gửi</Tag>;
  if (status === "failed") return <Tag color="error">Gửi lỗi</Tag>;
  if (status === "pending") return <Tag color="processing">Đang chờ</Tag>;
  return <Tag>Chỉ trong ứng dụng</Tag>;
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

export function PaymentReminderSettings({ organizationId, propertyId, onNotice, onRentCyclesChanged }: { organizationId: string; propertyId: string; onNotice: (message: string) => void; onRentCyclesChanged?: () => void }) {
  const [settings, setSettings] = useState(() => defaults(organizationId, propertyId));
  const [events, setEvents] = useState<ReminderEvent[]>([]);
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
    const [settingResult, historyResult, roomResult] = await Promise.all([
      supabase.from("payment_reminder_settings").select("*").eq("property_id", propertyId).maybeSingle(),
      supabase.from("payment_reminder_events").select(fields).eq("property_id", propertyId).order("created_at", { ascending: false }).limit(10),
      supabase.from("rooms").select("id, code, base_rent, rent_billing_cycle_months, rent_cycle_start_month").eq("property_id", propertyId).order("code"),
    ]);
    if (settingResult.error || historyResult.error) onNotice("Không tải được cấu hình thông báo. Hãy chạy migration 0022_split_rent_and_living_reminders.sql.");
    if (roomResult.error) onNotice("Không tải được chu kỳ tiền phòng. Hãy kiểm tra migration 0021_room_rent_billing_cycles.sql.");
    const normalized = settingResult.data ? { ...defaults(organizationId, propertyId), ...settingResult.data } as ReminderSettings : defaults(organizationId, propertyId);
    setSettings(normalized); form.setFieldsValue(normalized);
    setTestRecipientEmail((current) => current || normalized.sender_email);
    setEvents(((historyResult.data ?? []) as ReminderEvent[]).map((event) => ({ ...event, reminder_scope: event.reminder_scope || "living_expense", amount: Number(event.amount) })));
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
    if (error) { onNotice("Không thể lưu cấu hình. Hãy kiểm tra quyền quản trị và migration 0022."); return false; }
    const normalized = { ...settings, ...values }; setSettings(normalized); form.setFieldsValue(normalized); onNotice("Đã lưu cấu hình nhắc hạn."); return true;
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
    if (error) return onNotice(await functionErrorMessage(error));
    if (data?.error) return onNotice(data.error);
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
    const year = part("year"); const month = part("month"); const day = part("day");
    const due_date = new Date(`${year}-${month}-${day}T00:00:00Z`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
    const fillTemplate = (template: string, values: Record<string, string>) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll("{{" + key + "}}", value), template);
    const livingValues = { name: "Người nhận thử", items: "Chi phí sinh hoạt: điện, nước", period: `${month}/${year}`, amount: "1.050.000 đ", due_date };
    const rentValues = { name: "Người nhận thử", items: "Tiền phòng P.101 (3 tháng)", period: `${month}/${year}`, amount: "4.065.000 đ", due_date };
    return {
      living_expense: { subject: fillTemplate(settings.email_subject_template, livingValues), body: fillTemplate(settings.email_body_template, livingValues) },
      rent: { subject: fillTemplate(settings.rent_email_subject_template, rentValues), body: fillTemplate(settings.rent_email_body_template, rentValues) },
    };
  }, [settings.email_body_template, settings.email_subject_template, settings.rent_email_body_template, settings.rent_email_subject_template]);

  function channelPanel(scope: ReminderScope) {
    const rent = scope === "rent";
    const config = rent ? {
      enabled: "rent_enabled" as const, emailEnabled: "rent_email_enabled" as const, inAppEnabled: "rent_in_app_enabled" as const,
      dueDay: "rent_due_day" as const, beforeDays: "rent_reminder_before_days" as const, onDueDate: "rent_reminder_on_due_date" as const,
      afterDays: "rent_reminder_after_days" as const, subject: "rent_email_subject_template" as const, body: "rent_email_body_template" as const,
    } : {
      enabled: "enabled" as const, emailEnabled: "email_enabled" as const, inAppEnabled: "in_app_enabled" as const,
      dueDay: "settlement_due_day" as const, beforeDays: "reminder_before_days" as const, onDueDate: "reminder_on_due_date" as const,
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
            <Col xs={12} sm={8}><Form.Item name={config.beforeDays} label="Nhắc trước hạn" rules={[{ required: true }]}><InputNumber min={1} max={30} precision={0} addonAfter="ngày" /></Form.Item></Col>
            <Col xs={12} sm={8}><Form.Item name={config.afterDays} label="Nhắc quá hạn" rules={[{ required: true }]}><InputNumber min={1} max={30} precision={0} addonAfter="ngày" /></Form.Item></Col>
          </Row>
          <Form.Item className="reminder-due-toggle"><Form.Item name={config.onDueDate} valuePropName="checked" noStyle><Switch aria-label="Nhắc đúng ngày đến hạn" /></Form.Item> <Typography.Text>Nhắc đúng ngày đến hạn</Typography.Text></Form.Item>
          <Typography.Text type="secondary" className="reminder-form-hint">{rent ? "Chu kỳ lấy từ cấu hình của từng phòng; lịch này chỉ quyết định ngày gửi trong tháng đến kỳ." : "Chi phí sinh hoạt được xét độc lập vào mỗi tháng."}</Typography.Text>
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
        <Card size="small" title="Lịch sử gửi gần đây" extra={<Button type="link" onClick={() => void load()}>Tải lại</Button>} className="reminder-history-card">
          {events.length ? <div className="reminder-history-list">{events.map((event) => <div className="reminder-history-row" key={event.id}>
            <div className="reminder-history-person"><Typography.Text strong>{event.member_name}</Typography.Text><Typography.Text type="secondary">{event.recipient_email}</Typography.Text></div>
            <div className="reminder-history-info"><Typography.Text>{event.items} · {vnd.format(event.amount)}</Typography.Text><Typography.Text type="secondary"><Tag>{scopeLabel(event.reminder_scope)}</Tag>{reminderLabel(event.reminder_type)} · {dayjs(event.created_at).format("DD/MM HH:mm")}</Typography.Text></div>
            <div>{statusTag(event.email_status)}{event.email_error && <Typography.Text type="danger" className="reminder-history-error">{event.email_error}</Typography.Text>}</div>
          </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lần gửi nào" />}
        </Card>
      </>}
    </Card>
  </div>;
}

export function NotificationCenter({ userId, onNotice }: { userId: string; onNotice: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ReminderEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const unreadCount = useMemo(() => events.filter((event) => event.in_app_enabled && !event.read_at).length, [events]);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await createClient().from("payment_reminder_events").select(fields).eq("auth_user_id", userId).eq("in_app_enabled", true).order("created_at", { ascending: false }).limit(50);
    setLoading(false);
    if (error) return onNotice("Không tải được thông báo. Hãy chạy migration 0022_split_rent_and_living_reminders.sql.");
    setEvents(((data ?? []) as ReminderEvent[]).map((event) => ({ ...event, reminder_scope: event.reminder_scope || "living_expense", amount: Number(event.amount) })));
  }, [onNotice, userId]);
  useEffect(() => { void load(); }, [load]);
  async function markRead(event: ReminderEvent) {
    if (event.read_at) return;
    const { error } = await createClient().rpc("mark_payment_reminder_read", { target_event_id: event.id });
    if (error) return onNotice("Không thể cập nhật trạng thái thông báo.");
    setEvents((current) => current.map((item) => item.id === event.id ? { ...item, read_at: new Date().toISOString() } : item));
  }
  async function markAllRead() { for (const event of events.filter((item) => item.in_app_enabled && !item.read_at)) await markRead(event); }
  return <>
    <Badge count={unreadCount} size="small" offset={[-3, 3]}><Button type="text" shape="circle" className="notification-center-trigger" aria-label="Thông báo" onClick={() => setOpen(true)} icon={<BellOutlined />} /></Badge>
    <Drawer title={<div><Typography.Text strong>Thông báo</Typography.Text><Typography.Text type="secondary" className="notification-drawer-subtitle">{unreadCount} thông báo chưa đọc</Typography.Text></div>} open={open} onClose={() => setOpen(false)} width={440} className="notification-center-drawer" extra={<Button type="link" disabled={!unreadCount} onClick={() => void markAllRead()}><CheckOutlined /> Đọc tất cả</Button>}>
      <Flex justify="flex-end" className="notification-refresh"><Button type="text" icon={<ReloadOutlined />} onClick={() => void load()}>Tải lại</Button></Flex>
      {loading ? <div className="notification-loading"><Spin /></div> : events.length ? <div className="notification-list">{events.map((event) => <button type="button" key={event.id} className={"notification-item " + (event.read_at ? "is-read" : "is-unread")} onClick={() => void markRead(event)}>
        <span className="notification-unread-dot" /><span className="notification-item-main"><span className="notification-item-heading">{reminderLabel(event.reminder_type)}: {event.items}</span><span className="notification-item-description">Kỳ {dayjs(event.period_start).format("MM/YYYY")} · Còn {vnd.format(event.amount)} cần đóng</span><span className="notification-item-meta">Hạn {dayjs(event.due_date).format("DD/MM/YYYY")} · {dayjs(event.created_at).format("DD/MM HH:mm")}</span></span>
      </button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bạn chưa có thông báo nào" />}
    </Drawer>
  </>;
}
