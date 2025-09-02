/**
 * GitHub App Token Broker for Cloudflare Workers
 * 
 * This worker provides user-to-server GitHub tokens that properly attribute
 * actions to users while showing the GitHub App badge. This ensures proper
 * user attribution in GitHub's UI and audit logs.
 * 
 * Setup:
 * 1. Configure secrets:
 *    wrangler secret put GITHUB_CLIENT_ID        # App Client ID  
 * 
 * 2. Deploy:
 *    wrangler deploy
 * 
 * Usage Examples:
 * 
 * Start device flow (get user code for authorization):
 *    curl -X POST https://your-worker.workers.dev/user-token/start \
 *      -H "Content-Type: application/json" \
 *      -d '{"scopes": "repo"}'
 * 
 * Poll device flow (exchange device code for user token):
 *    curl -X POST https://your-worker.workers.dev/user-token/poll \
 *      -H "Content-Type: application/json" \
 *      -d '{"device_code": "device_abc123"}'
 * 
 * The returned tokens are user-to-server tokens that:
 * - Attribute actions to the specific user (not the app)
 * - Show the app badge next to the user's name  
 * - Appear in audit logs as "GitHub App user-to-server token"
 * - Respect the user's existing permissions
 * 
 * Shell example for device flow:
 *    # Start the flow
 *    DEVICE_DATA=$(curl -sS -X POST https://your-worker.workers.dev/user-token/start -d '{}')
 *    echo "Go to: $(echo $DEVICE_DATA | jq -r .verification_uri)"
 *    echo "Enter code: $(echo $DEVICE_DATA | jq -r .user_code)"
 *    
 *    # Poll for token (repeat until success)
 *    DEVICE_CODE=$(echo $DEVICE_DATA | jq -r .device_code)
 *    export GH_TOKEN=$(curl -sS -X POST https://your-worker.workers.dev/user-token/poll \
 *      -d "{\"device_code\": \"$DEVICE_CODE\"}" | jq -r .access_token)
 */

// Utilities for base64url encoding
function base64UrlEncode(buffer) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// Convert PEM to raw key data
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN.*?-----/g, '')
    .replace(/-----END.*?-----/g, '')
    .replace(/\s/g, '');
  // Use standard base64 decode for PEM (not base64url)
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}






// Make GitHub API request
async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GitHub-App-Token-Broker',
      ...options.headers
    }
  });
  
  const responseBody = await response.text();
  let jsonBody;
  
  try {
    jsonBody = JSON.parse(responseBody);
  } catch {
    jsonBody = { message: responseBody };
  }
  
  if (!response.ok) {
    const error = new Error(`GitHub API error: ${jsonBody.message || 'Unknown error'}`);
    error.status = response.status;
    error.body = jsonBody;
    throw error;
  }
  
  return jsonBody;
}



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
  
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/login/device/code`;
  
  const params = new URLSearchParams({
    client_id: clientId
  });
  
  if (scopes) {
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
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/login/oauth/access_token`;
  
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
    
    // Success - clean up device code (if KV is available)
    if (env.DEVICE_CODES) {
      await env.DEVICE_CODES.delete(device_code);
    }
    
    // Calculate expiration
    const expiresAt = new Date(Date.now() + (data.expires_in || 28800) * 1000).toISOString();
    
    return new Response(JSON.stringify({
      access_token: data.access_token,
      token_type: data.token_type,
      expires_at: expiresAt,
      scope: data.scope
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

// Handle /oauth/authorize endpoint - redirect to GitHub OAuth
async function handleOAuthAuthorize(request, env, body) {
  const { scopes, state, redirect_uri } = body;
  const clientId = env.GITHUB_CLIENT_ID;
  
  if (!clientId) {
    return new Response(JSON.stringify({
      error: 'GitHub Client ID not configured'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Build GitHub OAuth URL
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('response_type', 'code');
  
  if (scopes) {
    githubAuthUrl.searchParams.set('scope', scopes);
  }
  
  if (state) {
    githubAuthUrl.searchParams.set('state', state);
  }
  
  if (redirect_uri) {
    githubAuthUrl.searchParams.set('redirect_uri', redirect_uri);
  }
  
  return new Response(JSON.stringify({
    authorization_url: githubAuthUrl.toString(),
    message: 'Redirect user to authorization_url to complete OAuth flow'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle /oauth/callback endpoint - exchange code for token
async function handleOAuthCallback(request, env, body) {
  const { code, state } = body;
  const clientId = env.GITHUB_CLIENT_ID;
  
  if (!clientId) {
    return new Response(JSON.stringify({
      error: 'GitHub Client ID not configured'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (!code) {
    return new Response(JSON.stringify({
      error: 'Authorization code is required'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/login/oauth/access_token`;
  
  const params = new URLSearchParams({
    client_id: clientId,
    code: code,
    grant_type: 'authorization_code'
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
      return new Response(JSON.stringify({
        error: data.error,
        error_description: data.error_description
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Calculate expiration
    const expiresAt = new Date(Date.now() + (data.expires_in || 28800) * 1000).toISOString();
    
    return new Response(JSON.stringify({
      access_token: data.access_token,
      token_type: data.token_type,
      expires_at: expiresAt,
      scope: data.scope,
      state: state
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
    
    // CORS handling
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : [];
    const corsHeaders = {};
    
    if (origin && allowedOrigins.includes(origin)) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }
    
    // Add security headers
    const securityHeaders = {
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...corsHeaders
    };
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: securityHeaders
      });
    }
    
    // Allow GET for health check
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'GitHub App Token Broker',
        timestamp: new Date().toISOString(),
        endpoints: {
          '/health': 'Health check (GET)',
          '/user-token/start': 'Start device flow (POST)',
          '/user-token/poll': 'Poll device flow (POST)',
          '/oauth/authorize': 'Start OAuth web flow (POST)',
          '/oauth/callback': 'Complete OAuth web flow (POST)'
        }
      }), {
        status: 200,
        headers: {
          ...securityHeaders,
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
          ...securityHeaders,
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
          ...securityHeaders,
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
        
        case '/oauth/authorize':
          response = await handleOAuthAuthorize(request, env, body);
          break;
        
        case '/oauth/callback':
          response = await handleOAuthCallback(request, env, body);
          break;
        
        default:
          response = new Response(JSON.stringify({
            error: 'Not found'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
      }
      
      // Add security headers to response
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(securityHeaders)) {
        newHeaders.set(key, value);
      }
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    } catch (error) {
      console.error('Request failed:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error'
      }), {
        status: 500,
        headers: {
          ...securityHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  }
};