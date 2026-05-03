# Stateful Deep Research System – Architecture Overview

This document describes the architecture of the **Unified Stateful Deep Research Skill** (`stateful-deep-research`).

## Core Design Decisions

### The Internet-MCP Constraint

**Critical constraint:** The custom skill runs in an isolated Node.js process inside the AnythingLLM container. This process has:
- ✅ File I/O access to `STORAGE_DIR`
- ✅ Access to bundled node packages (`lowdb`, `jsdom`, `dompurify`)
- ❌ **No outbound internet access**
- ❌ **No access to MCP tools** (`web_search`, etc.)

The agent layer (which invokes the skill) **does** have internet access and **can** use MCP tools. Therefore, the skill cannot perform web searches itself via `fetch`.

### Registry-Orchestrator Pattern

The skill follows a **Registry-Orchestrator** architecture:

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Registry** | `plugin.json` | All parameters (`MAX_SOURCES`, `MAX_ANGLES`), schema, and examples |
| **Orchestrator** | `handler.js` dispatcher | Routes to the correct handler based on which parameters are present |
| **Workers** | `buildClarificationPrompt`, `buildMultiAngleSearchPrompt`, `buildFullFetchPrompt`, `processResearchLoop` | Platform-specific execution logic |

All mappings, schemas, and patterns live in `plugin.json` (single source of truth). The dispatcher reads from `this.runtimeArgs` at runtime — no hard-coded defaults in the dispatcher.

## Three-Phase Search Flow

### Phase 1: Query Clarification

| Step | Handler | Who Runs It? | Why? |
|------|---------|-------------|------|
| 1. `webSearch` (no params) | Skill's `handler` | Skill (Node.js) | Skill returns JSON prompt to analyse the query → generate `MAX_ANGLES` search angles |

**Flow:**
```
Agent ──webSearch(researchQuery)──▶ Skill ──"analyse query, generate angles"──▶ Agent
Agent ◀──angles── Skill ◀──(agent generates angles)── Agent
```

### Phase 2: Multi-Angle Summary Search

| Step | Handler | Who Runs It? | Why? |
|------|---------|-------------|------|
| 2. `webSearch` (searchAngles) | Skill's `handler` | Agent (via skill's return prompt) | Skill returns prompt to run `get-web-search-summaries` (limit: 5 per angle), then select best URLs |

**Flow:**
```
Agent ──webSearch(angles)──▶ Skill ──"use MCP get-web-search-summaries (limit: 5 per angle)"──▶ Agent
Agent ◀──best URLs── Skill ◀──(agent selects URLs)── Agent
Agent ──webFetchsingle(urls)──▶ Skill ──"use MCP get-single-web-page-content for URLs"──▶ Agent
Agent ◀──full content── Skill ◀──(agent embeds results)── Agent
```

### Phase 3: Deep Research Loop

| Step | Handler | Who Runs It? | Why? |
|------|---------|-------------|------|
| 4. `deepResearch` | Skill's `handler` | Skill (Node.js) | Skill has file I/O for structured processing |

**Flow:**
```
Agent ──deepResearch(angles)──▶ Skill ──processes/curated results──▶ Agent ──▶ report
```

## Two-Tier Memory Model

| Tier | Location | Purpose | Typical Size |
|------|----------|---------|--------------|
| **L1 – Working** | `research-reflex-cache.json` (lowdb) | Cached responses for repeated queries | KBs |
| **L2 – Knowledge** | `research-graph.json` (JSON) | Structured claims with confidence, sources, authority | KBs–MBs |

## Core Components

| Component | Role | Implementation |
|-----------|------|----------------|
| **`webSearch` Handler** | Orchestrator entry point | Dispatches to clarification, multi-angle search, full fetch, or deep research based on params |
| **`webFetchsingle` Handler** | Delegates to MCP | Returns structured prompt for agent to use `get-single-web-page-content` |
| **`deepResearch` Handler** | Deep research loop | Orchestrator; delegates to `extractClaims`, `upsertFact`, `processResearchLoop` |
| **`processResearchLoop`** | Multi-round research | Reads `MAX_SOURCES` from `this.runtimeArgs`; fixed threshold: if facts >= 6 and no conflicts → synthesize; else → follow-up |
| **`extractClaims`** | Extracts claims from sources | Accepts `maxSources` parameter (default 40); processes up to N sources with structured prompt |
| **`ResearchStorage`** | Persists L1/L2 state | `lowdb` for reflex cache; plain JSON for knowledge graph |
| **`upsertFact`** | Inserts facts into L2 | Keyed by `CLAIM_ID`; merges sources; computes confidence from authority weights |
| **`getConflicts`** | Detects contradictions | Finds nodes with multiple distinct facts (same `CLAIM_ID` → contradiction) |
| **`topFacts`** | L1 context assembly | Sorts by confidence, returns top N for synthesis |

## Data Flow

1. **Agent calls `webSearch(researchQuery)` →** Skill returns prompt to analyse query, generate angles.
2. **Agent generates angles** → calls skill with `searchAngles`.
3. **Skill returns multi-angle search prompt** → agent calls `get-web-search-summaries` (limit: 5 per angle).
4. **Agent selects best URLs** → calls skill with `urls`.
5. **Skill returns fetch prompt** → agent calls `get-single-web-page-content`.
6. **Agent calls `webFetchsingle(urls)` →** Skill returns prompt to call `get-single-web-page-content` for selected URLs.
7. **Agent calls `deepResearch(researchQuery, searchResults)` →** Skill:
    a. Checks reflex cache (L1).
    b. Parses sources and distils claims via structured prompts.
    c. Upserts into knowledge graph (L2).
    d. Detects conflicts.
    e. Assembles top facts.
    f. Returns synthesized report.
8. **Agent streams report to user.**

## Module Load Safety

DOMPurify and jsdom are loaded **inside** functions (not at module scope) to prevent the `"Cannot read properties of undefined (reading 'replace')"` crash during module load. A regex fallback handles cases where the HTML libraries fail.

## MCP Server Constraints

The `web-search` MCP server enforces a **25-second global timeout** (`GLOBAL_TIMEOUT = 25000`) for `full-web-search` operations. This affects how the handler's search prompts should be structured:

| Constraint | Impact | Handler Mitigation |
|------------|--------|-------------------|
| `full-web-search` with `includeContent: true` + `limit >= 12` | Full-content extraction from all URLs exceeds 25s timeout | `buildInitialSearchPrompt` does not request `includeContent: true` |
| `maxContentLength: 3000` | Higher values increase timeout risk | All prompts set `maxContentLength: 2000` |
| Agent using `limit: 12` per instruction | Consistent timeout on follow-ups | Agent may retry with `limit: 10` when timeout occurs |
| Agent ignoring follow-up instruction | Starts fresh search instead of passing `followUps` | `buildFollowUpPrompt` uses `CRITICAL` prefix + concrete JSON format |

The `extractClaims` function uses `src.snippet || src.content || src.summary` to extract claims, so `includeContent: true` is unnecessary for claim extraction.

## Registry (Single Source of Truth)

All configurable parameters are defined in `plugin.json`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_SOURCES` | 40 | Maximum sources to process in `extractClaims` |
| `MAX_ANGLES` | 10 | Number of search angles to generate during query clarification |

All handlers read these from `this.runtimeArgs` at runtime — no hard-coded values in the dispatcher.

---

*This architecture document is a living reference. Update it as the skills evolve.*