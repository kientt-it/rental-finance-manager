"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Col, Flex, Form, Input, Row, Space, Typography } from "antd";
import { CheckCircleFilled, LockOutlined, MailOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { createClient } from "@/lib/supabase/browser";

type LoginValues = { fullName?: string; email: string; password: string };

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
      const { error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
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
      email: values.email,
      password: values.password,
      options: { data: { full_name: values.fullName?.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setMessageType("error");
      setMessage(error.message);
    } else if (data.session) {
      router.push("/");
      router.refresh();
      return;
    } else {
      setMessageType("success");
      setMessage("Đã gửi email xác nhận. Hãy mở email để hoàn tất đăng ký.");
    }
    setLoading(false);
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
            <Typography.Paragraph type="secondary">{mode === "login" ? "Tiếp tục quản lý tài chính nhà trọ của bạn." : "Thiết lập tài khoản quản lý đầu tiên trong vài phút."}</Typography.Paragraph>

            {message && <Alert className="auth-alert" showIcon type={messageType} title={message} />}

            <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} size="large">
              {mode === "signup" && (
                <Form.Item name="fullName" label="Họ và tên" rules={[{ required: true, message: "Nhập họ và tên" }]}>
                  <Input prefix={<UserOutlined />} autoComplete="name" placeholder="Nguyễn Văn An" />
                </Form.Item>
              )}
              <Form.Item name="email" label="Email" rules={[{ required: true, message: "Nhập email" }, { type: "email", message: "Email chưa đúng định dạng" }]}>
                <Input prefix={<MailOutlined />} autoComplete="email" placeholder="ban@email.com" />
              </Form.Item>
              <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: "Nhập mật khẩu" }, { min: 6, message: "Mật khẩu cần ít nhất 6 ký tự" }]}>
                <Input.Password prefix={<LockOutlined />} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Tối thiểu 6 ký tự" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</Button>
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
