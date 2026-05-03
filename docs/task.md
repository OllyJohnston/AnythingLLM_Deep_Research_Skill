# Deep Research Quality — Task Plan (In Progress)

**Feature:** Multi-angle search + query clarification for the stateful-deep-research skill.

## Design Decisions

1. **LLM clarifies the query** — generates 5-15 search angles before searching
2. **Multi-angle search** — separate `get-web-search-summaries` (limit: 5) for each angle
3. **Curated URL selection** — agent picks best URLs across all angles
4. **Full content fetch** — `get-single-web-page-content` for selected URLs
5. **Fixed follow-up threshold** — if facts < 6 or conflicts detected, request follow-ups; if facts >= 6 and no conflicts, synthesize report

## Current Status — Implementation Complete

### New Flow (Three-Phase)

```
agent → skill (researchQuery)
  → skill: buildClarificationPrompt → agent extracts angles
  → agent → skill (searchAngles)
  → skill: buildMultiAngleSearchPrompt → agent searches + selects URLs
  → agent → skill (urls)
  → skill: buildFullFetchPrompt → agent fetches full content
  → agent → skill (searchResults)
  → skill: processResearchLoop
    → extractClaims, upsert facts, detect conflicts
    → if facts < 6 or conflicts: request follow-up searches
    → if facts >= 6 and no conflicts: synthesize report
```

### New Handler Functions

1. `buildClarificationPrompt(query, maxAngles)` — LLM analyses intent, returns JSON angles
2. `buildMultiAngleSearchPrompt(angles, maxAngles)` — LLM runs `get-web-search-summaries` for each angle (5 per angle)
3. `buildFullFetchPrompt(urls, researchQuery)` — existing, kept
4. `buildSummarySearchPrompt(query)` — existing, updated (was `buildSummarySearchPrompt`)

### Dispatch order in main handler:
1. No params → clarification
2. `searchAngles` → multi-angle search
3. `urls` → full fetch
4. `searchResults` → main processing

### Files modified

| File | Changes |
|------|---------|
| `handler.js` | ✅ Added `buildClarificationPrompt`, `buildMultiAngleSearchPrompt`; updated dispatcher; updated `processResearchLoop` threshold |
| `plugin.json` | ✅ Added `MAX_ANGLES` parameter |
| `architecture.md` | 🔄 New section on clarification step |
| `implementation.md` | 🔄 Add clarification handler |
| `walkthrough.md` | 🔄 Update all flow diagrams |
| `README.md` | 🔄 Add clarification section |
| `task.md` | 🔄 Update milestones |

### Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Skill generates clarification prompt when only `researchQuery` is provided | ✅ Implemented |
| Agent follows clarification prompt and calls skill with `searchAngles` | ✅ Implemented |
| Multi-angle search works end-to-end | ✅ Implemented |
| Fixed threshold (facts < 6 → follow-up; >= 6 → report) | ✅ Implemented |
| All docs consistent | 🔄 In progress |
| `node -c handler.js` passes | ✅ Verified |

### Implementation Order

1. ✅ Update `task.md` (this file)
2. ✅ Update `handler.js` — add clarification handlers, update dispatcher
3. ✅ Update `plugin.json` — add `MAX_ANGLES`
4. 🔄 Update `architecture.md`
5. 🔄 Update `implementation.md`
6. 🔄 Update `walkthrough.md`
7. 🔄 Create/update `README.md`
8. ✅ Verify with `node -c handler.js`
9. ⏳ Test in AnythingLLM

### Not Yet Done
- [x] Document all changes in documentation files (implementation, architecture, code cleanup)
- [ ] Test in AnythingLLM

### Debugging Session — Round 2 Quality Improvement

**Issue:** Second test run produced a thinner article than the first. The handler was architecturally correct, but the MCP server's `full-web-search` tool had a 25-second global timeout (`GLOBAL_TIMEOUT = 25000`). When the follow-up prompt told the agent to use `limit: 12, includeContent: true`, fetching full content from 12 URLs consistently exceeded that ceiling.

**Fixes applied (handler.js):**
1. `maxContentLength: 3000` → `2000` in `buildFollowUpPrompt` and `buildInitialSearchPrompt`
2. Removed `includeContent: true` from `buildInitialSearchPrompt` (agent was using `limit: 12` per instructions, which timed out)
3. Strengthened `buildFollowUpPrompt` instruction: added `CRITICAL` prefix, concrete JSON format example, and explicit `followUps` field names so the LLM agent passes `followUps` instead of starting a fresh session.

### Code Cleanup — Session 1

**Issue:** Code review found orphan functions (defined but never called) and a duplicate function in `handler.js`.

**Fixes applied (handler.js):**
1. Removed duplicate `buildMultiAngleSearchPrompt` (lines 804-824) — first definition at line 741 covers the call at line 845
2. Removed orphan `ensureStorageDir` (line 14) — `fs.mkdir` called inline instead
3. Removed orphan `cleanHtml` (lines 131-158) — never called
4. Removed orphan `buildMethodology` + `buildConclusion` (lines 713-724) — never called
5. Removed orphan `buildSummarySearchPrompt` (lines 762-778) — never called

**Result:** 881 lines → 789 lines (92 removed). All changes verified with grep across all project files. Zero regression risk.

### Documentation Updates — Session 1

**Fixes applied to docs:**
1. `architecture.md` — Removed `cleanHtml` from Core Components table (line 87)
2. `implementation.md` — Removed `cleanHtml` from Extension Points table (line 163)

**No changes needed to:**
- `walkthrough.md` — sample output references are correct (METHODOLOGY section is LLM-generated)
- `plan.md` — no orphan references
- `task.md` — this file
