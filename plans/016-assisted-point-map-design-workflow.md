# 016 开关图分析、点位微调与场景出图

Status: COMPLETE. Branch: `codex/point-map-design-workflow`.
Night continuation: automation `automation-2`, Asia/Shanghai 00:00–07:00 hourly, pause on completion.

## User outcome

助手阅读客户开关图并生成点位草稿；用户导入后看到预摆点位，调整位置、产品、控制灯组和场景；保存确认版本；从确认数据导出带点位编号和场景说明的新图及可交回助手的数据。助手分析在本聊天完成，首版不调用付费视觉服务。用户不需要逐点重新录入。

## Acceptance

- AC-001: Import a valid draft referencing image-percent coordinates; preview counts, then place all imported points on their own floors. Invalid numbers, duplicate IDs, dangling references or unsupported images reject the whole input without mutation. Repeat imports preserve existing manual edits and do not duplicate points.
- AC-002: Import at least two floors, upload their respective images, switch floors, zoom, pan and drag. Other floors keep their points, and displayed/exported locations agree with original-image coordinates at multiple aspect ratios.
- AC-003: Edit names, custom rooms, products, controlTargets, review notes and proposed/confirmed scenes. Export/import roundtrip preserves edits and stable IDs. Uncertain diagram readings and scenario proposals are never silently confirmed.
- AC-004: Save a project plan through its permission-scoped server endpoint and reload it. Concurrent stale writes return a conflict without overwrite. Confirmation creates an immutable version; later edits cannot mutate it.
- AC-005: Render the selected floor at source resolution, with point numbers, status legend and linked scene descriptions; actual export uses the edited coordinates. Export confirmed design JSON for a later assistant turn.
- AC-006: Generate product quantities from linked physical points without repeat accumulation. Preserve unrelated quote items. Pending/unplaced or unlinked points are reported rather than accidentally charged.
- AC-007: Existing point-map and quote tests pass; add import, migration, coordinate, persistence authorization/conflict, scene-reference and export checks. Perform browser workflow checks with synthetic data, then inspect a local customer sample. Customer source files and images stay local and are not committed.

## Shared contract (implementation teams)

Extend `PointMapPlan` and `PointMapNode` in `lib/point-map-plan.ts` with OPTIONAL additions, keeping legacy callers/tests compatible.

`PointMapFloor`: `{ id, name, floorplanName, floorplanDataUrl, imageWidth, imageHeight, sourcePage? }`.
`PointMapScene`: `{ id, name, trigger, description, pointIds: string[], status: 'proposed' | 'confirmed' }`.
Plan additions: `schemaVersion?: 2`, `floors?: PointMapFloor[]`, `activeFloorId?: string`, `scenes?: PointMapScene[]`.
Node additions: `floorId?: string`, `code?: string`, `controlTargets?: string[]`, `controlType?: string`, `reviewReason?: string`, `confidence?: 'low' | 'medium' | 'high'`, `source?: 'manual' | 'analysis' | 'quote'`.
All x/y coordinates are percent (0–100) of the ACTUAL IMAGE, not surrounding canvas. Legacy top-level floorplan fields mirror only the active floor for compatibility.

Core module `lib/point-map-design.ts` exports:
- `normalizeDesignPlan(plan: PointMapPlan): PointMapPlan` (legacy migration to default floor; preserve metadata).
- `validateDesignPlan(value: unknown, projectId?: string): PointMapPlan` (strict server/save validation, throws human-readable error).
- `parsePointMapDraft(value: unknown): PointMapDraft` (strict, all-or-nothing parsing).
- `importPointMapDraft(plan, draft): { plan, added, skipped }` (merge stable IDs, preserve existing edits; force imported suggestions to planned/needs-review).
- `exportPointMapDraft(plan): PointMapDraft`.
- `activePointMapFloor(plan): PointMapFloor | undefined`.

