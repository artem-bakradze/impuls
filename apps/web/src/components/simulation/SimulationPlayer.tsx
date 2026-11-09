"use client";

import { ExperimentOutlined, LoadingOutlined, MoreOutlined, PlusOutlined, RedoOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import type { PeriodAdInput, PeriodDays } from "@impuls/worker/simulation-period";
import { PLAYER_MENU } from "@/lib/simulation-model";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";
import { PeriodDialog } from "./PeriodDialog";

/** Whether a period goes: the step runs or the service reviews it. */
export const isStepping = (status: SimulationStatus): boolean => status.status === "stepping" || status.agentTurn;

/**
 * The simulation's player on «Реклама» (simulation-mode spec «Симуляция как отдельный режим»): a dark strip over the
 * answer and the review on every screen — «Симуляция · День N», the training market's note, one main button «Добавить
 * статистику» that opens the window of the next period and also says when a period is being reviewed or broke off, and
 * the menu with «Начать заново» and «Новая кампания». There is no «Запустить по-настоящему», a demo has no real ads
 * (demo-login). Time moves only by the owner's periods.
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

  const run = (control: SimulationAction) => void act(control);
  /** «Новая кампания»: everything of the simulation goes, and the preparation starts from the site again. */
  const confirmNewCampaign = () =>
    modal.confirm({
      title: "Начать новую кампанию?",
      content: "Цифры, история и объявления симуляции удалятся вместе с описанием бизнеса. Вы заново пройдёте подготовку: сайт, описание бизнеса, бюджет и объявления.",
      okText: "Начать новую кампанию",
      cancelText: "Отмена",
      icon: (
        <span className="dialog-mark dialog-mark-warn" aria-hidden="true">
          <PlusOutlined />
        </span>
      ),
      className: "dialog dialog-confirm",
      okButtonProps: { className: "dialog-dark" },
      onOk: () => act({ action: "new_campaign" }),
    });
  const menu: MenuProps = {
    items: PLAYER_MENU.map(({ action, label }) => ({ key: action, label, disabled: stepping })),
    onClick: ({ key }) => {
      if (key === "restart") setRestartOpen(true);
      if (key === "new_campaign") void confirmNewCampaign();
    },
  };
  // The window closes once the server took the period; a refusal stays in it.
  const sendPeriod = (days: PeriodDays, ads: PeriodAdInput[]) => act({ action: "period", days, ads }, () => setPeriodOpen(false));

  const primaryLabel = status.failed ? "Продолжить расчёт" : stepping ? "Сервис разбирает…" : "Добавить статистику";
  const primary = () => (status.failed ? run({ action: "continue" }) : setPeriodOpen(true));

  const primaryIcon = status.failed ? <RedoOutlined aria-hidden="true" /> : stepping ? <LoadingOutlined aria-hidden="true" /> : <PlusOutlined aria-hidden="true" />;

  return (
    <section className="sim-player" aria-label="Симуляция" data-testid="sim-player">
      {modalHolder}
      <div className="sim-player-main">
        <div className="studio-day">
          <span className="studio-day-label">Симуляция</span>
          <span className="studio-day-num" data-testid="studio-day">
            День {status.day}
          </span>
        </div>
        <p className="studio-disclaimer" data-testid="studio-disclaimer">
          <ExperimentOutlined aria-hidden="true" /> Учебный рынок · деньги не списываются
        </p>
      </div>
      <div className="sim-player-actions">
        <button type="button" className="studio-primary" onClick={primary} disabled={stepping || busy !== null}>
          {primaryIcon}
          {primaryLabel}
        </button>
        <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
          <Button type="text" icon={<MoreOutlined aria-hidden="true" />} aria-label="Ещё: начать заново, новая кампания" className="studio-menu" />
        </Dropdown>
      </div>
      {error !== null ? <Alert className="studio-alert" type="error" showIcon title={error} /> : null}

      {periodOpen ? <PeriodDialog status={status} onClose={() => setPeriodOpen(false)} onSend={sendPeriod} /> : null}
      <Modal
        open={restartOpen}
        title={
          <span className="dialog-title">
            <span className="dialog-mark dialog-mark-warn" aria-hidden="true">
              <RedoOutlined />
            </span>
            Начать симуляцию заново?
          </span>
        }
        className="dialog"
        okButtonProps={{ className: "dialog-dark" }}
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
