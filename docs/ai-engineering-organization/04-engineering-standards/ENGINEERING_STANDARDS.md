# Engineering Standards

Status: Draft

## Purpose

Establish minimum engineering requirements for all projects and agents.

## Repository-First Workflow

Every engineering task must follow this sequence:

1. Inspect.
2. Understand.
3. Decide.
4. Define scope.
5. Implement.
6. Validate.
7. Review.
8. Record.
9. Commit only after approval.

## Working Tree Safety

Do not:

- reset unrelated work,
- clean the repository without explicit approval,
- overwrite files before inspection,
- stage unrelated changes,
- assume a dirty file belongs to the current task.

## Architecture Standards

- Respect existing domain and application boundaries.
- Avoid duplicate sources of truth.
- Prefer explicit contracts.
- Keep infrastructure concerns outside domain logic.
- Preserve serialization boundaries.
- Avoid browser-side composition of server authority.
- Keep owner and tenant boundaries explicit.
- Document significant architecture decisions.

## Implementation Standards

- Change only what is required.
- Prefer small, reviewable patches.
- Avoid hidden behavior.
- Use meaningful names.
- Preserve backwards compatibility unless removal is approved.
- Add tests for new behavior and regressions.
- Do not silence failures without addressing their cause.

## Validation Standards

Depending on scope, validation may include:

- focused unit tests,
- integration tests,
- full test suite,
- TypeScript checks,
- linting,
- production build,
- runtime verification,
- API verification,
- database verification,
- security verification.

## Documentation Standards

Record:

- what changed,
- why it changed,
- files affected,
- validation performed,
- remaining risks,
- rollback method,
- owner decisions.

## Definition of Done

Work is not complete until:

- implementation matches the approved objective,
- required tests pass,
- no unrelated files were changed,
- documentation is updated where required,
- risks are disclosed,
- the owner receives a clear completion summary.
