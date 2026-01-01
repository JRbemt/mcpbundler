<h1 align="center">
  ♆    MCPbundler  ♆
</h1>
<p align="center">
  Aggregate multiple MCP servers into one unified interface.
</p>


MCP Bundler is a multiplexer that consolidates multiple Model Context Protocol (MCP) servers into a single endpoint, making it easy to manage and access multiple MCP services from one central location. MCPbundler enables registering and sharing MCP's within an organization through bundles: 

🧑‍💻 Bundles package a set of MCP's and support user authentication. 

🤖 LLM agents connected to a bundle automatically discover added tools, no (re)configuration needed. 

**What problem does this solve?** 

MCP's have tremendous potential, but can not yet be managed, configured and deployed in a user-friendly way. 
This project solves that for SSE MCP's.

<p align="center">
  <img src="./assets/infographic.png" alt="diagram" width="800">
</p>


## Tabel of Contents


## Use Cases💡

- **Development**: Manage multiple development MCPs from one endpoint
- **Production**: Centralize MCP access with proper authorisation controls
- **Teams**: Share bundles of MCPs across team members
- **Multi-tenant**: Manage many MCPs with many users in an organization

## Features 🚀

- **Single Endpoint**: Access multiple MCP servers through one unified interface
- **Dynamic Management**: Add and remove MCPs on the fly via CLI or API
- **Connection Management**: MCP bundler supports both (long-lasting) statefull and stateless connections
- **Namespacing**: Automatic namespacing prevents tool/resource conflicts
- **Database-Backed**: Persistent storage with PostgreSQL, MySQL, or SQLite
- **CLI Interface**: Simple command-line tools for management
- **REST API**: Functioning REST API for programmatic control

**Roadmap:**

- [ ] Full OAuth2 support
- [ ] OpenAPI Docs
- [ ] Web UI
- [ ] Finer-grained permissions
- [ ] Metrics dashboard for logs and metering


# 1. Getting Started

## 1.1 Installation 📦

TODO

## 1.2 Quick Start Guide

### 1

TODO: docker

### 2 Local
TODO

# 2. CLI 📋

<p align="center">
  <img src="./assets/cli.png" alt="diagram" width="800">
</p>

To add an mcp:
```
mcpbundler --token <mcpb_*> mcp add ...
```
To create a bundler


# 3. Bundler

```
[base]/sse
```
For using the bundler, no user account is needed. Just a token generated for 
bundle-token

## 3.1 Wildcard



# 4. Endpoints

## 4.1 Users
In order to interact with the API, you need an USER account for most endpoints.

### 4.1.1 User Creation
#### Self-service

#### Hierarchical Issuance
```
Endpoints:
- POST /api/users/self                   - Self-service registration (no auth, if enabled)
- POST /api/users                        - Create user (CREATE_USER permission)
- GET  /api/users/me                     - Get own profile with created users
- PUT  /api/users/me                     - Update own profile
- POST /api/users/me/revoke              - Revoke own API key
- POST /api/users/me/created/:id/revoke  - Revoke user you created (cascades)
- POST /api/users/me/created/revoke-all  - Revoke all users you created
- GET  /api/users                        - List all users (LIST_USERS permission)
- GET  /api/users/by-name/:name          - Get user by name (admin only)
- POST /api/users/by-name/:name/revoke   - Revoke user by name (admin only)
```
### 4.1.2 Permissions
Currently there are four scopes that can be assigned to an user account: 
0: "CREATE_USER"        Create a user
1: "ADD_MCP"            Add an MCP to the registry
2: "LIST_USERS"         List all users incl. in the organisation
3: "VIEW_PERMISSIONS"   View permissions

