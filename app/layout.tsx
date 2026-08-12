import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import AntdProvider from "./antd-provider";
import "./globals.css";
import ExtensionAttributeGuard from "./extension-attribute-guard";

import "./responsive.css";
export const metadata: Metadata = {
  title: "708 La Thành | Quản lý tài chính",
  description: "Quản lý phòng, hóa đơn và thu chi nhà trọ.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning><ExtensionAttributeGuard /><AntdRegistry><AntdProvider>{children}</AntdProvider></AntdRegistry></body>
    </html>
  );
}
