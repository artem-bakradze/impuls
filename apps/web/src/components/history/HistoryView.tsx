"use client";

import Link from "next/link";

import { Button, Card, Empty, Flex, Select, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { AUTHOR_LABELS, filterHistory, TYPE_LABELS } from "@/lib/history-view";
import type { HistoryAuthor, HistoryFilter, HistoryItem, HistoryType, Names } from "@/lib/history-view";
import { RollbackDialog } from "./RollbackDialog";

const PERIODS = [
  { value: 7, label: "За неделю" },
  { value: 30, label: "За месяц" },
  { value: 90, label: "За 3 месяца" },
  { value: 0, label: "За всё время" },
];

export function HistoryEntry({ item, timeZone, onRollback }: { item: HistoryItem; timeZone: string; onRollback: (item: HistoryItem) => void }) {
  return (
    <Card size="small" data-testid="history-entry">
      <Flex vertical gap={6}>
        <Space wrap size={6}>
          <Typography.Text type="secondary">{formatDateTime(item.at, timeZone)}</Typography.Text>
          <Tag color={item.author === "service" ? "purple" : item.author === "user" ? "blue" : "gold"}>{AUTHOR_LABELS[item.author]}</Tag>
          {item.reverted ? <Tag>Отменено</Tag> : null}
          {item.status === "pending" ? <Tag color="processing">Применяется</Tag> : null}
          {item.status === "failed" ? <Tag color="red">Не применилось</Tag> : null}
        </Space>
        <Typography.Text strong>{item.object}</Typography.Text>
        <Typography.Text>{item.explanation}</Typography.Text>
        {item.diff.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {item.diff.map((row) => (
              <li key={row.label}>
                {row.label}: было «{row.before}» → стало «{row.after}»
              </li>
            ))}
          </ul>
        ) : null}
        {item.turnId ? (
          <Link href={`/history/turn/${item.turnId}`}>Как сервис принял это решение</Link>
        ) : null}
        {item.outcome ? (
          <Typography.Text>
            <b>Что стало после:</b> {item.outcome}
          </Typography.Text>
        ) : null}
        {item.rollback.kind === "available" ? (
          <Button onClick={() => onRollback(item)} style={{ alignSelf: "flex-start" }}>
            Вернуть как было
          </Button>
        ) : item.reverted ? null : (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {item.rollback.reason}
          </Typography.Text>
        )}
      </Flex>
    </Card>
  );
}

export function HistoryView({ items, names, timeZone }: { items: HistoryItem[]; names: Names; timeZone: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<HistoryFilter>({ author: "all", type: "all", days: null });
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const visible = useMemo(() => filterHistory(items, filter, new Date()), [items, filter]);

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={2} style={{ margin: 0 }}>
        История изменений
      </Typography.Title>
      <Flex gap={8} wrap>
        <Select<HistoryAuthor | "all">
          aria-label="Кто сделал"
          style={{ minWidth: 200 }}
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
        <Select<number>
          aria-label="За какой период"
          style={{ minWidth: 150 }}
          value={filter.days ?? 0}
          onChange={(days) => setFilter({ ...filter, days: days === 0 ? null : days })}
          options={PERIODS}
        />
      </Flex>
      {visible.length === 0 ? <Empty description="Здесь пока пусто" /> : null}
      {visible.map((item) => (
        <HistoryEntry key={item.id} item={item} timeZone={timeZone} onRollback={setSelected} />
      ))}
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
    </Flex>
  );
}
