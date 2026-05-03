# Multi-Source Search Enhancement — Technical Design

## Problem Statement

The deep research skill's architecture is working correctly:
- ✅ Multi-round `webSearch` → `deepResearch` flow
- ✅ Knowledge graph (`research-graph.json`) persists between rounds
- ✅ Follow-up drill-down for deeper coverage

The problem is data volume. Two things are constraining the number of facts:

1. **`webSearch` handler doesn't instruct `full-web-search`** — the prompt tells the agent to "use web_search" generically, so the agent doesn't set `includeContent: true` or a larger `limit`. Results are limited to MCP's default of 5.
2. **`MAX_SOURCES` is read but never used** — `extractClaims` (line 210) hard-codes `Math.min(sources.length, 10)`. The `MAX_SOURCES` setup_arg from `plugin.json` is never read.

## Solution

### 1. `webSearch` Handler — Enrich Initial Search Instruction

**Current (line 402):**
```js
instruction: `Use the web_search MCP tool to perform a broad search for: "${query}".\nThen call this skill again with the \`searchResults\` parameter set to those results.`
```

**Updated:**
```js
instruction: `1. Use "full-web-search" MCP tool with: { query: "${query}", limit: 12, includeContent: true }
2. For 2-3 high-value URLs from results, also call "get-single-web-page-content" for full article text.
3. Combine all results and call the deepResearch skill with the searchResults parameter.

Format: { "researchQuery": "...", "searchResults": [ {"title": "...", "url": "...", "snippet": "...", "content": "..."}, ... ] }`
```

### 2. `deepResearch` Handler — Respect `MAX_SOURCES`

**Current (line 280-340):** `MAX_SOURCES` from `plugin.json` is never read. `extractClaims` hard-codes `10`.

**Updated:**
```js
async function processResearchLoop(query, env, ctx, callerId) {
  const MAX_SOURCES = this?.runtimeArgs?.MAX_SOURCES ? parseInt(this.runtimeArgs.MAX_SOURCES) : 15;
  ...
  const claims = extractClaims(searchResults, MAX_SOURCES); // pass limit
}
```

And in `extractClaims` (line 210):
```js
// Current:
for (let i = 0; i < Math.min(sources.length, 10); i++) {

// Updated:
for (let i = 0; i < Math.min(sources.length, maxSources); i++) {
```

### 3. `plugin.json` — Updated Configuration

```json
{
  "setup_args": {
    "MAX_SOURCES": { "type": "string", "default": "40" }
  }
}
```

### 4. Enhanced Follow-Up Prompt

**Current (line 371):** Hard-coded topics regardless of current state.

**Updated:** `buildFollowUpPrompt` analyzes current facts/topics to identify gaps and generates targeted follow-up queries.

## MCP Tool Integration

| MCP Tool | Usage |
|----------|-------|
| `full-web-search` (limit: 12, includeContent: true) | Primary — 12 rich results with article text |
| `get-single-web-page-content` | For 2-3 key URLs to extract full articles |

## Constraints

- **No new dependencies** — existing packages only (lowdb, jsdom, dompurify)
- **No changes to MCP tool** — only how the skill instructs the agent
- **No direct HTTP calls** from the skill
- **Backward compatible** — defaults to 40 when not configured
- **No changes to persistence layer** — knowledge graph and reflex cache untouched

## User-Centric Storyboard

1. **Entry:** User invokes `@agent "Research: WMS systems"`
2. **Input:** Agent calls `webSearch("WMS systems")`
3. **State Change:** Skill returns enhanced prompt with `full-web-search` instructions
4. **Data Consequence:** Agent runs `full-web-search` with `limit: 12` and `includeContent: true` → 12 rich results
5. **Resolution:** `extractClaims` processes up to 40 sources → richer knowledge graph → better report
6. **Iteration:** Follow-up prompt is targeted to gaps in the knowledge graph
