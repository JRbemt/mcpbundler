# Security
We take security serious.
Security issues can be reported privately to: [email](mailto:jr.semper3@gmail.com)

## How to secure
The current features are implemented to secure the usage of the bundler.
- Token-based authentication
- MCP drendentials are stored encrypted (AES-256-GCM)
- Permission-based access control
- Rate limiting on HTTP connections

Make sure when using the bundler in production to change the postgres username/password in both the docker-compose and the .env. 