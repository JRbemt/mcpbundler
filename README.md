# MCP Bundler

**Aggregate multiple MCP servers into one unified interface.**

MCP Bundler is a multiplexer that consolidates multiple Model Context Protocol (MCP) servers into a single endpoint, making it easy to manage and access multiple MCP services from one central location.

## 🚀 Features

- **Single Endpoint**: Access multiple MCP servers through one unified interface
- **Dynamic Management**: Add and remove MCPs on the fly via CLI or API
- **Namespacing**: Automatic namespacing prevents tool/resource conflicts
- **Database-Backed**: Persistent storage with PostgreSQL, MySQL, or SQLite
- **OAuth Support**: Built-in OAuth2 authentication for upstream MCPs
- **Caching**: Intelligent LRU caching with TTL for improved performance
- **Metering**: Track usage and costs across all MCPs
- **CLI Interface**: Simple command-line tools for management
- **REST API**: Full REST API for programmatic control

## 📦 Installation

```bash
npm install -g mcpbundler
```

Or install locally:

```bash
git clone <repository-url>
cd bundler
npm install
npm run build
npm link
```

### PM2 Log Rotation (Required for Daemon Mode)

The bundler uses PM2 to run as a daemon. For automatic log rotation with compression, you need to install the pm2-logrotate module:

```bash
pm2 install pm2-logrotate
```

This module provides:
- Automatic log rotation when files reach 10MB
- Retention of last 10 log files per type
- Gzip compression of rotated logs
- Configurable date-stamped file naming

The bundler will automatically configure pm2-logrotate with optimal settings when you start the daemon.

## 🏃 Quick Start

### 1. Set up database

Create a `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/mcpbundler"
# Or use SQLite for development:
# DATABASE_URL="file:./dev.db"
```

### 2. Run database migrations

```bash
cd bundler
npx prisma migrate dev
```

### 3. Start the bundler

```bash
mcpbundler start
```

This will start the daemon in the background on port 3000.

### 4. Create a collection and add MCPs

```bash
# This will create a default collection if none exists
mcpbundler add http://localhost:3001/sse --namespace files

# Add more MCPs
mcpbundler add http://localhost:3002/sse --namespace database
```

### 5. List your MCPs

```bash
mcpbundler list
```

### 6. Get an access token

You'll need to use the REST API to generate a token:

```bash
# Get the collection ID from the list command
curl -X POST http://localhost:3000/api/collections/{collection-id}/tokens \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app-token", "description": "Token for my MCP client"}'
```

### 7. Connect to the bundler

Use the access token in your MCP client:

```json
{
  "mcpServers": {
    "bundler": {
      "name": "bundler",
      "baseUrl": "http://localhost:3000/sse",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    }
  }
}
```

## 📋 CLI Commands

### `mcpbundler start`

Start the bundler daemon.

```bash
mcpbundler start [options]

Options:
  -p, --port <port>       Port to run on (default: 3000)
  -d, --database <url>    Database connection URL
  --no-daemon             Run in foreground instead of as daemon
```

### `mcpbundler stop`

Stop the bundler daemon.

```bash
mcpbundler stop
```

### `mcpbundler status`

Check daemon status and view metrics.

```bash
mcpbundler status
```

### `mcpbundler add <source>`

Add an MCP to the bundler.

```bash
mcpbundler add <source> [options]

Arguments:
  source                  MCP source URL (e.g., http://localhost:3001/sse)
                         or registry path (e.g., mcpbundler.ai/mcps/files)

Options:
  -n, --namespace <name>  Namespace for the MCP
  -c, --collection <id>   Collection ID to add to
  --stateless             Mark as stateless (shared connection)
```

Examples:

```bash
# Add from direct URL
mcpbundler add http://localhost:3001/sse --namespace files

# Add from registry (coming soon)
mcpbundler add mcpbundler.ai/mcps/notion --namespace notion
```

### `mcpbundler remove <namespace>`

Remove an MCP by namespace.

```bash
mcpbundler remove <namespace> [options]

Arguments:
  namespace               Namespace of the MCP to remove

Options:
  -c, --collection <id>   Collection ID to remove from
```

### `mcpbundler list`

List all configured MCPs.

```bash
mcpbundler list [options]

Options:
  -c, --collection <id>   Filter by collection ID
```

## 🌐 REST API

### Collections

#### List Collections

```
GET /api/collections
```

#### Get Collection

```
GET /api/collections/:id
```

#### Create Collection

```
POST /api/collections
Content-Type: application/json

{
  "name": "my-collection"
}
```

#### Delete Collection

```
DELETE /api/collections/:id
```

### Upstreams

#### List Upstreams

```
GET /api/collections/:id/upstreams
```

#### Add Upstream

```
POST /api/collections/:id/upstreams
Content-Type: application/json

{
  "namespace": "files",
  "url": "http://localhost:3001/sse",
  "version": "1.0.0",
  "stateless": true,
  "auth": {
    "method": "bearer",
    "token": "your-token"
  }
}
```

#### Remove Upstream

```
DELETE /api/collections/:id/upstreams/:namespace
```

### Tokens

#### Generate Access Token

```
POST /api/collections/:id/tokens
Content-Type: application/json

{
  "name": "production-token",           // required: descriptive name for the token
  "description": "Production API token", // optional: detailed description
  "expires_at": "2025-12-04T00:00:00.000Z" // optional: ISO 8601 timestamp
}
```

Response:

```json
{
  "token": "mcpb_live_a1b2c3d4e5f6...",  // actual token (only returned once on creation)
  "token_id": "tok_xyz123",
  "name": "production-token",
  "description": "Production API token",
  "expires_at": "2025-12-04T00:00:00.000Z",
  "created_at": "2025-01-15T10:30:00.000Z"
}
```

