"use client";

import { Alert, Button, Flex, Typography } from "antd";
import { DIRECT_OAUTH_MESSAGES } from "@/lib/direct-oauth";
import type { DirectOAuthOutcome } from "@/lib/direct-oauth";

interface Props {
  directApiMode: "simulator" | "production";
  connected: boolean;
  /** Result of the redirect back from Yandex, if the owner has just been there. */
  outcome: DirectOAuthOutcome | null;
  onConnect: () => void;
}

/**
 * In the simulator there is no real Direct account to connect. In production the owner grants access on the
 * Yandex page; the account is stored by the OAuth callback, and «Продолжить» moves on once it is connected.
 */
export function DirectStep({ directApiMode, connected, outcome, onConnect }: Props) {
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
      {outcome === "denied" || outcome === "failed" ? <Alert type={outcome === "denied" ? "warning" : "error"} showIcon title={DIRECT_OAUTH_MESSAGES[outcome]} /> : null}
      {connected ? (
        <>
          <Alert type="success" showIcon title="Яндекс Директ подключён" />
          <Button type="primary" size="large" onClick={onConnect} style={{ alignSelf: "flex-start" }}>
            Продолжить
          </Button>
        </>
      ) : (
        <Button type="primary" size="large" href="/api/direct/oauth/start" style={{ alignSelf: "flex-start" }}>
          {outcome === "denied" || outcome === "failed" ? "Подключить ещё раз" : "Подключить Яндекс Директ"}
        </Button>
      )}
      <Typography.Text type="secondary">
        Если в этом аккаунте уже есть ваша собственная реклама, мы её не трогаем, и её расходы не входят в бюджет сервиса.
      </Typography.Text>
    </Flex>
  );
}
