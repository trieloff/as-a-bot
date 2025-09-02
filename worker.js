/**
 * GitHub App Token Broker for Cloudflare Workers
 * 
 * README:
 * 
 * Setup:
 * 1. Configure secrets:
 *    wrangler secret put GITHUB_APP_PRIVATE_KEY  # Paste the entire PEM key
 *    wrangler secret put GITHUB_APP_ID           # Numeric App ID
 *    wrangler secret put GITHUB_CLIENT_ID        # App Client ID
 *    wrangler secret put BROKER_CLIENT_SECRET    # Shared HMAC secret
 * 
 * 2. Deploy:
 *    wrangler deploy
 * 
 * Usage Examples:
 * 
 * Get installation token:
 *    # Preferred: Using GitHub user token
 *    curl -X POST https://your-worker.workers.dev/token \
 *      -H "Content-Type: application/json" \
 *      -H "Authorization: Bearer $GITHUB_TOKEN" \
 *      -d '{"owner": "org", "repo": "repo"}'
 * 
 *    # Deprecated: Using HMAC (will be removed)
 *    curl -X POST https://your-worker.workers.dev/token \
 *      -H "Content-Type: application/json" \
 *      -H "X-Client-Auth: $(echo -n 'POST/token{"installation_id":123}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
 *      -d '{"installation_id": 123}'
 * 
 * Get token by repo:
 *    # Preferred: Using GitHub user token
 *    curl -X POST https://your-worker.workers.dev/token \
 *      -H "Content-Type: application/json" \
 *      -H "Authorization: Bearer $GITHUB_TOKEN" \
 *      -d '{"owner": "org", "repo": "repo"}'
 * 
 *    # Deprecated: Using HMAC
 *    curl -X POST https://your-worker.workers.dev/token \
 *      -H "Content-Type: application/json" \
 *      -H "X-Client-Auth: $(echo -n 'POST/token{"owner":"org","repo":"repo"}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
 *      -d '{"owner": "org", "repo": "repo"}'
 * 
 * Start device flow:
 *    curl -X POST https://your-worker.workers.dev/user-token/start \
 *      -H "Content-Type: application/json" \
 *      -H "X-Client-Auth: $(echo -n 'POST/user-token/start{}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
 *      -d '{}'
 * 
 * Poll device flow:
 *    curl -X POST https://your-worker.workers.dev/user-token/poll \
 *      -H "Content-Type: application/json" \
 *      -H "X-Client-Auth: $(echo -n 'POST/user-token/poll{"device_code":"..."}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
 *      -d '{"device_code": "..."}'
 * 
 * Shell one-liner for token export:
 *    # Using GitHub user token (secure)
 *    export GH_TOKEN=$(curl -sS -X POST https://your-worker.workers.dev/token \
 *      -H "Content-Type: application/json" \
 *      -H "Authorization: Bearer $GITHUB_TOKEN" \
 *      -d '{"owner": "org", "repo": "repo"}' | jq -r .token)
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

// Create GitHub App JWT
async function createAppJWT(privateKeyPEM, appId) {
  const now = Math.floor(Date.now() / 1000);
  
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  
  const payload = {
    iat: now - 60, // Issue time - 60 seconds for clock skew
    exp: now + 600, // Expires in 10 minutes
    iss: appId
  };
  
  const headerEncoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadEncoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${headerEncoded}.${payloadEncoded}`;
  
  // Import the private key
  const keyData = pemToArrayBuffer(privateKeyPEM);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
  
  // Sign the message
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(message)
  );
  
  const signatureEncoded = base64UrlEncode(signature);
  return `${message}.${signatureEncoded}`;
}

// Verify HMAC authentication (deprecated - for backward compatibility)
async function verifyHMAC(request, body, secret) {
  const method = request.method;
  const url = new URL(request.url);
  const path = url.pathname;
  const message = `${method}${path}${body}`;
  
  const providedAuth = request.headers.get('X-Client-Auth');
  if (!providedAuth) {
    return false;
  }
  
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message)
  );
  
  const expectedAuth = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return providedAuth === expectedAuth;
}

// Verify GitHub user token and get user info
async function verifyGitHubToken(token, env) {
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/user`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'GitHub-App-Token-Broker'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const user = await response.json();
    return user;
  } catch (error) {
    console.error('Failed to verify GitHub token:', error);
    return null;
  }
}

// Check if user has access to repository
async function checkRepositoryAccess(token, owner, repo, env) {
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/repos/${owner}/${repo}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'GitHub-App-Token-Broker'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const repoData = await response.json();
    
    // Also get user's permissions for this repo
    const permissionsUrl = `${githubApi}/repos/${owner}/${repo}/collaborators/permissions`;
    const userUrl = `${githubApi}/user`;
    
    const userResponse = await fetch(userUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'GitHub-App-Token-Broker'
      }
    });
    
    if (!userResponse.ok) {
      return null;
    }
    
    const userData = await userResponse.json();
    const username = userData.login;
    
    // Check user's permission level
    const permUrl = `${githubApi}/repos/${owner}/${repo}/collaborators/${username}/permission`;
    const permResponse = await fetch(permUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'GitHub-App-Token-Broker'
      }
    });
    
    if (permResponse.ok) {
      const permData = await permResponse.json();
      return {
        repo: repoData,
        permissions: permData.permission,
        user: permData.user
      };
    }
    
    // For public repos, users might have read access without being a collaborator
    if (!repoData.private) {
      return {
        repo: repoData,
        permissions: 'read',
        user: userData
      };
    }
    
    return null;
  } catch (error) {
    console.error('Failed to check repository access:', error);
    return null;
  }
}

// Get app installation permissions
async function getAppInstallationPermissions(jwt, installationId, env) {
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/app/installations/${installationId}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${jwt}`,
        'User-Agent': 'GitHub-App-Token-Broker'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const installation = await response.json();
    return installation.permissions;
  } catch (error) {
    console.error('Failed to get app permissions:', error);
    return null;
  }
}

// Check if user permissions meet or exceed app permissions
function validatePermissions(userPermission, appPermissions) {
  // Permission hierarchy: admin > write > read
  const permissionLevels = {
    'admin': 3,
    'write': 2,
    'read': 1,
    'none': 0
  };
  
  const userLevel = permissionLevels[userPermission] || 0;
  
  // Check each app permission
  for (const [resource, permission] of Object.entries(appPermissions || {})) {
    const requiredLevel = permissionLevels[permission] || 0;
    
    // For repository-level permissions, check if user has sufficient access
    if (resource === 'contents' || resource === 'pull_requests' || resource === 'issues') {
      if (userLevel < requiredLevel) {
        return {
          valid: false,
          error: `Insufficient permissions: app requires '${permission}' access to '${resource}', but user only has '${userPermission}' access to repository`
        };
      }
    }
  }
  
  return { valid: true };
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

// Get installation ID from owner/repo
async function getInstallationId(env, owner, repo, jwt) {
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/repos/${owner}/${repo}/installation`;
  
  const data = await githubRequest(url, {
    headers: {
      'Authorization': `Bearer ${jwt}`
    }
  });
  
  return data.id;
}

// Handle /token endpoint
async function handleToken(request, env, body, authenticatedUser = null) {
  const { installation_id, owner, repo } = body;
  
  if (!installation_id && (!owner || !repo)) {
    return new Response(JSON.stringify({
      error: 'Either installation_id or {owner, repo} must be provided'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Create App JWT
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  
  if (!appId || !privateKey) {
    return new Response(JSON.stringify({
      error: 'GitHub App configuration missing'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Use mock JWT in tests to bypass crypto issues
  const jwt = env.__mockJWT || await createAppJWT(privateKey, appId);
  
  // Get installation ID if not provided
  let installationId = installation_id;
  if (!installationId) {
    try {
      installationId = await getInstallationId(env, owner, repo, jwt);
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        details: error.body
      }), {
        status: error.status || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // If authenticated with GitHub user token, verify permissions
  if (authenticatedUser) {
    // Get app installation permissions
    const appPermissions = await getAppInstallationPermissions(jwt, installationId, env);
    if (!appPermissions) {
      return new Response(JSON.stringify({
        error: 'Failed to retrieve app installation permissions'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate user has sufficient permissions
    const validation = validatePermissions(authenticatedUser.repoAccess.permissions, appPermissions);
    if (!validation.valid) {
      return new Response(JSON.stringify({
        error: 'Permission denied',
        details: validation.error,
        user: authenticatedUser.user.login,
        userPermission: authenticatedUser.repoAccess.permissions,
        requiredPermissions: appPermissions
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log({
      action: 'token_requested',
      user: authenticatedUser.user.login,
      repo: `${owner || authenticatedUser.repoAccess.repo.owner.login}/${repo || authenticatedUser.repoAccess.repo.name}`,
      userPermission: authenticatedUser.repoAccess.permissions,
      timestamp: new Date().toISOString()
    });
  }
  
  // Get installation token
  const githubApi = env.GITHUB_API || 'https://api.github.com';
  const url = `${githubApi}/app/installations/${installationId}/access_tokens`;
  
  try {
    const tokenData = await githubRequest(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`
      }
    });
    
    // Set expiration headers
    const expiresAt = new Date(tokenData.expires_at);
    
    return new Response(JSON.stringify(tokenData), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Expires': expiresAt.toUTCString()
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      details: error.body
    }), {
      status: error.status || 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
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
      corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type, X-Client-Auth';
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
          '/token': 'Get installation token (POST)',
          '/user-token/start': 'Start device flow (POST)',
          '/user-token/poll': 'Poll device flow (POST)'
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
    let authenticatedUser = null;
    
    try {
      const rawBody = await request.text();
      body = rawBody ? JSON.parse(rawBody) : {};
      
      // Check for GitHub token in Authorization header
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const githubToken = authHeader.substring(7);
        
        // Verify GitHub token
        const user = await verifyGitHubToken(githubToken, env);
        if (!user) {
          return new Response(JSON.stringify({
            error: 'Invalid GitHub token'
          }), {
            status: 401,
            headers: {
              ...securityHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
        
        // For /token endpoint, check repository access
        if (url.pathname === '/token') {
          // Determine repository from request
          let targetOwner = body.owner;
          let targetRepo = body.repo;
          
          // If using installation_id, we need to get the repo info first
          if (!targetOwner || !targetRepo) {
            if (body.installation_id) {
              // For now, require owner/repo when using user authentication
              return new Response(JSON.stringify({
                error: 'When using GitHub user authentication, owner and repo must be specified'
              }), {
                status: 400,
                headers: {
                  ...securityHeaders,
                  'Content-Type': 'application/json'
                }
              });
            }
          }
          
          // Check user has access to the repository
          const repoAccess = await checkRepositoryAccess(githubToken, targetOwner, targetRepo, env);
          if (!repoAccess) {
            return new Response(JSON.stringify({
              error: 'Access denied',
              details: `User does not have access to repository ${targetOwner}/${targetRepo}`
            }), {
              status: 403,
              headers: {
                ...securityHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          
          authenticatedUser = {
            user,
            repoAccess,
            token: githubToken
          };
        } else {
          // For non-token endpoints, just store user info
          authenticatedUser = {
            user,
            token: githubToken
          };
        }
      } else {
        // Fall back to HMAC authentication (deprecated)
        const secret = env.BROKER_CLIENT_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({
            error: 'Authentication required. Use GitHub token in Authorization header.'
          }), {
            status: 401,
            headers: {
              ...securityHeaders,
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer realm="GitHub App Token Broker"'
            }
          });
        }
        
        const isValid = await verifyHMAC(request, rawBody, secret);
        if (!isValid) {
          return new Response(JSON.stringify({
            error: 'Invalid authentication. Use GitHub token in Authorization header.'
          }), {
            status: 401,
            headers: {
              ...securityHeaders,
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer realm="GitHub App Token Broker"'
            }
          });
        }
        
        // Log warning about deprecated auth method
        console.warn('HMAC authentication is deprecated. Please use GitHub token authentication.');
      }
    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Invalid request body or authentication'
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
        case '/token':
          response = await handleToken(request, env, body, authenticatedUser);
          break;
        
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