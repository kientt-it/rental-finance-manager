"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { App, ConfigProvider, theme as antdTheme } from "antd";
import viVN from "antd/locale/vi_VN";

type ThemeMode = "system" | "light" | "dark";
type AppTheme = { mode: ThemeMode; setMode: (mode: ThemeMode) => void; resolvedTheme: "light" | "dark" };
const themeStorageKey = "rental-finance-theme";
const AppThemeContext = createContext<AppTheme>({ mode: "system", setMode: () => {}, resolvedTheme: "light" });

export function useAppTheme() { return useContext(AppThemeContext); }

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(themeStorageKey); } catch { /* Browser storage may be unavailable. */ }
    setModeState(stored === "light" || stored === "dark" ? stored : "system");
    setSystemDark(media.matches);
    setMounted(true);
    const onSystemChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, []);

  const resolvedTheme = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  const setMode = useCallback((nextMode: ThemeMode) => {
    try { window.localStorage.setItem(themeStorageKey, nextMode); } catch { /* Keep the selected theme for this session. */ }
    document.documentElement.classList.toggle("dark", nextMode === "dark" || (nextMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
    setModeState(nextMode);
  }, []);

  useEffect(() => {
    if (mounted) document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [mounted, resolvedTheme]);
  if (!mounted) return <div className="app-boot" suppressHydrationWarning />;

  const dark = resolvedTheme === "dark";
  return (
    <AppThemeContext.Provider value={{ mode, setMode, resolvedTheme }}>
    <ConfigProvider
      locale={viVN}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: dark ? "#65d6a3" : "#087a58",
          colorInfo: dark ? "#65d6a3" : "#087a58",
          colorSuccess: dark ? "#65d6a3" : "#16835d",
          colorWarning: dark ? "#f0b86b" : "#d97706",
          colorError: dark ? "#ed8179" : "#c2413a",
          colorText: dark ? "#eaf4ed" : "#10271f",
          colorTextSecondary: dark ? "#abc1b2" : "#71837b",
          colorTextPlaceholder: dark ? "#a9c1b1" : "#a3afa8",
          colorTextLightSolid: dark ? "#092018" : "#ffffff",
          colorBgBase: dark ? "#0b1510" : "#ffffff",
          colorBgLayout: dark ? "#0b1510" : "#f3f7f5",
          colorBgContainer: dark ? "#15231b" : "#ffffff",
          colorBgElevated: dark ? "#1d3024" : "#ffffff",
          colorBorder: dark ? "rgba(210, 239, 221, 0.22)" : "#dce7e1",
          colorBorderSecondary: dark ? "rgba(210, 239, 221, 0.14)" : "#e5ebe7",
          borderRadius: 12,
          borderRadiusLG: 16,
          controlHeight: 40,
          fontFamily: '"Segoe UI Variable Text", "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif',
          fontSize: 14,
          boxShadowSecondary: dark ? "0 18px 50px rgba(0, 0, 0, 0.4)" : "0 18px 50px rgba(27, 54, 42, 0.12)",
        },
        components: {
          Button: { fontWeight: 650 },
          Card: { headerFontSize: 16 },
          Layout: { siderBg: dark ? "#15231b" : "#ffffff", lightSiderBg: dark ? "#15231b" : "#ffffff", bodyBg: dark ? "#0b1510" : "#f4f7f5" },
          Menu: {
            itemBg: "transparent",
            itemSelectedBg: dark ? "rgba(101, 214, 163, 0.15)" : "#e5f3ed",
            itemSelectedColor: dark ? "#80e2b2" : "#087a58",
            itemBorderRadius: 10,
          },
          Table: { headerBg: dark ? "#1b2d22" : "#f6f8f7", headerColor: dark ? "#abc1b2" : "#5e6c65" },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
    </AppThemeContext.Provider>
  );
}
