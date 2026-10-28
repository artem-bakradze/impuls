"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App, ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import type { ReactNode } from "react";

dayjs.locale("ru");

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider locale={ruRU} theme={{ token: { colorPrimary: "#5b3df5", borderRadius: 8, fontSize: 15 } }}>
        <App>{children}</App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