## 🔐 Authentication

### Collection-Level Auth

Clients authenticate with the bundler using Bearer tokens:

```
Authorization: Bearer <collection-token>
```

Generate tokens via the API:

```bash
curl -X POST http://localhost:3000/api/collections/{id}/tokens \
  -H "Content-Type: application/json" \
  -d '{"name": "my-token", "description": "Token for my app"}'
```

### Upstream Auth

MCPs can use various authentication methods:

#### Bearer Token

```json
{
  "auth": {
    "method": "bearer",
    "token": "your-bearer-token"
  }
}
```

#### Basic Auth

```json
{
  "auth": {
    "method": "basic",
    "username": "user",
    "password": "pass"
  }
}
```

#### API Key

```json
{
  "auth": {
    "method": "api_key",
    "header": "X-API-Key",
    "key": "your-api-key"
  }
}
```

#### OAuth2 (coming soon)

```json
{
  "auth": {
    "method": "oauth2",
    "access_token": "token",
    "refresh_token": "refresh",
    "expires_at": 1234567890
  }
}
```

## 🗄️ Database

MCP Bundler supports PostgreSQL, MySQL, and SQLite via Prisma.

### Connection URLs

**PostgreSQL:**

```
postgresql://user:password@localhost:5432/mcpbundler
```

**MySQL:**

```
mysql://user:password@localhost:3306/mcpbundler
```

**SQLite:**

```
file:./dev.db
```

### Migrations

Run migrations after installation or schema changes:

```bash
npx prisma migrate dev
```

Generate Prisma client:

```bash
npx prisma generate
```

## 📊 Monitoring

### Metrics Endpoint

```
GET /metrics
```

Returns server metrics including active sessions, upstreams, and health status.

Example response:

```json
{
  "sessions": {
    "active": 5,
    "max": 100,
    "details": [
      {
        "id": "session-123",
        "idleTimeMs": 5000,
        "upstreams": 3
      }
    ]
  },
  "upstreams": [
    {
      "namespace": "files",
      "connected": true
    }
  ]
}
```

### Logs

Daemon logs are stored in `~/.mcpbundler/logs/`:

- `bundler.log` - stdout
- `bundler.error.log` - stderr

View logs in real-time:

```bash
npm run pm2:logs
# or
pm2 logs mcpbundler
```

Clear all logs:

```bash
npm run pm2:logs:flush
# or
pm2 flush mcpbundler
```

When pm2-logrotate is installed, logs are automatically:
- Rotated when they reach 10MB
- Compressed with gzip
- Limited to 10 files per log type (oldest deleted automatically)

## 🏗️ Architecture

```
┌─────────────┐
│  MCP Client │
└──────┬──────┘
       │ Bearer Token
       ▼
┌─────────────────┐
│  MCP Bundler    │
│  (Port 3000)    │
└────────┬────────┘
         │
    ┌────┴────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐ ...
│ Files  │ │Database│ │ Notion │
│  MCP   │ │  MCP   │ │  MCP   │
└────────┘ └────────┘ └────────┘
```

### Key Features

- **Namespacing**: Tools are prefixed with namespace (e.g., `files__read_file`)
- **Caching**: LRU cache with TTL for list operations
- **Session Management**: Auto-cleanup of idle sessions
- **Metering**: Track usage by collection, upstream, and tool

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mcpbundler

# Server
PORT=3000
HOST=0.0.0.0

# Auth
MOCK_AUTH=false
NODE_ENV=production

# OAuth Encryption (required for OAuth support)
OAUTH_ENCRYPTION_KEY=your-secret-key-here

# Logging
LOG_LEVEL=info
```

## 🐳 Docker

### Docker Compose

```yaml
version: '3.8'

services:
  mcpbundler:
    image: mcpbundler:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://user:password@db:5432/mcpbundler
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: mcpbundler
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Build Docker Image

```bash
docker build -t mcpbundler -f Dockerfile .
```

## 🛣️ Roadmap

- [x] CLI interface
- [x] Database persistence
- [x] REST API
- [x] Collection management
- [x] Dynamic MCP addition/removal
- [ ] OAuth2 authorization flow
- [ ] Web UI for `/authorize` endpoint
- [ ] Registry support (mcpbundler.ai)
- [ ] Fine-grained permissions
- [ ] User management
- [ ] Rate limiting per collection
- [ ] Webhook notifications

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please see CONTRIBUTING.md for guidelines.

## 📚 Documentation

- [Architecture](./ARCHITECTURE.md)
- [API Reference](./docs/api.md) (coming soon)
- [Development Guide](./docs/development.md) (coming soon)

## ⚡ Performance

- LRU caching with configurable TTL
- Connection pooling for stateless upstreams
- Automatic idle session cleanup
- Efficient namespace-based routing

## 🔒 Security

- Token-based authentication
- Encrypted OAuth credentials (AES-256-GCM)
- Permission-based access control
- Rate limiting on SSE connections
- HTTPS support (via reverse proxy)

## 💡 Use Cases

- **Development**: Manage multiple development MCPs from one endpoint
- **Production**: Centralize MCP access with proper auth and metering
- **Teams**: Share collections of MCPs across team members
- **Multi-tenant**: Isolate MCPs per user or organization

## 🙋 Support

For issues, questions, or contributions:

- GitHub Issues: [repository]/issues
- Documentation: [repository]/docs
- Email: support@mcpbundler.ai (coming soon)

---

Built with ❤️ for the MCP community
