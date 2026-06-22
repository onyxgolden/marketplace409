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
2. Provide exactly one terminal command.
3. Edit using Nano.
4. Verify using `cat`.
5. Run targeted tests.
6. Run full test suite.
7. Run production build.
8. Commit.
9. Push.
10. Verify clean working tree.

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
