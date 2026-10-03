# Satpad

Satpad is a memecoin launchpad on Solana. Every coin is a pump.fun coin quoted in BTC. The spec is SPEC.md and it is the source of truth. You never edit SPEC.md; propose changes in DECISIONS.md. The full workflow is in WORKFLOW.md.

## How to work

Follow the loop in order every time:
1. Read CLAUDE.md, STATUS.md, VERIFIED.md, and the SPEC.md section for the current milestone.
2. Write or confirm the task plan in STATUS.md. Show it and wait if it is new.
3. Before any task that uses a mint address, program id, fee value, instruction account list, or external API shape, check VERIFIED.md. If the item is missing, verify it against a live source (pump.fun SDK on npm, pump-public-docs on GitHub, NEAR Intents API docs, Solana explorers), record the answer with URL and date in VERIFIED.md, then proceed. Never fill these from memory.
4. Implement one task with its test. Run tests, lint, typecheck.
5. Re-read the spec paragraph you implemented. Fix gaps or log them in DECISIONS.md.
6. Update STATUS.md and the package MILESTONE.md.
7. Commit: one task per commit, message "m<N>: <task>". No secrets. No red tests. Push to origin/main after every commit so GitHub is always current.
8. Report in a few lines and continue to the next task.
9. When the plan is empty, run the milestone definition of done from SPEC.md. Green: advance STATUS.md to the next milestone and stop for review. Red: add failures to the plan.

## Stop and ask a human before
- Changing split bounds, authorities, recovery address, or Reserve mechanics
- Any mainnet transaction or deploy
- Adding a dependency or service not named in SPEC.md
- Pinning the BTC quote mint

## Conventions
- Monorepo: pnpm workspaces, TypeScript strict, Node 22. Program in Anchor 0.30+.
- All token amounts are bigint in base units. Never floats for money.
- Every keeper or admin action is a script in scripts/ with a dry-run flag. No admin UI.
- Env vars for secrets and RPC URLs. .env.example is kept current.
- Tests: Anchor tests use bankrun. TS tests use vitest. Each package has `pnpm test`.
- Commit messages: m<N>: imperative summary. Reference the spec section when useful.
- Subagents run on Sonnet (`model: "sonnet"`).

## Session end
When context is nearly full or you are told to stop: rewrite STATUS.md so a new session can resume without this chat, commit it, and stop.
