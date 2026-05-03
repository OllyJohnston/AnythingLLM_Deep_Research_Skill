# Implementation Details

This document describes the concrete implementation of the **Unified Stateful Deep Research Skill** (`stateful-deep-research`). The skill uses a **three-phase pipeline** because the AnythingLLM plugin runtime has no internet access and no access to MCP tools — it only has file I/O and JSON processing.

**Key insight:** `web_search` tools are only available to the *agent* layer. The skill runs in an isolated Node.js process. Therefore, the agent performs the web search first, then passes results to the skill.

## Three-Phase Pipeline

### Phase 1: Query Clarification

| Step | Handler | Purpose |
|------|---------|---------|
| `webSearch` (no params) | `handler` — `buildClarificationPrompt` | Skill analyses query intent and returns a JSON prompt instructing the agent to generate `MAX_ANGLES` search angles |

### Phase 2: Multi-Angle Summary Search

| Step | Handler | MCP Tool | Purpose |
|------|---------|----------|---------|
| `webSearch` (searchAngles) | `handler` — `buildMultiAngleSearchPrompt` | `get-web-search-summaries` | Cast wide net (limit: 5 per angle) |
| `webFetchsingle` (urls) | `handler` — `buildFullFetchPrompt` | `get-single-web-page-content` | Fetch full content for selected URLs |

### Phase 3: Deep Research

| Step | Handler | MCP Tool | Purpose |
|------|---------|----------|---------|
| `deepResearch` | `handler` — `processResearchLoop` | N/A | Process curated results through knowledge graph |

## File Structure

```
stateful-deep-research/
├─ plugin.json          # Registry: skill metadata, parameters, examples
├─ handler.js           # Orchestrator: dispatcher + worker functions
├─ package.json         # Dependencies (lowdb, jsdom, dompurify)
└─ README.md            # Usage instructions
```

## Registry (Single Source of Truth)

All configuration lives in `plugin.json`:

```json
{
  "setup_args": {
    "MAX_SOURCES": { "type": "string", "default": "40" },
    "MAX_ANGLES":  { "type": "string", "default": "10" },
    "LLM_ENDPOINT": { "type": "string", "default": "http://localhost:1337/api/v1/chat/completions" },
    "LLM_MODEL": { "type": "string", "default": "gpt-4o" },
    "LLM_API_KEY": { "type": "string", "default": "" }
  }
}
```

Both parameters are read from `this.runtimeArgs` at dispatch time — no hard-coded values in the dispatcher.

## Handler: `webSearch` (Orchestrator)

**Purpose:** Central dispatcher that routes to the correct handler based on input parameters.

**Dispatch order:**
1. **No params** → `buildClarificationPrompt(query, MAX_ANGLES)` — LLM analyses intent, generates angles
2. **`searchAngles`** → `buildMultiAngleSearchPrompt(angles, MAX_ANGLES)` — Multi-angle search
3. **`urls`** → `buildFullFetchPrompt(urls, researchQuery)` — Full content fetch
4. **`searchResults` / `followUps`** → `processResearchLoop(query, params, ctx)` — Deep research

**Registry read:** `this?.runtimeArgs?.MAX_ANGLES` and `this?.runtimeArgs?.MAX_SOURCES` — defaults from plugin.json.

## Handler: `webFetchsingle` (Orchestrator)

**Purpose:** Delegates full-content fetching to the agent, which invokes the MCP `get-single-web-page-content` tool.

