// Unified Stateful Deep Research Skill
// Orchestrates deep research through knowledge graph, conflict detection,
// and synthesis to produce detailed research reports.

const path = require("path");
const fs   = require("fs").promises;
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

// ---------- Persistence Layer: Knowledge Graph & Reflex Cache ----------
class ResearchStorage {
  constructor(storageDir) {
    this.graphPath = path.join(storageDir, "research-graph.json");
    this.cachePath = path.join(storageDir, "research-reflex-cache.json");
    this.nodes = {};

    const adapter = new FileSync(this.cachePath);
    this.db = low(adapter);
    this.db.defaults({ reflex: [] }).write();
  }

  async loadGraph() {
    try { this.nodes = JSON.parse(await fs.readFile(this.graphPath, "utf8")); }
    catch (_) { this.nodes = {}; }
  }

  async saveGraph() {
    await fs.writeFile(this.graphPath, JSON.stringify(this.nodes, null, 2));
  }

  upsertFact(claimId, fact, confidence, source, authority) {
    const node = this.nodes[claimId] ?? { claimId, confidence: 0, versions: [] };

    const existingVersion = node.versions.find(v => v.fact === fact);
    if (!existingVersion) {
      node.versions.push({ fact, source, authority, timestamp: Date.now() });
    } else if (!existingVersion.source.includes(source)) {
      existingVersion.source += `, ${source}`;
    }

    const authWeights = { MASTER: 1.0, SENIOR: 0.8, JUNIOR: 0.5, USER: 0.3 };
    const authWeight = authWeights[authority] || 0.5;
    node.confidence = Math.max(node.confidence, confidence * authWeight);
    this.nodes[claimId] = node;
  }

  topFacts(limit = 15) {
    return Object.values(this.nodes)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit)
      .map(node => ({
        claimId: node.claimId,
        fact: node.versions[node.versions.length - 1].fact,
        sources: node.versions.map(v => v.source).join(", "),
        confidence: node.confidence
      }));
  }

  getConflicts() {
    return Object.values(this.nodes)
      .filter(n => new Set(n.versions.map(v => v.fact)).size > 1)
      .map(n => ({ claimId: n.claimId, versions: n.versions }));
  }

  getCachedResponse(query) {
    return this.db.get('reflex').find({ query }).value();
  }

  saveToCache(query, response) {
    this.db.get('reflex')
      .push({ query, response, hits: 1, updated_at: Date.now() })
      .write();
  }

  async resetGraph() {
    this.nodes = {};
    await this.saveGraph();
  }
}

