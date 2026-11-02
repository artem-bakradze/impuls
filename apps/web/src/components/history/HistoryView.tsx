"use client";

import { BulbOutlined, DesktopOutlined, DownOutlined, HistoryOutlined, NodeIndexOutlined, RobotOutlined, RollbackOutlined, SafetyCertificateOutlined, UpOutlined, UserOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { formatDateTime, formatLocalDate, formatRub, plural } from "@/lib/format";
import { AUTHOR_LABELS, foldBudgetAdjustments, newestFirst } from "@/lib/history-view";
import type { BudgetGroup, HistoryAuthor, HistoryItem, Names } from "@/lib/history-view";
import { InsightCard } from "../insights/InsightFeed";
import { Chip, Empty, PageHead } from "../ui/primitives";
import { RollbackDialog } from "./RollbackDialog";

const AVATARS: Record<HistoryAuthor, ReactNode> = {
  service: <RobotOutlined />,
  user: <UserOutlined />,
  cabinet: <DesktopOutlined />,
};


export function HistoryEntry({ item, timeZone, onRollback }: { item: HistoryItem; timeZone: string; onRollback: (item: HistoryItem) => void }) {
  const [why, setWhy] = useState(false);
  return (
    <li className="feed-item fade-in">
      <span className="feed-avatar" data-author={item.author} aria-hidden="true">
        {AVATARS[item.author]}
      </span>
      <article className="surface feed-card" data-testid="history-entry" id={item.id} style={{ scrollMarginTop: 140 }}>
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
                  {row.label}: было {row.before} → стало {row.after}
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
            {item.insight ? (
              <button type="button" className="link-button" onClick={() => setWhy(!why)} aria-expanded={why}>
                <BulbOutlined aria-hidden="true" /> Почему
              </button>
            ) : null}
            {item.turnId ? (
              <Link href={`/history/turn/${item.turnId}`} style={{ fontSize: 14, fontWeight: 550 }}>
                <NodeIndexOutlined style={{ marginRight: 6 }} />
                Как сервис принял это решение
              </Link>
            ) : null}
          </div>
          {why && item.insight ? <InsightCard card={item.insight} timeZone={timeZone} /> : null}
        </div>
      </article>
    </li>
  );
}

/** One row for a day of budget-guard limit cuts, with every cut inside on demand (change-history spec). */
function BudgetDay({ group, timeZone, monthlyBudgetRub, onRollback }: { group: BudgetGroup; timeZone: string; monthlyBudgetRub: number; onRollback: (item: HistoryItem) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="feed-item fade-in">
      <span className="feed-avatar" data-author="service" aria-hidden="true">
        <SafetyCertificateOutlined />
      </span>
      <article className="surface feed-card" data-testid="history-budget-day">
        <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
          <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
            <span style={{ fontWeight: 600 }}>Защита бюджета</span>
            <Chip tone="accent" plain>
              {AUTHOR_LABELS.service}
            </Chip>
            <span className="spacer" />
            <span className="t-small">{formatLocalDate(group.date)}</span>
          </div>
          <p className="t-body">
            Сколько тратить в день, уменьшали {group.entries.length} {plural(group.entries.length, "раз", "раза", "раз")} — чтобы не выйти за {formatRub(monthlyBudgetRub * 100)} в месяц.
          </p>
          <ul className="diff">
            {group.limits.map((limit) => (
              <li key={limit.object}>
                {limit.object}: было {limit.from} → стало {limit.to}
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <UpOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />} {open ? "Скрыть подробности" : `Все ${group.entries.length} изменений`}
          </button>
          {open ? (
            <ol className="feed" style={{ marginTop: 4 }}>
              {group.entries.map((item) => (
                <HistoryEntry key={item.id} item={item} timeZone={timeZone} onRollback={onRollback} />
              ))}
            </ol>
          ) : null}
        </div>
      </article>
    </li>
  );
}

export function HistoryView({ items, names, timeZone, monthlyBudgetRub }: { items: HistoryItem[]; names: Names; timeZone: string; monthlyBudgetRub: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const visible = useMemo(() => foldBudgetAdjustments(newestFirst(items), timeZone), [items, timeZone]);

  return (
    <div className="page page-narrow">
      <PageHead title="История изменений" lead="Всё, что меняли сервис, вы и кабинет Директа. Любое изменение можно вернуть." />
      {visible.length === 0 ? (
        <div className="surface">
          <Empty icon={<HistoryOutlined aria-hidden="true" />} title="Здесь пока пусто">
            Изменения появятся здесь, как только сервис или вы что-то поменяете.
          </Empty>
        </div>
      ) : (
        <ol className="feed">
          {visible.map((row) =>
            row.kind === "entry" ? (
              <HistoryEntry key={row.item.id} item={row.item} timeZone={timeZone} onRollback={setSelected} />
            ) : (
              <BudgetDay key={row.group.id} group={row.group} timeZone={timeZone} monthlyBudgetRub={monthlyBudgetRub} onRollback={setSelected} />
            ),
          )}
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
