# Forge Session

**Version:** 2.0
**Status:** Active

---

# Purpose

This document defines the standard sequence for every Forge development session.

Its purpose is to ensure that every session strengthens both Financial Forge and the engineering process used to build it.

Consistency is a feature.

Every session should improve the platform, validate the architecture, and leave the repository easier to understand than it was before.

---

# Session Boot

Before implementation begins:

- Review `FORGE_STARTUP_CHECKLIST.md`
- Review governing Forge documents when required
- Confirm the current development phase
- Confirm today's architectural objective
- Verify repository state with `git status`
- Review recent commits if additional context is needed
- Identify the file to inspect

No implementation begins until boot is complete.

---

# Forge V2 Validation Philosophy

Financial Forge follows an architecture-first approach validated through real production use.

Architecture leads.

Reality validates.

Documentation preserves the lessons.

Every major architectural milestone should be validated by at least one thin vertical production feature before significant additional architectural expansion.

The standard validation loop is:

1. Design
2. Implement
3. Build one real feature
4. Stress the architecture
5. Improve the architecture
6. Capture lessons learned
7. Repeat

Production features exist to validate architecture.

Architecture evolves because of production experience.

---

# Standard Development Cycle

Every implementation follows this sequence:

1. Inspect the target file.
2. Review the current implementation.
3. Explain the architectural reasoning.
4. Open the file in Nano.
5. Replace the entire file unless a surgical edit is clearly justified.
6. Verify the saved file from the terminal.
7. Run targeted tests when appropriate.
8. Run the full test suite.
9. Run a production build when applicable.
10. Review Git status.
11. Review Git diff.
12. Perform an architectural review.
13. Commit one architectural objective.
14. Push.
15. Verify a clean working tree.

No quality gate may be skipped without explicit justification.

---

# Execution Cadence

The AI and the human execute work using a disciplined cadence.

The cadence is designed to eliminate assumptions.

For implementation work:

1. AI identifies the file to inspect.
2. AI provides one inspection command.
3. Human shares repository output.
4. AI reviews the actual implementation.
5. AI proposes the architectural change.
6. AI provides one Nano command.
7. Human edits the file.
8. AI requests verification.
9. Human verifies from the terminal.
10. AI requests testing.
11. Human runs the requested tests.
12. AI reviews results.
13. AI performs Git review before staging or committing.

Verified repository output always overrides assumptions.

---

# Session Rules

- Never assume file contents.
- Never guess imports or paths.
- Never skip inspection.
- Never skip verification.
- Never combine unrelated objectives into one commit.
- Green tests are necessary but not sufficient.
- Architecture always takes priority over speed.
- Production experience should influence future architecture.
- Documentation should improve future engineering decisions.

---

# Session Closeout

Before ending a session:

- Confirm the current roadmap phase.
- Record the completed architectural objective.
- Record any architectural lessons learned.
- Verify test status.
- Verify build status.
- Verify Git synchronization.
- Identify the next recommended objective.
- Prepare a continuation paste when moving to a new chat.

Every session should leave the next session with immediate context.

---

# Success Criteria

A successful Forge session ends with:

- Clean architecture
- Production validation when appropriate
- Passing tests
- Passing production build
- Clean Git history
- Updated documentation when appropriate
- A synchronized repository
- A clearly identified next objective

Every completed production feature should strengthen the architecture beneath it.

Every architectural improvement should make future production features easier to build.
