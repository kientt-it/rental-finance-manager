"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Col, Flex, Form, Input, Row, Space, Typography } from "antd";
import { CheckCircleFilled, GoogleOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";

type LoginValues = { username: string; email?: string; password: string };

function authEmailFromUsername(username: string) {
  return `${username.trim().toLowerCase()}@users.708.local`;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success">("error");
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<LoginValues>();

  async function submit(values: LoginValues) {
    setLoading(true);
    setMessage("");
    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmailFromUsername(values.username), password: values.password });
      if (error) {
        setMessageType("error");
        setMessage(error.message === "Invalid login credentials" ? "Email hoặc mật khẩu chưa đúng." : error.message);
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: authEmailFromUsername(values.username),
      password: values.password,
      options: {
        data: {
          username: values.username.trim(),
          full_name: values.username.trim(),
          contact_email: values.email?.trim() || null,
        },
      },
    });

    if (error) {
      setMessageType("error");
      setMessage(error.message);
    } else if (data.user && data.user.identities?.length === 0) {
      setMessageType("error");
      setMessage("Tên tài khoản này đã tồn tại.");
    } else if (data.session) {
      router.push("/");
      router.refresh();
      return;
    } else {
      setMessageType("error");
      setMessage("Supabase đang bật xác nhận email. Hãy tắt Confirm email trong Authentication → Providers → Email rồi thử lại.");
    }
    setLoading(false);
  }

  async function signInWithGoogle() {
    setLoading(true);
    setMessage("");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setMessageType("error");
      setMessage(error.message);
      setLoading(false);
    }
  }

  function switchMode() {
    setMode((current) => current === "login" ? "signup" : "login");
    setMessage("");
    form.resetFields();
  }

  return (
    <main className="auth-shell">
      <Row className="auth-row">
        <Col xs={24} lg={13} className="auth-hero">
          <div className="auth-hero-content">
            <div className="app-brand auth-logo"><span className="brand-badge inverse">708</span><span>La Thành</span></div>
            <Typography.Text className="auth-kicker">TÀI CHÍNH NHÀ TRỌ, GỌN TRONG MỘT NƠI</Typography.Text>
            <Typography.Title>Nắm dòng tiền.<br />Nhẹ việc quản lý.</Typography.Title>
            <Typography.Paragraph>Theo dõi phòng, hóa đơn, công nợ và chi phí trên mọi thiết bị với một giao diện rõ ràng, nhất quán.</Typography.Paragraph>
            <Space orientation="vertical" size={18} className="auth-benefits">
              <Benefit icon={<CheckCircleFilled />} title="Rõ công nợ từng phòng" description="Số liệu cập nhật ngay khi ghi nhận thanh toán." />
              <Benefit icon={<SafetyCertificateOutlined />} title="Dữ liệu riêng tư" description="Mỗi tài khoản chỉ truy cập dữ liệu đã được phân quyền." />
            </Space>
          </div>
        </Col>
        <Col xs={24} lg={11} className="auth-form-column">
          <Card className="auth-card">
            <Typography.Text className="form-eyebrow">{mode === "login" ? "CHÀO MỪNG TRỞ LẠI" : "BẮT ĐẦU MIỄN PHÍ"}</Typography.Text>
            <Typography.Title level={2}>{mode === "login" ? "Đăng nhập 708 La Thành" : "Tạo tài khoản"}</Typography.Title>
            <Typography.Paragraph type="secondary">{mode === "login" ? "Đăng nhập bằng tên tài khoản hoặc tiếp tục với Google." : "Chỉ cần tên tài khoản và mật khẩu. Email là tùy chọn."}</Typography.Paragraph>

            {message && <Alert className="auth-alert" showIcon type={messageType} title={message} />}

            <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} size="large">
              <Form.Item name="username" label="Tên tài khoản" rules={[{ required: true, message: "Nhập tên tài khoản" }, { pattern: /^[a-zA-Z0-9._-]{3,32}$/, message: "Dùng 3–32 ký tự không dấu: chữ, số, dấu chấm, gạch ngang hoặc gạch dưới" }]}>
                <Input prefix={<UserOutlined />} autoComplete="username" placeholder="nguyenvanan" />
              </Form.Item>
              {mode === "signup" && <Form.Item name="email" label="Email liên hệ (không bắt buộc)" rules={[{ type: "email", message: "Email chưa đúng định dạng" }]}>
                <Input prefix={<MailOutlined />} autoComplete="email" placeholder="ban@email.com" />
              </Form.Item>}
              <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: "Nhập mật khẩu" }, { min: 6, message: "Mật khẩu cần ít nhất 6 ký tự" }]}>
                <Input.Password prefix={<LockOutlined />} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Tối thiểu 6 ký tự" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</Button>
              <div className="auth-divider"><span>hoặc</span></div>
              <Button icon={<GoogleOutlined />} onClick={() => void signInWithGoogle()} disabled={loading} block>Tiếp tục với Google</Button>
              <Button type="link" onClick={switchMode} block className="auth-switch">
                {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </main>
  );
}

function Benefit({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <Flex gap={12} align="flex-start"><span className="benefit-icon">{icon}</span><div><Typography.Text strong>{title}</Typography.Text><Typography.Text>{description}</Typography.Text></div></Flex>;
}
