"use client";

import { DesktopOutlined, HistoryOutlined, NodeIndexOutlined, RobotOutlined, RollbackOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Select } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { AUTHOR_LABELS, filterHistory, TYPE_LABELS } from "@/lib/history-view";
import type { HistoryAuthor, HistoryFilter, HistoryItem, HistoryType, Names } from "@/lib/history-view";
import { Chip, Empty, PageHead } from "../ui/primitives";
import { RollbackDialog } from "./RollbackDialog";

const PERIODS = [
  { value: 7, label: "За неделю" },
  { value: 30, label: "За месяц" },
  { value: 90, label: "За 3 месяца" },
  { value: 0, label: "За всё время" },
];

const AVATARS: Record<HistoryAuthor, ReactNode> = {
  service: <RobotOutlined />,
  user: <UserOutlined />,
  cabinet: <DesktopOutlined />,
};

/** Filters appear once there is more than one entry to filter. */
const FILTERS_FROM = 2;

export function HistoryEntry({ item, timeZone, onRollback }: { item: HistoryItem; timeZone: string; onRollback: (item: HistoryItem) => void }) {
  return (
    <li className="feed-item fade-in">
      <span className="feed-avatar" data-author={item.author} aria-hidden="true">
        {AVATARS[item.author]}
      </span>
      <article className="surface feed-card" data-testid="history-entry">
        <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
          <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
            <span style={{ fontWeight: 600 }}>{item.object}</span>
            <Chip tone={item.author === "service" ? "accent" : item.author === "cabinet" ? "warning" : "neutral"} plain>
              {AUTHOR_LABELS[item.author]}
            </Chip>
            {item.reverted ? <Chip plain>Отменено</Chip> : null}
            {item.status === "pending" ? <Chip tone="accent">Применяется</Chip> : null}
            {item.status === "failed" ? <Chip tone="danger">Не применилось</Chip> : null}
            <span className="spacer" />
            <span className="t-small">{formatDateTime(item.at, timeZone)}</span>
          </div>
          <p className="t-body">{item.explanation}</p>
          {item.diff.length > 0 ? (
            <ul className="diff">
              {item.diff.map((row) => (
                <li key={row.label}>
                  {row.label}: было «{row.before}» → стало «{row.after}»
                </li>
              ))}
            </ul>
          ) : null}
          {item.outcome ? (
            <p className="t-body">
              <b>Что стало после:</b> {item.outcome}
            </p>
          ) : null}
          <div className="row" style={{ "--gap": "16px" } as React.CSSProperties}>
            {item.rollback.kind === "available" ? (
              <Button icon={<RollbackOutlined aria-hidden="true" />} onClick={() => onRollback(item)}>
                Вернуть как было
              </Button>
            ) : item.reverted ? null : (
              <span className="t-small">{item.rollback.reason}</span>
            )}
            {item.turnId ? (
              <Link href={`/history/turn/${item.turnId}`} style={{ fontSize: 14, fontWeight: 550 }}>
                <NodeIndexOutlined style={{ marginRight: 6 }} />
                Как сервис принял это решение
              </Link>
            ) : null}
          </div>
        </div>
      </article>
    </li>
  );
}

export function HistoryView({ items, names, timeZone }: { items: HistoryItem[]; names: Names; timeZone: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<HistoryFilter>({ author: "all", type: "all", days: null });
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const visible = useMemo(() => filterHistory(items, filter, new Date()), [items, filter]);

  return (
    <div className="page page-narrow">
      <PageHead title="История изменений" lead="Всё, что меняли сервис, вы и кабинет Директа. Любое изменение можно вернуть." />
      {items.length >= FILTERS_FROM ? (
        <div className="row" style={{ "--gap": "8px", marginBottom: 20 } as React.CSSProperties}>
          <Select<HistoryAuthor | "all">
            aria-label="Кто сделал"
            style={{ minWidth: 190 }}
            value={filter.author}
            onChange={(author) => setFilter({ ...filter, author })}
            options={[
              { value: "all", label: "Все авторы" },
              { value: "service", label: "Сделал сервис" },
              { value: "user", label: "Сделали вы" },
              { value: "cabinet", label: "Изменено в кабинете Директа" },
            ]}
          />
          <Select<HistoryType | "all">
            aria-label="Что менялось"
            style={{ minWidth: 160 }}
            value={filter.type}
            onChange={(type) => setFilter({ ...filter, type })}
            options={[{ value: "all", label: "Все изменения" }, ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value: value as HistoryType, label }))]}
          />
          <Select<number> aria-label="За какой период" style={{ minWidth: 150 }} value={filter.days ?? 0} onChange={(days) => setFilter({ ...filter, days: days === 0 ? null : days })} options={PERIODS} />
        </div>
      ) : null}
      {visible.length === 0 ? (
        <div className="surface">
          <Empty icon={<HistoryOutlined aria-hidden="true" />} title="Здесь пока пусто">
            Изменения появятся здесь, как только сервис или вы что-то поменяете.
          </Empty>
        </div>
      ) : (
        <ol className="feed">
          {visible.map((item) => (
            <HistoryEntry key={item.id} item={item} timeZone={timeZone} onRollback={setSelected} />
          ))}
        </ol>
      )}
      {selected ? (
        <RollbackDialog
          item={selected}
          items={items}
          names={names}
          onClose={(changed) => {
            setSelected(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
