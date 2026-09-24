// Optional server-side search. Search result descriptions are leads, not verified page content.
export async function collectResearch(project, { key = process.env.BRAVE_SEARCH_API_KEY, fetchImpl = fetch } = {}) {
  if (!key?.trim()) return { status: 'unavailable', sources: [], searchedAt: null, reason: 'Connect BRAVE_SEARCH_API_KEY on the local server for live web search.' };
  const query = [project.brief, project.discovery?.answers?.audience, 'alternatives market user needs']
    .filter(Boolean).join(' ').slice(0, 300);
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '6');
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key.trim() },
      signal: AbortSignal.timeout(12000), redirect: 'error' });
  } catch { throw new Error('Research search timed out or could not reach the search provider. Saved work is unchanged.'); }
  if (!response.ok) throw new Error(`Research search returned HTTP ${response.status}. Check the search key or retry later.`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Research search returned invalid JSON. Retry later.'); }
  const sources = (Array.isArray(data?.web?.results) ? data.web.results : []).map(result => ({
    title: String(result.title || '').slice(0, 180), url: String(result.url || ''),
    excerpt: String(result.description || '').replace(/<[^>]*>/g, '').slice(0, 550),
  })).filter(item => {
    try { return new URL(item.url).protocol === 'https:' && item.title; } catch { return false; }
  }).slice(0, 6);
  return { status: sources.length ? 'snippets' : 'empty', sources, searchedAt: new Date().toISOString(), query };
}

export function researchPlan(project, result) {
  if (result.status === 'unavailable') return `# Research plan — sources not collected\n\n${result.reason}\n\nBrief: ${project.discovery?.brief || project.brief}\n\nSuggested checks: identify direct alternatives; interview representative users; verify demand, accessibility needs, and delivery constraints. This is a plan, not researched findings. To collect live results, configure search, request a revision of this task, then run it again.`;
  if (result.status === 'empty') return `# Research plan — no search results\n\nSearch query: ${result.query}\n\nNo usable sources were returned. Refine the brief or search query before making factual claims. This is a research plan, not evidence-backed findings.`;
  return null;
}
