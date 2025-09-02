/**
 * GitHub App Token Broker - Web Flow Implementation
 * 
 * Provides user-to-server GitHub tokens via web-based OAuth flow for proper user attribution.
 * This should create tokens with app badge attribution.
 */

import { signJWT } from './jwt-simple.js';

// Handle /auth/start endpoint - initiate web flow
async function handleAuthStart(request, env) {
  const state = crypto.randomUUID();
  const clientId = env.GITHUB_CLIENT_ID;
  
  if (!clientId) {
    return new Response(JSON.stringify({
      error: 'GitHub Client ID not configured'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Store state in KV for later verification
  if (env.AUTH_STATES) {
    await env.AUTH_STATES.put(state, JSON.stringify({
      created_at: Date.now(),
      status: 'pending'
    }), {
      expirationTtl: 600 // 10 minutes
    });
  }
  
  // Build GitHub OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${new URL(request.url).origin}/auth/callback`,
    state: state
    // Don't include scope for GitHub Apps - they use fine-grained permissions
  });
  
  const authUrl = `https://github.com/login/oauth/authorize?${params}`;
  
  return new Response(JSON.stringify({
    auth_url: authUrl,
    state: state,
    expires_in: 600
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle /auth/callback endpoint - GitHub redirects here
async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  
  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }
  
  // Verify state
  if (env.AUTH_STATES) {
    const stateData = await env.AUTH_STATES.get(state, 'json');
    if (!stateData) {
      return new Response('Invalid or expired state', { status: 400 });
    }
  }
  
  // Exchange code for token
  const tokenUrl = 'https://github.com/login/oauth/access_token';
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  
  if (!clientSecret) {
    return new Response('Client secret not configured', { status: 500 });
  }
  
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      state: state
    }).toString()
  });
  
  const tokenData = await tokenResponse.json();
  
  if (tokenData.error) {
    return new Response(`Error: ${tokenData.error_description}`, { status: 400 });
  }
  
  // Store token in KV for polling
  if (env.AUTH_STATES) {
    await env.AUTH_STATES.put(state, JSON.stringify({
      created_at: Date.now(),
      status: 'completed',
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      scope: tokenData.scope
    }), {
      expirationTtl: 300 // 5 minutes to poll
    });
  }
  
  // Return success page
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authorization Successful</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          background: #0d1117;
          color: #c9d1d9;
        }
        .container {
          text-align: center;
          padding: 2rem;
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
        }
        .success {
          color: #3fb950;
          font-size: 48px;
          margin-bottom: 1rem;
        }
        h1 {
          margin: 0 0 0.5rem 0;
          font-size: 24px;
        }
        p {
          color: #8b949e;
          margin: 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success">✓</div>
        <h1>Authorization Successful</h1>
        <p>You can now close this window and return to your terminal.</p>
      </div>
    </body>
    </html>
  `, {
    status: 200,
    headers: { 'Content-Type': 'text/html' }
  });
}

// Handle /auth/poll endpoint - CLI polls this
async function handleAuthPoll(request, env, body) {
  const { state } = body;
  
  if (!state) {
    return new Response(JSON.stringify({
      error: 'state is required'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (!env.AUTH_STATES) {
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Auth state storage not configured'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const stateData = await env.AUTH_STATES.get(state, 'json');
  
  if (!stateData) {
    return new Response(JSON.stringify({
      error: 'expired_token',
      error_description: 'State has expired or does not exist'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (stateData.status === 'pending') {
    return new Response(JSON.stringify({
      error: 'authorization_pending',
      error_description: 'User has not yet completed authorization'
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (stateData.status === 'completed') {
    // Clean up state
    await env.AUTH_STATES.delete(state);
    
    // Return token
    return new Response(JSON.stringify({
      access_token: stateData.access_token,
      token_type: stateData.token_type || 'bearer',
      scope: stateData.scope
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }
  
  return new Response(JSON.stringify({
    error: 'server_error',
    error_description: 'Invalid state status'
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Health check
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'GitHub App Token Broker - Web Flow',
        endpoints: {
          '/auth/start': 'Start web authorization flow (POST)',
          '/auth/callback': 'OAuth callback (GET)',
          '/auth/poll': 'Poll for authorization completion (POST)'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Route requests
    try {
      switch (url.pathname) {
        case '/auth/start':
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
          }
          return await handleAuthStart(request, env);
        
        case '/auth/callback':
          if (request.method !== 'GET') {
            return new Response('Method not allowed', { status: 405 });
          }
          return await handleAuthCallback(request, env);
        
        case '/auth/poll':
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
          }
          const body = await request.json().catch(() => ({}));
          return await handleAuthPoll(request, env, body);
        
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({
        error: 'internal_error',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};