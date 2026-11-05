"use client";

import { ExperimentOutlined, MoreOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import { DIVERGED_TEXT } from "@/lib/simulation-model";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";

/** Whether the day goes: a step runs or the service reviews its day. */
export const isStepping = (status: SimulationStatus): boolean => status.status === "stepping" || status.agentTurn !== null;

/**
 * The simulation's player on «Реклама» (simulation-mode spec «Симуляция как отдельный режим»), under the review on a
 * wide screen and over the answer on a narrow one: the day and its state, one main button for the next step with
 * «Прожить неделю» under it, and at its foot the training market's note with the real launch as a secondary button;
 * «Начать заново» is in its menu. Time moves only by these presses. The run has no end for the owner: neither the
 * scenario's length nor its name is shown, and after its last day the next step goes on (the worker extends the run).
 */
export function SimulationPlayer({
  status,
  busy,
  error,
  act,
}: {
  status: SimulationStatus;
  busy: string | null;
  error: string | null;
  act: (control: SimulationAction) => Promise<void>;
}) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [modal, modalHolder] = Modal.useModal();
  const stepping = isStepping(status);
  const firstDay = status.weeks === 0 && status.day === 1 && !stepping;
  const tag = status.failed ? "прерван" : stepping ? "идёт" : firstDay ? "впереди" : "прожит";

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

  const primaryLabel = status.failed
    ? "Продолжить расчёт"
    : stepping
      ? status.agentTurn
        ? "Сервис разбирает…"
        : "День идёт…"
      : firstDay
        ? "Прожить день"
        : "Прожить следующий день";
  const primary = () => run({ action: status.failed ? "step_week" : "step_day" });

  return (
    <section className="sim-player panel" aria-label="Симуляция" data-testid="sim-player">
      {modalHolder}
      <div className="sim-player-head">
        <div className="studio-day">
          <span className="studio-day-num" data-testid="studio-day">
            День {status.day}
          </span>
          <span className={`studio-tag ${status.failed ? "bad" : stepping ? "live" : firstDay ? "muted" : "done"}`} data-testid="studio-status">
            {tag}
          </span>
        </div>
        <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
          <Button type="text" icon={<MoreOutlined aria-hidden="true" />} aria-label="Ещё: начать заново" className="studio-menu" />
        </Dropdown>
      </div>
      <div className="sim-player-actions">
        <button type="button" className="studio-primary" onClick={primary} disabled={stepping || busy !== null}>
          {primaryLabel}
        </button>
        {!status.failed && !stepping ? (
          <button type="button" className="studio-link" onClick={() => run({ action: "step_week" })} disabled={busy !== null}>
            Прожить неделю
          </button>
        ) : null}
      </div>
      {status.replay.diverged ? <Alert className="studio-alert" type="info" showIcon title={DIVERGED_TEXT} /> : null}
      {error !== null ? <Alert className="studio-alert" type="error" showIcon title={error} /> : null}
      <div className="sim-player-foot">
        <p className="studio-disclaimer" data-testid="studio-disclaimer">
          <ExperimentOutlined aria-hidden="true" /> Учебный рынок · деньги не списываются
        </p>
        <Button className="studio-go-real" onClick={() => void confirmGoReal()} disabled={stepping}>
          Запустить по-настоящему
        </Button>
      </div>

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
