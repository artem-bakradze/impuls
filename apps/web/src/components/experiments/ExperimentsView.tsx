"use client";

import { Card, Empty, Flex, Progress, Tag, Typography } from "antd";
import { formatLocalDate, formatRub } from "@/lib/format";
import { experimentProgress } from "@/lib/experiments-model";
import type { ExperimentItem, ExperimentsModel, ExperimentVariant } from "@/lib/experiments-model";

function VariantLine({ label, v }: { label: string; v: ExperimentVariant }) {
  return (
    <Typography.Text>
      {label} «{v.title}»: переходов на сайт {v.clicks}, обращений {v.leads}, потрачено {formatRub(v.spend)}
    </Typography.Text>
  );
}

function ExperimentCard({ item, model }: { item: ExperimentItem; model: ExperimentsModel }) {
  return (
    <Card size="small" data-testid="experiment">
      <Flex vertical gap={6}>
        <Typography.Text strong>{item.hypothesis}</Typography.Text>
        <Typography.Text type="secondary">
          {item.direction} · с {formatLocalDate(item.startedOn)}
          {item.status === "running" ? ` · идёт ${item.day}-й день из ${model.maxDays} максимум` : ""}
        </Typography.Text>
        <VariantLine label="Сейчас" v={item.control} />
        {item.variant ? <VariantLine label="Новый вариант" v={item.variant} /> : null}
        {item.status === "running" ? (
          <>
            <Progress percent={experimentProgress(item, model)} size="small" />
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Вывод делаем не раньше чем через {model.minDays} дней и когда у каждого варианта наберётся хотя бы {model.minClicks} переходов. Если за {model.maxDays} день
              разница не проявится, оставим вариант, где обращение обходится дешевле.
            </Typography.Text>
          </>
        ) : (
          <Flex gap={8} align="center" wrap>
            <Tag color="purple">Завершено</Tag>
            <Typography.Text>{item.outcome ?? "Итог записан в истории изменений"}</Typography.Text>
          </Flex>
        )}
      </Flex>
    </Card>
  );
}

export function ExperimentsView({ model }: { model: ExperimentsModel }) {
  return (
    <Flex vertical gap={16}>
      <Typography.Title level={2} style={{ margin: 0 }}>
        Проверяем
      </Typography.Title>
      <Typography.Paragraph style={{ margin: 0 }}>
        Когда объявление работает «так себе», сервис сравнивает его с новым вариантом на равной части показов и оставляет тот, что приводит клиентов дешевле. Общие расходы
        при этом не растут. Одновременно идёт не больше {model.maxActive} проверок.
      </Typography.Paragraph>
      {model.running.length === 0 ? <Empty description="Сейчас ничего не проверяем" /> : null}
      {model.running.map((item) => (
        <ExperimentCard key={item.id} item={item} model={model} />
      ))}
      {model.finished.length > 0 ? (
        <Typography.Title level={4} style={{ margin: 0 }}>
          Уже проверили
        </Typography.Title>
      ) : null}
      {model.finished.map((item) => (
        <ExperimentCard key={item.id} item={item} model={model} />
      ))}
    </Flex>
  );
}