// ---------- Helpers (loaded inside functions to avoid module-load failures) ----------
function cleanHtml(html) {
  try {
    const { JSDOM } = require("jsdom");
    const createDOMPurify = require("dompurify");
    const domWindow = new JSDOM("").window;
    const DOMPurify = createDOMPurify(domWindow);
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    if (!doc || !doc.body) return "";
    doc.querySelectorAll("script, style, nav, footer, iframe").forEach((s) => s.remove());
    let text = doc.body.textContent || "";
    text = DOMPurify.sanitize(text);
    return (text || "").replace(/\s+/g, " ").trim().slice(0, 5000);
  } catch (_) {
    return (html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
  }
}

async function ensureStorageDir(storageDir) {
  try { await fs.mkdir(storageDir, { recursive: true }); } catch (_) { /* already exists or permission error */ }
}

function splitLines(content) {
  // Split by newlines, but if content has no newlines and is long,
  // use smarter heuristics for single-paragraph output.
  let lines = content.split('\n').filter(l => l.trim().length > 30);

  if (lines.length === 1 && lines[0].length > 200) {
    const raw = lines[0];

    // Strategy 1: numbered list markers (1), 1., 2) etc.)
    const numbered = raw.split(/(?=\d{1,3}[\)\.]\s)/)
      .filter(l => l.trim().length > 50);
    if (numbered.length > 1) { lines = numbered; }

    // Strategy 2: sentence boundary (period followed by space + capital)
    if (lines.length <= 1) {
      const bySentences = raw.split(/(?<=[.!?])\s+(?=[A-Z])/)
        .filter(l => l.trim().length > 60);
      if (bySentences.length > 1) { lines = bySentences; }
    }

    // Strategy 3: colon-separated headings (e.g., "Revenue: $1B" at start of sentence)
    if (lines.length <= 1) {
      const byHeadings = raw.split(/(?=(?:The |According to |Research |A |This |Over |More |Key |Key |Most |About |With |At |For |In |On |From |And |But |However |Despite |While |Where |When |How |What |Who |Which |Which |Which |Which )\w+[^.]{0,40}:)/)
        .filter(l => l.trim().length > 80);
      if (byHeadings.length > 1) { lines = byHeadings; }
    }

    // Strategy 4: common transition phrases
    if (lines.length <= 1) {
      const transitions = [
        'Additionally,', 'Furthermore,', 'Moreover,', 'Importantly,',
        'Notably,', 'Significantly,', 'Research shows', 'According to',
        'Findings show', 'The study', 'Analysis', 'Survey',
        'According to', 'Expert', 'Study', 'Report', 'Report',
        'Market', 'Industry', 'Revenue', 'Sales', 'Growth',
        'Meanwhile,', 'Conversely,', 'In contrast,', 'Similarly,'
      ];
      const pattern = new RegExp('(?=(?:' + transitions.join('|') + ')[^.]{0,60})');
      const byTransitions = raw.split(pattern)
        .filter(l => l.trim().length > 60);
      if (byTransitions.length > 1) { lines = byTransitions; }
    }

    // Strategy 5: aggressive sentence-level splitting using multiple delimiters
    // Handles: period, exclamation, question mark (when followed by space or end)
    if (lines.length <= 1) {
      const aggroSentences = raw.match(/[^.!?]+[.!?]\s*/g) || [raw];
      const filtered = aggroSentences.filter(l => l.trim().length > 50);
      if (filtered.length > 1) { lines = filtered; }
    }

    // Strategy 6: split at common sentence-ending patterns
    if (lines.length <= 1) {
      const byPatterns = raw.split(/(?<=[.!?)])\s+(?=[A-Z\d])/)
        .filter(l => l.trim().length > 40);
      if (byPatterns.length > 1) { lines = byPatterns; }
    }

    // Strategy 7: fallback — split at any sentence-ending punctuation
    if (lines.length <= 1) {
      const byPunc = raw.split(/(?<=[.!?])\s+/)
        .filter(l => l.trim().length > 30);
      if (byPunc.length > 1) { lines = byPunc; }
    }
  }

  return lines;
}

