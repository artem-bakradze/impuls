"use client";

import { Alert, Button, Card, Checkbox, Flex, Tabs, Typography } from "antd";
import { GOAL_OPTIONS, hasOwnSite } from "@/lib/onboarding";
import type { StepProps } from "./Wizard";

const BUILDER_STEPS: { key: string; label: string; steps: string[] }[] = [
  { key: "tilda", label: "Tilda", steps: ["Откройте «Настройки сайта» → «Аналитика».", "В поле «Яндекс Метрика» вставьте номер счётчика.", "Нажмите «Сохранить» и переопубликуйте все страницы."] },
  { key: "wix", label: "Wix", steps: ["Откройте «Настройки» → «Пользовательский код».", "Нажмите «Добавить код», вставьте код в раздел «Head», выберите «Все страницы».", "Сохраните и опубликуйте сайт."] },
  { key: "wordpress", label: "WordPress", steps: ["Установите плагин «Яндекс Метрика» или откройте «Внешний вид» → «Редактор тем».", "Вставьте код перед закрывающим тегом </head> в файле header.php или укажите номер счётчика в плагине.", "Сохраните изменения."] },
  { key: "taplink", label: "Taplink", steps: ["Откройте «Настройки» → «Статистика».", "В поле «Яндекс Метрика» вставьте номер счётчика.", "Сохраните изменения."] },
];

export function GoalsStep({ draft, onChange }: StepProps) {
  return (
    <Flex vertical gap={16}>
      <Typography.Paragraph style={{ margin: 0 }}>
        Что считать обращением — действием, после которого человек может стать вашим клиентом? Можно выбрать несколько вариантов. По ним мы будем считать результаты и
        решать, какие объявления работают.
      </Typography.Paragraph>
      <Checkbox.Group value={draft.goals} onChange={(goals) => onChange({ ...draft, goals })} aria-label="Что считать обращением">
        <Flex vertical gap={8}>
          {GOAL_OPTIONS.map((goal) => (
            <Checkbox key={goal.value} value={goal.value}>
              {goal.label}
            </Checkbox>
          ))}
        </Flex>
      </Checkbox.Group>
      {hasOwnSite(draft) ? (
        <Card size="small" title="Счётчик Яндекс Метрики на вашем сайте">
          <Typography.Paragraph>
            Чтобы считать заявки и звонки с вашего сайта, на него нужно поставить счётчик Яндекс Метрики — небольшой код, который замечает, что посетитель оставил заявку
            или нажал на телефон.
          </Typography.Paragraph>
          <Typography.Paragraph>
            Счётчик создаётся в вашем аккаунте Яндекса, поэтому его номер и код появятся после подключения Яндекса. Вот как его потом поставить:
          </Typography.Paragraph>
          <Tabs
            items={BUILDER_STEPS.map((builder) => ({
              key: builder.key,
              label: builder.label,
              children: (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {builder.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ),
            }))}
          />
          <Flex vertical gap={8} style={{ marginTop: 12 }}>
            <Button disabled>Проверить</Button>
            <Typography.Text type="secondary">Проверка установки появится вместе с подключением Метрики.</Typography.Text>
          </Flex>
          <Alert style={{ marginTop: 12 }} type="warning" showIcon title="Без счётчика обращения с сайта не будут посчитаны. Запустить рекламу это не мешает." />
        </Card>
      ) : null}
    </Flex>
  );
}
