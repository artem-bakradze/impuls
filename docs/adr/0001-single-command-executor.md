# ADR 0001: Single command executor with a journal written before the platform call

Status: accepted (design.md D3).

**Context.** The agent, safety net, budget guard, reconciliation and the user change the same campaigns.
Budget checks on a hypothetical state can pass individually and fail together; a crash between the platform
call and the journal write leaves changes invisible in the history.

**Decision.** Only the worker executes commands, under a per-business session advisory lock. Guards run on the
current state; the change is logged as `pending` in its own commit before the platform call and resolved to
`applied`/`failed`; stuck `pending` entries are recovered by reading the platform.

**Consequences.** Commands of one business are serialized; web only enqueues jobs; history and rollback come
from one mechanism. Alternative rejected: a queue per business (more moving parts, same guarantee).
