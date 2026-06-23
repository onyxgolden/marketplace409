# Forge Workflow

The Forge is governed by architecture-first development validated by real production use.

## Core Rule

Architecture always wins over speed.

Every change must preserve:

- clean architecture
- passing tests
- passing production build
- clean git history
- repository documentation as source of truth

## Forge V2 Validation Loop

Architecture leads.

Reality validates.

Documentation preserves the lesson.

Every major architectural milestone must be validated by at least one thin vertical production feature before the Forge continues deeper into architecture.

The standard loop is:

1. Design
2. Implement
3. Build one real feature
4. Stress the architecture
5. Improve the architecture
6. Capture lessons
7. Repeat

We do not build architecture endlessly in isolation.

Production code must expose architectural weaknesses before new abstractions are added.

## Documentation Standard

Documentation is not created for documentation's sake.

Documentation exists only to preserve architectural context so future Forge sessions immediately know:

- where we are
- why we built it
- where we are going
- how to safely continue

If documentation does not improve engineering decisions, avoid it.

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

1. Inspect existing files first.
2. Explain architectural reasoning.
3. Provide exactly one terminal command.
4. Edit using Nano.
5. Verify using `cat`.
6. Run targeted tests when applicable.
7. Run full test suite.
8. Run production build.
9. Inspect results.
10. Commit only after green verification.
11. Push only after verification.
12. Verify clean working tree.

No gate may be skipped.

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

