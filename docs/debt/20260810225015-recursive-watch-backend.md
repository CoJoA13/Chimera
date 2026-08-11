---
id: 20260810225015
title: recursive-watch-backend
principal: 1d
interest: +resource pressure on large repos
hotspot: src/main/watcherManager.ts
business_capability: background-watchers
payoff_trigger: when watcher scalability or inotify exhaustion is observed
quadrant: prudent-deliberate
category: planning
ai_authored: true
created: 2026-08-10
---

Recursive fs.watch still subscribes to ignored trees such as node_modules and .git; the event filter prevents triggers but not watch-resource consumption. This batch defers replacing it because the team should choose between adding chokidar and maintaining a custom filtered directory walker, and that dependency/portability decision is separate from the lifecycle and permission work.
