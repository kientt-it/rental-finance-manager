"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Empty,
  FloatButton,
  Form,
  Image,
  Input,
  Modal,
  Space,
  Typography,
} from "antd";
import {
  CustomerServiceOutlined,
  DeleteOutlined,
  GiftOutlined,
  LinkOutlined,
  SaveOutlined,
  SettingOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";

type SupportSettings = {
  report_contact_label: string | null;
  report_contact_url: string | null;
  donate_message: string | null;
  donate_qr_image_data: string | null;
  donate_qr_file_name: string | null;
  donate_account_name: string | null;
  donate_bank_account: string | null;
  donate_bank_name: string | null;
};

type ReportForm = { report_contact_label?: string; report_contact_url?: string };
type DonateForm = { donate_message?: string; donate_account_name?: string; donate_bank_account?: string; donate_bank_name?: string };

const emptySettings: SupportSettings = {
  report_contact_label: null,
  report_contact_url: null,
  donate_message: null,
  donate_qr_image_data: null,
  donate_qr_file_name: null,
  donate_account_name: null,
  donate_bank_account: null,
  donate_bank_name: null,
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không thể đọc ảnh."));
    reader.readAsDataURL(file);
  });
}

export default function SupportFloatingActions({ organizationId, propertyId, canManage, onNotice }: {
  organizationId: string;
  propertyId: string;
  canManage: boolean;
  onNotice: (message: string) => void;
}) {
  const [settings, setSettings] = useState<SupportSettings>(emptySettings);
  const [reportOpen, setReportOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pendingDonateQr, setPendingDonateQr] = useState<string | null>(null);
  const [pendingDonateQrName, setPendingDonateQrName] = useState<string | null>(null);
  const [reportForm] = Form.useForm<ReportForm>();
  const [donateForm] = Form.useForm<DonateForm>();
  const qrInputRef = useRef<HTMLInputElement>(null);

  const loadSettings = useCallback(async () => {
    if (!propertyId) return;
    setError("");
    const { data, error: loadError } = await createClient().from("support_settings")
      .select("report_contact_label, report_contact_url, donate_message, donate_qr_image_data, donate_qr_file_name, donate_account_name, donate_bank_account, donate_bank_name")
      .eq("property_id", propertyId)
      .maybeSingle();
    if (loadError) {
      setError("Không tải được thông tin Report/Donate. Hãy chạy migration 0014.");
      return;
    }
    const next = data ? data as SupportSettings : emptySettings;
    setSettings(next);
    setPendingDonateQr(next.donate_qr_image_data);
    setPendingDonateQrName(next.donate_qr_file_name);
  }, [propertyId]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => {
    if (!reportOpen) return;
    reportForm.setFieldsValue({ report_contact_label: settings.report_contact_label ?? "", report_contact_url: settings.report_contact_url ?? "" });
  }, [reportForm, reportOpen, settings]);
  useEffect(() => {
    if (!donateOpen) return;
    donateForm.setFieldsValue({
      donate_message: settings.donate_message ?? "",
      donate_account_name: settings.donate_account_name ?? "",
      donate_bank_account: settings.donate_bank_account ?? "",
      donate_bank_name: settings.donate_bank_name ?? "",
    });
    setPendingDonateQr(settings.donate_qr_image_data);
    setPendingDonateQrName(settings.donate_qr_file_name);
  }, [donateForm, donateOpen, settings]);

  async function upsertSettings(patch: Partial<SupportSettings>) {
    const next = { ...settings, ...patch };
    const { error: saveError } = await createClient().from("support_settings").upsert({
      property_id: propertyId,
      organization_id: organizationId,
      ...next,
      updated_at: new Date().toISOString(),
    }, { onConflict: "property_id" });
    if (saveError) throw saveError;
    setSettings(next);
    setError("");
  }

  async function saveReport(values: ReportForm) {
    if (!canManage) return;
    setSaving(true);
    try {
      await upsertSettings({
        report_contact_label: values.report_contact_label?.trim() || null,
        report_contact_url: values.report_contact_url?.trim() || null,
      });
      onNotice("Đã cập nhật kênh Report/liên hệ.");
    } catch {
      onNotice("Không thể lưu kênh liên hệ. Hãy kiểm tra migration 0014.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDonate(values: DonateForm) {
    if (!canManage) return;
    setSaving(true);
    try {
      await upsertSettings({
        donate_message: values.donate_message?.trim() || null,
        donate_account_name: values.donate_account_name?.trim() || null,
        donate_bank_account: values.donate_bank_account?.trim() || null,
        donate_bank_name: values.donate_bank_name?.trim() || null,
        donate_qr_image_data: pendingDonateQr,
        donate_qr_file_name: pendingDonateQrName,
      });
      onNotice("Đã cập nhật thông tin Donate.");
    } catch {
      onNotice("Không thể lưu thông tin Donate. Hãy kiểm tra migration 0014.");
    } finally {
      setSaving(false);
    }
  }

  async function chooseDonateQr(file: File) {
    if (!canManage) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return onNotice("Ảnh QR phải là PNG, JPG hoặc WebP.");
    if (file.size > 1.5 * 1024 * 1024) return onNotice("Ảnh QR tối đa 1,5 MB.");
    try {
      setPendingDonateQr(await fileToDataUrl(file));
      setPendingDonateQrName(file.name.slice(0, 160));
    } catch {
      onNotice("Không thể đọc ảnh QR.");
    }
  }

  return (
    <>
      <FloatButton.Group trigger="click" type="primary" icon={<CustomerServiceOutlined />} className="support-float-group" tooltip="Hỗ trợ">
        <FloatButton icon={<WarningOutlined />} tooltip="Report / Liên hệ" onClick={() => setReportOpen(true)} />
        <FloatButton icon={<GiftOutlined />} tooltip="Donate" onClick={() => setDonateOpen(true)} />
      </FloatButton.Group>

      <Modal title={<Space><WarningOutlined /><span>Report / Liên hệ</span></Space>} open={reportOpen} onCancel={() => setReportOpen(false)} footer={null} centered width={520} className="support-modal">
        {error && <Alert type="error" showIcon title={error} />}
        <div className="support-contact-view">
          <Typography.Paragraph>Báo lỗi hoặc liên hệ với quản trị viên của 708 La Thành.</Typography.Paragraph>
          {settings.report_contact_url ? <Button type="primary" icon={<LinkOutlined />} href={settings.report_contact_url} target="_blank" rel="noopener noreferrer" block>{settings.report_contact_label || "Mở kênh liên hệ"}</Button> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Quản trị viên chưa cập nhật kênh liên hệ" />}
        </div>
        {canManage && <>
          <Divider><Space><SettingOutlined />Cấu hình quản trị</Space></Divider>
          <Form form={reportForm} layout="vertical" onFinish={saveReport}>
            <Form.Item name="report_contact_label" label="Tên kênh liên hệ"><Input placeholder="Ví dụ: Facebook" maxLength={120} /></Form.Item>
            <Form.Item name="report_contact_url" label="Link Facebook / liên hệ" rules={[{ type: "url", message: "Nhập link bắt đầu bằng http:// hoặc https://" }]}><Input placeholder="https://facebook.com/..." /></Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} block>Lưu kênh liên hệ</Button>
          </Form>
        </>}
      </Modal>

      <Modal title={<Space><GiftOutlined /><span>Donate</span></Space>} open={donateOpen} onCancel={() => setDonateOpen(false)} footer={null} centered width={540} className="support-modal donate-modal">
        {error && <Alert type="error" showIcon title={error} />}
        <div className="donate-view">
          <Typography.Paragraph>{settings.donate_message || "Cảm ơn bạn đã ủng hộ chi phí duy trì và phát triển ứng dụng."}</Typography.Paragraph>
          {pendingDonateQr ? <div className="donate-qr-frame"><Image src={pendingDonateQr} alt="Mã QR donate" preview /></div> : !canManage && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có mã QR donate" />}
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Chủ tài khoản">{settings.donate_account_name || "—"}</Descriptions.Item>
            <Descriptions.Item label="Số tài khoản">{settings.donate_bank_account || "—"}</Descriptions.Item>
            <Descriptions.Item label="Ngân hàng">{settings.donate_bank_name || "—"}</Descriptions.Item>
          </Descriptions>
        </div>
        {canManage && <>
          <Divider><Space><SettingOutlined />Cấu hình quản trị</Space></Divider>
          <Form form={donateForm} layout="vertical" onFinish={saveDonate}>
            <Form.Item name="donate_message" label="Lời nhắn"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
            <Form.Item name="donate_account_name" label="Tên chủ tài khoản"><Input maxLength={160} /></Form.Item>
            <Space size={12} align="start" className="donate-bank-fields">
              <Form.Item name="donate_bank_account" label="Số tài khoản"><Input inputMode="numeric" maxLength={80} /></Form.Item>
              <Form.Item name="donate_bank_name" label="Ngân hàng"><Input maxLength={120} /></Form.Item>
            </Space>
            <input ref={qrInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden-file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void chooseDonateQr(file); event.currentTarget.value = ""; }} />
            <Space wrap className="donate-qr-actions">
              <Button icon={<UploadOutlined />} onClick={() => qrInputRef.current?.click()}>{pendingDonateQr ? "Thay ảnh QR" : "Tải ảnh QR"}</Button>
              {pendingDonateQr && <Button danger icon={<DeleteOutlined />} onClick={() => { setPendingDonateQr(null); setPendingDonateQrName(null); }}>Xóa ảnh</Button>}
              {pendingDonateQrName && <Typography.Text type="secondary">{pendingDonateQrName}</Typography.Text>}
            </Space>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} block className="donate-save-button">Lưu thông tin Donate</Button>
          </Form>
        </>}
      </Modal>
    </>
  );
}
