"use client";

import { Alert, Button, Flex, Typography } from "antd";

interface Props {
  directApiMode: "simulator" | "sandbox" | "production";
  connected: boolean;
  onConnect: () => void;
}

/**
 * In the local test environment there is no real Direct account to connect. Real OAuth needs the
 * registered Yandex application and is not available yet.
 */
export function DirectStep({ directApiMode, connected, onConnect }: Props) {
  if (directApiMode === "simulator") {
    return (
      <Flex vertical gap={16}>
        <Alert type="warning" showIcon title="Тестовый режим — реклама не показывается" description="Подключать Яндекс Директ не нужно: объявления создаются в тестовой копии, деньги не тратятся." />
        {connected ? <Typography.Text type="success">Тестовый режим включён.</Typography.Text> : null}
        <Button type="primary" size="large" onClick={onConnect} style={{ alignSelf: "flex-start" }}>
          Продолжить в тестовом режиме
        </Button>
      </Flex>
    );
  }
  return (
    <Flex vertical gap={16}>
      <Typography.Paragraph style={{ margin: 0 }}>
        Реклама будет работать в вашем аккаунте Яндекс Директа: деньги списываются с его баланса, а мы управляем только теми кампаниями, которые создали сами.
      </Typography.Paragraph>
      <Alert type="info" showIcon title="Подключение Яндекс Директа скоро появится" description="Мы сообщим, когда можно будет продолжить." />
      <Typography.Text type="secondary">
        Если в этом аккаунте уже есть ваша собственная реклама, мы её не трогаем, и её расходы не входят в бюджет сервиса.
      </Typography.Text>
    </Flex>
  );
}
