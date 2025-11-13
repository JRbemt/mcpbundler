/**
 * OAuth API Routes
 *
 * Handles OAuth authorization flows
 */

import express, { Request, Response, Router } from 'express';
import { OAuthService } from '../../services/oauth/oauth-service.js';
import { CollectionRepository, OAuthTokenRepository, McpRepository } from '../database/repositories/index.js';
import { getConfiguredProviders } from '../../services/oauth/providers.js';
import logger from '../../utils/logger.js';
import { PrismaClient } from '@prisma/client';

export function createOAuthRoutes(publicUrl: string, prisma: PrismaClient): Router {
  const router = express.Router();
  const collectionRepo = new CollectionRepository(prisma);
  const oauthTokenRepo = new OAuthTokenRepository(prisma);
  const mcpRepo = new McpRepository(prisma);

  const oauthService = new OAuthService(publicUrl, oauthTokenRepo, mcpRepo);

  /**
   * GET /authorize
   * Web UI for authorizing all upstreams in a collection
   */
  router.get('/authorize', async (req: Request, res: Response) => {
    try {
      const collectionId = req.query.collection_id as string;

      if (!collectionId) {
        res.status(400).send(renderErrorPage('Missing collection_id parameter'));
        return;
      }

      // Get collection
      const collection = await collectionRepo.findById(collectionId);

      if (!collection) {
        res.status(404).send(renderErrorPage('Collection not found'));
        return;
      }

      // Get collection MCPs
      const collectionMcps = await collectionMcpRepo.listByCollection(collectionId);

      // Filter MCPs that need OAuth
      const oauthMcps = collectionMcps.filter(
        (collectionMcp) =>
          collectionMcp.authConfig &&
          (collectionMcp.authConfig as any).method === 'oauth2' &&
          !(collectionMcp.authConfig as any).access_token
      );

      if (oauthMcps.length === 0) {
        res.send(renderSuccessPage(collection.name, collectionId));
        return;
      }

      // Render authorization page
      res.send(
        renderAuthorizePage(collection.name, collectionId, oauthMcps, publicUrl)
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to render authorize page');
      res.status(500).send(renderErrorPage('Internal server error'));
    }
  });

  /**
   * POST /oauth/start/:provider
   * Start OAuth authorization for a specific provider
   */
  router.post('/oauth/start/:provider', async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      const { collection_id, upstream_namespace } = req.body;

      if (!collection_id) {
        res.status(400).json({ error: 'collection_id is required' });
        return;
      }

      const result = await oauthService.startAuthorization(
        provider,
        collection_id,
        upstream_namespace
      );

      res.json(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to start OAuth authorization');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /oauth/callback/:provider
   * OAuth callback endpoint
   */
  router.get('/oauth/callback/:provider', async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      const { code, state } = req.query;

      if (!code || !state) {
        res.status(400).send(renderErrorPage('Missing code or state parameter'));
        return;
      }

      await oauthService.handleCallback(
        provider,
        code as string,
        state as string
      );

      // Redirect to success page
      res.redirect(`/authorize/success?provider=${provider}`);
    } catch (error: any) {
      logger.error({ error: error.message }, 'OAuth callback failed');
      res.status(500).send(renderErrorPage(`OAuth authorization failed: ${error.message}`));
    }
  });

  /**
   * GET /authorize/success
   * Success page after OAuth authorization
   */
  router.get('/authorize/success', (req: Request, res: Response) => {
    const provider = req.query.provider as string;
    res.send(renderOAuthSuccessPage(provider));
  });

  return router;
}

// TODO: Can we integrate a next.js frontend/ dashboard
/**
 * Render authorization page HTML
 */
function renderAuthorizePage(
  collectionName: string,
  collectionId: string,
  upstreams: any[],
  publicUrl: string
): string {
  const configuredProviders = getConfiguredProviders();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize MCPs - ${collectionName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 600px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .header p { opacity: 0.9; }
    .content { padding: 30px; }
    .upstream {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      transition: all 0.3s;
    }
    .upstream:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .upstream-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .upstream-name { font-weight: 600; font-size: 18px; color: #333; }
    .upstream-url { color: #666; font-size: 14px; margin-bottom: 15px; }
    .btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
      width: 100%;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn:active { transform: translateY(0); }
    .btn:disabled {
      background: #ccc;
      cursor: not-allowed;
      transform: none;
    }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .status.pending { background: #fff3cd; color: #856404; }
    .status.authorized { background: #d4edda; color: #155724; }
    .footer {
      text-align: center;
      padding: 20px;
      color: #666;
      font-size: 14px;
      border-top: 1px solid #e0e0e0;
    }
    .loading {
      display: none;
      text-align: center;
      padding: 20px;
      color: #667eea;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 Authorize MCPs</h1>
      <p>Collection: ${collectionName}</p>
    </div>
    <div class="content">
      <p style="margin-bottom: 20px; color: #666;">
        The following MCPs require OAuth authorization. Click "Authorize" to connect each service.
      </p>
      ${upstreams
      .map(
        (collectionMcp: any) => `
        <div class="upstream" data-namespace="${collectionMcp.mcp.namespace}">
          <div class="upstream-header">
            <span class="upstream-name">${collectionMcp.mcp.namespace}</span>
            <span class="status pending">Pending</span>
          </div>
          <div class="upstream-url">${collectionMcp.mcp.url}</div>
          <button class="btn" onclick="authorize('${collectionMcp.mcp.namespace}', '${(collectionMcp.authConfig as any)?.provider || 'github'}')">
            Authorize ${collectionMcp.mcp.namespace}
          </button>
        </div>
      `
      )
      .join('')}
      <div class="loading" id="loading">
        <p>Authorizing...</p>
      </div>
    </div>
    <div class="footer">
      <p>MCP Bundler - Secure OAuth Authorization</p>
    </div>
  </div>

  <script>
    async function authorize(namespace, provider) {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Authorizing...';

      try {
        const response = await fetch('/api/oauth/start/' + provider, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection_id: '${collectionId}',
            upstream_namespace: namespace
          })
        });

        const data = await response.json();

        if (data.authorizationUrl) {
          // Open authorization in popup
          const width = 600;
          const height = 700;
          const left = (screen.width - width) / 2;
          const top = (screen.height - height) / 2;

          const popup = window.open(
            data.authorizationUrl,
            'oauth',
            \`width=\${width},height=\${height},left=\${left},top=\${top}\`
          );

          // Listen for popup close
          const checkPopup = setInterval(() => {
            if (popup.closed) {
              clearInterval(checkPopup);
              location.reload();
            }
          }, 500);
        }
      } catch (error) {
        alert('Authorization failed: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Authorize ' + namespace;
      }
    }
  </script>
</body>
</html>
  `;
}

/**
 * Render success page
 */
function renderSuccessPage(collectionName: string, collectionId: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Complete</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .success-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 20px;
      background: #d4edda;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
    }
    h1 { color: #333; margin-bottom: 15px; }
    p { color: #666; line-height: 1.6; }
    .collection { font-weight: 600; color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">✓</div>
    <h1>All Set!</h1>
    <p>
      All MCPs in collection <span class="collection">${collectionName}</span> are authorized.
    </p>
    <p style="margin-top: 20px;">You can close this window.</p>
  </div>
</body>
</html>
  `;
}

/**
 * Render OAuth success page
 */
function renderOAuthSuccessPage(provider: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 400px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .success-icon {
      width: 60px;
      height: 60px;
      margin: 0 auto 20px;
      background: #d4edda;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
    }
    h1 { color: #333; margin-bottom: 10px; font-size: 24px; }
    p { color: #666; }
  </style>
  <script>
    // Auto-close after 2 seconds
    setTimeout(() => {
      window.close();
    }, 2000);
  </script>
</head>
<body>
  <div class="container">
    <div class="success-icon">✓</div>
    <h1>Authorized!</h1>
    <p>${provider} has been successfully authorized.</p>
    <p style="margin-top: 15px; font-size: 14px;">This window will close automatically...</p>
  </div>
</body>
</html>
  `;
}

/**
 * Render error page
 */
function renderErrorPage(errorMessage: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .error-icon {
      width: 60px;
      height: 60px;
      margin: 0 auto 20px;
      background: #f8d7da;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
    }
    h1 { color: #721c24; margin-bottom: 10px; }
    p { color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">✕</div>
    <h1>Authorization Failed</h1>
    <p>${errorMessage}</p>
  </div>
</body>
</html>
  `;
}
