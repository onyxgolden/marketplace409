#!/usr/bin/env python3

from pathlib import Path

BASE = Path("docs/forge-os/architecture")
BASE.mkdir(parents=True, exist_ok=True)


def write_doc(filename: str, content: str):
    path = BASE / filename
    path.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"Wrote {path}")


write_doc(
    "WORKSPACE_MODEL.md",
    """
# FORGE OS Workspace Model

Status: Draft
Version: 0.1
Architecture Phase: 1A

---

## Purpose

A FORGE OS workspace is a bounded domain environment hosted by the shared operating platform.

A workspace contains domain-specific capabilities, workflows, data, interfaces, and intelligence.

The FORGE OS kernel provides shared operating capabilities but does not own workspace business logic.

---

## Initial Workspaces

- Financial Workspace
- Engineering Workspace
- Marketplace Workspace

Future workspaces may be added without changing the kernel.
"""
)

print("Architecture generation complete.")