function extractClaims(searchResults, maxSources = 40) {
  const claims = [];

  // Parse MCP-synthesized output
  // MCP returns: [{ query: "...", searchResults: "..." }]

  // If MCP returned structured JSON with title/url/snippet, extract from each
  let sources = [];
  const searchText = typeof searchResults === 'string' ? searchResults : JSON.stringify(searchResults);

  // If MCP returned structured JSON with title/url/snippet, extract from each
  try {
    const parsed = JSON.parse(searchText);
    if (Array.isArray(parsed)) {
      sources = parsed;
    } else if (parsed.results && Array.isArray(parsed.results)) {
      sources = parsed.results;
    } else if (parsed.query && parsed.searchResults) {
      sources = [{ snippet: parsed.searchResults || parsed.snippet || '', url: `mcp-${parsed.query.slice(0, 10)}` }];
    } else {
      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = searchText.match(urlRegex) || [];
      sources = urls.map((url, i) => ({ index: i, url }));
    }
  } catch (_) {
    const lines = searchText.split('\n').filter(l => l.trim());
    const urlRegex = /https?:\/\/[^\s]+/g;
    sources = lines.map((line, i) => {
      const urls = line.match(urlRegex) || [];
      return { index: i, url: urls[0] || '', snippet: line.trim() };
    });
  }

  for (let i = 0; i < Math.min(sources.length, maxSources); i++) {
    const src = sources[i] || {};
    const content = src.snippet || src.content || src.summary || src.searchResults || '';
    const url = src.url || `source_${i}`;

    if (!content || content.length < 30) continue;

    // Try multiple extraction strategies
    const lines = splitLines(content);

    for (const line of lines) {
      const trimmed = line.trim();

      // Structured CLAIM_ID/Fact blocks
      if (trimmed.includes('CLAIM_ID:') || trimmed.includes('Fact:')) {
        const blockMatch = trimmed.match(/CLAIM_ID:\s*(.+)?\n?\s*Fact:\s*(.*)/i);
        if (blockMatch) {
          claims.push({
            claimId: blockMatch[1]?.trim() || `claim_${i}`,
            fact: blockMatch[2]?.trim() || trimmed,
            source: url,
            authority: "SENIOR"
          });
          continue;
        }
      }

      // Generic claim-worthy content — aggressive extraction
      const hasMetric = /\d+%|\d+\.\d+|\d+x|\d+\s*\w+|over \d+\d+|\d{4,}/.test(trimmed);
      const hasSpecific = /\d{4,}/.test(trimmed);
      const hasAuthority = /expert|research|study|report|analysis|findings|survey|commissioned|conducted by|showed|revealed|found|indicated|reported|estimated|suggested|demonstrated|revealed|confirms|shows|i|indicates|presents|demonstrates/i.test(trimmed);

      const threshold = hasAuthority ? 30 : hasSpecific ? 40 : hasMetric ? 60 : 80;
      if (trimmed.length >= threshold) {
        // Extract compound claims: split on coordinating conjunctions within long claims
        const subClaims = trimAndSplitCompound(trimmed);
        for (const sub of subClaims) {
          claims.push({
            claimId: `claim_${i}_${Date.now().toString().slice(-4)}`,
            fact: sub,
            source: url,
            authority: hasAuthority ? "MASTER" : hasSpecific ? "SENIOR" : "JUNIOR"
          });
        }
      }
    }
  }

  return claims;
}

function trimAndSplitCompound(text) {
  const txt = text.trim();
  // Split compound sentences on coordinating conjunctions + semicolons
  // e.g., "X is Y, and A is B" → ["X is Y", "A is B"]
  const compoundPats = [
    /,\s+(?:and|but|yet|or|so)\s+[^.]+(?=\s+$)/i,
    /;\s*(?:but|however|moreover|furthermore|additionally|conversely|meanwhile|alternatively|consequently)\s+/i,
  ];

  for (const pat of compoundPats) {
    if (txt.length > 120 && pat.test(txt)) {
      return txt.split(pat).filter(s => s.trim().length > 30);
    }
  }

  return [txt];
}

