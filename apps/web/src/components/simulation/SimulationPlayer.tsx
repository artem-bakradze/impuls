"use client";

import { ExperimentOutlined, MoreOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import { DIVERGED_TEXT, stepWeekLabel } from "@/lib/simulation-model";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";

function DayStrip({ total, done, now }: { total: number; done: number; now: boolean }) {
  return (
    <div className="studio-strip" style={{ gridTemplateColumns: `repeat(${Math.max(1, total)}, minmax(0, 1fr))` }} aria-hidden="true">
      {Array.from({ length: Math.max(1, total) }, (_, index) => (
        <i key={index} data-state={index < done ? "done" : now && index === done ? "now" : "todo"} />
      ))}
    </div>
  );
}

/** Whether the day goes: a step runs or the service reviews its day. */
export const isStepping = (status: SimulationStatus): boolean => status.status === "stepping" || status.agentTurn !== null;

/**
 * The simulation's player over «Реклама» (simulation-mode spec «Симуляция как отдельный режим»): the scenario's day and
 * state, its days strip, one main button for the next step with «Прожить неделю» beside it, the real launch as a
 * secondary button and «Начать заново» in its menu. Time moves only by these presses.
 */
export function SimulationPlayer({
  status,
  busy,
  error,
  act,
  scenarioTitle,
}: {
  status: SimulationStatus;
  busy: string | null;
  error: string | null;
  act: (control: SimulationAction) => Promise<void>;
  scenarioTitle: string | null;
}) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [modal, modalHolder] = Modal.useModal();
  const stepping = isStepping(status);
  const firstDay = status.weeks === 0 && status.day === 1 && !stepping && !status.ended;
  const shownDay = status.ended ? status.totalDays : status.day;
  const done = stepping ? Math.max(0, status.day - 1) : firstDay ? 0 : shownDay;
  const tag = status.failed ? "прерван" : stepping ? "идёт" : status.ended ? "завершён" : firstDay ? "впереди" : "прожит";

  const run = (control: SimulationAction) => void act(control);
  const restart = (mode: "repeat" | "fresh") => {
    setRestartOpen(false);
    run({ action: "restart", mode });
  };
  const confirmGoReal = () =>
    modal.confirm({
      title: "Запустить настоящую рекламу?",
      content: "Данные симуляции удалятся без возможности вернуть. Описание бизнеса, бюджет и объявления сохранятся.",
      okText: "Запустить по-настоящему",
      cancelText: "Отмена",
      onOk: () => act({ action: "go_real" }),
    });
  const menu: MenuProps = {
    items: [{ key: "restart", label: "Начать заново", disabled: stepping }],
    onClick: ({ key }) => {
      if (key === "restart") setRestartOpen(true);
    },
  };

  const primaryLabel = status.ended
    ? "Продолжить ещё 30 дней"
    : status.failed
      ? "Продолжить расчёт"
      : stepping
        ? status.agentTurn
          ? "Сервис разбирает…"
          : "День идёт…"
        : firstDay
          ? "Прожить день"
          : "Прожить следующий день";
  const primary = () => {
    if (status.ended) return run({ action: "extend" });
    if (status.failed) return run({ action: "step_week" });
    return run({ action: "step_day" });
  };

  return (
    <section className="sim-player panel" aria-label="Симуляция" data-testid="sim-player">
      {modalHolder}
      <div className="sim-player-head">
        <div className="studio-day">
          <span className="studio-day-num" data-testid="studio-day">
            День {shownDay}
          </span>
          <span className="studio-day-of">из {status.totalDays}</span>
          <span className={`studio-tag ${status.failed ? "bad" : stepping ? "live" : status.ended ? "done" : firstDay ? "muted" : "done"}`} data-testid="studio-status">
            {tag}
          </span>
        </div>
        <span className="studio-scenario" data-testid="studio-scenario">
          {scenarioTitle ? `сценарий «${scenarioTitle}»` : "симуляция"}
        </span>
        <div className="sim-player-end">
          <Button className="studio-go-real" onClick={() => void confirmGoReal()} disabled={stepping}>
            Запустить по-настоящему
          </Button>
          <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
            <Button type="text" icon={<MoreOutlined aria-hidden="true" />} aria-label="Ещё: начать заново" className="studio-menu" />
          </Dropdown>
        </div>
      </div>
      <DayStrip total={status.totalDays} done={done} now={stepping} />
      <div className="sim-player-foot">
        <div className="sim-player-actions">
          <button type="button" className="studio-primary" onClick={primary} disabled={stepping || busy !== null}>
            {primaryLabel}
          </button>
          {!status.ended && !status.failed && !stepping ? (
            <button type="button" className="studio-link" onClick={() => run({ action: "step_week" })} disabled={busy !== null}>
              {stepWeekLabel(status.daysLeft)}
            </button>
          ) : null}
        </div>
        <p className="studio-disclaimer" data-testid="studio-disclaimer">
          <ExperimentOutlined aria-hidden="true" /> Учебный рынок · деньги не списываются
        </p>
      </div>
      {status.replay.diverged ? <Alert className="studio-alert" type="info" showIcon title={DIVERGED_TEXT} /> : null}
      {error !== null ? <Alert className="studio-alert" type="error" showIcon title={error} /> : null}

      <Modal open={restartOpen} title="Начать симуляцию заново?" onCancel={() => setRestartOpen(false)} footer={null}>
        <div className="studio-modal">
          <p className="t-body t-muted">Тот же сценарий с первого дня: рынок будет тем же. История и цифры этого прогона удалятся.</p>
          <Button type="primary" block onClick={() => restart("repeat")} disabled={!status.replay.available}>
            Повторить этот прогон
          </Button>
          <span className="t-small">
            {status.replay.available
              ? "Сервис повторит те же решения — цифры совпадут, если вы будете действовать так же."
              : "Повторять пока нечего: в этом прогоне сервис ещё не принимал своих решений."}
          </span>
          <Button block onClick={() => restart("fresh")}>
            Прогнать заново
          </Button>
          <span className="t-small">Рынок будет тем же, но сервис будет решать заново и может решить иначе.</span>
        </div>
      </Modal>
    </section>
  );
}
