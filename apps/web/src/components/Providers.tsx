"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App, ConfigProvider } from "antd";
import type { ThemeConfig } from "antd";
import ruRU from "antd/locale/ru_RU";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import type { ReactNode } from "react";

dayjs.locale("ru");

/** Ant Design on the same tokens as globals.css: one accent, calm neutrals, soft radii, no heavy shadows. */
const theme: ThemeConfig = {
  token: {
    colorPrimary: "#5646f2",
    colorInfo: "#5646f2",
    colorSuccess: "#0c7c55",
    colorWarning: "#a45106",
    colorError: "#c8261b",
    colorText: "#121217",
    colorTextSecondary: "#4f4f5c",
    colorTextTertiary: "#6b6b78",
    colorTextPlaceholder: "#9a9aa6",
    colorBorder: "#e0e0e7",
    colorBorderSecondary: "#e7e7ec",
    colorBgLayout: "#f6f6f8",
    colorFillTertiary: "#f2f2f5",
    fontFamily: "var(--font-sans)",
    fontSize: 15,
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 8,
    controlHeight: 42,
    controlHeightLG: 50,
    controlHeightSM: 32,
    lineWidthFocus: 3,
    controlOutline: "rgba(86, 70, 242, 0.18)",
    boxShadowSecondary: "0 2px 4px rgba(18,18,23,0.04), 0 24px 48px -16px rgba(18,18,23,0.18)",
    motionDurationMid: "0.18s",
  },
  components: {
    Button: { fontWeight: 600, primaryShadow: "0 1px 2px rgba(18,18,23,0.08)", defaultShadow: "none", dangerShadow: "none", paddingInlineLG: 22 },
    Input: { activeShadow: "0 0 0 3px rgba(86, 70, 242, 0.18)", paddingInline: 14 },
    InputNumber: { activeShadow: "0 0 0 3px rgba(86, 70, 242, 0.18)", paddingInline: 14 },
    Select: { optionSelectedBg: "#efedfe", optionSelectedColor: "#3a2cc4" },
    Segmented: { itemSelectedBg: "#ffffff", trackBg: "#ececf1", borderRadius: 10, itemColor: "#4f4f5c" },
    Slider: { railBg: "#e7e7ec", railHoverBg: "#d6d6de", trackBg: "#5646f2", trackHoverBg: "#4434df", handleColor: "#5646f2", dotActiveBorderColor: "#5646f2" },
    Modal: { borderRadiusLG: 18, titleFontSize: 18 },
    Alert: { withDescriptionPadding: "14px 16px" },
    Collapse: { headerBg: "#ffffff", contentBg: "#ffffff" },
    Tabs: { itemSelectedColor: "#121217", inkBarColor: "#5646f2", titleFontSize: 14.5 },
  },
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider locale={ruRU} theme={theme}>
        <App>{children}</App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
