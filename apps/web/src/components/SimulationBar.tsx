"use client";

import { CaretRightOutlined, CheckOutlined, ExperimentOutlined, FastForwardOutlined, MoreOutlined, PauseOutlined, ReloadOutlined, RocketOutlined, StepForwardOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callApi, runWebJob } from "@/lib/client-api";
import { agentTurnText, SPEED_LABELS } from "@/lib/simulation-model";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";

const POLL_MS = 1_000;

const clockText = (status: SimulationStatus): string =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: status.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(status.at));

/** Days of the scenario as a thin strip under the pult: passed, today, ahead. */
function DayStrip({ day, totalDays }: { day: number; totalDays: number }) {
  return (
    <div className="sim-strip" aria-hidden="true">
      {Array.from({ length: totalDays }, (_, i) => (
        <i key={i} data-state={i + 1 < day ? "done" : i + 1 === day ? "now" : "todo"} />
      ))}
    </div>
  );
}

/**
 * The simulation pult on every screen of a simulated business (simulation-mode spec): one row with the virtual day,
 * pause, «+1 день» and «До следующего решения»; the speed, «Начать заново» and «Запустить по-настоящему» are in the
 * menu. It polls the status and refreshes the page when the history grows, so the screens follow the virtual time.
 */
export function SimulationBar({ initial }: { initial: SimulationStatus }) {
  const router = useRouter();
  const [modal, modalHolder] = Modal.useModal();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown after «До следующего решения» stopped on a decision, until the next action on the pult. */
  const [decision, setDecision] = useState<SimulationStatus["lastDecision"]>(null);
  const seen = useRef({ changes: initial.changes, day: initial.day, status: initial.status, thinking: initial.agentTurn !== null });

  useEffect(() => {
    const timer = setInterval(() => {
      void callApi<SimulationStatus>("/api/simulation", "GET").then((result) => {
        if (result.kind !== "ok") return;
        const next = result.body;
        const before = seen.current;
        if (before.status === "until_decision" && next.status === "paused" && !next.ended) {
          setDecision(next.lastDecision);
        }
        // A finished agent turn brings its insights even when it changed nothing.
        if (next.changes !== before.changes || next.day !== before.day || (before.thinking && next.agentTurn === null)) {
          router.refresh();
        }
        seen.current = { changes: next.changes, day: next.day, status: next.status, thinking: next.agentTurn !== null };
        setStatus(next);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  const act = async (control: SimulationAction) => {
    setBusy(control.action);
    setError(null);
    setDecision(null);
    const outcome = await runWebJob<{ ok: true }>("/api/simulation", control);
    setBusy(null);
    if (outcome.kind === "error") {
      setError(outcome.message);
      return;
    }
    if (control.action === "go_real") {
      // A full load: the shared layout (pult, navigation) must be rendered again for a business that is not launched.
      window.location.assign("/wizard");
      return;
    }
    if (control.action === "speed") {
      setStatus((current) => ({ ...current, speed: control.speed }));
    }
    if (control.action === "restart") {
      router.push("/summary");
    }
    router.refresh();
  };

  const confirmRestart = () =>
    modal.confirm({
      title: "Начать симуляцию заново?",
      content: "Тот же сценарий с первого дня: рынок будет тем же, но агент может решить иначе. История и цифры этого прогона удалятся.",
      okText: "Начать заново",
      cancelText: "Отмена",
      onOk: () => act({ action: "restart" }),
    });
  const confirmGoReal = () =>
    modal.confirm({
      title: "Запустить настоящую рекламу?",
      content: "Данные симуляции удалятся без возможности вернуть. Описание бизнеса, бюджет и объявления сохранятся.",
      okText: "Запустить по-настоящему",
      cancelText: "Отмена",
      onOk: () => act({ action: "go_real" }),
    });

  const speeds = Object.keys(SPEED_LABELS) as SimulationStatus["speed"][];
  const menu: MenuProps = {
    items: [
      {
        type: "group",
        label: "Скорость",
        children: speeds.map((speed) => ({ key: `speed:${speed}`, label: SPEED_LABELS[speed], icon: speed === status.speed ? <CheckOutlined /> : <span style={{ width: 14, display: "inline-block" }} /> })),
      },
      { type: "divider" },
      { key: "restart", label: "Начать заново", icon: <ReloadOutlined /> },
      { key: "go_real", label: "Запустить по-настоящему", icon: <RocketOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === "restart") confirmRestart();
      else if (key === "go_real") confirmGoReal();
      else if (key.startsWith("speed:")) void act({ action: "speed", speed: key.slice(6) as SimulationStatus["speed"] });
    },
  };

  const moving = status.status !== "paused";
  return (
    <div className="sim-bar" data-testid="simulation-bar">
      {modalHolder}
      <div className="sim-bar-inner">
        <span className="sim-label">
          <ExperimentOutlined aria-hidden="true" /> Симуляция — реклама не показывается, время ускорено
        </span>
        <span className="sim-clock" data-testid="simulation-day">
          День {status.day} из {status.totalDays}
          <span className="on-wide"> · {clockText(status)}</span>
        </span>
        {status.agentTurn ? (
          <span className="sim-thinking" role="status" data-testid="simulation-agent-turn">
            {agentTurnText(status.agentTurn)}
          </span>
        ) : null}
        <span className="spacer" />
        <span className="sim-actions">
          {status.ended ? (
            <Button size="small" type="primary" onClick={() => void act({ action: "extend" })} loading={busy === "extend"}>
              Продолжить ещё 30 дней
            </Button>
          ) : (
            <>
              {moving ? (
                <Button size="small" icon={<PauseOutlined aria-hidden="true" />} onClick={() => void act({ action: "pause" })} loading={busy === "pause"} aria-label="Пауза">
                  <span className="on-wide">Пауза</span>
                </Button>
              ) : (
                <Button size="small" type="primary" icon={<CaretRightOutlined aria-hidden="true" />} onClick={() => void act({ action: "resume" })} loading={busy === "resume"} aria-label="Продолжить">
                  <span className="on-wide">Продолжить</span>
                </Button>
              )}
              <Button size="small" icon={<StepForwardOutlined aria-hidden="true" />} onClick={() => void act({ action: "step_day" })} loading={busy === "step_day"} aria-label="+1 день">
                <span className="on-wide">+1 день</span>
                <span className="on-narrow">+1</span>
              </Button>
              <Button size="small" icon={<FastForwardOutlined aria-hidden="true" />} onClick={() => void act({ action: "until_decision" })} loading={busy === "until_decision" || status.status === "until_decision"}
                aria-label="До следующего решения"
              >
                <span className="on-wide">До следующего решения</span>
                <span className="on-narrow">До решения</span>
              </Button>
            </>
          )}
          <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
            <Button size="small" type="text" icon={<MoreOutlined aria-hidden="true" />} aria-label="Ещё: скорость, начать заново, запустить по-настоящему" loading={busy === "restart" || busy === "go_real" || busy === "speed"} />
          </Dropdown>
        </span>
      </div>
      <DayStrip day={status.day} totalDays={status.totalDays} />
      {decision ? (
        <div className="sim-bar-inner">
          <Alert
            type="info"
            showIcon
            closable={{ onClose: () => setDecision(null) }}
            title={decision.explanation}
            action={
              <Link href={`/history#${decision.id}`} onClick={() => setDecision(null)}>
                В истории
              </Link>
            }
            style={{ width: "100%" }}
            data-testid="simulation-decision"
          />
        </div>
      ) : null}
      {error ? (
        <div className="sim-bar-inner">
          <Alert type="error" showIcon title={error} style={{ width: "100%" }} />
        </div>
      ) : null}
    </div>
  );
}
