# Walkthrough – Using the Stateful Deep Research Skill

This document provides a step-by-step guide to **installing, configuring, running, and extending** the stateful-deep-research skill that implements the Stateful Deep Research System.

---

## 1. Prerequisites

| Requirement | How to Verify |
|--------------|-----------------|
| AnythingLLM v1.12.1+ (Desktop, Docker, or local dev) | Open the app → Settings → About. |
| MCP tools installed and configured (web-search-mcp) | Verify via the web-search-mcp project. |
| Agent mode enabled in AnythingLLM | Check Settings → Agent. |

---

## 2. Installation

### 2.1 Locate AnythingLLM Storage Directory

| Environment | Typical Path |
|-------------|----------------|
| **Desktop (Windows)** | `%APPDATA%\AnythingLLM\storage` or check Settings → Storage. |
| **Desktop (macOS)** | `~/Library/Application Support/AnythingLLM/storage` |
| **Desktop (Linux)** | `~/.config/AnythingLLM/storage` |
| **Docker** | The volume you mounted for `STORAGE_DIR` (often `/app/storage` inside container). |
| **Local Dev** | `<project>/server/storage` |

### 2.2 Copy Skill Folders

From the repository root:

```bash
cp -r plugins/agent-skills/* <STORAGE>/plugins/agent-skills/
```

After copying, the structure should look like:

```
<STORAGE>/plugins/agent-skills/
└── stateful-deep-research/
    ├── plugin.json
    ├── handler.js
    └── package.json
```

### 2.3 Install Dependencies (If needed)

```bash
cd <STORAGE>/plugins/agent-skills/stateful-deep-research
npm install
```

### 2.4 Reload AnythingLLM

- **Desktop**: Restart the application, or toggle the agent off/on.
- **Docker**: Restart the container (`docker restart <container>`).
- **Local Dev**: Restart the backend server.

After reload, navigate to **Agent Settings → Custom Skills**. You should see:

- **Stateful Deep Research**

---

## 3. Invocation

### 3.1 Three-Phase Search Flow (Recommended)

The recommended way to use the skill follows a three-phase flow that ensures comprehensive research coverage:

**User prompt**:
```
@agent use the stateful-deep-research skill to produce a research report for: "What are the main trends shaping renewable energy storage in 2026?"
```

**Flow:**

1. **Phase 1 — Query Clarification** — The skill returns a JSON instruction to the agent asking it to analyse the query intent and generate up to `MAX_ANGLES` different search angles.

2. **Phase 2 — Multi-Angle Summary Search** — The agent extracts the angles and calls the skill again. The skill then instructs the agent to run `get-web-search-summaries` (limit: 5) for *each* angle, then select the best curated URLs across all angles.

3. **Phase 2b — Full-Content Fetch** — The skill returns a JSON instruction to call `get-single-web-page-content` for each selected URL. The agent fetches full content and calls `deepResearch` with the enriched `searchResults`.

4. **Multi-Round Drill-Down** — The skill processes curated results through its knowledge graph. If fewer than 6 facts (or conflicts detected), the skill requests follow-up searches. After sufficient depth, the skill synthesizes the final report.

**Sample output** (truncated):
```
DEEP RESEARCH REPORT: What are the main trends shaping renewable energy storage in 2026?

METHODOLOGY:
- Processed 12 sources with adaptive compression
- Applied source-authority-based confidence scoring
- 3 follow-up search rounds performed

KEY FINDINGS:

HIGH CONFIDENCE (5 findings):
1. LFP batteries now account for 90% of grid storage deployments
2. Global BESS shipments surged 50% in 2025, projected to grow another 43% in 2026
3. Long-duration energy storage (10+ hours) reaching commercial maturity
...
```

### 3.2 Direct Invocation (Full Content)

If you already have search results:

```
@agent use the stateful-deep-research skill to produce a research report for: "What are the best WMS solutions?" Results from web search: [{ ... }]
```

### 3.3 Multi-Round Research Flow

The skill automatically handles follow-up searches when more depth is needed:

```
Round 1: Initial search (three-phase flow)
    └── Skill extracts claims → builds knowledge graph
    └── Skill requests follow-up searches if needed (facts < 6 or conflicts)

Round 2: Follow-up searches
    └── Skill processes each follow-up → upserts facts into graph
    └── Checks: facts < 6 or conflicts detected?
        ├── Yes → Request more follow-up searches
        └── No → Synthesise final report

Round 3+: Synthesis
    └── Group findings by theme → Executive summary → Detailed sections
    └── Flag conflicts → Recommendation to consult sources
```

---

## 4. Installation & Configuration

### 4.1 Configure MAX_SOURCES

The `MAX_SOURCES` parameter (default: 40) controls how many sources the skill processes. This is set in the AnythingLLM skill settings:

1. Open **Agent Settings → Custom Skills**
2. Find **Stateful Deep Research**
3. Set `MAX_SOURCES` to 40 (or your desired value)

### 4.2 Configure MAX_ANGLES

The `MAX_ANGLES` parameter (default: 10) controls how many search angles the LLM generates during query clarification. This is set in the AnythingLLM skill settings:

1. Open **Agent Settings → Custom Skills**
2. Find **Stateful Deep Research**
3. Set `MAX_ANGLES` to 10 (or your desired value)

