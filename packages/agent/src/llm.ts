import OpenAI from "openai";
import { ProxyAgent } from "undici";
import { z } from "zod";

/**
 * One structured-output request: plain instructions, the input text and the zod schema of the answer.
 * Only public business data goes into `input` (AGENTS.md: no personal data, no tokens).
 */
export interface LlmRequest<T> {
  /** Stable name of the task, used in logs and as the JSON schema name. */
  task: string;
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
}

/** Port for text generation and extraction (design: `LlmClient`). Implementations never return unvalidated data. */
export interface LlmClient {
  generate<T>(request: LlmRequest<T>): Promise<T>;
}

export class LlmError extends Error {
  constructor(
    readonly code: "LLM_INVALID_OUTPUT" | "LLM_REFUSED" | "LLM_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface OpenAiLlmOptions {
  apiKey: string;
  model: string;
  /** Optional HTTPS proxy for egress from hosts where OpenAI is not reachable directly. */
  proxyUrl?: string;
  timeoutMs?: number;
}

/** JSON schema for strict structured outputs: zod's draft 2020-12 output without the `$schema` key. */
export const strictJsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
};

/** `LlmClient` on the OpenAI Responses API with strict structured output. One attempt; callers decide on retries. */
export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAiLlmOptions) {
    if (!options.apiKey || !options.model) {
      throw new Error("OpenAI API key and model are required for the LLM client");
    }
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: 0,
      ...(options.proxyUrl !== undefined && { fetchOptions: { dispatcher: new ProxyAgent(options.proxyUrl) } }),
    });
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    let text: string;
    try {
      const response = await this.client.responses.create({
        model: this.options.model,
        instructions: request.instructions,
        input: request.input,
        text: { format: { type: "json_schema", name: request.task, schema: strictJsonSchema(request.schema), strict: true } },
        store: false,
      });
      text = response.output_text;
    } catch (error) {
      throw new LlmError("LLM_UNAVAILABLE", `OpenAI request for ${request.task} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (text.trim() === "") {
      throw new LlmError("LLM_REFUSED", `OpenAI returned no structured output for ${request.task}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LlmError("LLM_INVALID_OUTPUT", `OpenAI returned invalid JSON for ${request.task}`);
    }
    const result = request.schema.safeParse(parsed);
    if (!result.success) {
      throw new LlmError("LLM_INVALID_OUTPUT", `OpenAI output for ${request.task} does not match the schema: ${result.error.message}`);
    }
    return result.data;
  }
}

/** Test double: answers each task from a queue of prepared outputs and records the requests it got. */
export class ScriptedLlmClient implements LlmClient {
  readonly requests: { task: string; input: string }[] = [];

  constructor(private readonly answers: Record<string, unknown[]>) {}

  generate<T>(request: LlmRequest<T>): Promise<T> {
    this.requests.push({ task: request.task, input: request.input });
    const queue = this.answers[request.task];
    const next = queue?.shift();
    if (next === undefined) {
      return Promise.reject(new Error(`No scripted answer left for ${request.task}`));
    }
    const result = request.schema.safeParse(next);
    return result.success ? Promise.resolve(result.data) : Promise.reject(new LlmError("LLM_INVALID_OUTPUT", result.error.message));
  }
}