// ---------- Deep research loop ----------
async function processResearchLoop(query, env, ctx, callerId) {
  const MAX_SOURCES = this?.runtimeArgs?.MAX_SOURCES ? parseInt(this.runtimeArgs.MAX_SOURCES) : 15;
  const storageRoot = process.env.STORAGE_DIR || path.join(__dirname, "..", "storage");
  await ensureStorageDir(storageRoot);
  const storage = new ResearchStorage(storageRoot);
  await storage.loadGraph();

  try {
    // Check cache
    const cached = storage.getCachedResponse(query);
    if (cached) {
      ctx.introspect(`${callerId} cache hit`);
      storage.db.get('reflex')
        .find({ query })
        .assign({ hits: cached.hits + 1 })
        .write();
      return cached.response;
    }

    ctx.introspect(`${callerId} starting multi-round deep research for: ${query}`);

    // Round 1: Initial broad search
    if (env.searchResults) {
      ctx.introspect(`${callerId} processing initial search results`);
      await processSearchResults(env.searchResults, storage, MAX_SOURCES);
      const facts = storage.topFacts(8);
      if (facts.length === 0) {
        ctx.introspect(`${callerId} no initial facts found`);
        return "No structured claims found in search results. Please try a different query or provide more detailed results.";
      }

      await storage.saveGraph();
      ctx.introspect(`${callerId} initial findings extracted, requesting follow-up searches...`);
      return buildFollowUpPrompt(query, facts);
    }

    // Round 2+: Follow-up search processing
    let followUps = [];
    if (env.followUps) {
      if (typeof env.followUps === 'string') {
        try { followUps = JSON.parse(env.followUps); } catch (_) { followUps = []; }
      } else if (Array.isArray(env.followUps)) {
        followUps = env.followUps;
      }
    }

    if (followUps.length > 0) {
      ctx.introspect(`${callerId} processing ${followUps.length} follow-up searches`);

      for (const fu of followUps) {
        if (fu && fu.searchResults) {
          const claims = extractClaims(fu.searchResults, MAX_SOURCES);
          for (const c of claims) {
            storage.upsertFact(c.claimId, c.fact, c.confidence || 0.85, c.source, c.authority);
          }
        }
      }
      await storage.saveGraph();

      // Check if we need more rounds
      const facts = storage.topFacts(15);
      const conflicts = storage.getConflicts();

      ctx.introspect(`${callerId} after follow-ups: ${facts.length} facts, ${conflicts.length} conflicts`);

      // Fixed follow-up threshold: if fewer than 6 facts, request follow-ups; if >= 6, synthesize
      if (facts.length >= 6 && conflicts.length === 0) {
        // Enough depth, synthesize final report
        return await synthesizeReport(query, storage, ctx, callerId);
      }

      // Still need more drilling
      return buildFollowUpPrompt(query, facts);
    }

    // No search results at all - generate initial search prompts
    return buildInitialSearchPrompt(query);

  } catch (e) {
    ctx.introspect(`${callerId} ERROR: ${e.message}`);
    ctx.logger(`${callerId} stack`, e.stack);
    return `Deep Research Error: ${e.message}`;
  }
}

function processSearchResults(searchResults, storage, maxSources) {
  const claims = extractClaims(searchResults, maxSources);
  for (const c of claims) {
    storage.upsertFact(c.claimId, c.fact, c.confidence || 0.85, c.source, c.authority);
  }
  return claims;
}

function buildFollowUpPrompt(query, facts) {
  const topicSuggestions = [
    "Current status and latest developments in",
    "Key players and competitive landscape for",
    "Technical details and how it works",
    "Industry trends and future outlook for",
    "Financial performance and growth metrics for"
  ];

  // Build a summary of what we already know
  const factSummary = facts.map(f => f.fact.slice(0, 120)).slice(0, 3).join('; ');
  const uniqueTopics = new Set(facts.map(f => f.claimId.split('_')[0]));
  const topicCount = uniqueTopics.size;
  const sourceCount = [...new Set(facts.map(f => f.source))].length;

  const instruction = `I've found ${facts.length} facts about "${query}" across ${topicCount} topics from ${sourceCount} sources (summary: ${factSummary}).

To produce a comprehensive Google-level research report, I need deeper coverage. Please perform these follow-up searches using the "full-web-search" MCP tool:

1. ${topicSuggestions[0]} ${query}
2. ${topicSuggestions[1]} ${query}
3. ${topicSuggestions[2]} ${query}
4. ${topicSuggestions[3]} ${query}
5. ${topicSuggestions[4]} ${query}

For each search use: { limit: 12, maxContentLength: 2000 }.

CRITICAL: After gathering results, assemble a JSON array of objects with fields "query" and "searchResults" for each search. Then call this skill with the \`followUps\` parameter set to that exact array.

Format: {"followUps": [{"query": "search query text", "searchResults": {"content": "...", "query": "...", ...}}, ...]}`;

  return JSON.stringify({
    status: "COMPLETED",
    instruction,
    prompt: `Please perform 5 follow-up web searches with full-web-search (limit=12, maxContentLength=2000), then combine all results and call this skill again with the \`followUps\` parameter.`
  });
}

