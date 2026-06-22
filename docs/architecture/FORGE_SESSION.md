# Forge Session

**Version:** 1.0
**Status:** Active

---

# Purpose

This document defines the standard sequence for every Forge development session.

The goal is consistency.

Every session should begin, execute, and end using the same disciplined process.

---

# Session Boot

Before implementation begins:

* Review `FORGE_STARTUP_CHECKLIST.md`
* Confirm current development phase
* Confirm today's architectural objective
* Verify repository state with `git status`
* Review recent commits if context is needed
* Identify the file to inspect

No implementation begins until boot is complete.

---

# Standard Development Cycle

Every implementation follows this sequence:

1. Inspect the target file from the terminal.
2. Paste the current file into ChatGPT.
3. Review architecture before proposing changes.
4. Open the file with Nano.
5. Replace the entire file unless a small surgical edit is explicitly justified.
6. Verify the saved file from the terminal.
7. Run targeted tests when appropriate.
8. Run the full test suite.
9. Run a production build when applicable.
10. Review Git status and diffs.
11. Commit one architectural objective.
12. Push.
13. Verify a clean working tree.

---
# Execution Cadence

The AI and the human execute work in a fixed cadence.

The cadence must not be skipped or reordered.

For implementation work the sequence is:

1. AI identifies the file to inspect.
2. AI provides one terminal inspection command.
3. Human pastes the file contents from the terminal.
4. AI reviews the actual implementation before proposing changes.
5. AI provides one Nano command.
6. Human opens the file.
7. AI provides a complete replacement when appropriate.
8. Human saves the file.
9. AI requests verification from the terminal.
10. Human runs verification and shares the results.
11. AI requests the appropriate tests.
12. Human runs the tests and shares the results.
13. AI performs Git review before staging or committing.

The AI must never assume a file's contents.

The AI must never prepare edits before inspecting the current implementation.

Repository output always overrides assumptions.

The human controls execution.

The AI controls architecture and review.

Both follow the same cadence every session.
---
# Session Rules

* Never assume file contents.
* Never guess imports or paths.
* Never skip inspection.
* Never mix unrelated objectives into one commit.
* Repository output is the source of truth.
* Green tests are required but not sufficient.
* Architecture always takes priority over speed.

---

# Session Closeout

Before ending a session:

* Confirm current phase.
* Record completed objective.
* Verify test status.
* Verify Git synchronization.
* Identify the next recommended objective.
* Prepare a continuation paste when moving to a new chat.

---

# Success Criteria

A successful Forge session ends with:

* Clean architecture
* Passing tests
* Clean Git history
* Updated documentation when required
* A synchronized repository
* A clear next objective

Every session should leave the repository easier to understand than it was at the beginning.
