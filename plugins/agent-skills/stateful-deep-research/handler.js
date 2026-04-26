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

function extractClaims(searchResults) {
  const claims = [];

  // Parse MCP-synthesized output
  // MCP returns: [{ query: "...", searchResults: "..." }]

  // If MCP returned structured JSON with title/url/snippet, extract from each
  let sources = [];
  try {
    const parsed = JSON.parse(searchResults);
    if (Array.isArray(parsed)) {
      sources = parsed;
    } else if (parsed.results && Array.isArray(parsed.results)) {
      sources = parsed.results;
    } else if (parsed.query && parsed.searchResults) {
      sources = [{ snippet: parsed.searchResults || parsed.snippet || '', url: `mcp-${parsed.query.slice(0, 10)}` }];
    } else {
      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = searchResults.match(urlRegex) || [];
      sources = urls.map((url, i) => ({ index: i, url }));
    }
  } catch (_) {
    const lines = searchResults.split('\n').filter(l => l.trim());
    const urlRegex = /https?:\/\/[^\s]+/g;
    sources = lines.map((line, i) => {
      const urls = line.match(urlRegex) || [];
      return { index: i, url: urls[0] || '', snippet: line.trim() };
    });
  }

  for (let i = 0; i < Math.min(sources.length, 10); i++) {
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
      await processSearchResults(env.searchResults, storage);
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
          const claims = extractClaims(fu.searchResults);
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

      if (facts.length >= 6 && conflicts.length === 0) {
        // Enough depth, synthesize final report
        return await synthesizeReport(query, storage);
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

function processSearchResults(searchResults, storage) {
  const claims = extractClaims(searchResults);
  for (const c of claims) {
    storage.upsertFact(c.claimId, c.fact, c.confidence || 0.85, c.source, c.authority);
  }
  return claims;
}

function buildFollowUpPrompt(query, facts) {
  const topicSuggestions = [
    "Current status and latest news about",
    "Key competitors and market alternatives to",
    "Technical architecture and how it works",
    "Industry trends and future outlook for",
    "Financial performance and recent growth"
  ];

  // Build a short summary of what we already know
  const factSummary = facts.map(f => f.fact.slice(0, 120)).slice(0, 3).join('; ');

  const instruction = `I've found ${facts.length} facts about "${query}" (preliminary summary: ${factSummary}).

To produce a Google-level research report, I need deeper coverage. Please perform these follow-up searches:

1. Current status and latest news about ${query}
2. Key competitors and alternatives to ${query}
3. Technical implementation and how ${query} works
4. Industry trends and market outlook for ${query}
5. Financial performance and growth metrics for ${query}

Use the web_search MCP tool for each. Then call this skill again with the results.\n\nFormat: {"followUps": [{"query": "...", "searchResults": "..."}, ...]}`;

  return JSON.stringify({
    status: "COMPLETED",
    instruction,
    prompt: `Please perform 5 follow-up web searches for these topics and return the results as searchResults objects for this skill.`
  });
}

function buildInitialSearchPrompt(query) {
  return JSON.stringify({
    status: "COMPLETED",
    instruction: `Use the web_search MCP tool to perform a broad search for: "${query}".\nThen call this skill again with the \`searchResults\` parameter set to those results.`,
    prompt: `Please perform a web search for: "${query}" using the web_search tool. Return the search results (titles, URLs, and snippets) as the searchResults parameter when you call this skill again.`
  });
}

async function llmSynthesizeReport(query, facts, conflicts) {
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

  const sections = Object.entries(topics)
    .map(([title, sectionFacts]) => `### ${title}\n\n${sectionFacts.map(f => `- **${f.fact.slice(0, 200)}** (conf. ${f.confidence.toFixed(2)}, sources: ${f.sources})`).join('\n  ')}`)
    .join('\n\n');

  const prompt = buildSynthesisPrompt(query, { topics, conflicts, uniqueSources: [...new Set(facts.map(f => f.source))] });
  const resultRaw = await callLLM(prompt);
  if (resultRaw) {
    return JSON.stringify({ status: "COMPLETED", instruction: resultRaw });
  }

  // Fallback to bullet-point report if LLM call fails
  return synthesizeReportFallback(query, facts, conflicts, topics);
}

function buildSynthesisPrompt(query, input) {
  return `Write a comprehensive, Google-Deep-Research-style article on "${query}" using the following verified facts gathered from multiple rounds of deep research.

Write in professional journalistic style with flowing prose, not bullet points or numbered lists. Use paragraph structure, transitional sentences, and thematic flow.

## Facts by Topic
${Object.entries(input.topics).map(([title, facts]) => {
  return `### ${title}
${facts.map(f => '- ' + f.fact.slice(0, 200)).join('\n')}`;
}).join('\n\n')}

## Conflicting Findings
${input.conflicts.length > 0 ? input.conflicts.map(c => `**${c.claimId}**: ${c.versions.join(' vs ')}`).join('\n') : 'None detected.'}

## Unique Sources (${input.uniqueSources.length})
${input.uniqueSources.join(', ')}

## Writing Instructions
- Write 1500-2000 words (a full article, not a summary)
- Use flowing prose with smooth transitions between paragraphs
- Use appropriate subheadings for section structure
- Use italics for emphasis
- Do NOT use bullet points
- Do NOT use numbered lists (1, 2, 3)
- Do NOT use the format "- **Claim** (conf. 0.95)"
- Do NOT use markdown tables
- Integrate facts naturally into sentences
- Reference multiple sources where appropriate
- Use data-driven reasoning and cite findings with specificity
- Include a strong introductory paragraph that sets the context
- Include a brief conclusion that synthesizes the key takeaways
- Address and resolve any conflicting findings
- Maintain a professional, authoritative tone throughout

Write the article now. Output ONLY the article content — no preamble, no "Here is the article", no closing remarks.`;
}

async function callLLM(prompt) {
  try {
    const res = await fetch('http://localhost:1337/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim();
  } catch {
    return null;
  }
}

function synthesizeReport(query, storage) {
  const facts = storage.topFacts(30);
  const conflicts = storage.getConflicts();

  if (facts.length === 0) {
    return JSON.stringify({ status: "COMPLETED", instruction: `I couldn't find enough information about "${query}" to write a detailed report. Try a different query.` });
  }

  // Try LLM-powered prose synthesis (Google-Deep-Research style)
  return llmSynthesizeReport(query, facts, conflicts);
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

// ---------- Main Handler ----------
module.exports.runtime = {
  handler: async function ({ researchQuery, searchResults, followUps }) {
    const callerId = `StatefulResearch-v${this.config.version}`;

    if (!researchQuery) {
      this.introspect(`${callerId} ERROR: researchQuery is missing or undefined.`);
      return "Please provide a research query.";
    }

    return await processResearchLoop(researchQuery, {
      searchResults,
      followUps
    }, this, callerId);
  }
};
