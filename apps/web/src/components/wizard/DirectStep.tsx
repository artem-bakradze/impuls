"use client";

import { ApiOutlined, CheckCircleFilled, ExperimentOutlined, LockOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { DIRECT_OAUTH_MESSAGES } from "@/lib/direct-oauth";
import type { DirectOAuthOutcome } from "@/lib/direct-oauth";
import { Note } from "../ui/primitives";

interface Props {
  directApiMode: "simulator" | "production";
  connected: boolean;
  /** Result of the redirect back from Yandex, if the owner has just been there. */
  outcome: DirectOAuthOutcome | null;
  onConnect: () => void;
}

const PROMISES = [
  { icon: <LockOutlined />, text: "Деньги списываются только с баланса вашего Директа — к ним мы доступа не получаем." },
  { icon: <ApiOutlined />, text: "Управляем только кампаниями, которые создали сами. Ваша реклама в кабинете остаётся как есть." },
];

/**
 * In the simulator there is no real Direct account to connect. In production the owner grants access on the
 * Yandex page; the account is stored by the OAuth callback. Once connected, the launch summary appears below.
 */
export function DirectStep({ directApiMode, connected, outcome, onConnect }: Props) {
  if (directApiMode === "simulator") {
    return (
      <div className="stack" style={{ "--gap": "18px" } as React.CSSProperties}>
        <div className="row" style={{ "--gap": "14px", flexWrap: "nowrap", alignItems: "flex-start" } as React.CSSProperties}>
          <span className="icon-tile warning" style={{ width: 44, height: 44, fontSize: 20 }}>
            <ExperimentOutlined />
          </span>
          <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
            <h2 className="t-h3">На этом стенде Яндекс Директ не подключён</h2>
            <p className="t-body t-muted">Здесь доступна только тестовая копия Директа: настоящая реклама не запускается, деньги не списываются. Для учебного рынка с решениями по неделям выберите «Симуляция».</p>
          </div>
        </div>
        {connected ? null : (
          <Button type="primary" size="large" onClick={onConnect} style={{ alignSelf: "flex-start" }}>
            Продолжить в тестовом режиме
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="stack" style={{ "--gap": "18px" } as React.CSSProperties}>
      <ul className="benefits">
        {PROMISES.map((p) => (
          <li key={p.text}>
            <span className="benefit-icon">{p.icon}</span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      {outcome === "denied" || outcome === "failed" ? <Note tone="warning">{DIRECT_OAUTH_MESSAGES[outcome]}</Note> : null}
      {connected ? (
        <Note tone="success" icon={<CheckCircleFilled />}>
          Яндекс Директ подключён
        </Note>
      ) : (
        <Button type="primary" size="large" href="/api/direct/oauth/start" style={{ alignSelf: "flex-start" }}>
          {outcome === "denied" || outcome === "failed" ? "Подключить ещё раз" : "Подключить Яндекс Директ"}
        </Button>
      )}
    </div>
  );
}