function buildInitialSearchPrompt(query) {
  return JSON.stringify({
    status: "COMPLETED",
    instruction: `Use the "full-web-search" MCP tool with: { query: "${query}", limit: 12, maxContentLength: 2000 }
For 2-3 key URLs from results, also call "get-single-web-page-content" to extract full article text.
Then call this skill again with the \`searchResults\` parameter set to all results combined.

Format: { "researchQuery": "...", "searchResults": [ {"title": "...", "url": "...", "snippet": "...", "content": "..."}, ... ] }`,
    prompt: `Please perform a web search for: "${query}" using full-web-search with limit=12, maxContentLength=2000. Then call this skill again with the searchResults parameter.`
  });
}

async function llmSynthesizeReport(query, facts, conflicts, ctx, callerId) {
  ctx.introspect(`${callerId} llmSynthesizeReport: ${facts.length} facts`);
  const topics = {};
  facts.forEach(f => {
    const fact = f.fact.toLowerCase();
    if (/(?:growth|market|revenue|sales|financial|performance|stock|share|stock price|profit|earnings|income|margin)/.test(fact)) {
      (topics['Financial Performance'] ??= []).push(f);
    } else if (/(?:product|feature|launch|update|release|version|innovation|technology|software|platform|solution|service|application)/.test(fact)) {
      (topics['Product & Innovation'] ??= []).push(f);
    } else if (/(?:competitor|alternative|rival|competition|industry|market share|landscape|position|standing)/.test(fact)) {
      (topics['Competitive Landscape'] ??= []).push(f);
    } else if (/(?:customer|user|adoption|demand|pricing|subscription|client|buyer|buyer|buyer)/.test(fact)) {
      (topics['Customer Insights'] ??= []).push(f);
    } else {
      (topics['General Overview'] ??= []).push(f);
    }
  });

  // If we don't have enough facts, return a follow-up prompt instead of a weak article
  if (facts.length < 10 || Object.keys(topics).length < 3) {
    const topicGaps = Object.entries(topics).map(([t, fs]) => `${t} (${fs.length} findings)`).join('; ');
    return `I have only ${facts.length} findings on "${query}" so far. I need more data. Please search for additional information on:

${topicGaps}

Use the web_search tool to find more specific research results. Then call this skill again with the searchResults parameter.`;
  }

  // Return structured state for the transformation phase
  const uniqueSources = [...new Set(facts.map(f => f.source))].slice(0, 10);
  const state = { query, facts, conflicts, topics, uniqueSources, topicCount: Object.keys(topics).length };
  return JSON.stringify({ status: "FACTS_CAPTURED", query, state, prompt: `Captured ${facts.length} facts across ${Object.keys(topics).length} topics. Now invoke the transformation phase to convert these into a detailed article.` });
}

