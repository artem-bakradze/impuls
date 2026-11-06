"use client";

import { Alert, Button, Checkbox, InputNumber, Modal, Segmented } from "antd";
import { useState } from "react";
import { checkPeriod, marketLines, PERIOD_DAYS, suggestPeriod } from "@impuls/worker/simulation-period";
import type { PeriodAdInput, PeriodDays, PeriodError, PeriodField, PeriodForm, PeriodMarket } from "@impuls/worker/simulation-period";
import { callApi } from "@/lib/client-api";
import { formatRub, plural } from "@/lib/format";
import { periodDaysText } from "@/lib/simulation-model";
import type { SimulationStatus } from "@/lib/simulation-model";

const DAY_LABELS: Record<PeriodDays, string> = { 1: "1 день", 3: "3 дня", 7: "Неделя", 14: "2 недели" };
const FIELDS: { key: PeriodField; label: string }[] = [
  { key: "impressions", label: "Показы" },
  { key: "clicks", label: "Переходы" },
  { key: "leads", label: "Обращения" },
  { key: "spendRub", label: "Расход, ₽" },
];

type Values = Record<string, Partial<Record<PeriodField, number | null>>>;

/** «Статистика за дни 9–15» (simulation-mode spec «Статистика периода от владельца»). */
export const periodTitle = (day: number, days: PeriodDays): string => `Статистика за ${periodDaysText({ from: day, to: day + days - 1 })}`;

/** The window's numbers as the action sends them: an empty field is zero. */
const rowsOf = (form: PeriodForm, values: Values): PeriodAdInput[] =>
  form.directions.flatMap((d) =>
    d.ads.map((a) => {
      const v = values[a.id] ?? {};
      return { adId: a.id, impressions: v.impressions ?? 0, clicks: v.clicks ?? 0, leads: v.leads ?? 0, spendRub: v.spendRub ?? 0 };
    }),
  );

/**
 * What Direct would have sent for the next period, entered by the owner: the period, and for every ad shown now its
 * impressions, clicks, leads and spend. The window checks the numbers itself with the rules the server checks again;
 * mistakes are said under their field after «Отправить сервису». It is mounted only while open, so every opening starts
 * from the ads and limits of that moment with empty fields.
 */
