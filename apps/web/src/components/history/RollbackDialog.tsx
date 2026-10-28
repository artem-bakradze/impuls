"use client";

import { Alert, Button, Flex, List, Modal, Typography } from "antd";
import { useState } from "react";
import { PENDING_TEXT, runWebJob } from "@/lib/client-api";
import { sentence } from "@/lib/format";
import { describeDiff } from "@/lib/history-view";
import type { HistoryItem, Names, Snapshot } from "@/lib/history-view";

/** RollbackResult of the worker's rollback job (dates arrive as strings). */
export type RollbackOutput =
  | { kind: "not_reversible"; reason: string }
  | { kind: "needs_chain"; later: { id: string; explanation: string }[] }
  | { kind: "state_differs"; expected: Snapshot; actual: Snapshot }
  | { kind: "done"; entryIds: string[]; messages: string[] }
  | { kind: "failed"; message: string };

type Phase =
  | { kind: "confirm" }
  | { kind: "running" }
  | { kind: "chain"; later: { id: string; explanation: string }[] }
  | { kind: "differs"; expected: Snapshot; actual: Snapshot; includeLater: boolean }
  | { kind: "done" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

interface Props {
  item: HistoryItem;
  items: readonly HistoryItem[];
  names: Names;
  onClose: (changed: boolean) => void;
  run?: (body: { entryId: string; includeLater?: boolean; confirmDifference?: boolean }) => ReturnType<typeof runWebJob<RollbackOutput>>;
}

/**
 * «Вернуть как было» (change-history spec): consequences before confirming, later changes of the same object
 * rolled back together from the newest, and the Direct cabinet difference shown before overwriting it.
 */
export function RollbackDialog({ item, items, names, onClose, run = (body) => runWebJob<RollbackOutput>("/api/rollback", body) }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const consequences = item.rollback.kind === "available" ? item.rollback.consequences : [];

  const execute = async (includeLater: boolean, confirmDifference: boolean) => {
    setPhase({ kind: "running" });
    const outcome = await run({ entryId: item.id, ...(includeLater ? { includeLater } : {}), ...(confirmDifference ? { confirmDifference } : {}) });
    if (outcome.kind === "pending") return setPhase({ kind: "pending" });
    if (outcome.kind === "error") return setPhase({ kind: "error", message: outcome.message });
    const result = outcome.output;
    switch (result.kind) {
      case "done":
        return setPhase({ kind: "done" });
      case "needs_chain":
        return setPhase({ kind: "chain", later: result.later });
      case "state_differs":
        return setPhase({ kind: "differs", expected: result.expected, actual: result.actual, includeLater });
      case "not_reversible":
        return setPhase({ kind: "error", message: `${sentence(result.reason)}.` });
      case "failed":
        return setPhase({ kind: "error", message: `Не получилось вернуть: ${result.message}` });
    }
  };

  const finished = phase.kind === "done" || phase.kind === "pending";
  const footer = (() => {
    switch (phase.kind) {
      case "confirm":
        return [
          <Button key="cancel" onClick={() => onClose(false)}>
            Отмена
          </Button>,
          <Button key="ok" type="primary" onClick={() => void execute(false, false)}>
            Вернуть как было
          </Button>,
        ];
      case "chain":
        return [
          <Button key="cancel" onClick={() => onClose(false)}>
            Не возвращать
          </Button>,
          <Button key="ok" type="primary" onClick={() => void execute(true, false)}>
            Вернуть всё по порядку
          </Button>,
        ];
      case "differs":
        return [
          <Button key="cancel" onClick={() => onClose(false)}>
            Оставить как сейчас
          </Button>,
          <Button key="ok" type="primary" danger onClick={() => void execute(phase.includeLater, true)}>
            Всё равно вернуть
          </Button>,
        ];
      case "running":
        return [
          <Button key="ok" type="primary" loading>
            Возвращаем…
          </Button>,
        ];
      default:
        return [
          <Button key="close" type="primary" onClick={() => onClose(finished)}>
            Понятно
          </Button>,
        ];
    }
  })();

  const laterItem = (id: string) => items.find((i) => i.id === id);

  return (
    <Modal open title="Вернуть как было?" onCancel={() => onClose(finished)} footer={footer} destroyOnHidden>
      <Flex vertical gap={12}>
        <Typography.Text strong>{item.object}</Typography.Text>
        {phase.kind === "confirm" || phase.kind === "running" ? (
          <>
            <Typography.Text>Что произойдёт:</Typography.Text>
            <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="rollback-consequences">
              {item.diff.map((row) => (
                <li key={row.label}>
                  {row.label}: снова будет «{row.before}»
                </li>
              ))}
              {consequences.map((c) => (
                <li key={c}>{sentence(c)}</li>
              ))}
              <li>Возврат запишется в историю, а бюджет на месяц по-прежнему не будет превышен</li>
            </ul>
          </>
        ) : null}
        {phase.kind === "chain" ? (
          <>
            <Alert type="warning" showIcon title="После этого изменения тот же объект менялся ещё раз" />
            <Typography.Text>Чтобы вернуть как было, сначала отменим более поздние изменения — от последнего к выбранному:</Typography.Text>
            <List
              size="small"
              bordered
              dataSource={phase.later.slice().reverse()}
              renderItem={(later) => <List.Item>{laterItem(later.id)?.explanation ?? later.explanation}</List.Item>}
            />
          </>
        ) : null}
        {phase.kind === "differs" ? (
          <>
            <Alert type="warning" showIcon title="В кабинете Директа сейчас другие настройки, чем мы записали" />
            <List
              size="small"
              bordered
              dataSource={describeDiff(phase.expected, phase.actual, names)}
              renderItem={(row) => (
                <List.Item>
                  {row.label}: у нас записано «{row.before}», в Директе сейчас «{row.after}»
                </List.Item>
              )}
            />
            <Typography.Text>Если вернуть, настройки из кабинета будут заменены.</Typography.Text>
          </>
        ) : null}
        {phase.kind === "done" ? <Alert type="success" showIcon title="Готово — вернули как было. Запись об этом появилась в истории." /> : null}
        {phase.kind === "pending" ? <Alert type="info" showIcon title={PENDING_TEXT} /> : null}
        {phase.kind === "error" ? <Alert type="error" showIcon title={phase.message} /> : null}
      </Flex>
    </Modal>
  );
}