async function transformToArticle(query, facts, conflicts, topics, uniqueSources) {
  const now = new Date();
  const currentYear = String(now.getFullYear());

  const topicNarratives = Object.entries(topics).map(([title, fs]) => {
    const selected = fs.slice(0, 8).map(f => {
      let text = f.fact.replace(/^[\d\-\*]+\.?\s*/, '').trim();
      // Strip "2025" references so the LLM doesn't anchor to them
      // (the LLM already knows the current year via [Current date: ...])
      text = text.replace(/\b2025\b/gi, '');
      text = text.replace(/\b2024\b/gi, '');
      // Fix orphaned double spaces
      text = text.replace(/\s{2,}/g, ' ').trim();
      return text;
    });
    return `### ${title}\n\n${selected.map(f => `• ${f.slice(0, 200)}`).join('\n')}`;
  }).join('\n\n');

  let conflictNote = '';
  if (conflicts.length > 0) {
    const conflictText = conflicts.map(c => c.claimId + ': ' + c.versions.join(' vs ')).join('. ');
    conflictNote = `\n\nConflicting findings detected — you should address these in the article and explain the resolution: ${conflictText}.`;
  }

  const prompt = `You are an expert research analyst writing a comprehensive article in the style of a Google Deep Research publication.

## What you do
Turn the source material below into a more verbose article like Google Deep Research would produce. We need the depth and analysis to explain what this actually means.

## Current year
Write in the current year. Do not write about the past — all data and research is from the current year.

## Source Material
${topicNarratives}

${uniqueSources?.length > 0 ? `## Sources Cited\n${uniqueSources.join(', ')}` : ''}
${conflictNote}

## Critical
- Write flowing prose with smooth transitions
- NO bullet points, NO numbered lists, NO markdown tables
- Use italics sparingly for emphasis

## Article Structure
- Strong opening paragraph that establishes context and significance
- 4-6 well-developed sections with appropriate subheadings
- Brief conclusion that synthesizes the key takeaways

## Output Rules
- Output ONLY the article — no preamble, no "Here is the article", no closing remarks
- Do NOT format as a list of findings — transform into a proper article
- Address any conflicting findings and explain resolution

Write the article now.`;

  const resultRaw = await callLLM(prompt);
  if (resultRaw) {
    return JSON.stringify({ status: "COMPLETED", instruction: resultRaw });
  }
  return synthesizeReportFallback(query, facts, conflicts, topics);
}

async function callLLM(prompt) {
  try {
    const currentDate = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const res = await fetch('http://localhost:1337/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `[Current date: ${currentDate}] ${prompt}` }],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim();
  } catch {
    return null;
  }
}

async function synthesizeReport(query, storage, ctx, callerId) {
  const facts = storage.topFacts(15);
  const conflicts = storage.getConflicts();
  const result = await llmSynthesizeReport(query, facts, conflicts, ctx, callerId);

  // Check if we need more data
  if (typeof result === 'string' && !result.startsWith('{')) {
    return result; // Follow-up prompt
  }

  // Parse structured state from llmSynthesizeReport
  const parsed = JSON.parse(result);
  if (parsed.status === "FACTS_CAPTURED") {
    // Now transform to article
    const articleResult = await transformToArticle(
      parsed.query,
      parsed.state.facts,
      parsed.state.conflicts,
      parsed.state.topics,
      parsed.state.uniqueSources
    );
    return articleResult;
  }

  // Fallback
  return synthesizeReportFallback(parsed.query, parsed.state?.facts ?? [], parsed.state?.conflicts ?? [], {});
}
function synthesizeReportFallback(query, facts, conflicts, topics) {
  const totalFacts = facts.length;
  const topicCount = Object.keys(topics).length;
  const topFacts = facts.slice(0, 5).map(f => f.fact.slice(0, 150));

  let summary = `## Executive Summary\n\n`;
  summary += `This report presents findings from a multi-round deep research process on "${query}". `;
  summary += `${totalFacts} key findings were extracted across ${topicCount} thematic areas through adaptive knowledge graph construction and cross-source conflict resolution.\n\n`;
  summary += `**Core findings include:**\n\n`;
  for (const ft of topFacts) {
    summary += `- ${ft.slice(0, 200)}\n`;
  }
  summary += `\nThe analysis draws on multiple sources including market research, financial data, competitive intelligence, and industry reports.`;
  return summary;
}

