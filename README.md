<h1 align="center">
  MCPbundler
</h1>
<p align="center">
  Aggregate multiple MCP servers into one unified interface.
</p>

Model Context Protocol (MCP) Bundler lets you combine multiple MCP servers into a single endpoint. Your AI agent connects once and gets access to tools, resources, and prompts from all configured servers - no need to manage multiple connections.

Imagine: you have 5 agents running and you want to give them access to a new MCP server.

**Without bundler**
Update config on all 5 agents and restart them.

**With bundler**
Add the MCP to the bundle. All 5 agents already pointing at that bundle endpoint now have access.

<p align="center">
  <img src="https://raw.githubusercontent.com/jrbemt/mcpbundler/master/assets/infographic.png" alt="diagram" width="800">
</p>

## Table of Contents

- [How It Works](#how-it-works)
- [Modes](#modes)
  - [YAML Mode](#yaml-mode)
  - [API Mode](#api-mode)
- [YAML Configuration Reference](#yaml-configuration-reference)
  - [definitions](#definitions)
  - [bundles](#bundles)
  - [subscriptions](#subscriptions)
  - [Auth Strategies](#auth-strategies)
  - [LLM Tool Router](#llm-tool-router)
- [Loading Strategy](#loading-strategy)
- [Connecting a Client](#connecting-a-client)
- [Running](#running)
- [Metrics](#metrics)
- [Contributing](#contributing)

---

## How It Works

An MCP client (Claude Desktop, an AI agent, VS Code) connects to the bundler with a single **bearer token**. The bundler:

1. Looks up which subscription that token belongs to
2. Reads which bundle that subscription points to - this determines which upstream MCP servers are included
3. For each upstream MCP, injects the right credentials transparently based on the auth strategy
4. Multiplexes all upstream tool/resource/prompt namespaces into a single MCP session

The client only ever knows one endpoint and one token. All upstream authentication is handled server-side.

---

## Modes

### YAML Mode

Everything is declared in a single YAML file. Bundles, subscriptions, credentials, and access tokens are all defined as code. This is the recommended mode for self-hosted deployments.

Set `YAML_CONFIG` to the path of your config file:

```bash
YAML_CONFIG=./mcpbundler.yaml node dist/src/main.js
```

See [YAML Configuration Reference](#yaml-configuration-reference) and `mcpbundler.example.yaml` for the full schema.

### API Mode

The bundler delegates bundle resolution to an external backend (the MCP Market FastAPI service). Set `BACKEND_URL` to the backend's base URL:

```bash
BACKEND_URL=https://api.example.com node dist/src/main.js
```

When a token arrives, the bundler calls `GET $BACKEND_URL/v1/bundler/resolve` with the token forwarded as the Authorization header. The backend returns the resolved bundle. No local config is needed.

---

## YAML Configuration Reference

Secrets belong in `.env` (or environment variables) and are referenced in YAML with `${VAR_NAME}`. Interpolation happens after YAML parsing so env var values cannot corrupt the YAML structure.

### definitions

Shared resources referenced by bundles.

```yaml
definitions:
  mcps:
    - namespace: github
      url: "https://github-mcp.example.com/mcp"
      pooled: true
      description: "GitHub repository management"
      capabilities: ["git", "pull-requests", "code-review"]
      auth:
        method: bearer
        token: "${GITHUB_MASTER_TOKEN}"

    - namespace: jira
      url: "https://jira-mcp.example.com/mcp"
      description: "Jira issue tracking"

  llms:
    - name: local-llama
      type: openai-compatible
      model: llama3.2:3b
      endpoint: "http://localhost:11434/v1"
      temperature: 0.1
      max_tokens: 256
```

Each MCP entry requires `namespace` and `url`. `auth` provides the upstream credentials (used for `MASTER` auth strategy). `capabilities` improves LLM tool router accuracy.

`llms` registers LLM providers for the tool router middleware. Use any OpenAI-compatible endpoint, including local Ollama models.

### bundles

A bundle is a named collection of MCPs. Each MCP entry sets an `auth_strategy` that controls how credentials are resolved at request time.

```yaml
bundles:
  - name: dev-tools
    mcps:
      - ref: github          # references definitions.mcps[namespace=github]
        auth_strategy: MASTER

      - ref: jira
        auth_strategy: USER_SET

      - namespace: notion    # inline definition (not in definitions block)
        url: "https://notion-mcp.example.com/mcp"
        auth_strategy: USER_SET
```

Three ways to include an MCP in a bundle:

| Form | When to use |
|------|-------------|
| `ref: <namespace>` | References an entry from `definitions.mcps` |
| Inline (`namespace` + `url`) | One-off MCP not shared across bundles |
| Registry ref (`namespace` + `registry`) | References an MCP on an external registry (not resolvable in YAML mode) |

### subscriptions

A subscription links a set of tokens to a bundle, carrying per-MCP credentials for `USER_SET` MCPs and an optional router config.

```yaml
subscriptions:
  - name: alice
    tokens:
      claude-desktop: "${ALICE_CLAUDE_TOKEN}"
      vscode: "${ALICE_VSCODE_TOKEN}"
    bundle: dev-tools
    credentials:
      jira:
        auth:
          method: api_key
          key: "${ALICE_JIRA_KEY}"
          header: "X-API-Token"
        permissions:
          allowed_tools: ["get_issue", "create_issue", "search_issues"]
          allowed_resources: ["*"]
          allowed_prompts: ["*"]
      notion:
        auth:
          method: bearer
          token: "${ALICE_NOTION_TOKEN}"
    router:
      model: local-llama
```

Each key under `tokens` is a label (e.g. which client it belongs to); each value is the actual bearer token. All tokens for a subscription resolve to the same bundle and credentials. This lets you issue separate revocable tokens per client without duplicating the subscription.

`credentials` is a map from MCP namespace to auth config + optional permissions. Only namespaces present here are resolved for `USER_SET` MCPs; missing ones are excluded from the session.

### Auth Strategies

| Strategy | Description |
|----------|-------------|
| `NONE` | No authentication required on the upstream MCP |
| `MASTER` | Shared credentials from the MCP definition in `definitions.mcps`. All subscribers use the same upstream credentials. |
| `USER_SET` | Per-subscription credentials from the `credentials` map. Each subscriber provides their own credential for that namespace. |

Supported credential formats:

```yaml
auth:
  method: none

auth:
  method: bearer
  token: "..."

auth:
  method: basic
  username: "..."
  password: "..."

auth:
  method: api_key
  key: "..."
  header: "X-API-Key"   # default

auth:
  method: headers
  headers:
    X-Custom-Header: "..."
    X-Another: "..."
```

### LLM Tool Router

The tool router is optional middleware that uses an LLM to decide which upstream namespaces to activate for a given request, instead of connecting all of them upfront. This reduces connection overhead and agent context window usage for large bundles.

Configure it per subscription via `router`:

```yaml
router:
  model: local-llama        # references a name from definitions.llms
  set_context:
    enabled: true           # expose bundler__set_context as the first (only) tool
    max_active_upstreams: 6
  rolling_window:
    enabled: true           # re-rank based on recent tool call history
    max_active_upstreams: 6
    window_size: 10
    re_rank_every_n_calls: 5
```

Set `model: allpass` (or omit `router`) to disable routing and connect all upstreams unconditionally.

`capabilities` on each MCP definition contributes to routing accuracy. The router builds a selection prompt listing every MCP in the bundle with its namespace, description, capabilities, and known tool names.

---

## Loading Strategy

Controls when a session's upstream MCPs are connected:

| Strategy | Behavior |
|----------|----------|
| `eager` (default) | All of the bundle's upstreams are connected before the session finishes initializing. |
| `progressive` | The session initializes immediately; upstreams connect in the background as they become available. |

The server-wide default comes from the `loading_strategy` bundler setting. A running session's strategy can also be switched at runtime:

```
PUT /mcp/strategy
{ "strategy": "eager" | "progressive" }
```

This only affects future upstream-attach calls on that session (for example, when the LLM tool router activates a namespace that was not connected yet).

---

## Connecting a Client

The bundler exposes an MCP endpoint at:

```
POST /mcp
```

Pass your subscription token as a bearer token:

```json
{
  "mcpServers": {
    "bundler": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

A legacy SSE transport is also available at `GET /sse` + `POST /messages` for clients that do not support StreamableHTTP.

---

## Running

**Local (Node):**

```bash
cp .env.example .env
# Set YAML_CONFIG or BACKEND_URL in .env
npm install
npm run build
npm start
```

**Docker Compose:**

```bash
cp .env.example .env
# Set YAML_CONFIG or BACKEND_URL in .env
docker compose up
```

The bundler listens on port `3000` by default (override with `PORT`). A Prometheus metrics scraper is included in the compose file.

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `YAML_CONFIG` | Path to YAML config file (YAML mode) |
| `BACKEND_URL` | Base URL of the MCP Market backend (API mode) |
| `PORT` | HTTP port (default: `3000`) |
| `LOG_LEVEL` | Pino log level (default: `info`) |

One of `YAML_CONFIG` or `BACKEND_URL` must be set. If neither is set the server exits with an error.

---

## Metrics

```
GET /metrics
```

Returns Prometheus metrics including active sessions, upstream connections, and request counts.

```
GET /status
```

Returns server health, active session count, and uptime.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
