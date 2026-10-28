# ADR 0002: The agent is a replaceable runtime behind deterministic guards

Status: accepted (design.md D7, D14).

**Context.** Strategies are created and tuned by an LLM agent (OpenAI Agents API, public beta, US data
residency, access restrictions for Russia). Budget and acceptance criteria must not depend on its behaviour.

**Decision.** `AgentRuntime` port; one session per turn; memory in our DB; tools bound to the turn's business;
every action through the command executor; guards, budget guard, safety net and A/B verdicts are pure code.
Tests replace the agent with idle/adversarial/random/replay policies.

**Consequences.** The service stays safe without the agent; switching providers touches one module. The OpenAI
runtime itself waits for the Agents API spike (task 0.6) and the legal check (task 0.7).
