"use client";

import { ExperimentOutlined, TrophyOutlined } from "@ant-design/icons";
import { Progress } from "antd";
import { formatLocalDate, formatRub } from "@/lib/format";
import { experimentProgress } from "@/lib/experiments-model";
import type { ExperimentItem, ExperimentsModel, ExperimentVariant } from "@/lib/experiments-model";
import { Chip, Empty, PageHead } from "../ui/primitives";

function Variant({ label, v, accent }: { label: string; v: ExperimentVariant; accent?: boolean }) {
  return (
    <div className="surface" style={{ padding: 14, boxShadow: "none", background: accent ? "var(--accent-soft)" : "var(--surface-2)", borderColor: accent ? "transparent" : undefined }}>
      <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
        <span className="t-eyebrow">{label}</span>
        <span style={{ fontWeight: 600 }}>«{v.title}»</span>
        <span className="t-small t-num">
          переходов на сайт {v.clicks} · обращений {v.leads} · потрачено {formatRub(v.spend)}
        </span>
      </div>
    </div>
  );
}

function ExperimentCard({ item, model }: { item: ExperimentItem; model: ExperimentsModel }) {
  return (
    <article className="surface surface-pad" data-testid="experiment">
      <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
        <div className="row" style={{ "--gap": "10px", flexWrap: "nowrap", alignItems: "flex-start" } as React.CSSProperties}>
          <span className={`icon-tile ${item.status === "running" ? "accent" : "success"}`}>{item.status === "running" ? <ExperimentOutlined /> : <TrophyOutlined />}</span>
          <div className="stack" style={{ "--gap": "4px", flex: 1 } as React.CSSProperties}>
            <span className="t-h3">{item.hypothesis}</span>
            <span className="t-small">
              {item.direction} · с {formatLocalDate(item.startedOn)}
              {item.status === "running" ? ` · идёт ${item.day}-й день из ${model.maxDays} максимум` : ""}
            </span>
          </div>
          {item.status === "running" ? <Chip tone="accent">Идёт</Chip> : <Chip tone="success">Завершено</Chip>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <Variant label="Сейчас" v={item.control} />
          {item.variant ? <Variant label="Новый вариант" v={item.variant} accent /> : null}
        </div>
        {item.status === "running" ? (
          <>
            <Progress percent={experimentProgress(item, model)} size="small" showInfo={false} />
            <span className="t-small">
              Вывод делаем не раньше чем через {model.minDays} дней и когда у каждого варианта наберётся хотя бы {model.minClicks} переходов. Если за {model.maxDays} день
              разница не проявится, оставим вариант, где обращение обходится дешевле.
            </span>
          </>
        ) : (
          <div className="note note-success">{item.outcome ?? "Итог записан в истории изменений"}</div>
        )}
      </div>
    </article>
  );
}

export function ExperimentsView({ model }: { model: ExperimentsModel }) {
  return (
    <div className="page page-narrow">
      <PageHead
        title="Эксперименты"
        lead={`Когда объявление работает «так себе», сервис сравнивает его с новым вариантом на равной части показов и оставляет тот, что приводит клиентов дешевле. Общие расходы при этом не растут. Одновременно идёт не больше ${model.maxActive} проверок.`}
      />
      <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
        {model.running.length === 0 ? (
          <div className="surface">
            <Empty icon={<ExperimentOutlined aria-hidden="true" />} title="Сейчас ничего не проверяем">
              Проверка начнётся сама, когда у какого-нибудь объявления результаты окажутся на грани.
            </Empty>
          </div>
        ) : null}
        {model.running.map((item) => (
          <ExperimentCard key={item.id} item={item} model={model} />
        ))}
        {model.finished.length > 0 ? (
          <h2 className="t-h2" style={{ marginTop: 12 }}>
            Уже проверили
          </h2>
        ) : null}
        {model.finished.map((item) => (
          <ExperimentCard key={item.id} item={item} model={model} />
        ))}
      </div>
    </div>
  );
}
