/** Plain-language explanations for safety-net, budget-guard and reconciliation actions (design decision 4). */
const rub = (kopecks: number): string => `${Math.floor(kopecks / 100).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

export type TemplateFacts = Record<string, string | number>;

const templates: Record<string, (f: TemplateFacts) => string> = {
  SAFETY_PAUSE_AD: (f) =>
    `Отключил объявление «${f.name}»: за 2 недели оно потратило ${rub(Number(f.spend))} и привело обращений: ${f.leads}. Это слишком дорого при вашей цели ${rub(Number(f.cso))} за обращение. Эти деньги пойдут на объявления, которые работают.`,
  SAFETY_PAUSE_DIRECTION: (f) =>
    `Остановил направление «${f.name}»: за 2 недели оно потратило ${rub(Number(f.spend))}, а обращения в нём слишком дорогие. Деньги перешли в направления, которые приводят клиентов.`,
  SAFETY_SCALE_EFFECTIVE: (f) =>
    `Выделил направлению «${f.name}» больше денег: оно приводит клиентов по ${rub(Number(f.cpl))} при цели ${rub(Number(f.cso))} и тратило почти весь лимит.`,
  SAFETY_REDISTRIBUTE_FREED: (f) => `Передал направлению «${f.name}» деньги из остановленных направлений: здесь клиенты обходятся дешевле.`,
  SAFETY_START_EXPERIMENT: (f) => `Запустил проверку для объявления «${f.name}»: сравню его с новым вариантом и оставлю тот, что приводит клиентов дешевле.`,
  BUDGET_FIT: (f) => `Снизил лимит направления «${f.name}» до ${rub(Number(f.limit))} в неделю, чтобы не выйти за ваш бюджет на месяц.`,
  BUDGET_PAUSE_SHORTAGE: (f) => `Поставил на паузу направление «${f.name}»: остатка бюджета на этот месяц хватает только на самые выгодные направления.`,
  BUDGET_EXHAUSTED: () => "Бюджет на этот месяц почти израсходован — реклама остановлена до 1-го числа.",
  BUDGET_NEW_MONTH: () => "Начался новый месяц — реклама снова включена.",
  CABINET_LIMIT_CLAMP: (f) =>
    `В кабинете Директа лимит подняли до ${rub(Number(f.raised))}. Я снизил его до ${rub(Number(f.limit))}, чтобы не выйти за ваш бюджет на месяц. Если хотите тратить больше, увеличьте бюджет в настройках.`,
  CABINET_STRATEGY_RESTORE: (f) => `В кабинете Директа сменили стратегию на такую, при которой нельзя ограничить расходы. Я вернул прежнюю стратегию направления «${f.name}».`,
  CABINET_CHANGE: (f) => `Изменено в кабинете Директа: ${f.what}.`,
};

export const renderTemplate = (reasonCode: string, facts: TemplateFacts): string => {
  const template = templates[reasonCode];
  if (!template) {
    throw new Error(`No explanation template for reason code ${reasonCode}`);
  }
  return template(facts);
};

export const templateCodes = (): string[] => Object.keys(templates);

/** Sample facts used to render every template in the jargon test. */
export const sampleFacts: TemplateFacts = {
  name: "Маникюр — Поиск",
  spend: 240_000,
  leads: 0,
  cso: 80_000,
  cpl: 52_000,
  limit: 310_000,
  raised: 1_000_000,
  what: "текст объявления «Маникюр у метро»",
};
