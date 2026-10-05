"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Badge, Button, Card, Col, Drawer, Empty, Flex, Form, Input, InputNumber, Row, Skeleton, Space, Spin, Switch, Tag, Typography } from "antd";
import { BellOutlined, CheckOutlined, ClockCircleOutlined, MailOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";

const { TextArea } = Input;
const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
type ReminderSettings = {
  organization_id: string; property_id: string; enabled: boolean; email_enabled: boolean; in_app_enabled: boolean;
  settlement_due_day: number; reminder_before_days: number; reminder_on_due_date: boolean; reminder_after_days: number;
  sender_name: string; sender_email: string; reply_to: string; email_subject_template: string; email_body_template: string;
};
type ReminderEvent = {
  id: string; member_name: string; recipient_email: string; amount: number; items: string; period_start: string; due_date: string;
  reminder_type: "before" | "due" | "overdue"; in_app_enabled: boolean; email_status: "pending" | "sent" | "failed" | "skipped";
  email_error: string | null; read_at: string | null; created_at: string;
};
const defaults = (organization_id: string, property_id: string): ReminderSettings => ({
  organization_id, property_id, enabled: false, email_enabled: false, in_app_enabled: true, settlement_due_day: 5,
  reminder_before_days: 3, reminder_on_due_date: true, reminder_after_days: 3, sender_name: "708 La Thành",
  sender_email: "", reply_to: "", email_subject_template: "Nhắc thanh toán {{items}} trước hạn {{due_date}}",
  email_body_template: "Chào {{name}},\n\nBạn còn khoản {{items}} của kỳ {{period}}, tổng cộng {{amount}}. Hạn thanh toán là {{due_date}}.\n\nVui lòng mở ứng dụng để xem chi tiết và xác nhận thanh toán.\n\n708 La Thành",
});
const fields = "id, member_name, recipient_email, amount, items, period_start, due_date, reminder_type, in_app_enabled, email_status, email_error, read_at, created_at";
function reminderLabel(type: ReminderEvent["reminder_type"]) { return type === "before" ? "Sắp đến hạn" : type === "due" ? "Đến hạn hôm nay" : "Quá hạn"; }
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

export function PaymentReminderSettings({ organizationId, propertyId, onNotice }: { organizationId: string; propertyId: string; onNotice: (message: string) => void }) {
  const [settings, setSettings] = useState(() => defaults(organizationId, propertyId));
  const [events, setEvents] = useState<ReminderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRecipientEmail, setTestRecipientEmail] = useState("");
  const [form] = Form.useForm<ReminderSettings>();
  const load = useCallback(async () => {
    if (!organizationId || !propertyId) return;
    setLoading(true);
    const supabase = createClient();
    const [settingResult, historyResult] = await Promise.all([
      supabase.from("payment_reminder_settings").select("*").eq("property_id", propertyId).maybeSingle(),
      supabase.from("payment_reminder_events").select(fields).eq("property_id", propertyId).order("created_at", { ascending: false }).limit(10),
    ]);
    if (settingResult.error || historyResult.error) onNotice("Không tải được cấu hình thông báo. Hãy chạy migration 0019_payment_reminders.sql.");
    const normalized = settingResult.data ? { ...defaults(organizationId, propertyId), ...settingResult.data } as ReminderSettings : defaults(organizationId, propertyId);
    setSettings(normalized); form.setFieldsValue(normalized);
    setTestRecipientEmail((current) => current || normalized.sender_email);
    setEvents(((historyResult.data ?? []) as ReminderEvent[]).map((event) => ({ ...event, amount: Number(event.amount) })));
    setLoading(false);
  }, [form, onNotice, organizationId, propertyId]);
  useEffect(() => { void load(); }, [load]);

  async function save(values: ReminderSettings): Promise<boolean> {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("payment_reminder_settings").upsert({ ...settings, ...values, organization_id: organizationId, property_id: propertyId, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "property_id" });
    setSaving(false);
    if (error) { onNotice("Không thể lưu cấu hình. Vui lòng kiểm tra quyền quản trị viên."); return false; }
    const normalized = { ...settings, ...values }; setSettings(normalized); form.setFieldsValue(normalized); onNotice("Đã lưu cấu hình nhắc hạn."); return true;
  }
  async function sendTest() {
    let values: ReminderSettings;
    try { values = await form.validateFields(); } catch { return; }
    if (!values.sender_email) return onNotice("Hãy nhập email gửi và lưu cấu hình trước.");
    const recipient = testRecipientEmail.trim();
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient)) return onNotice("Hãy nhập địa chỉ email nhận thử hợp lệ.");
    if (!(await save(values))) return;
    setTesting(true);
    const { data, error } = await createClient().functions.invoke("payment-reminders", { body: { action: "test", property_id: propertyId, test_recipient_email: recipient } });
    setTesting(false);
    if (error) return onNotice(await functionErrorMessage(error));
    if (data?.error) return onNotice(data.error);
    onNotice("Đã gửi email thử đến " + recipient + ".");
  }
  const preview = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "01";
    const year = part("year"); const month = part("month"); const day = part("day");
    const values = {
      name: "Người nhận thử", items: "Tiền phòng P.101 (3 tháng); Chi phí sinh hoạt: điện, nước", period: `${month}/${year}`, amount: "6.050.000 đ",
      due_date: new Date(`${year}-${month}-${day}T00:00:00Z`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }),
    };
    const fillTemplate = (template: string) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll("{{" + key + "}}", value), template);
    return { subject: fillTemplate(settings.email_subject_template), body: fillTemplate(settings.email_body_template) };
  }, [settings.email_body_template, settings.email_subject_template]);

  return <div className="page-stack payment-reminder-settings">
    <Card className="section-card admin-hub-card" title={<div><span>Nhắc hạn thanh toán</span><Typography.Text type="secondary" className="card-title-note">Một email gộp cho mỗi người trong mỗi lần chạy</Typography.Text></div>} extra={<Tag color={settings.enabled ? "success" : "default"}>{settings.enabled ? "Đang bật" : "Đang tắt"}</Tag>}>
      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : <>
        <Form form={form} layout="vertical" onFinish={(values) => void save(values)} initialValues={settings} onValuesChange={(_, values) => setSettings((current) => ({ ...current, ...values }))}>
          <Row gutter={[16, 12]} className="reminder-top-grid">
            <Col xs={24} lg={12}><Card size="small" title={<Space><ClockCircleOutlined />Lịch nhắc</Space>} className="reminder-subcard">
              <div className="reminder-setting-row"><div><Typography.Text strong>Bật lịch nhắc</Typography.Text><Typography.Text type="secondary">Tiền nhà và chi phí sinh hoạt chưa đóng</Typography.Text></div><Form.Item name="enabled" valuePropName="checked" noStyle><Switch aria-label="Bật lịch nhắc" /></Form.Item></div>
              <div className="reminder-setting-row"><div><Typography.Text strong>Thông báo trong ứng dụng</Typography.Text><Typography.Text type="secondary">Hiển thị ở biểu tượng chuông của người nhận</Typography.Text></div><Form.Item name="in_app_enabled" valuePropName="checked" noStyle><Switch aria-label="Bật thông báo trong ứng dụng" /></Form.Item></div>
              <div className="reminder-setting-row"><div><Typography.Text strong>Email tổng hợp</Typography.Text><Typography.Text type="secondary">Tối đa một email cho mỗi người mỗi lần chạy</Typography.Text></div><Form.Item name="email_enabled" valuePropName="checked" noStyle><Switch aria-label="Bật email nhắc hạn" /></Form.Item></div>
              <Row gutter={12} className="reminder-number-row">
                <Col xs={24} sm={8}><Form.Item name="settlement_due_day" label="Ngày đến hạn trong tháng" rules={[{ required: true }]}><InputNumber min={1} max={31} precision={0} addonAfter="hằng tháng" /></Form.Item></Col>
                <Col xs={12} sm={8}><Form.Item name="reminder_before_days" label="Nhắc trước hạn" rules={[{ required: true }]}><InputNumber min={1} max={30} precision={0} addonAfter="ngày" /></Form.Item></Col>
                <Col xs={12} sm={8}><Form.Item name="reminder_after_days" label="Nhắc quá hạn" rules={[{ required: true }]}><InputNumber min={1} max={30} precision={0} addonAfter="ngày" /></Form.Item></Col>
              </Row>
              <Form.Item name="reminder_on_due_date" valuePropName="checked" className="reminder-due-toggle"><Switch /> <Typography.Text>Nhắc đúng ngày đến hạn</Typography.Text></Form.Item>
              <Typography.Text type="secondary" className="reminder-form-hint">Ngày đến hạn tự lùi về ngày cuối tháng nếu tháng đó ngắn hơn ngày đã chọn.</Typography.Text>
            </Card></Col>
            <Col xs={24} lg={12}><Card size="small" title={<Space><MailOutlined />Cấu hình gửi email</Space>} className="reminder-subcard">
              <Row gutter={12} className="reminder-email-fields">
                <Col xs={24} sm={12}><Form.Item name="sender_name" label="Tên người gửi" rules={[{ required: true, max: 100 }]}><Input placeholder="708 La Thành" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="sender_email" label="Tài khoản Gmail gửi" rules={[{ required: true, type: "email", message: "Nhập địa chỉ Gmail đã cấp quyền gửi" }]}><Input placeholder="ten.tai.khoan@gmail.com" /></Form.Item></Col>
                <Col span={24}><Form.Item name="reply_to" label="Email nhận phản hồi" rules={[{ type: "email", message: "Email chưa đúng định dạng" }]}><Input placeholder="quanly@tenmien.vn" /></Form.Item></Col>
                <Col span={24}><Form.Item label="Gửi email thử đến"><Input type="email" value={testRecipientEmail} onChange={(event) => setTestRecipientEmail(event.target.value)} placeholder="email-ban-muon-nhan@gmail.com" /><Typography.Text type="secondary" className="reminder-form-hint">Chỉ dùng cho email thử; không ảnh hưởng danh sách thành viên nhận nhắc hạn.</Typography.Text></Form.Item></Col>
              </Row>
              <Space wrap><Button icon={<SendOutlined />} onClick={() => void sendTest()} loading={testing} disabled={!settings.sender_email}>Gửi email thử</Button><Button icon={<ReloadOutlined />} onClick={() => void load()}>Tải lại</Button></Space>
            </Card></Col>
          </Row>
          <Row gutter={[16, 12]} className="reminder-bottom-grid">
            <Col xs={24} lg={12}><Card size="small" title="Template email" className="reminder-subcard">
              <Form.Item name="email_subject_template" label="Tiêu đề email" rules={[{ required: true, max: 180 }]}><Input maxLength={180} /></Form.Item>
              <Form.Item name="email_body_template" label="Nội dung" rules={[{ required: true, max: 5000 }]}><TextArea rows={7} maxLength={5000} /></Form.Item>
              <Typography.Text type="secondary" className="reminder-form-hint">Biến: <code>{"{{name}}"}</code>, <code>{"{{items}}"}</code>, <code>{"{{period}}"}</code>, <code>{"{{amount}}"}</code>, <code>{"{{due_date}}"}</code>.</Typography.Text>
            </Card></Col>
            <Col xs={24} lg={12}><Card size="small" title="Xem trước email" className="reminder-subcard email-preview-card">
              <div className="email-preview-from">Từ: {settings.sender_name || "708 La Thành"} &lt;{settings.sender_email || "ten.tai.khoan@gmail.com"}&gt;</div><div className="email-preview-from">Đến thử: {testRecipientEmail || "nhập email nhận thử ở trên"}</div><div className="email-preview-subject">{preview.subject}</div><pre className="email-preview-body">{preview.body}</pre>
            </Card></Col>
          </Row>
          <Flex justify="flex-end" className="reminder-save-row"><Button type="primary" htmlType="submit" loading={saving}>Lưu cấu hình</Button></Flex>
        </Form>
        <Card size="small" title="Lịch sử gửi gần đây" extra={<Button type="link" onClick={() => void load()}>Tải lại</Button>} className="reminder-history-card">
          {events.length ? <div className="reminder-history-list">{events.map((event) => <div className="reminder-history-row" key={event.id}>
            <div className="reminder-history-person"><Typography.Text strong>{event.member_name}</Typography.Text><Typography.Text type="secondary">{event.recipient_email}</Typography.Text></div>
            <div className="reminder-history-info"><Typography.Text>{event.items} · {vnd.format(event.amount)}</Typography.Text><Typography.Text type="secondary">{reminderLabel(event.reminder_type)} · {dayjs(event.created_at).format("DD/MM HH:mm")}</Typography.Text></div>
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
    if (error) return onNotice("Không tải được thông báo. Hãy chạy migration 0019_payment_reminders.sql.");
    setEvents(((data ?? []) as ReminderEvent[]).map((event) => ({ ...event, amount: Number(event.amount) })));
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
