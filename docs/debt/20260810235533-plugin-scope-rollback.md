---
id: 20260810235533
title: plugin-scope-rollback
principal: 3d
interest: +manual global plugin switching and no update recovery
hotspot: src/main/store/plugins.ts
business_capability: plugin-management
payoff_trigger: when users need different plugin sets per conversation or rollback after a bad update
quadrant: prudent-deliberate
category: planning
ai_authored: true
created: 2026-08-10
---

The first plugin-management redesign intentionally keeps enablement global and updates forward-only.
Per-conversation plugin sets require coordinated database, runtime, and session semantics, while rollback requires persisted Git revisions and recovery UX.
Both are separated from the inventory and bulk-management pass to keep this batch reviewable.
