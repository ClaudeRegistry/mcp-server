// Catalog: fetch + transform + cache of the ClaudeRegistry marketplace.json.
// Mirrors the website's marketplaceService.js transform.

const MARKETPLACE_URL =
  'https://raw.githubusercontent.com/ClaudeRegistry/marketplace/main/.claude-plugin/marketplace.json';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache = {
  plugins: [],
  fetchedAt: 0,
  lastGood: null, // last successfully-fetched plugin array
};

function transformEntry(entry) {
  const name = entry.name || '';
  const id = name.toLowerCase().replace(/\s+/g, '-');
  const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
  const commands = Array.isArray(entry.commands) ? entry.commands : [];
  const agents = Array.isArray(entry.agents) ? entry.agents : [];
  const skills = Array.isArray(entry.skills) ? entry.skills : [];
  const author = entry.author;

  return {
    id,
    name,
    version: entry.version,
    description: entry.description,
    category: entry.category,
    tags: keywords,
    author,
    license: entry.license,
    commands,
    agents,
    skills,
    counts: {
      commands: commands.length,
      agents: agents.length,
      skills: skills.length,
    },
    homepage: entry.homepage,
    installMarketplace: '/plugin marketplace add clauderegistry/marketplace',
    installCommand: `/plugin install ${id}@clauderegistry`,
    searchableText: [name, entry.description, ...keywords, author && author.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

async function fetchCatalog() {
  const now = Date.now();
  if (cache.plugins.length && now - cache.fetchedAt < TTL_MS) {
    return cache.plugins;
  }

  try {
    const res = await fetch(MARKETPLACE_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rawPlugins = Array.isArray(data.plugins) ? data.plugins : [];
    const plugins = rawPlugins.map(transformEntry);

    cache = { plugins, fetchedAt: now, lastGood: plugins };
    return plugins;
  } catch (err) {
    // On fetch error: serve last-good cache, or an empty list. Never crash.
    if (cache.lastGood) {
      cache.fetchedAt = now; // avoid hammering on repeated errors within TTL
      return cache.lastGood;
    }
    return [];
  }
}

export async function searchPlugins(query, category) {
  const plugins = await fetchCatalog();
  const q = query ? String(query).toLowerCase().trim() : '';
  const cat = category ? String(category).toLowerCase().trim() : '';

  let results = plugins;
  if (q) {
    results = results.filter((p) => p.searchableText.includes(q));
  }
  if (cat) {
    results = results.filter(
      (p) => (p.category || '').toLowerCase() === cat
    );
  }

  return results.slice(0, 15).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    installCommand: p.installCommand,
  }));
}

export async function getPlugin(id) {
  const plugins = await fetchCatalog();
  const target = id ? String(id).toLowerCase().trim() : '';
  const found = plugins.find((p) => p.id === target);
  return found || null;
}

export async function listCategories() {
  const plugins = await fetchCatalog();
  const counts = new Map();
  for (const p of plugins) {
    const c = p.category || 'uncategorized';
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const categories = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return { categories, total: plugins.length };
}