An user creating another user can not assign permissions beyond those held by the creating (parent) user. The child user can only be assigned permissions that are equal to or more restrictive than those of the parent. 
```
Endpoints:
- GET    /api/permissions                            - List all permission types
- GET    /api/permissions/me                         - Get own permissions
- GET    /api/permissions/by-name/:name              - Get user permissions (VIEW_PERMISSIONS)
- POST   /api/permissions/by-name/:name              - Add permission (optional cascade)
- DELETE /api/permissions/by-name/:name/:permission  - Remove permission (cascades)
```
## 4.2 MCP's

```
Endpoints:
- GET    /api/mcps                       - List all master MCPs
- POST   /api/mcps                       - Add MCP (ADD_MCP permission)
- GET    /api/mcps/:id                   - Get MCP by ID
- PUT    /api/mcps/:id                   - Update MCP
- DELETE /api/mcps/all                   - Bulk delete all user's MCPs
- GET    /api/mcps/:namespace            - Get MCP by namespace
- DELETE /api/mcps/:namespace            - Delete MCP
```
url, author, description, 

```bash 
>> mcpbundler --token <mcpb_*> mcp add ...
add an MCP server manually via URL and metadata (requires valid token, ADD_MCP permission)

Options:
  -n, --namespace <namespace>  Namespace for the MCP
  --url <url>                  URL of the MCP server
  --author <author>            Author of the MCP server
  --description <description>  Description of the MCP server
  -v, --mcp-version [version]  Version of the MCP server (default: "1.0.0")
  --stateless                  Mark as stateless (shared connection) (default: false)
  --auth-type <type>           Which auth credentials are used by bundles accessing the MCP (choices: "MASTER", "NONE",
                               "USER_SET", default: "NONE")
  --auth-bearer [token]        Bearer token authentication (optional)
  --auth-basic [user:pass]     Basic authentication username:password (optional)
  --auth-apikey [key]          API key authentication (optional)
  -h, --help                   display help for command
```

## 4.3 Bundles
A bundle allows usage of a controlled subset of MCP's, a bundle can be configured to allow/deny certain tools/resources/prompts (supports regex).

The public endpoints require a xx bit bundle-token to access!!

```http
Endpoints:
- GET    /api/bundles                                   - List all bundles
- GET    /api/bundles/me                                - List all your bundles
- POST   /api/bundles                                   - Create bundle
- DELETE /api/bundles/:id                               - Delete bundle (owner or admin)
- GET    /api/bundles/:id                               - List MCPs in bundle
- POST   /api/bundles/:id                               - Add MCP to bundle
- DELETE /api/bundles/:id/:namespace                    - Remove MCP from bundle

Bundle Token endpoints:    
- POST   /api/bundles/:id/tokens                        - Generate token
- GET    /api/bundles/:id/tokens                        - List tokens
- DELETE /api/bundles/:id/tokens/:tokenId               - Revoke token

Endpoints requiring bundle-token i.o. API-user token:
- POST   /api/credentials/:bundleToken/mcps/:namespace - Bind credentials
- PUT    /api/credentials/:bundleToken/mcps/:namespace - Update credentials
- DELETE /api/credentials/:bundleToken/mcps/:namespace - Remove credentials
- GET    /api/credentials/:bundleToken/mcps            - List all mcps and whether credentials are bound
```

## 4.4 Authentication

### 4.4.1 API Authentication

### 4.4.2 Bundle Authentication

### 4.4.3 MCP Authentication
Modes: 
- NONE
- MASTER
- USER_SET


This enables scenarios where multiple users share a bundle but each
uses their own containerized credentials to access the underlying MCP servers.

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

## 4.5 Metrics Endpoint

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





# 5. Other Information


## 5.1 Database 🗄️

MCP Bundler supports PostgreSQL and SQLite via Prisma.


## 5.2 License 📝

MIT License - see LICENSE file for details

## 5.3 Contributing 🤝

Contributions are welcome! Please see CONTRIBUTING.md for guidelines.

## 5.4 Security 🔒

- Token-based authentication
- Encrypted credentials (AES-256-GCM)
- Permission-based access control
- Rate limiting on SSE connections

## 🙋 Support

---

Built with ❤️ for the MCP community