Draft JSON envelope: `{ format: 'fmkj-point-map-draft', version: 1, coordinateSystem: 'image-percent', floors, points, scenes }`. Draft floor fields reuse PointMapFloor; floorplanDataUrl may be empty until matching image upload. Draft points reuse PointMapNode plus REQUIRED floorId. Scene pointIds must reference known points. Import rejects duplicate IDs in a file, non-finite/out-of-range coordinates, unsupported icon IDs and dangling floor/scene references. Imported products are suggestions and the UI must identify missing library matches. Draft reimport by identical IDs keeps current points unchanged (reports skipped), preserving user's micro-adjustments.

Cloud endpoint `/api/projects/[id]/point-map`:
- GET -> `{ data: PointMapPlan | null, revision: number, versions: [{revision, confirmedAt}] }`.
- PUT accepts `{ plan: PointMapPlan, expectedRevision: number, confirm?: boolean }`; returns the same payload. expectedRevision=0 creates. Confirmation stores immutable snapshot; optimistic revision mismatch returns 409. Auth + point_map.use required; writes also require project.edit and writable project membership. Only visible owned projects; graceful read-only/subscription behavior consistent with repository.
- GET `?version=N` returns a confirmed snapshot with its revision.

Render module (root-owned) `lib/point-map-render.ts`: `renderPointMapFloor(plan, floorId, options?: {title?: string}): Promise<HTMLCanvasElement>` and pure `buildPointMapRenderLayout(...)` for meaningful coordinate/scene tests. UI can await canvas and download PNG.

## Ownership

- Core agent: point-map-plan.ts, point-map-design.ts, point-map-interaction.ts and corresponding tests.
- UI agent: point-map-workbench.tsx and new UI/client files; import/read/write/confirmation, floors, custom rooms, zoom/pan, scene editor, render buttons.
- Persistence agent: service, GET/PUT route, additive SQL, migration list entry and authorization/persistence tests.
- Root: shared plan, CONTEXT/ADR as needed, renderer, quote draft idempotency, integration and local sample validation.

## Progress / resume

2026-10-14: Goal active; overnight heartbeat configured. Managed worktree created from current committed HEAD; original checkout has unrelated uncommitted changes and must stay intact. No production migration, merge or deploy authorized. All test data synthetic. First implementation underway; read latest agent/file progress before continuing.

2026-10-14 00:30 Asia/Shanghai — Persistence and quote integration completed. Added project-scoped GET/PUT and immutable confirmation snapshots, optimistic revisions, membership/account gates, bounded streaming JSON and a post-normalization 32 MiB envelope check. Server confirmation requires all physical points placed/confirmed, readable floor image metadata, and complete confirmed scenes with linked points; historical review provenance remains intact. Additive migration includes quote origin fields and is registered, but this agent has not run any database migration. Quote loading now merges this project's queued work after the cloud base (including empty point-map snapshots), preserves manual rows and fetch-time edits, caches unsaved project-switch drafts, and sends provenance during save. Final targeted verification: 8 files / 70 tests passed, global TypeScript check passed, owned-file ESLint and diff whitespace checks passed. All fixtures synthetic. Independent review reported and Root routed UI fixes for all-point deletion synchronization, replacement-floor confirmation invalidation, and readable API validation messages; core agent fixed same-floor ID/image conflicts and invisible ID controls. Root owns real database/browser and local customer validation.
2026-10-14 01:10 Asia/Shanghai — Complete. AC-001 through AC-007 verified. Implementation synchronized into the original local checkout by a checked patch, preserving unrelated working changes; only the additive point-map migration was applied to the workstation PostgreSQL at localhost:15432. The running localhost:3000 app loads the new protected endpoint (unauthenticated requests return 401). No public deployment or Git push performed.

Final verification: 32 test files / 251 tests passed in the original checkout; global TypeScript and affected-file ESLint passed; whitespace checks passed. Optimized Next.js production build completed successfully. Isolated PostgreSQL and browser checks covered import, manual coordinates, actual mouse drag under zoom, pan over a marker, viewport resize, floor isolation, repeated import preservation, JSON/PNG export, draft save, stale-write conflict, confirmation gates, immutable snapshots, version viewing, repeated quote sync, empty sync preserving manual rows, and legacy image-size migration without reupload. The local test database container is stopped after verification and can be restarted for reproduction.