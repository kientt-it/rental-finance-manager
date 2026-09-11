import type { Metadata, Viewport } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import AntdProvider from "./antd-provider";
import "./globals.css";
import ExtensionAttributeGuard from "./extension-attribute-guard";
import PwaRegistration from "./pwa-registration";

import "./responsive.css";
export const metadata: Metadata = {
  title: "708 La Thành | Quản lý tài chính",
  description: "Quản lý phòng, hóa đơn và thu chi nhà trọ.",
  applicationName: "708 La Thành",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "708 La Thành",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#087a58",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning><ExtensionAttributeGuard /><PwaRegistration /><AntdRegistry><AntdProvider>{children}</AntdProvider></AntdRegistry></body>
    </html>
  );
}