function buildThematicSections(topics, query) {
  const entries = Object.entries(topics).sort((a, b) => b[1].length - a[1].length);
  const sectionParts = [];

  entries.forEach(([title, sectionFacts], idx) => {
    if (sectionFacts.length === 0) return;

    // Write flowing prose rather than bullet points
    let prose = `### ${title}\n\n`;
    const facts = sectionFacts.map(f => ({ ...f, original: f.fact }));

    // Sort by confidence for authoritative claims first
    facts.sort((a, b) => b.confidence - a.confidence);

    // Convert facts to narrative sentences
    const sentences = facts.map(f => {
      const raw = f.fact;
      // If the fact already looks like a sentence, use it; otherwise, prefix it
      if (/^[A-Z]/.test(raw.trim())) return raw.trim();
      return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;
    });

    // Group into paragraphs of 3-5 sentences
    const paragraphs = [];
    for (let i = 0; i < sentences.length; i += 4) {
      const chunk = sentences.slice(i, i + 4);
      paragraphs.push(chunk.join('. '));
    }

    prose += paragraphs.map(p => `${p}.\n\n`).join('');

    // Add source attribution
    const allSources = [...new Set(facts.map(f => f.source))].slice(0, 8);
    if (allSources.length > 0) {
      prose += `*Sources: ${allSources.join(', ')}*\n`;
    }

    sectionParts.push(prose);
  });

  return sectionParts.join('\n\n');
}

function buildConflictsSection(conflicts) {
  if (conflicts.length === 0) {
    return '## Cross-Source Verification\n\nAll key findings are consistent across sources. No contradictions were detected in the collected data.';
  }
  let s = '## Cross-Source Verification\n\nThe following findings show contradictions across sources:\n\n';
  for (const c of conflicts) {
    s += `- **${c.claimId}**: ${c.versions.map(v => v.fact.slice(0, 100)).join(' vs ')}\n`;
  }
  return s;
}

function buildMethodology(query, facts) {
  const uniqueSources = [...new Set(facts.map(f => f.source))];
  return `## Methodology\n\n- **Knowledge Graph**: ${facts.length} claims extracted from multiple search rounds with adaptive confidence scoring\n- **Conflict Resolution**: Contradictory claims flagged for review\n- **Sources**: ${uniqueSources.join(', ')}\n- **Confidence Threshold**: Claims only synthesized when confidence ≥ 0.7\n- **Process**: Multi-round drill-down with ${facts.length > 10 ? 'deep synthesis' : 'standard synthesis'} of findings\n\n*Report generated by stateful-deep-research skill (v${query ? 'current' : 'unknown'})*\n`;
}

function buildConclusion(query, facts) {
  const totalFacts = facts.length;
  if (totalFacts < 6) {
    return `## Conclusion\n\nWhile limited data was gathered on "${query}", a full synthesis is not yet possible. Consider performing additional targeted searches to deepen the knowledge base.`;
  }
  return `## Conclusion\n\nThis report synthesized ${totalFacts} verified findings on "${query}" across multiple thematic areas. The multi-round deep research process combined broad initial searches with targeted follow-up drill-downs to build a comprehensive understanding of the subject. Key findings are presented above with confidence scores and source attribution.\n\nFor deeper investigation into any specific area, use the follow-up search capability provided in the research flow.\n`;
}

// ---------- Two-Phase Search Handlers ----------

function buildClarificationPrompt(query, maxAngles) {
  const limit = maxAngles ?? 10;
  return JSON.stringify({
    status: "COMPLETED",
    instruction: `Analyse the following research query and generate ${limit} distinct search angles to ensure comprehensive coverage:

Query: "${query}"

Please extract the key topics, dimensions, and perspectives that need to be covered. For example, for "WMS systems" you might generate angles like:
- Current market leaders and their features
- Technical architecture and integration capabilities
- Industry adoption and customer case studies
- Pricing and licensing models
- Future trends (AI, automation, cloud)

Return a JSON array of strings, where each string is one search angle:
{"angles": ["Angle 1", "Angle 2", "Angle 3", ...]}`,
    prompt: `Please analyse this research query and generate ${limit} search angles: "${query}"`
  });
}

