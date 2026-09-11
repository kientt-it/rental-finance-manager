import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "708 La Thành | Quản lý tài chính",
    short_name: "708 La Thành",
    description: "Quản lý phòng, hóa đơn và thu chi nhà trọ.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f3f7f5",
    theme_color: "#087a58",
    orientation: "any",
    lang: "vi",
    categories: ["finance", "utilities", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Tổng quan",
        short_name: "Tổng quan",
        url: "/dashboard",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Khoản chi",
        short_name: "Khoản chi",
        url: "/expenses",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