**Flow:**
1. Accept `urls` parameter (array of URLs from agent's selection).
2. Return a structured prompt instructing the agent to call `get-single-web-page-content` for each URL.
3. When the agent returns with results, the skill processes them as `searchResults`.

## Handler: `deepResearch`

**Purpose:** Process search results through adaptive compression, conflict detection, and synthesis.

**Flow:**
1. **Reflex Cache check** (L1) — `research-reflex-cache.json` stores `{ query, response, hits, updated_at }` via `lowdb`. If the same query was cached, return immediately.
2. **Parse sources** — accepts JSON or plain text from the agent's MCP tool results. Extracts URLs and snippets.
3. **Source processing**:
   - Extract text via `jsdom` + `dompurify`.
   - Distill claims into structured `{ claimId, fact }` pairs.
   - Upsert into the knowledge graph keyed by `CLAIM_ID`.
4. **Conflict detection** — scan for nodes with multiple different facts (same `CLAIM_ID` → contradiction).
5. **Top facts assembly** — sort by confidence, take top 15.
6. **Final synthesis** — build a prompt feeding the agent the distilled facts, then return a structured research report.

## New Handler: `buildClarificationPrompt`

**Purpose:** Generate a structured prompt that instructs the agent to analyse the research query and produce distinct search angles.

**Parameters:** `query` (string), `maxAngles` (number, from registry).

**Output:** JSON with `status`, `instruction` (detailed prompt), and `prompt` (short prompt).

## New Handler: `buildMultiAngleSearchPrompt`

**Purpose:** Generate a structured prompt that instructs the agent to perform a `get-web-search-summaries` search for each angle.

**Parameters:** `angles` (array), `maxAngles` (number, from registry).

**Output:** JSON with `status`, `instruction` (detailed prompt), and `prompt` (short prompt).

## Core Data Structures

### Knowledge Graph (`research-graph.json`)

```json
{
  "claim_XYZ": {
    "claimId": "claim_XYZ",
    "confidence": 0.87,
    "versions": [
      { "fact": "PostgreSQL is suitable for local LLM storage", "source": "url1", "authority": "MASTER" }
    ]
  }
}
```

### Reflex Cache (`research-reflex-cache.json`)

```json
{
  "reflex": [
    { "query": "What are the current best warehouse management systems...", "response": "...", "hits": 3, "updated_at": 1712345678 }
  ]
}
```

## Plugin Contract

All handlers:
- Receive `{ researchQuery, searchResults?, followUps?, urls?, searchAngles? }` from `this.params`.
- Use `this.introspect()` for UI feedback and `this.logger()` for console output.
- Return a **string** (required by AnythingLLM).
- Are wrapped in `try/catch` (required by AnythingLLM).

## Module Load Safety

`dompurify` and `jsdom` are loaded **inside** functions (not at module scope) to avoid the `"Cannot read properties of undefined (reading 'replace')"` crash that occurred during module load. A regex fallback handles cases where the HTML libraries fail.

## MCP Server Constraints

The `web-search` MCP server has a **25-second global timeout** (`GLOBAL_TIMEOUT = 25000`) for `full-web-search` operations. This affects how the handler's search prompts should be constructed:

- `includeContent: true` triggers full-content extraction from all returned URLs, which consistently exceeds the timeout when `limit >= 12`
- `maxContentLength` is set to `2000` (not `3000`) to stay within the timeout budget
- The handler's `extractClaims` function works with snippet-level data (`src.snippet || src.content || src.summary`), so `includeContent: true` is unnecessary

## Extension Points

| Component | Where to Change | Example |
|-----------|-----------------|---------|
| Clarification angles | `buildClarificationPrompt()` prompt | Change angle generation criteria |
| Search API | `buildMultiAngleSearchPrompt()` prompt (delegate to any MCP tool) | Swap `get-web-search-summaries` for a specialized search tool |
| Conflict Detection | `getConflicts()` — currently uses `new Set(n.versions.map(v => v.fact)).size > 1` | Implement cosine similarity for semantic conflicts |
| Confidence Scoring | `upsertFact()` — currently uses authority weights `{ MASTER: 1.0, SENIOR: 0.8, JUNIOR: 0.5, USER: 0.3 }` and `Math.max()` | Use source authority (domain rating) or recency |
| Cache TTL | `getCachedResponse()` — currently no expiration | Expire entries older than N hours or after M hits |

## Configuration Options (Registry)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_SOURCES` | 40 | Maximum sources to process in `extractClaims` |
| `MAX_ANGLES` | 10 | Number of search angles to generate during query clarification |
| `LLM_ENDPOINT` | `http://localhost:1337/api/v1/chat/completions` | LLM API endpoint URL |
| `LLM_MODEL` | `gpt-4o` | Model name to use for synthesis |
| `LLM_API_KEY` | `` | API key for the LLM endpoint (if required) |

## Deployment

1. Copy `plugins/agent-skills/stateful-deep-research/` into AnythingLLM's `storage/plugins/agent-skills/`.
2. `npm install` in the skill folder (installs `lowdb`, `jsdom`, `dompurify`).
3. Restart AnythingLLM or reload the agent session.
4. Invoke via `@agent` with the three-phase pattern described in README.
