# Stateful Deep Research Skill

> **⚠️ Prerequisites:** This skill is **entirely dependent on the `web-search-mcp` server** (built by its author). The three-phase search flow (clarification → multi-angle summary → full-content fetch) relies on the following MCP tools: `get-web-search-summaries`, `get-single-web-page-content`, and `full-web-search`. See **Prerequisites** below for installation instructions.

A Google-level deep research tool for AnythingLLM that performs multi-round web search drills with query clarification, adaptive claim extraction, hierarchical knowledge graph construction, and synthesis to produce detailed research reports.

## Prerequisites

This skill is **entirely dependent on the `web-search-mcp` server**. The three-phase search flow (clarification → multi-angle summary → full-content fetch) relies on the following MCP tools:

| MCP Tool | Required? | Source |
|----------|-----------|--------|
| `get-web-search-summaries` | **Yes** | `web-search-mcp` |
| `get-single-web-page-content` | **Yes** | `web-search-mcp` |
| `full-web-search` | **Yes** | `web-search-mcp` |

**To install the `web-search-mcp` server**, follow the instructions in the [web-search-mcp repository](https://github.com/OllyJohnston/web-search-mcp). The skill will not function without these MCP tools.

## Installation

1. **Install the web-search-mcp server** (see Prerequisites above).
2. **Copy the skill folder** into AnythingLLM's storage directory:
   ```bash
   cp -r plugins/agent-skills/stateful-deep-research <STORAGE>/plugins/agent-skills/
   ```
   Where `<STORAGE>` is typically `%APPDATA%\AnythingLLM\storage` (Windows), `~/Library/Application Support/AnythingLLM/storage` (macOS), or `~/.config/AnythingLLM/storage` (Linux).
3. **Install dependencies**:
   ```bash
   cd <STORAGE>/plugins/agent-skills/stateful-deep-research
   npm install
   ```
4. **Restart** AnythingLLM (or toggle the agent off/on) so the skill is detected.
5. **Configure** `MAX_SOURCES` (default: 40) and `MAX_ANGLES` (default: 10) in Agent Settings → Custom Skills.

## Search Flow

### Three-Phase Search (Recommended)

1. **Phase 1 — Query Clarification**: The skill tells the agent to analyse the query, generate up to `MAX_ANGLES` distinct search angles, and call `get-web-search-summaries` with `limit: 5` per angle
2. **Phase 2 — Multi-Angle Search**: Agent selects the best URLs from summaries across all angles, then the skill instructs the agent to call `get-single-web-page-content` for each URL
3. **Phase 3 — Deep Research**: The skill processes the curated results through the knowledge graph:
   - Round 1: Initial search → extracts claims → builds knowledge graph
   - Round 2: Skill requests follow-up searches if fewer than 6 facts or conflicts detected
   - Round 3+: Skill processes follow-up results, detects conflicts, and synthesizes final report

### Direct Full Search Mode

Call the skill with pre-collected search results. The skill processes them through the multi-round research loop (same as Phase 3).

## How to Use

### Recommended Flow

Invoke the skill with a research query:

```
@agent use the stateful-deep-research skill to produce a research report for: "What are the latest trends in renewable energy storage?"
```

The agent will:
1. Use the skill's `webSearch` handler to analyse the query and generate search angles
2. Call `get-web-search-summaries` for each angle (limit: 5 per angle)
3. Select the best URLs and call `webFetchsingle` with them
4. Use the skill's `webFetchsingle` handler to call `get-single-web-page-content` for each URL
5. Call `deepResearch` with the enriched results
6. The skill automatically requests follow-up searches if more depth is needed
7. The skill synthesises the final report

### Direct Invocation Mode

If you already have search results:

```
@agent use the stateful-deep-research skill to produce a research report for: "What are the best WMS solutions?" Results from web search: [{ ... }]
```

## Multi-Round Research Flow

```
Round 1: Initial broad search
    └── Skill extracts claims → builds knowledge graph
    └── Skill requests follow-up searches if facts < 6 or conflicts detected

Round 2: Follow-up searches
    └── Skill processes each follow-up → upserts facts into graph
    └── Checks: facts < 6 or conflicts detected?
        ├── Yes → Request more follow-up searches
        └── No → Synthesize final report

Round 3+: Synthesis
    └── Group findings by theme → Executive summary → Detailed sections
    └── Flag conflicts → Recommendation to consult sources
```

## JSON Response Format

When the skill requests a web search, it returns:

```json
{
  "status": "COMPLETED",
  "instruction": "Use the 'get-web-search-summaries' MCP tool to search for: '...'. Set limit to 50. Then call this skill again with the best URLs.\n\nOr use 'full-web-search' with: { query: '...', limit: 12, maxContentLength: 2000 }",
  "prompt": "Please perform a web search for: '...'"
}
```

When the skill requests follow-up searches (Round 2+), it returns:

```json
{
  "status": "COMPLETED",
  "instruction": "I've found X facts about '...'. To produce a Google-level research report, I need deeper follow-up searches for these specific topics:\n1. Current status and latest news about...\n2. Key competitors and alternatives to...\n...\n\nCRITICAL: After gathering results, assemble a JSON array of objects with fields 'query' and 'searchResults' for each search. Then call this skill again with the `followUps` parameter set to that exact array.",
  "prompt": "Please perform follow-up web searches with full-web-search (limit=12, maxContentLength=2000), then combine results and call this skill with the `followUps` parameter."
}
```

The agent should parse this JSON, follow the `instruction`, and display the `prompt` as guidance.

## Features

- **Three-Phase Search**: Query clarification → Multi-angle search → Full content fetch → Deep research
- **Query Clarification**: LLM analyses query intent and generates `MAX_ANGLES` distinct search angles (default: 10)
- **Multi-Round Research Loop**: Automatically drills down through 3+ rounds of targeted follow-up searches
- **Adaptive Claim Extraction**: Smart line splitting (numbered lists, sentence boundaries, transition phrases) — handles MCP's single-paragraph output
- **Reflex Cache**: Repeated queries return persisted findings instantly (L1)
- **Claim-Based Conflict Detection**: Facts tracked by `CLAIM_ID` for cross-source contradiction detection (L2)
- **Topic-Based Synthesis**: Grouping facts by Financial Performance, Product & Innovation, Competitive Landscape, etc.
- **Hierarchical Memory**: L1 (reflex cache), L2 (knowledge graph), L3 (archived HTML)
- **Generic Claim Detection**: Extracts claims containing metrics, dates, statistics, and authority indicators (not vendor-specific)
- **Configurable Source Count**: `MAX_SOURCES` parameter (default: 40) controls how many sources are processed
- **Fixed Follow-Up Threshold**: Facts < 6 or conflicts detected → follow-up; facts >= 6 and no conflicts → synthesize
- **Adaptive Follow-Up**: Follow-up prompts include fact/topic counts to target specific areas needing more research
- **Registry-Orchestrator Pattern**: All configuration in `plugin.json` (SSoT), dispatcher reads from registry at runtime

## How to Use

### Recommended Flow

Invoke the skill with a research query:

```
@agent use the stateful-deep-research skill to produce a research report for: "What are the latest trends in renewable energy storage?"
```

The agent will:
1. Use the skill's `webSearch` handler to analyse the query and generate search angles
2. Call `get-web-search-summaries` for each angle (limit: 5 per angle)
3. Select the best URLs and call `webFetchsingle` with them
4. Use the skill's `webFetchsingle` handler to call `get-single-web-page-content` for each URL
5. Call `deepResearch` with the enriched results
6. The skill automatically requests follow-up searches if more depth is needed
7. The skill synthesises the final report

### Direct Invocation Mode

If you already have search results:

```
@agent use the stateful-deep-research skill to produce a research report for: "What are the best WMS solutions?" Results from web search: [{ ... }]
```

## Runtime Requirements

- **Agent with MCP tools**: The agent must support MCP tool calls (the skill delegates web search to MCP).
- **Model with strong tool-calling**: Multi-round drill-down requires an LLM that follows tool-calling instructions precisely. Models like Qwen 3.5/3.6 work very well; others may vary in their adherence to search angle generation, follow-up formatting, and JSON parsing.
- **Multiple invocations**: The skill re-invokes itself 3-4 times — ensure your AnythingLLM setup supports re-invocation.

## Constraints

- **MCP server timeout**: The `web-search` MCP server enforces a 25-second global timeout. Use `maxContentLength: 2000` (not higher) to stay within budget.
- **`includeContent: true`**: Triggers full-content extraction from all URLs. When `limit >= 12`, this consistently exceeds the 25s timeout. Omit `includeContent` from search prompts.
- **Agent re-invocation**: The skill re-invokes itself 3-4 times — ensure your AnythingLLM setup supports re-invocation.
- **Follow-up parameter**: The agent must pass `followUps` (not `searchResults`) for the second round of multi-round research.

## Storage

- `research-graph.json` — the knowledge graph with claims and confidence scores.
- `research-reflex-cache.json` — cached responses for repeated queries.
- `research-archive/` — archived HTML from source pages.

## Dependencies

- `lowdb` — reflex cache
- `jsdom` — HTML parsing
- `dompurify` — HTML sanitisation