export function PeriodDialog({
  status,
  onClose,
  onSend,
}: {
  status: SimulationStatus;
  onClose: () => void;
  /** Sends the period with its marks; resolves with the server's refusal, or null once it is accepted (the window then closes). */
  onSend: (days: PeriodDays, ads: PeriodAdInput[], market: PeriodMarket) => Promise<{ code: string; message: string } | null>;
}) {
  const [days, setDays] = useState<PeriodDays>(7);
  // The ads and limits the window opened with: the numbers belong to them, even while the player polls.
  const [form, setForm] = useState<PeriodForm>(status.form);
  const [values, setValues] = useState<Values>({});
  // The last period's marks stay until the owner takes them off (simulation-breakdowns).
  const [market, setMarket] = useState<PeriodMarket>(status.form.market);
  const [errors, setErrors] = useState<PeriodError[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const set = (adId: string, field: PeriodField, value: number | null) => setValues((v) => ({ ...v, [adId]: { ...v[adId], [field]: value } }));
  /** «Заполнить примерно»: plausible numbers of the chosen period and marks in every field, which the owner may correct. */
  const fill = () => {
    setValues(Object.fromEntries(suggestPeriod(form, days, market).map(({ adId, ...numbers }) => [adId, numbers])));
    setErrors([]);
    setRefusal(null);
  };
  const junkExample = form.directions.find((d) => d.junkQuery !== null)?.junkQuery ?? null;
  const entered = rowsOf(form, values);
  const fieldError = (adId: string, field: PeriodField) => errors.find((e) => e.adId === adId && e.field === field)?.message ?? null;

  const send = async () => {
    const ads = rowsOf(form, values);
    const check = checkPeriod(form, days, ads);
    setErrors(check.errors.filter((e) => e.adId !== null || e.directionId !== null));
    setRefusal(null);
    if (check.errors.length > 0) return;
    setSending(true);
    const refused = await onSend(days, ads, market);
    setSending(false);
    if (refused === null) return;
    setRefusal(refused.message);
    if (refused.code === "SIMULATION_ADS_CHANGED") {
      // The advertising changed under the window: it shows the ads and limits of now, the numbers of the ads kept.
      const fresh = await callApi<SimulationStatus>("/api/simulation", "GET");
      if (fresh.kind === "ok") setForm(fresh.body.form);
    }
  };

  return (
    <Modal
      open
      title={periodTitle(status.day, days)}
      onCancel={onClose}
      width={680}
      className="period-dialog"
      footer={[
        <Button key="cancel" onClick={onClose}>
          Отмена
        </Button>,
        <Button key="send" type="primary" loading={sending} onClick={() => void send()} data-testid="period-send">
          Отправить сервису
        </Button>,
      ]}
    >
      <div className="period-body" data-testid="period-dialog">
        <Segmented<PeriodDays>
          block
          value={days}
          onChange={setDays}
          options={PERIOD_DAYS.map((d) => ({ value: d, label: DAY_LABELS[d] }))}
          aria-label="Период"
        />
        <div className="period-hint-row">
          <p className="t-small t-muted period-hint">Сервис получит эти цифры как отчёт Директа за эти дни и сразу разберёт их. Пустое поле — ноль.</p>
          {form.directions.length > 0 ? (
            <Button size="small" onClick={fill} data-testid="period-fill">
              Заполнить примерно
            </Button>
          ) : null}
        </div>
        {form.directions.length > 0 ? (
          <fieldset className="period-market" data-testid="period-market">
            <legend className="period-market-title">Что ещё было за эти дни</legend>
            {junkExample !== null ? (
              <div className="period-mark">
                <Checkbox checked={market.junkQuery} onChange={(e) => setMarket((m) => ({ ...m, junkQuery: e.target.checked }))} aria-describedby="period-mark-junk">
                  Часть денег ушла на ненужный запрос
                </Checkbox>
                <span id="period-mark-junk" className="period-mark-hint">
                  Например, «{junkExample}»: по нему переходят, но не обращаются
                </span>
              </div>
            ) : null}
            <div className="period-mark">
              <Checkbox checked={market.phonesWorse} onChange={(e) => setMarket((m) => ({ ...m, phonesWorse: e.target.checked }))} aria-describedby="period-mark-phones">
                С телефонов обращаются хуже
              </Checkbox>
              <span id="period-mark-phones" className="period-mark-hint">
                Переходят так же, а обращаются реже
              </span>
            </div>
          </fieldset>
        ) : null}
        {refusal !== null ? <Alert type="warning" showIcon title={refusal} /> : null}
        {form.directions.length === 0 ? <p className="period-empty">Сейчас ни одно объявление не показывается</p> : null}
        {form.directions.map((direction) => {
          const over = errors.find((e) => e.directionId === direction.id && e.adId === null)?.message ?? null;
          const lines = marketLines(direction, market, entered, form.from);
          return (
            <section key={direction.id} className="period-dir" aria-label={direction.name}>
              <div className="period-dir-head">
                <span className="period-dir-name">{direction.name}</span>
                <span className="t-small t-muted" data-testid="period-room">
                  до {formatRub(direction.roomRub[days] * 100)} за {days} {plural(days, "день", "дня", "дней")}
                </span>
              </div>
              {lines.map((line) => (
                <p key={line} className="period-market-line" data-testid="period-market-line">
                  {line}
                </p>
              ))}
              {over !== null ? (
                <p className="period-error" role="alert">
                  {over}
                </p>
              ) : null}
              {direction.ads.map((ad) => (
                <div key={ad.id} className="period-ad" data-testid="period-ad">
                  <span className="period-ad-title">{ad.title}</span>
                  <div className="period-fields">
                    {FIELDS.map((f) => {
                      const id = `period-${ad.id}-${f.key}`;
                      const error = fieldError(ad.id, f.key);
                      return (
                        <div key={f.key} className="period-field">
                          <label htmlFor={id}>{f.label}</label>
                          <InputNumber<number>
                            id={id}
                            min={0}
                            precision={0}
                            controls={false}
                            placeholder="0"
                            inputMode="numeric"
                            status={error !== null ? "error" : ""}
                            value={values[ad.id]?.[f.key] ?? null}
                            onChange={(value) => set(ad.id, f.key, value)}
                            aria-describedby={error !== null ? `${id}-error` : undefined}
                          />
                          {error !== null ? (
                            <span id={`${id}-error`} className="period-error">
                              {error}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
