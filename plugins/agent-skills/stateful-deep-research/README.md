# Stateful Deep Research Skill

A Google-level deep research tool for AnythingLLM that performs multi-round web search drills, adaptive claim extraction, hierarchical knowledge graph construction, and synthesis to produce detailed research reports.

## How to Use

This skill requires a **two-step invocation** because the skill runs in an isolated Node.js process with no internet access. The agent must perform the web search first.

### Step 1: Search

The agent will return a JSON instruction telling you to use the `web_search` MCP tool. **Do not stop here.** The agent should then:

1. Call the `web_search` MCP tool to search for the query
2. Re-invoke the skill with the search results as the `searchResults` parameter

### Step 2: Multi-Round Follow-Up

The skill automatically orchestrates **3-round research loops**:

1. **Round 1** — Initial broad search (you provide `searchResults`)
2. **Round 2** — Skill requests 5 follow-up searches on specific topics (competitors, industry trends, financial performance, etc.)
3. **Round 3+** — Skill processes follow-up results, detects conflicts, and synthesizes final report

The skill handles this entire flow — you only need to provide search results for each round.

### Invocation

Call the skill with the research query and search results (the agent typically handles this automatically):
```
@agent use the stateful-deep-research skill to produce a research report for: "What are the best WMS solutions?" Results from web search: [results here]
```

## How It Works

The skill runs inside AnythingLLM's Node.js process, which has no internet access and no access to MCP tools. The agent layer (which invokes the skill) **does** have MCP tools.

| Step | Tool | Who runs it? | Why? |
|------|------|-------------|------|
| `webSearch` | `web_search` MCP | Agent (invoked by skill's prompt) | Skill can't make HTTP calls; agent has MCP access |
| `deepResearch` | N/A (processes results) | Skill | Skill is an isolated Node.js process with file I/O and JSON processing |

## Multi-Round Research Flow

```
Round 1: Initial broad search
    └── Skill extracts claims → builds knowledge graph
    └── Skill requests 5 follow-up searches (competitors, trends, financials, etc.)

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
  "instruction": "Use the web_search MCP tool to search for: '...'.\nThen call this skill again with the `searchResults` parameter set to the search results you obtained.",
  "prompt": "Please perform a web search for: ..."
}
```

When the skill requests follow-up searches (Round 2+), it returns:

```json
{
  "status": "COMPLETED",
  "instruction": "I've found X facts about '...'. To produce a Google-level research report, I need deeper follow-up searches for these specific topics:\n1. Current status and latest news about...\n2. Key competitors and alternatives to...\n...",
  "prompt": "Please perform follow-up web searches for these topics and return the results as searchResults objects for this skill."
}
```

The agent should parse this JSON, follow the `instruction`, and display the `prompt` as guidance.

## Features

- **Multi-Round Research Loop**: Automatically drills down through 3+ rounds of targeted follow-up searches
- **Adaptive Claim Extraction**: Smart line splitting (numbered lists, sentence boundaries, transition phrases) — handles MCP's single-paragraph output
- **Reflex Cache**: Repeated queries return persisted findings instantly (L1)
- **Claim-Based Conflict Detection**: Facts tracked by `CLAIM_ID` for cross-source contradiction detection (L2)
- **Topic-Based Synthesis**: Grouping facts by Financial Performance, Product & Innovation, Competitive Landscape, etc.
- **Hierarchical Memory**: L1 (reflex cache), L2 (knowledge graph), L3 (archived HTML)
- **Generic Claim Detection**: Extracts claims containing metrics, dates, statistics, and authority indicators (not vendor-specific)

## Setup

1. Configure `MAX_SOURCES` (default: 15) in the AnythingLLM skill settings.
2. Ensure you are using `@agent` to invoke the skill (MCP tools require the agent).
3. The skill uses AnythingLLM's built-in `web_search` MCP tool for source discovery.

## Runtime Requirements

- **Agent with MCP tools**: The agent must support MCP tool calls (the skill delegates web search to MCP).
- **Good LLM model**: Multi-round drill-down requires an LLM that handles MCP tool use correctly.
- **Multiple invocations**: The skill re-invokes itself 3-4 times — ensure your AnythingLLM setup supports re-invocation.

## Storage

All state is stored in AnythingLLM's `STORAGE_DIR` directory:

- `research-graph.json` — the knowledge graph with claims and confidence scores.
- `research-reflex-cache.json` — cached responses for repeated queries.
- `research-archive/` — archived HTML from source pages.

## Dependencies

- `lowdb` — reflex cache
- `jsdom` — HTML parsing
- `dompurify` — HTML sanitisation
