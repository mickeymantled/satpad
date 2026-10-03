# Claude Code workflow

Claude Code builds Satpad one milestone at a time in a fixed loop: load context, plan, verify assumptions, implement, test, record, commit, report. The loop is encoded in a `CLAUDE.md` at the repo root plus three prompt templates; every session starts and ends the same way so progress survives context resets.

## Files that drive the loop

| File | Owner | Purpose |
| --- | --- | --- |
| `CLAUDE.md` | you, written once | Standing rules, the loop, definition of done. Claude Code reads it every session |
| `SPEC.md` | export of the Satpad Spec tab | The source of truth. Claude Code never edits it; it proposes changes in `DECISIONS.md` |
| `STATUS.md` | Claude Code | Current milestone, last completed step, next step, blockers. Rewritten at the end of every session |
| `VERIFIED.md` | Claude Code | The build-time checklist with each item's answer, source URL, and date |
| `DECISIONS.md` | Claude Code, you approve | Append-only log of deviations from the spec and why |
| `packages/*/MILESTONE.md` | Claude Code | What was built, how to run it, what was deferred |

## The loop

1. **Load.** Read `CLAUDE.md`, `STATUS.md`, the spec section for the current milestone, and `VERIFIED.md`. Nothing else until needed
2. **Plan.** Write a numbered task list for the milestone into `STATUS.md` under "Plan". Each task is small enough to finish and test in one go. Stop and show the plan before writing code
3. **Verify.** Any task that touches an item in the verification checklist that has no entry in `VERIFIED.md` is blocked until the item is checked against a live source and recorded. Never fill a mint, program id, fee, or API shape from memory
4. **Implement one task.** Write the code and its test together. Run the test. Run lint and typecheck
5. **Check against spec.** Re-read the spec paragraph the task implements. Any gap is either fixed now or logged in `DECISIONS.md` with a reason
6. **Record.** Mark the task done in `STATUS.md` with the commit hash. Update `MILESTONE.md` for the package touched
7. **Commit.** One commit per task, message `m<N>: <task>`. Never commit secrets, never commit with failing tests
8. **Report.** One short message: task done, tests run, anything deferred, the next task. Then go to step 4, or to step 9 when the plan is empty
9. **Close the milestone.** Run the milestone's definition of done from the spec. If green, update `STATUS.md` to the next milestone and stop for review. If not, add the failing items to the plan and continue

## Session rules

- Start of session: step 1, then say in two lines where things stand and what the next task is. Do not start coding until the plan is confirmed or already confirmed in `STATUS.md`
- End of session (context nearly full, or told to stop): rewrite `STATUS.md` so a fresh session can resume with no chat history, commit it, stop
- Hard stops that need a human: any change to the fee split bounds, authorities, or the Reserve mechanics; any mainnet transaction; any dependency on a service not in the spec; the checklist item for the BTC quote mint
- No scope creep: features not in the spec go to `DECISIONS.md` as proposals, not into code
- Tests before merge, always. A task without a test is not done unless `DECISIONS.md` says why

## CLAUDE.md

Drop this at the repo root as `CLAUDE.md`.

```markdown
# Satpad

Satpad is a memecoin launchpad on Solana. Every coin is a pump.fun coin quoted in BTC. The spec is SPEC.md and it is the source of truth. You never edit SPEC.md; propose changes in DECISIONS.md.

## How to work

Follow the loop in order every time:
1. Read CLAUDE.md, STATUS.md, VERIFIED.md, and the SPEC.md section for the current milestone.
2. Write or confirm the task plan in STATUS.md. Show it and wait if it is new.
3. Before any task that uses a mint address, program id, fee value, instruction account list, or external API shape, check VERIFIED.md. If the item is missing, verify it against a live source (pump.fun SDK on npm, pump-public-docs on GitHub, NEAR Intents API docs, Solana explorers), record the answer with URL and date in VERIFIED.md, then proceed. Never fill these from memory.
4. Implement one task with its test. Run tests, lint, typecheck.
5. Re-read the spec paragraph you implemented. Fix gaps or log them in DECISIONS.md.
6. Update STATUS.md and the package MILESTONE.md.
7. Commit: one task per commit, message "m<N>: <task>". No secrets. No red tests.
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

## Session end
When context is nearly full or you are told to stop: rewrite STATUS.md so a new session can resume without this chat, commit it, and stop.
```

## Prompt templates

**Kickoff (first session)**

```
Read CLAUDE.md and SPEC.md in full. Create STATUS.md with milestone 1 and a task plan, VERIFIED.md with every item from the spec's verification checklist as an open row, and DECISIONS.md empty. Then start the loop at step 3: verify every checklist item milestone 1 depends on. Show me VERIFIED.md before writing any code.
```

**Per-milestone**

```
Start the loop for milestone <N>. Load STATUS.md and the SPEC.md section for it. Show me the plan, then wait for my go.
```

**Resume (any later session)**

```
Resume from STATUS.md. Tell me in two lines where we are and the next task, then continue the loop.
```

**Review gate (you, after each milestone)**

```
Milestone <N> is closed. Before advancing: list every DECISIONS.md entry from this milestone, every test added, and anything deferred. Then run the definition of done again and paste the output.
```

## Definition of done, per milestone

Copied from the spec's milestone list so it lives next to the loop. Claude Code pastes the evidence into `STATUS.md` when closing.

| Milestone | Done when |
| --- | --- |
| 1 Repo and SDK | A coin exists on devnet with `quote_mint = BTC_QUOTE_MINT`, created and bought by a script |
| 2 Vault program | A devnet coin's creator fee settles four ways; bankrun suite green; verifiable build hash recorded |
| 3 Keeper claim and settle | Ten devnet coins settle unattended for 24 hours; ledger rows match chain |
| 4 Indexer and API | `/coins` and `/ledger` match on-chain state for the devnet set |
| 5 Web app core | A user with only SOL launches and trades on devnet from the UI |
| 6 Reserve | LP mint supply is net zero after ten keeper runs |
| 7 Holder rewards | The 50-holder test pays out correctly, snapshot hash on chain |
| 8 Bridge | One round trip native BTC to Solana and back completes |
| 9 Docs and Ledger | Every address on `/docs` resolves on Solscan |
| 10 Audit and mainnet | Audit fixes merged, multisig deploy, $SATPAD launched, allowlist run complete |
