"use client";

import { FastForwardOutlined, MoreOutlined, RocketOutlined, RotateLeftOutlined, StepForwardOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callApi, runWebJob } from "@/lib/client-api";
import { agentTurnText, DIVERGED_TEXT, elapsedText, stepText, stepWeekLabel } from "@/lib/simulation-model";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";

const POLL_MS = 1_000;

const clockText = (status: SimulationStatus): string =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: status.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(status.at));

/** Days of the scenario as a thin strip along the bottom edge of the pult: passed, today, ahead. */
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
 * The simulation pult on every screen of a simulated business (simulation-mode spec «Виртуальное время и пульт»): one
 * row with the virtual day, «Прожить неделю» and «Начать заново»; «+1 день» and «Запустить по-настоящему» are in the
 * menu. The time moves only by these steps. While a step runs the pult says which day goes; after a week it opens the
 * week's story. It polls the status and refreshes the page when the history grows.
 */
export function SimulationBar({ initial }: { initial: SimulationStatus }) {
  const router = useRouter();
  const [modal, modalHolder] = Modal.useModal();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const seen = useRef({ changes: initial.changes, day: initial.day, status: initial.status, thinking: initial.agentTurn !== null, week: initial.step?.week ?? null, weeks: initial.weeks });
  /** When the running review was first seen, on the owner's clock, and the clock now: the pult counts the time it takes. */
  const [turnSeenAt, setTurnSeenAt] = useState<number | null>(initial.agentTurn ? Date.now() : null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      void callApi<SimulationStatus>("/api/simulation", "GET").then((result) => {
        if (result.kind !== "ok") return;
        const next = result.body;
        const before = seen.current;
        // A week has been lived: «Реклама» opens with the journal on that week.
        if (before.status === "stepping" && next.status === "paused" && !next.failed && next.weeks > before.weeks) {
          router.push(`/summary?week=${next.weeks}`);
        }
        // The page is refreshed when a step ends or something changed between steps, never in the middle of a step:
        // the pult shows the step's progress, and a screen jumping every virtual day looks broken.
        const changed = next.changes !== before.changes || next.day !== before.day || (before.thinking && next.agentTurn === null) || before.status !== next.status;
        if (next.status === "paused" && changed) {
          router.refresh();
        }
        setTurnSeenAt((seenAt) => (next.agentTurn === null ? null : before.thinking && seenAt !== null ? seenAt : Date.now()));
        seen.current = { changes: next.changes, day: next.day, status: next.status, thinking: next.agentTurn !== null, week: next.step?.week ?? null, weeks: next.weeks };
        setStatus(next);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  const act = async (control: SimulationAction) => {
    setBusy(control.action);
    setError(null);
    if (control.action === "step_week" || control.action === "step_day") {
      // The pult shows the step at once; the polling follows it day by day.
      setStatus((current) => ({ ...current, failed: false, status: "stepping", step: { kind: control.action === "step_week" ? "week" : "day", week: control.action === "step_week" ? current.weeks + 1 : null } }));
      seen.current = { ...seen.current, status: "stepping", week: control.action === "step_week" ? status.weeks + 1 : null };
    }
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
    if (control.action === "restart") {
      router.push("/summary");
    }
    router.refresh();
  };

  const restart = (mode: "repeat" | "fresh") => {
    setRestartOpen(false);
    void act({ action: "restart", mode });
  };
  const confirmGoReal = () =>
    modal.confirm({
      title: "Запустить настоящую рекламу?",
      content: "Данные симуляции удалятся без возможности вернуть. Описание бизнеса, бюджет и объявления сохранятся.",
      okText: "Запустить по-настоящему",
      cancelText: "Отмена",
      onOk: () => act({ action: "go_real" }),
    });

  const stepping = status.status === "stepping";
  const menu: MenuProps = {
    items: [
      { key: "step_day", label: "+1 день", icon: <StepForwardOutlined />, disabled: stepping || status.ended },
      { key: "restart", label: "Начать заново", icon: <RotateLeftOutlined />, disabled: stepping },
      { type: "divider" },
      { key: "go_real", label: "Запустить по-настоящему", icon: <RocketOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === "restart") setRestartOpen(true);
      else if (key === "go_real") confirmGoReal();
      else if (key === "step_day") void act({ action: "step_day" });
    },
  };

  // The time the review has been going: a minute-long review without it looks stuck.
  const elapsed = status.agentTurn && turnSeenAt !== null ? ` · ${elapsedText(Math.max(0, Math.round((now - turnSeenAt) / 1_000)))}` : "";
  const progress = status.agentTurn ? `${agentTurnText(status.agentTurn)}${elapsed}` : stepText(status);
  const compactProgress = status.failed ? "Расчёт прерван" : status.agentTurn ? `Разбор ${status.agentTurn.weekly ? "недели" : `${status.agentTurn.day}-го дня`}${elapsed}` : stepping ? "Расчёт идёт" : status.ended ? "Сценарий завершён" : status.weeks > 0 ? `Готовых недель: ${status.weeks}` : "Можно начать";
  return (
    <div className="sim-bar" data-testid="simulation-bar">
      {modalHolder}
      <div className="sim-bar-inner">
        <span className="sim-label" title="Реклама не показывается людям, время идёт по шагам">
          <span className="sim-live" data-moving={stepping} aria-hidden="true" />
          <span className="sim-label-text">Симуляция — реклама не показывается</span>
          <span className="on-narrow">Симуляция</span>
        </span>
        <span className="sim-time">
          <span className="sim-clock" data-testid="simulation-day">
            День {status.day} из {status.totalDays}
            <span className="on-wide"> · {clockText(status)}</span>
          </span>
          <span className="sim-speed" data-testid="simulation-progress">
            <span className="on-wide">{status.failed ? "Расчёт прерван — продолжите шаг" : progress ?? (status.weeks > 0 ? `Прожито недель: ${status.weeks}` : "Время стоит, пока вы не нажмёте")}</span>
            <span className="on-narrow">{compactProgress}</span>
          </span>
        </span>
        <span className="sim-actions">
          {status.ended && !status.failed ? (
            <Button size="small" type="primary" aria-label="Продолжить ещё 30 дней" onClick={() => void act({ action: "extend" })} loading={busy === "extend"}>
              <span className="on-wide">Продолжить ещё 30 дней</span><span className="on-narrow">Ещё 30 дней</span>
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<FastForwardOutlined aria-hidden="true" />}
              onClick={() => void act({ action: "step_week" })}
              loading={stepping || busy === "step_week"}
              data-testid="simulation-step-week"
            >
              <span className="on-wide">{status.failed ? "Продолжить расчёт" : stepWeekLabel(status.daysLeft)}</span>
              <span className="on-narrow">{status.failed ? "Продолжить" : status.daysLeft >= 7 ? "Неделя" : `${status.daysLeft} дн.`}</span>
            </Button>
          )}
          <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
            <Button size="small" type="text" className="sim-icon" icon={<MoreOutlined aria-hidden="true" />} aria-label="Ещё: один день и запуск по-настоящему" loading={busy === "go_real" || busy === "step_day"} />
          </Dropdown>
        </span>
        <DayStrip day={status.day} totalDays={status.totalDays} />
      </div>
      <Modal open={restartOpen} title="Начать симуляцию заново?" onCancel={() => setRestartOpen(false)} footer={null}>
        <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
          <p className="t-body t-muted">Тот же сценарий с первого дня: рынок будет тем же. История и цифры этого прогона удалятся.</p>
          <Button type="primary" block onClick={() => restart("repeat")} disabled={!status.replay.available} data-testid="restart-repeat">
            Повторить этот прогон
          </Button>
          <span className="t-small">
            {status.replay.available
              ? "Сервис повторит те же решения без новых запросов к модели — цифры совпадут, если вы будете действовать так же."
              : "Повторять пока нечего: в этом прогоне сервис ещё не принимал решений на модели."}
          </span>
          <Button block onClick={() => restart("fresh")} data-testid="restart-fresh">
            Прогнать заново
          </Button>
          <span className="t-small">Сервис будет решать заново — рынок будет тем же, но агент может решить иначе.</span>
        </div>
      </Modal>
      {status.replay.diverged ? (
        <div className="sim-bar-inner sim-bar-note">
          <Alert type="info" showIcon title={DIVERGED_TEXT} style={{ width: "100%" }} data-testid="simulation-diverged" />
        </div>
      ) : null}
      <span className="sr-only" role="status">{stepping ? "Расчёт выполняется" : status.failed ? "Расчёт не завершён" : `Прожито недель: ${status.weeks}`}</span>
      {error ? (
        <div className="sim-bar-inner sim-bar-note">
          <Alert type="error" showIcon title={error} style={{ width: "100%" }} />
        </div>
      ) : null}
    </div>
  );
}
