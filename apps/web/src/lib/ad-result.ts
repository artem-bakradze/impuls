import { formatRub } from "./format";
import type { ShownAd } from "./service-work";

/** The goal word of the period: «цели» once it is the owner's or learned, «ориентира» while the service picks it. */
export type GoalWord = "цели" | "ориентира";

export interface AdResult {
  tone: "good" | "bad" | "neutral";
  text: string;
}

/**
 * An ad's result over 7 days in words, the main figure of its card in the studio (simulation-mode spec «Подписи
 * студии»): its cost per lead against the goal the rules estimate ads with, as the main screen's «дешевле цели на N%».
 */
export const adResult = (ad: Pick<ShownAd, "leads" | "costPerLead">, cso: number, goalWord: GoalWord): AdResult => {
  if (ad.leads === 0 || ad.costPerLead === null) return { tone: "neutral", text: "пока без обращений" };
  if (cso <= 0) return { tone: "neutral", text: `${formatRub(ad.costPerLead)} за обращение` };
  if (ad.costPerLead <= cso) {
    const cheaper = Math.floor(((cso - ad.costPerLead) / cso) * 100);
    if (cheaper < 5) return { tone: "good", text: goalWord === "цели" ? "в цели" : "в пределах ориентира" };
    return { tone: "good", text: `на ${cheaper}% дешевле ${goalWord}` };
  }
  const dearer = Math.ceil(((ad.costPerLead - cso) / cso) * 100);
  return { tone: "bad", text: `на ${dearer}% дороже ${goalWord}` };
};
