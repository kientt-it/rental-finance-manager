"use client";

import { useEffect, useState } from "react";
import { App, ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="app-boot" suppressHydrationWarning />;

  return (
    <ConfigProvider
      locale={viVN}
      theme={{
        token: {
          colorPrimary: "#087a58",
          colorInfo: "#087a58",
          colorSuccess: "#16835d",
          colorWarning: "#d97706",
          colorError: "#c2413a",
          colorText: "#17211c",
          colorTextSecondary: "#68766f",
          colorBgLayout: "#f4f7f5",
          colorBorderSecondary: "#e5ebe7",
          borderRadius: 12,
          borderRadiusLG: 16,
          controlHeight: 40,
          fontFamily: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          boxShadowSecondary: "0 18px 50px rgba(27, 54, 42, 0.12)",
        },
        components: {
          Button: { fontWeight: 650 },
          Card: { headerFontSize: 16 },
          Layout: { siderBg: "#ffffff", bodyBg: "#f4f7f5" },
          Menu: {
            itemBg: "transparent",
            itemSelectedBg: "#e5f3ed",
            itemSelectedColor: "#087a58",
            itemBorderRadius: 10,
          },
          Table: { headerBg: "#f6f8f7", headerColor: "#5e6c65" },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
