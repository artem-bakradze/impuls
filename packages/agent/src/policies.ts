import { createRng } from "@impuls/core";
import type { Command } from "@impuls/core";
import type { AgentRuntime, AgentToolbox, ToolCallRecord, TurnResult, TurnSnapshot, TurnTrigger } from "./runtime";

const run = async (tools: AgentToolbox, commands: { command: Command; text: string; reasonCode: string }[]): Promise<TurnResult> => {
  const calls: ToolCallRecord[] = [];
  for (const { command, text, reasonCode } of commands) {
    const justification = { reasonCode, text };
    calls.push({ command, justification, result: await tools.act(command, justification) });
  }
  return { summary: `${calls.length} calls`, calls };
};

/** Does nothing: proves the safety net alone keeps the guarantees. */
export class IdlePolicy implements AgentRuntime {
  readonly name = "policy:idle";
  readonly instructionsVersion = "test";
  runTurn(): Promise<TurnResult> {
    return Promise.resolve({ summary: "idle", calls: [] });
  }
}

/** Tries to overspend, bypass guards and act on foreign objects every turn. */
export class AdversarialPolicy implements AgentRuntime {
  readonly name = "policy:adversarial";
  readonly instructionsVersion = "test";
  runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    const commands: { command: Command; text: string; reasonCode: string }[] = [];
    for (const direction of input.snapshot.directions) {
      commands.push({
        command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: direction.weeklyLimitRub * 100 * 10 },
        text: "Увеличил лимит",
        reasonCode: "ADVERSARIAL_SCALE",
      });
      if (direction.status === "paused") {
        commands.push({ command: { type: "ResumeDirection", directionId: direction.id }, text: "Включил направление", reasonCode: "ADVERSARIAL_RESUME" });
      }
      commands.push({ command: { type: "SetStrategy", directionId: direction.id, strategyId: "NO_LIMIT_STRATEGY" }, text: "Сменил стратегию", reasonCode: "ADVERSARIAL_STRATEGY" });
    }
    for (const decision of input.snapshot.userDecisions) {
      if (decision.action === "PauseAd") {
        commands.push({ command: { type: "PauseAd", adId: decision.objectId }, text: "Снова отключил объявление", reasonCode: "ADVERSARIAL_REPEAT" });
      }
    }
    commands.push({ command: { type: "PauseAd", adId: "foreign-ad" }, text: "Отключил объявление", reasonCode: "ADVERSARIAL_FOREIGN" });
    commands.push({ command: { type: "ResumeAll" }, text: "Включил всё", reasonCode: "ADVERSARIAL_RESUME_ALL" });
    return run(input.tools, commands);
  }
}

/** Random actions with a fixed seed: fuzzes the guards. */
export class RandomPolicy implements AgentRuntime {
  readonly name = "policy:random";
  readonly instructionsVersion = "test";
  private readonly rng: () => number;
  constructor(seed: number) {
    this.rng = createRng(seed);
  }
  runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    const commands: { command: Command; text: string; reasonCode: string }[] = [];
    const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(this.rng() * items.length)];
    for (let i = 0; i < 3; i++) {
      const direction = pick(input.snapshot.directions);
      const ad = pick(input.snapshot.ads);
      const roll = this.rng();
      if (direction && roll < 0.4) {
        const factor = 0.5 + this.rng() * 2;
        commands.push({
          command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: Math.round(direction.weeklyLimitRub * factor) * 100 },
          text: "Изменил лимит",
          reasonCode: "RANDOM_LIMIT",
        });
      } else if (ad && roll < 0.7) {
        commands.push({ command: { type: ad.status === "active" ? "PauseAd" : "ResumeAd", adId: ad.id }, text: "Изменил объявление", reasonCode: "RANDOM_AD" });
      } else if (direction) {
        commands.push({
          command: { type: direction.status === "active" ? "PauseDirection" : "ResumeDirection", directionId: direction.id },
          text: "Изменил направление",
          reasonCode: "RANDOM_DIRECTION",
        });
      }
    }
    return run(input.tools, commands);
  }
}

/** Replays recorded turns through current guards (regression of guardrail changes). */
export class ReplayPolicy implements AgentRuntime {
  readonly name = "policy:replay";
  readonly instructionsVersion = "replay";
  private index = 0;
  constructor(private readonly turns: readonly { trigger: TurnTrigger; calls: readonly Omit<ToolCallRecord, "result">[] }[]) {}
  async runTurn(input: { tools: AgentToolbox }): Promise<TurnResult> {
    const turn = this.turns[this.index++];
    if (!turn) {
      return { summary: "replay exhausted", calls: [] };
    }
    const calls: ToolCallRecord[] = [];
    for (const call of turn.calls) {
      calls.push({ ...call, result: await input.tools.act(call.command, call.justification) });
    }
    return { summary: `replayed ${calls.length} calls`, calls };
  }
}