function buildMultiAngleSearchPrompt(angles, maxAngles) {
  const limit = maxAngles ?? 5;
  const angleList = angles.map((a, i) => `${i + 1}. ${a}`).join('\n');
  return JSON.stringify({
    status: "COMPLETED",
    instruction: `Use the "get-web-search-summaries" MCP tool to search for each of these angles (limit: ${limit} per angle):

${angleList}

For each angle, call "get-web-search-summaries" with { query: "...", limit: ${limit} }.

After gathering summaries for all angles, select the most relevant and high-value URLs across all angles (aim for 10-20 distinct URLs).

Then call this skill again with the \`webFetchsingle\` handler, passing the URLs of your selected sources.

Format: { "urls": ["https://...", "https://...", ...] }`,
    prompt: `Please perform web searches for these angles using get-web-search-summaries (limit=${limit} per angle), then call this skill with the best URLs.`
  });
}

function buildSummarySearchPrompt(query) {
  return JSON.stringify({
    status: "COMPLETED",
    instruction: `Use the "get-web-search-summaries" MCP tool to search for: "${query}"
  
  Set the limit to 50 (or the maximum available) to get a wide net of results.
  
  Read through all the results (titles, URLs, and brief descriptions). Pick the 8-12 most relevant and interesting ones for a deep report on this topic.
  
  Then call this skill again with the \`webFetchsingle\` handler, passing the URLs of your selected sources.
  
  Format: { "urls": ["https://...", "https://...", ...] }`,
    prompt: `Please perform a broad web search for: "${query}" using get-web-search-summaries with limit=50, then call this skill with the best URLs.`
  });
}

function buildFullFetchPrompt(urls, researchQuery) {
  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');
  return JSON.stringify({
    status: "COMPLETED",
    instruction: `Use the "get-single-web-page-content" MCP tool to retrieve the full content of each of these URLs:

${urlList}

For each URL, call "get-single-web-page-content" with the URL. Then call this skill again with the \`deepResearch\` handler, passing:
- researchQuery: "${researchQuery}"
- searchResults: an array of objects, each with { title, url, snippet, content }

Format: { "researchQuery": "...", "searchResults": [{ "title": "...", "url": "...", "snippet": "...", "content": "..." }, ...] }`,
    prompt: `Please fetch full article content for the URLs above, then call this skill with the searchResults parameter.`
  });
}

// ---------- Main Handler ----------
module.exports.runtime = {
  handler: async function ({ researchQuery, searchResults, followUps, urls, searchAngles }) {
    const callerId = `StatefulResearch-v${this.config.version}`;

    try {
      if (!researchQuery) {
        this.introspect(`${callerId} ERROR: researchQuery is missing or undefined.`);
        return "Please provide a research query.";
      }

      // If searchAngles provided, this is the multi-angle search stage
      if (searchAngles && Array.isArray(searchAngles)) {
        const MAX_ANGLES = this?.runtimeArgs?.MAX_ANGLES ? parseInt(this.runtimeArgs.MAX_ANGLES) : 10;
        return buildMultiAngleSearchPrompt(searchAngles, MAX_ANGLES);
      }

      // If searchResults provided, this is the full-fetch stage (after webFetchsingle)
      if (urls && Array.isArray(urls)) {
        return buildFullFetchPrompt(urls, researchQuery);
      }

      // If searchResults or followUps provided, process normally
      if (searchResults || followUps) {
        return await processResearchLoop(researchQuery, {
          searchResults,
          followUps
        }, this, callerId);
      }

      // No params — generate clarification prompt (new clarification step)
      const MAX_ANGLES = this?.runtimeArgs?.MAX_ANGLES ? parseInt(this.runtimeArgs.MAX_ANGLES) : 10;
      return buildClarificationPrompt(researchQuery, MAX_ANGLES);

    } catch (e) {
      this.introspect(`${callerId} ERROR: ${e.message}`);
      this.logger(`${callerId} stack`, e.stack);
      return `Deep Research Error: ${e.message}`;
    }
  }
};
