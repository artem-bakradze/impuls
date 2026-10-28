# Domain and invariants

Specs: `openspec/changes/bootstrap-ad-autopilot-mvp/specs/*/spec.md`.

## Terms

- **Direction** — «группа услуг × канал» (Поиск / Сайты-партнёры) = one platform campaign (`campaigns` table).
- **ЦСО** — target cost per lead. The user's goal is used as is and never changed automatically; only the
  «подберите сами» mode recalculates it (median of 30 days after 20 leads, capped at reference × 1.5).
- **Lead (обращение)** — Metrika goal conversion; **client** — confirmed weekly by the owner.

## Money

- Integer kopecks everywhere; budgets entered in whole rubles, with VAT.
- **Month budget** = monthly budget, prorated by remaining days in the launch month (rounded down to rubles).
- **Platform-side protection**: `spent + Σ weekly limits × weeks left (partial = full) ≤ 0.9 × month budget`.
- Hourly thresholds: 80% → notify once, 95% → PauseAll until the 1st.

## Classification (14-day window)

| Class | Rule |
| --- | --- |
| learning | age < 7 days or spend < 2 × ЦСО |
| ineffective | spend ≥ 3 × ЦСО and (no leads or cost per lead ≥ 2 × ЦСО) |
| effective | ≥ 3 leads and cost per lead ≤ 0.7 × ЦСО |
| borderline | everything else |

## Guardrails for automated actors

+20% per step and once per 3 days; no growth above ЦСО; strategy only from the adapter catalog, once per 7 days;
no pausing the last ad without a replacement; no repeating what the user reverted/declined for 14 days;
no resuming ineffective objects; agents cannot change mini-sites, finish experiments, PauseAll/ResumeAll.

## Safety net (24 h after evaluation)

Pauses ineffective objects the agent did not handle (resumes do not count as handling), scales effective
directions that use ≥ 90% of the limit, redistributes freed money by leads, starts an experiment for ads
borderline for 7 days. Agent limits: 20 actions/day, 30 calls/turn.

## Experiments

Beta(1,1) per variant, Monte Carlo seeded by experiment ID. Winner: P ≥ 90% and ≥ 100 clicks each, 7–21 days;
early stop if P(worse) ≥ 97%; after 21 days without a winner keep the cheaper (tie → control).