### 4.3 Configure MCP Tool Parameters

In your `mcp.json`:

```json
{
  "MAX_BROWSERS": "3",
  "MAX_CONTENT_LENGTH": "20000"
}
```

### 4.4 Reload AnythingLLM

After making changes, restart the application or toggle the agent off/on.

---

## 5. Extending the Skill

### 5.1 Swapping the Search API

The skill delegates web search to MCP tools via the skill's return prompts. To change:

1. Open `handler.js`
2. Modify `buildClarificationPrompt()`, `buildMultiAngleSearchPrompt()`, and `buildFollowUpPrompt()` to use different MCP tools or parameters.
3. The skill's return value becomes a prompt that triggers the agent's tool call.

### 5.2 Changing the LLM Endpoint

The skills assume a local AnythingLLM completion server at `http://localhost:1337/api/v1/chat/completions`. To use a different OpenAI-compatible endpoint:

1. In the `handler.js`, find the `fetch` calls to `http://localhost:1337/api/v1/chat/completions`.
2. Replace the URL with your endpoint (e.g., `https://api.openai.com/v1/chat/completions`).
3. If the endpoint requires an API key, add it via `setup_args` in `plugin.json` and access it as `this?.runtimeArgs?.LLM_API_KEY`.

### 5.3 Improving Distillation

The skill currently extracts claims from MCP output using structured prompts. To improve:

- Modify the `extractClaims()` function to use a more sophisticated prompt that extracts structured facts.
- Consider using a separate "fact-checker" model or a simple heuristic (e.g., check if the source domain is in a list of trusted domains).

### 5.4 Adding a Real Conflict Log

The skill already detects contradictions via `getConflicts()`. To add:

1. In the skill folder, create a file `conflict_log.md`.
2. When a conflict is detected, append a structured entry.

---

## 6. Troubleshooting

| Symptom | Possible Cause | Solution |
|----------|----------------|---------|
| Skill does not appear in Custom Skills list | Folder not in correct location, or `hubId` mismatch between folder name and `plugin.json`. | Verify folder name matches `hubId` in `plugin.json`. Ensure it's under `<STORAGE>/plugins/agent-skills/`. |
| "The tool failed to run for some reason" message | Error in `handler.js` (check console logs). | Look at AnythingLLM backend console (or Docker logs) for `this.logger` output. Common issues: network failure (search API down), LLM endpoint unreachable, file‑IO permissions. |
| No introspection messages | Skill not invoked, or `this.introspect` not called. | Check that the agent is enabled and the skill is selected. Try invoking via chat with explicit skill name. |
| Report is empty or "undefined" | LLM response not parsed correctly, or fetch failed. | Add more `this.logger` calls to inspect intermediate values. Verify the LLM endpoint returns JSON with an `answer` field (as assumed in the code). |
| MCP tool fails with "maxContentLength" error | MCP server not configured to accept this parameter. | Check the web-search-mcp documentation for supported parameters. |
| Multi-round research produces thin article | MCP server timeout (25s) exceeded by full-content extraction with `limit >= 12` | Ensure `maxContentLength: 2000` in search prompts. Agent should retry with `limit: 10` if timeout occurs. |
| Agent starts fresh search instead of follow-up | Follow-up instruction not parsed correctly by agent | The skill's follow-up prompt now uses `CRITICAL` prefix and concrete JSON format examples. Check handler.js `buildFollowUpPrompt()` content. |

## 7. MCP Server Constraints

The `web-search` MCP server enforces a **25-second global timeout** (`GLOBAL_TIMEOUT = 25000`) for `full-web-search` operations. This constrains how the skill's search prompts should be structured:

- `includeContent: true` triggers full-content extraction from all returned URLs, which can exceed the timeout when `limit >= 12`
- The handler's `buildInitialSearchPrompt` and `buildFollowUpPrompt` set `maxContentLength: 2000` (not `3000`) to stay within the timeout budget
- The `extractClaims` function uses `src.snippet || src.content || src.summary`, so `includeContent: true` is unnecessary
- The agent may retry with `limit: 10` when the first call with `limit: 12` times out — this is expected and correct behaviour

---

## 8. Moving to Production

1. **Choose the right flow**: Use the three-phase search for quality; direct invocation for speed.
2. **Set up monitoring**: Use the introspection messages and console logs to track token usage (if your LLM server provides token counts) and error rates.
3. **Backup storage**: Periodically backup the `storage/` directory (especially `research-graph.json`, `research-reflex-cache.json`, and `archive/`).
4. **Update skills**: Because AnythingLLM supports hot‑loading, you can edit the `handler.js` files, then either restart the agent session or reload the UI.

---

## 8. Further Reading

- **AnythingLLM Custom Skill Documentation**: https://docs.anythingllm.com/agent/custom/developer-guide
- **Model Context Protocol (MCP)**: https://modelcontextprotocol.io/ (inspiration for decoupling memory and tools)
- **Hierarchical Memory Orchestration (HMO)**: arXiv:2604.01670v1
- **EMBER (Neuromorphic Hybrid)**: arXiv:2604.12167v1
- **Reflex Fabric**: clawRxiv:2603.00044

---

*This walkthrough is a living document. As you enhance the skills, update the relevant sections to reflect new features, fixed bugs, or changed APIs.*
