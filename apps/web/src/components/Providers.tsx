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
    colorPrimary: "#5a48f0",
    colorInfo: "#5a48f0",
    colorSuccess: "#0e7a54",
    colorWarning: "#a04a05",
    colorError: "#c8261b",
    colorText: "#16171d",
    colorTextSecondary: "#4b4f5c",
    colorTextTertiary: "#6a6f7c",
    colorTextPlaceholder: "#6a6f7c",
    colorBorder: "#dadce3",
    colorBorderSecondary: "#e4e6eb",
    colorBgLayout: "#f2f3f5",
    colorFillTertiary: "#f2f3f5",
    fontFamily: "var(--font-sans)",
    fontSize: 15,
    borderRadius: 12,
    borderRadiusLG: 14,
    borderRadiusSM: 8,
    controlHeight: 44,
    controlHeightLG: 52,
    controlHeightSM: 32,
    lineWidthFocus: 3,
    controlOutline: "rgba(90, 72, 240, 0.18)",
    boxShadowSecondary: "0 2px 4px rgba(18,18,23,0.04), 0 24px 48px -16px rgba(18,18,23,0.18)",
    motionDurationMid: "0.18s",
  },
  components: {
    Button: { fontWeight: 600, primaryShadow: "0 1px 2px rgba(18,18,23,0.08)", defaultShadow: "none", dangerShadow: "none", paddingInlineLG: 22 },
    Input: { activeShadow: "0 0 0 4px rgba(90, 72, 240, 0.12)", paddingInline: 14 },
    InputNumber: { activeShadow: "0 0 0 4px rgba(90, 72, 240, 0.12)", paddingInline: 14 },
    Select: { optionSelectedBg: "#f1effe", optionSelectedColor: "#3f2fd0" },
    Segmented: { itemSelectedBg: "#ffffff", trackBg: "#f2f3f5", borderRadius: 12, itemColor: "#4b4f5c", trackPadding: 4 },
    Slider: { railBg: "#e7e7ec", railHoverBg: "#d6d6de", trackBg: "#5a48f0", trackHoverBg: "#4a38e0", handleColor: "#5a48f0", dotActiveBorderColor: "#5a48f0" },
    Modal: { borderRadiusLG: 24, titleFontSize: 22 },
    Alert: { withDescriptionPadding: "14px 16px" },
    Collapse: { headerBg: "#ffffff", contentBg: "#ffffff" },
    Tabs: { itemSelectedColor: "#16171d", inkBarColor: "#5a48f0", titleFontSize: 14.5 },
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
