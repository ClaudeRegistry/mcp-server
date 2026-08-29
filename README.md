# Sigistry MCP server

[Listed on Smithery](https://smithery.ai/servers/sigistry/plugin-catalog) · [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=sigistry)

A small, self-contained Node.js service that exposes the [Sigistry](https://sigistry.com) catalog of verified plugins and skills to AI agents through a public, read-only, authless **remote MCP server** using the Streamable HTTP transport.

It reads the same `marketplace.json` and `skills.json` the website uses and serves them as MCP tools, so any MCP-capable agent can discover verified plugins and skills, fetch portable SKILL.md sources, and get ready-to-run install commands.

## Tools

- **search_plugins** `{ query?: string, category?: string }`: case-insensitive keyword match against each plugin's searchable text, optionally filtered by category. Returns up to 15 matches (id, name, description, category, installCommand).
- **get_plugin** `{ id: string }`: returns the full plugin object including component counts and both install commands (`installMarketplace` + `installCommand`). Returns a not-found error (suggesting `search_plugins`) if the id is unknown.
- **list_categories** `{}`: returns the distinct categories with a plugin count each, plus the total plugin count.

## Add to Claude Code

Connect straight to the hosted endpoint (no gateway, no key):

```bash
claude mcp add --transport http sigistry https://sigistry.com/mcp
```

## Use with Smithery

Listed on [Smithery](https://smithery.ai/servers/sigistry/plugin-catalog) as `@sigistry/plugin-catalog`. Smithery's gateway proxies to the same hosted endpoint, so you can install it into any Smithery-supported client:

```bash
npx -y @smithery/cli install @sigistry/plugin-catalog --client claude
```

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

- `GET /health` produces `{ ok: true }`
- `GET /` produces a plain-text description
- `GET /mcp` produces `405` (this is a stateless server; use `POST`)

## Deployment

Runs under **pm2** (`ecosystem.config.cjs`) at `/var/www/sigistry/mcp-server`, listening on `127.0.0.1:8787`, and exposed as the **path** `sigistry.com/mcp` via a `location` block in the existing site's Nginx (`.infra/nginx/sigistry.com.mcp-location.conf`), so there is no new subdomain, DNS record, or TLS cert. Because the static site is served directly by Nginx, a Node hiccup only ever affects `/mcp`.

Deploy with `.infra/deploy.sh` (or, from the Sigistry root, `./deploy.sh mcp-server`), which git-pulls on the server, runs `npm ci --omit=dev`, and `pm2 reload`s. Full runbook in [`DEPLOY.md`](./DEPLOY.md). A `Dockerfile` is included as an alternative to pm2.

The catalog is fetched from GitHub at runtime and cached in memory (~5 minute TTL). On a fetch error the server serves the last-good cache (or an empty list) and never crashes.

## Official MCP Registry

Published to the [Official MCP Registry](https://github.com/modelcontextprotocol/registry) as **`com.sigistry/plugin-catalog`** (status `active`). The manifest is [`server.json`](./server.json); its `remotes` entry points at `https://sigistry.com/mcp`. To publish an update, bump the `version` in `server.json` and re-run the publisher (see [`DEPLOY.md`](./DEPLOY.md)); the registry caps `description` at 100 characters.

## Discovery

- **Official MCP Registry** and **PulseMCP** (auto-ingests from the registry): live.
- **Smithery** (`@sigistry/plugin-catalog`): listed.
- **Glama** indexes public MCP repositories on GitHub automatically.

## License

MIT

---

*Sigistry is an independent project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. Claude and Claude Code are trademarks of Anthropic, PBC, used here only to identify compatibility.*
