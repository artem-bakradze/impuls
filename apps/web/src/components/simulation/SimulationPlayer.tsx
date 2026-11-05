"use client";

import { ExperimentOutlined, MoreOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import type { PeriodAdInput, PeriodDays } from "@impuls/worker/simulation-period";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";
import { PeriodDialog } from "./PeriodDialog";

/** Whether a period goes: the step runs or the service reviews it. */
export const isStepping = (status: SimulationStatus): boolean => status.status === "stepping" || status.agentTurn;

/**
 * The simulation's player on «Реклама» (simulation-mode spec «Симуляция как отдельный режим»), under the review on a
 * wide screen and over the answer on a narrow one: the day and its state, one main button «Добавить статистику» that
 * opens the window of the next period, and at its foot the training market's note with the real launch as a secondary
 * button; «Начать заново» is in its menu. Time moves only by the owner's periods, and the run has no end.
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
  act: (control: SimulationAction, onAccepted?: () => void) => Promise<{ code: string; message: string } | null>;
}) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [modal, modalHolder] = Modal.useModal();
  const stepping = isStepping(status);
  const first = status.periods === 0 && !stepping && !status.failed;
  const tag = status.failed ? "прерван" : stepping ? "идёт" : first ? "впереди" : "прожит";

  const run = (control: SimulationAction) => void act(control);
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
  // The window closes once the server took the period; a refusal stays in it.
  const sendPeriod = (days: PeriodDays, ads: PeriodAdInput[]) => act({ action: "period", days, ads }, () => setPeriodOpen(false));

  const primaryLabel = status.failed ? "Продолжить расчёт" : stepping ? "Сервис разбирает…" : "Добавить статистику";
  const primary = () => (status.failed ? run({ action: "continue" }) : setPeriodOpen(true));

  return (
    <section className="sim-player panel" aria-label="Симуляция" data-testid="sim-player">
      {modalHolder}
      <div className="sim-player-head">
        <div className="studio-day">
          <span className="studio-day-num" data-testid="studio-day">
            День {status.day}
          </span>
          <span className={`studio-tag ${status.failed ? "bad" : stepping ? "live" : first ? "muted" : "done"}`} data-testid="studio-status">
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
      </div>
      {error !== null ? <Alert className="studio-alert" type="error" showIcon title={error} /> : null}
      <div className="sim-player-foot">
        <p className="studio-disclaimer" data-testid="studio-disclaimer">
          <ExperimentOutlined aria-hidden="true" /> Учебный рынок · деньги не списываются
        </p>
        <Button className="studio-go-real" onClick={() => void confirmGoReal()} disabled={stepping}>
          Запустить по-настоящему
        </Button>
      </div>

      {periodOpen ? <PeriodDialog status={status} onClose={() => setPeriodOpen(false)} onSend={sendPeriod} /> : null}
      <Modal
        open={restartOpen}
        title="Начать симуляцию заново?"
        onCancel={() => setRestartOpen(false)}
        okText="Начать заново"
        cancelText="Отмена"
        onOk={() => {
          setRestartOpen(false);
          run({ action: "restart" });
        }}
      >
        <p className="t-body t-muted">Цифры и история симуляции удалятся, а реклама начнётся с первого дня с теми же объявлениями.</p>
      </Modal>
    </section>
  );
}
