/**
 * GitHub App Token Broker for ai-aligned-gh
 * 
 * Provides user-to-server GitHub tokens via device flow for proper user attribution.
 * Actions appear as the user (with app badge), not as the bot.
 * 
 * Setup:
 * 1. wrangler secret put GITHUB_CLIENT_ID  # From GitHub App settings
 * 2. wrangler secret put GITHUB_APP_ID      # From GitHub App settings  
 * 3. wrangler secret put GITHUB_APP_PRIVATE_KEY  # From GitHub App settings
 * 4. wrangler deploy
 * 
 * Usage with ai-aligned-gh:
 * The CLI tool will automatically handle the device flow to get user tokens.
 * 
 * Manual testing:
 *    # Start device flow
 *    curl -X POST https://your-worker.workers.dev/user-token/start -d '{"scopes":"repo"}'
 *    # Go to verification_uri and enter user_code
 *    # Poll for token
 *    curl -X POST https://your-worker.workers.dev/user-token/poll -d '{"device_code":"..."}'
 */

import { signJWT } from './jwt-simple.js';








// Handle /user-token/start endpoint
async function handleUserTokenStart(request, env, body) {
  const { scopes, redirect_uri } = body;
  const clientId = env.GITHUB_CLIENT_ID;
  
  if (!clientId) {
    return new Response(JSON.stringify({
      error: 'GitHub Client ID not configured'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // OAuth endpoints are on github.com, not api.github.com
  const url = 'https://github.com/login/device/code';
  
  const params = new URLSearchParams({
    client_id: clientId
  });
  
  // IMPORTANT: For GitHub Apps, we should NOT send scopes
  // GitHub Apps use fine-grained permissions, not OAuth scopes
  // Sending scopes makes it behave like an OAuth App
  if (scopes && false) { // Disabled - never send scopes for GitHub App
    params.append('scope', scopes);
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error_description || data.error || 'Failed to start device flow');
    }
    
    // Store device code data in KV for polling (if KV is available)
    if (env.DEVICE_CODES) {
      await env.DEVICE_CODES.put(data.device_code, JSON.stringify({
        ...data,
        created_at: Date.now(),
        redirect_uri
      }), {
        expirationTtl: data.expires_in
      });
    } else {
      console.warn('DEVICE_CODES KV namespace not configured - device flow will not persist');
    }
    
    return new Response(JSON.stringify({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Exchange OAuth token for installation access token
async function exchangeForInstallationToken(oauthToken, env) {
  try {
    // First, get user installations using the OAuth token
    const installationsResponse = await fetch('https://api.github.com/user/installations', {
      headers: {
        'Authorization': `Bearer ${oauthToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!installationsResponse.ok) {
      throw new Error('Failed to get user installations');
    }
    
    const installationsData = await installationsResponse.json();
    
    // Find the as-a-bot installation
    const installation = installationsData.installations?.find(
      inst => inst.app_slug === 'as-a-bot'
    );
    
    if (!installation) {
      // User hasn't installed the app, return the OAuth token as-is
      return oauthToken;
    }
    
    // Create an installation access token for the user
    // This requires the app's private key and app ID
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      // If app credentials aren't configured, return OAuth token
      console.log('App credentials not configured, returning OAuth token');
      return oauthToken;
    }
    
    // Create JWT for app authentication
    const jwt = await createAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    
    // Create installation access token
    // We'll request the same permissions the user authorized
    const tokenResponse = await fetch(
      `https://api.github.com/app/installations/${installation.id}/access_tokens`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          // Request repo scope to match what the OAuth token has
          repositories: 'all',
          permissions: {
            contents: 'write',
            issues: 'write',
            pull_requests: 'write',
            metadata: 'read'
          }
        })
      }
    );
    
    if (!tokenResponse.ok) {
      console.error('Failed to create installation token:', await tokenResponse.text());
      return oauthToken;
    }
    
    const tokenData = await tokenResponse.json();
    return tokenData.token;
  } catch (error) {
    console.error('Error exchanging token:', error);
    // On any error, return the original OAuth token
    return oauthToken;
  }
}

// Create JWT for GitHub App authentication
async function createAppJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  
  const payload = {
    iat: now - 60,  // Issued 60 seconds ago to account for clock drift
    exp: now + 600, // Expires in 10 minutes
    iss: appId      // Issuer is the app ID
  };
  
  return await signJWT(payload, privateKey);
}

// Handle /user-token/poll endpoint
async function handleUserTokenPoll(request, env, body) {
  const { device_code } = body;
  
  if (!device_code) {
    return new Response(JSON.stringify({
      error: 'device_code is required'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Get device code data from KV (if available)
  if (!env.DEVICE_CODES) {
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Device flow not configured on this server'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const deviceData = await env.DEVICE_CODES.get(device_code, 'json');
  
  if (!deviceData) {
    return new Response(JSON.stringify({
      error: 'expired_token',
      error_description: 'Device code has expired'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const clientId = env.GITHUB_CLIENT_ID;
  // OAuth endpoints are on github.com, not api.github.com
  const url = 'https://github.com/login/oauth/access_token';
  
  const params = new URLSearchParams({
    client_id: clientId,
    device_code: device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  });
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    
    const data = await response.json();
    
    if (data.error) {
      if (data.error === 'authorization_pending') {
        // Still waiting for user authorization
        return new Response(JSON.stringify({
          error: 'authorization_pending',
          error_description: 'User has not yet authorized the request',
          interval: deviceData.interval
        }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (data.error === 'slow_down') {
        // Client is polling too fast
        return new Response(JSON.stringify({
          error: 'slow_down',
          error_description: 'Polling too frequently',
          interval: deviceData.interval + 5
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Other errors
      return new Response(JSON.stringify({
        error: data.error,
        error_description: data.error_description
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Success - we have an OAuth token
    // Now exchange it for an installation token to get app attribution
    const finalToken = await exchangeForInstallationToken(data.access_token, env);
    
    // Clean up device code (if KV is available)
    if (env.DEVICE_CODES) {
      await env.DEVICE_CODES.delete(device_code);
    }
    
    // Calculate expiration
    const expiresAt = new Date(Date.now() + (data.expires_in || 28800) * 1000).toISOString();
    
    return new Response(JSON.stringify({
      access_token: finalToken,
      token_type: data.token_type || 'bearer',
      expires_at: expiresAt,
      scope: data.scope,
      app_attribution: finalToken !== data.access_token // Indicate if we got an installation token
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    
    // Allow GET for health check
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'GitHub App Token Broker for ai-aligned-gh',
        timestamp: new Date().toISOString(),
        endpoints: {
          '/user-token/start': 'Start device flow (POST)',
          '/user-token/poll': 'Poll device flow (POST)'
        }
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Only allow POST for other endpoints
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Parse request body
    let body;
    
    try {
      const rawBody = await request.text();
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Invalid request body'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Route requests
    try {
      let response;
      
      switch (url.pathname) {
        case '/user-token/start':
          response = await handleUserTokenStart(request, env, body);
          break;
        
        case '/user-token/poll':
          response = await handleUserTokenPoll(request, env, body);
          break;
        
        default:
          response = new Response(JSON.stringify({
            error: 'Not found'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
      }
      
      return response;
    } catch (error) {
      console.error('Request failed:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }
};