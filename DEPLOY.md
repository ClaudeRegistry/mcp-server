# Deploying the ClaudeRegistry MCP server

Runs under **pm2** at `/var/www/clauderegistry/mcp-server`, listening on `127.0.0.1:8787`,
and exposed publicly as the path `https://clauderegistry.com/mcp` via the existing
site's Nginx (no new subdomain, DNS record, or TLS cert). This matches the
onBookmarks `service` convention (pm2 + `.infra/deploy.sh`).

## One-time setup on the droplet

```bash
# 1. Clone to the standard path
sudo git clone git@github.com:ClaudeRegistry/mcp-server.git /var/www/clauderegistry/mcp-server
cd /var/www/clauderegistry/mcp-server
npm ci --omit=dev

# 2. Start under pm2
pm2 start ecosystem.config.cjs
pm2 save                                    # persist across reboots
curl -fsS http://127.0.0.1:8787/health      # -> {"ok":true}

# 3. Nginx: paste the `location = /mcp` block from
#    .infra/nginx/clauderegistry.com.mcp-location.conf into the EXISTING
#    clauderegistry.com server{} block, then:
sudo nginx -t && sudo systemctl reload nginx

# 4. Verify
curl -s -o /dev/null -w '%{http_code}\n' https://clauderegistry.com/mcp   # 405 for GET (not 404)
```

Then anyone can add it:

```bash
claude mcp add --transport http clauderegistry https://clauderegistry.com/mcp
```

## Deploying updates

After pushing to `main`, from your laptop:

```bash
./.infra/deploy.sh
# or, from the ClaudeRegistry root:
./deploy.sh mcp-server
```

This SSHes to the droplet, `git pull`s, runs `npm ci --omit=dev`, `pm2 reload`s, and health-checks.

## Docker (alternative to pm2)

```bash
docker build -t clauderegistry-mcp .
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 --name mcp clauderegistry-mcp
```

## Official MCP Registry

**Published** as `com.clauderegistry/plugin-catalog` (status `active`; verify at
`https://registry.modelcontextprotocol.io/v0/servers?search=clauderegistry`). PulseMCP
auto-ingests from the registry; Smithery/Glama need a separate manual submit.

Domain ownership is proven via **HTTP verification** — set up once on the droplet:
- Ed25519 keypair: `/root/mcp-key.pem` (private hex cached at `/root/.mcp-priv`).
- Proof file: `/var/www/clauderegistry/mcp-registry-auth.txt` (`v=MCPv1; k=ed25519; p=<pubkey>`, mode 644), served at `https://clauderegistry.com/.well-known/mcp-registry-auth` via an exact-match nginx `location` that bypasses the `location ~ /\.` deny.

To publish an **update** (name+version is immutable, so bump `version` first):
```bash
# on the droplet, in /root (mcp-publisher binary + server.json live there)
./mcp-publisher login http --domain=clauderegistry.com --private-key="$(cat /root/.mcp-priv)"
./mcp-publisher publish
```
Note: the registry caps `description` at 100 characters.
