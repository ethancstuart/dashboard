# NexusWatch Runbooks

Living operational docs. Linked from production-relevant code; each
file answers a "what do I do when X happens" question.

## Index

- [stripe-go-live.md](./stripe-go-live.md) — switch from test → live keys
- [db-backup.md](./db-backup.md) — Neon PITR + disaster recovery
- [key-rotation.md](./key-rotation.md) — scheduled + emergency rotation
- [staging-setup.md](./staging-setup.md) — adding a stable staging URL
- [mobile-checklist.md](./mobile-checklist.md) — mobile QA before promote
- [cinema-checklist.md](./cinema-checklist.md) — cinema mode regression check
- [external-cctv-policy.md](./external-cctv-policy.md) — third-party iframe / link policy

## Related

- [../OPERATIONAL-KNOWLEDGE.md](../OPERATIONAL-KNOWLEDGE.md) — what has been
  PROVED about how this system behaves, with the evidence and the limits of each
  investigation. Different genre from a runbook: a runbook says what to do, that
  file says what is true. Retractions are made in place.

## Conventions

- Runbooks are short (one screen scroll max). Link to deeper docs if needed.
- Each starts with **when to run** and ends with **rollback**.
- "Last verified" dates are appended whenever the procedure is
  actually executed in anger.
