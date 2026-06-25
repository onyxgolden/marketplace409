# FORGE FILE STANDARDS

Version 1.0

---

# Purpose

Define the approved file types, naming conventions, and repository rules used by Financial Forge.

The objective is to prevent build failures, import-analysis errors, and repository instability caused by unsupported or unintended files.

---

# Engineering Principles

Files introduced into the repository must be:

* Supported by the active toolchain.
* Appropriate for their purpose.
* Intentionally named.
* Safe for Vite, Next.js, and Vitest.
* Compatible with the existing project architecture.

No file should exist in the runtime module graph unless its behavior is understood and supported.

---

# Approved Runtime Source Files

Application source code may use:

* `.js`
* `.jsx`
* `.ts`
* `.tsx`
* `.json`
* `.css`

These extensions are considered runtime-safe unless project configuration changes.

---

# Documentation Files

Documentation may use:

* `.md`

Documentation files must never be imported into the runtime application unless a documented build process explicitly supports doing so.

---

# Temporary and Backup Files

The following file types must never become part of the runtime module graph:

* `.save`
* `.bak`
* `.backup`
* `.tmp`
* `.orig`

Do not place backup copies beside active source files.

If temporary files are needed during development, they should remain outside the application's import paths or be ignored by Git.

---

# Unsupported Files

Do not introduce new runtime file types unless they have been verified to work with:

* Vite
* Next.js
* Vitest
* Current project configuration

Verification should occur before the first commit that references the new file type.

---

# Runtime Import Rules

Before adding an import:

1. Verify the target file exists.
2. Verify the extension is supported.
3. Verify the import path is correct.
4. Verify the module is intended for runtime use.

Avoid speculative imports.

---

# Build Failure Policy

If any of the following occur:

* Failed to parse source for import analysis
* Module resolution failure
* Zero collected test suites after a localized change

Stop development and activate the Forge Stability Guard.

---

# Repository Rule

Every file must satisfy one of the following:

1. Runtime source file using an approved extension.
2. Documentation.
3. Configuration required by the toolchain.
4. Test file.
5. Build artifact intentionally excluded from source control.

Files outside these categories require explicit architectural justification.

---

# Engineering Rule

Repository stability is more important than introducing a new file type.

When uncertain, use an approved file type or obtain architectural approval before proceeding.
