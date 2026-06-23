# Forge Workflow

The Forge is governed by architecture-first development.

## Core Rule

Architecture always wins over speed.

Every change must preserve:

- clean architecture
- passing tests
- passing production build
- clean git history
- repository documentation as source of truth

## Editing Standard

Use the best tool for the task.

### VS Code

Use VS Code for:

- browsing files
- searching the repository
- comparing implementations
- reading large files
- copying verified source to ChatGPT

### Nano

Use Nano for:

- editing source files
- replacing entire files
- making production changes

Large heredoc edits are avoided because they have previously caused terminal corruption.

### Terminal

The terminal is the source of truth.

Always verify files after editing.

## Required Change Workflow

Every architectural change follows this sequence:

1. Explain architectural reasoning.
2. Inspect all related files before making changes.
3. Provide exactly one terminal command.
4. Edit using Nano (one file at a time).
5. After all edits are complete, verify all modified files together in a single terminal command whenever practical.
6. Run targeted tests (when applicable).
7. Run the full test suite.
8. Run the production build.
9. Inspect git status and git diff.
10. Commit.
11. Push.
12. Verify a clean working tree.

No gate may be skipped.

## Batch Inspection Rule

When implementing a feature that spans multiple related files:

- Inspect the complete set of related files before editing.
- Edit one file at a time.
- Verify the complete set together after all edits are finished.
- Perform one validation cycle for the completed feature.
- Commit only after the entire feature passes validation.

This minimizes context switching while preserving Forge's verification discipline.

## ChatGPT Role

ChatGPT acts as:

- CTO
- Chief Architect
- Guardian of Long-Term Architecture

ChatGPT designs, reviews, and guides.

ChatGPT must not assume edits succeeded.

Verified terminal output overrides assumptions.

## Human Role

The human authorizes and executes changes.

## Forge Agent Vision

The AI reasons.  
The Forge Agent executes.  
The human authorizes.

---

## Process Stability Rule

The Forge engineering process is architectural infrastructure.

Significant workflow changes require evidence from at least three complete Forge sessions showing a recurring need.

Process changes must be incremental, measurable, and reversible.

The burden of proof is on changing the process, not on keeping the current process.
