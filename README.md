# ClaudeRegistry MCP server

A small, self-contained Node.js service that exposes the [ClaudeRegistry](https://clauderegistry.com) plugin catalog to AI agents through a public, read-only, authless **remote MCP server** using the Streamable HTTP transport.

It reads the same `marketplace.json` the website uses and serves it as three MCP tools, so any MCP-capable agent can discover Claude Code plugins and get ready-to-run install commands.

## Tools

- **search_plugins** — `{ query?: string, category?: string }`. Case-insensitive keyword match against each plugin's searchable text, optionally filtered by category. Returns up to 15 matches (id, name, description, category, installCommand).
- **get_plugin** — `{ id: string }`. Returns the full plugin object including component counts and both install commands (`installMarketplace` + `installCommand`). Returns a not-found error (suggesting `search_plugins`) if the id is unknown.
- **list_categories** — `{}`. Returns the distinct categories with a plugin count each, plus the total plugin count.

## Run locally

```bash
npm install
npm start
```

The server listens on `http://localhost:8787/mcp` (override with `PORT`). Smoke-test it with the bundled client:

```bash
npm test   # runs node test/client.mjs against localhost:8787
```

Other endpoints:

- `GET /health` → `{ ok: true }`
- `GET /` → plain-text description
- `GET /mcp` → `405` (this is a stateless server; use `POST`)

## Add to Claude Code

```bash
claude mcp add --transport http clauderegistry https://clauderegistry.com/mcp
```

## Deployment

Runs as a plain Node service (`node src/index.js`, or the included `Dockerfile` on `node:22-alpine`) listening on `127.0.0.1:8787`. Expose it as a **path on the existing site**: add the `location = /mcp` block from `deploy/nginx-mcp.conf` to your current `clauderegistry.com` Nginx server block, then `nginx -t && systemctl reload nginx`. No new subdomain, DNS record, or TLS cert is needed — it reuses the site's existing certificate, and the static site keeps being served directly by Nginx (so if the Node process is down, only `/mcp` is affected). The proxy runs with buffering off and long read timeouts for Streamable HTTP.

The catalog is fetched from GitHub at runtime and cached in memory (~5 minute TTL). On a fetch error the server serves the last-good cache (or an empty list) and never crashes.

## Official MCP Registry

`server.json` is the manifest for the [Official MCP Registry](https://github.com/modelcontextprotocol/registry). Submit it (name `com.clauderegistry/plugin-catalog`) to publish this server so agents can discover it, using its `remotes` entry pointing at `https://clauderegistry.com/mcp`.
