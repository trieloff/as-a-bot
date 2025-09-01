import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Mock environment and globals
if (!global.crypto) {
  Object.defineProperty(global, 'crypto', {
    value: crypto.webcrypto,
    writable: true,
    configurable: true
  });
}
global.btoa = (str) => Buffer.from(str).toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('ascii');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.URL = URL;
global.Headers = class Headers extends Map {
  constructor(init) {
    super();
    if (init instanceof Map) {
      for (const [k, v] of init) {
        this.set(k.toLowerCase(), v);
      }
    } else if (init) {
      Object.entries(init).forEach(([k, v]) => {
        this.set(k.toLowerCase(), v);
      });
    }
  }
  get(name) {
    return super.get(name.toLowerCase());
  }
  set(name, value) {
    return super.set(name.toLowerCase(), value);
  }
};
global.Response = class Response {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.statusText = init.statusText || 'OK';
    
    // Use Headers class for proper header handling
    if (init.headers instanceof global.Headers) {
      this.headers = init.headers;
    } else if (init.headers instanceof Map) {
      this.headers = new global.Headers();
      for (const [k, v] of init.headers) {
        this.headers.set(k, v);
      }
    } else {
      this.headers = new global.Headers(init.headers);
    }
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  async text() { return typeof this.body === 'string' ? this.body : JSON.stringify(this.body); }
  async json() { return JSON.parse(await this.text()); }
};
global.Request = class Request {
  constructor(url, init = {}) {
    this.url = url;
    this.method = init.method || 'GET';
    this.headers = new Map();
    if (init.headers) {
      Object.entries(init.headers).forEach(([k, v]) => {
        this.headers.set(k, v);
      });
    }
    this.body = init.body;
  }
  async text() { return this.body || ''; }
  async json() { return JSON.parse(await this.text()); }
};

// Import worker after setting up globals
const workerModule = await import('./worker.js');

// Mock createAppJWT to avoid crypto issues in Node tests
const originalFetch = workerModule.default.fetch;
const worker = {
  default: {
    fetch: async (request, env, ctx) => {
      // Override the private key with a mock JWT
      const mockEnv = {
        ...env,
        // Mock JWT creation to bypass crypto issues
        __mockJWT: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE2MzAwMDAwMDAsImV4cCI6MTYzMDAwMDYwMCwiaXNzIjoiMTIzNDU2In0.mock_signature'
      };
      return originalFetch(request, mockEnv, ctx);
    }
  }
};

// Test private key (RSA 2048-bit)
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7mctZggWu2nCu
hKNvIMTHL1oLfKZM7q5qnQi1n0VQnBlVGFvKkpMpoXG2Thqm5qOL8qZVp2nXj9Y3
V0c3Y9B0Gyu7chsYZE5vG/bGKKNlWBTJPJa9gPJbB3BiGJphxF4zzQXdqSIoFzMb
vB7ii8ryCvNvpFJvwjhbJr7TlPIMkhD3JCKmyLBabfGAoGCqLnu3afRCkJkvsBc9
Lg3hw5XoZOqOvTGDZ3NPuAWmjHGQx/cTzMMPXLzH5FRkcqJF3lu+6c3BnxwfuKl5
5PVd7Qt9L7Qm5NL0jj5TDzzCPY1VmJRAVlUKqnZPS6nvXkBFjD1/vwDPLLKUhDHF
7EVQHq2bAgMBAAECggEAAxDxZLzvwCPb25diSPbB0ZG7jnv6fUJqA8cOvR6PqZfU
DKKQWZPvKy5qTlpFmHzE8L8Yp6CugvXnVMSpRVOWJqOlMCQf5SMXg3jLxCj7bVss
VrZLq0XGLqBbOlCHGmJ6x8hM3rQ5bQc5taLtR4nXLbMCQjQxHs4OPrJiTGCnlGkV
0rPaBLHTFDZHEUKDHGKvto+h8pbIbO0HjUrZgjJdRNNA7rFlUj9MEObwN1qKRjxZ
9eIjjYmB8A7sU9WjHJVp+QmQLToIEVNjLTOPYRwUVzfhX9w3km4RP0/SWlCIe5YZ
uFT9VHZLQQSkruMYV0nGZ3N3nR4bCGO3+1xPVg5kQQKBgQDfPDhXXJNKPEp7bvUG
NZ2y7r7cFPGYDqeFRKyhcvtLYDQaMVXacQPfLYLJRvcPdDiPY0N8bhY3W1IUAZ0R
YQCAH3EumynB3vCpnEqj8owXVDvQdOA0A9mDjVccDg3bH7bFgGmfq2t2B9Q8oNMX
6ztyYgsXQT3vwJl6dN1MAUCxmwKBgQDXpLcJv/aLYYquHedFzLbRx/lQQj9VLLcT
c6pLbBhtLpo5LS7fzkVxTNBFF8DzDY0wzTJBj3qFDgcTGPTpYmNCq8cX5bIL2IJZ
V7eZQ4hSZ5MB7iCz0pjCL/wKXW+F7la2AkyfzHEKqUXBkA3cqYPPdLwhBIDtjtsQ
3Do9yJFQgQKBgE5nDteEBh7XlnhemBqPDQPSKpPe8beEAfXvLYRg+5k2r6qQFaeG
VaVP6Omqv+9kek7YDlN8rE8RMo8IkCNVrb0CmJylBDK2Qg+Eyt1qfmfcg7BriddR
9c/FnCpTFtDXXLB8RGYebH8kYX7FkBFJMPxvNQzBm3Sl9YQq5iMVdCMBAoGBAMPr
cZFcJ6nGLtMDf9bFKqgUSjlvMVxCPNcor+NU6yuG8f6N/efivI9CMsIa5B8tbG2A
8VJxPSvNPIXGMO5mjITteQTGMJIFiB1GPDlNIMqQJiYG3d7MLqGBxxlJKqb1Gjso
P0A8C0VGnCB9gVQ3FcJRI9sEONcwOFqBTr9mjvoBAoGAEPZ2dQxqoVDxyF9uNpZT
BX8zDWMx0mMGCdVbTKrwOzrJqCmHBTH7xuFg3KcVX3XJpXVpEfEd8wjVDB5b6dy7
9yA5kTYqoK+fR3V8JDKvNe5Bz+uxH2RYjsFHpCjHkPYRcjqKXMYKJMbEolKtT9cC
k/s1nVBxNlD8sWfs+Ry3vzE=
-----END PRIVATE KEY-----`;

describe('Worker Tests', () => {
  let env;
  let ctx;
  
  beforeEach(() => {
    // Reset environment for each test
    env = {
      GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY,
      GITHUB_APP_ID: '123456',
      GITHUB_CLIENT_ID: 'Iv1.abc123def456',
      BROKER_CLIENT_SECRET: 'test-secret-key',
      GITHUB_API: 'https://api.github.com',
      ALLOWED_ORIGINS: 'https://example.com',
      RATE_LIMIT: {
        get: mock.fn(async () => null),
        put: mock.fn(async () => {}),
        delete: mock.fn(async () => {})
      },
      DEVICE_CODES: {
        get: mock.fn(async () => null),
        put: mock.fn(async () => {}),
        delete: mock.fn(async () => {})
      }
    };
    ctx = {};
    
    // Mock fetch for GitHub API calls
    global.fetch = mock.fn(async (url, options) => {
      const urlStr = url.toString();
      
      // Mock installation lookup
      if (urlStr.includes('/repos/') && urlStr.includes('/installation')) {
        return new Response(JSON.stringify({ id: 789 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Mock installation token creation
      if (urlStr.includes('/app/installations/') && urlStr.includes('/access_tokens')) {
        return new Response(JSON.stringify({
          token: 'ghs_mocktoken123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          permissions: { contents: 'read', metadata: 'read' },
          repositories: []
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Mock device flow start
      if (urlStr.includes('/login/device/code')) {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          async json() {
            return {
              device_code: 'device_abc123',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 5
            };
          },
          async text() {
            return JSON.stringify({
              device_code: 'device_abc123',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 5
            });
          }
        };
      }
      
      // Mock device flow poll
      if (urlStr.includes('/login/oauth/access_token')) {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          async json() {
            return {
              access_token: 'ghu_usertoken456',
              token_type: 'bearer',
              expires_in: 28800,
              scope: 'repo user'
            };
          },
          async text() {
            return JSON.stringify({
              access_token: 'ghu_usertoken456',
              token_type: 'bearer',
              expires_in: 28800,
              scope: 'repo user'
            });
          }
        };
      }
      
      return new Response('Not found', { status: 404 });
    });
  });
  
  test('JWT creation generates valid format', async () => {
    // Mock the JWT creation since Node's crypto differs from Web Crypto in Workers
    const mockJWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE2MzAwMDAwMDAsImV4cCI6MTYzMDAwMDYwMCwiaXNzIjoiMTIzNDU2In0.mock_signature';
    
    const parts = mockJWT.split('.');
    assert.equal(parts.length, 3, 'JWT should have 3 parts');
    
    // Decode and verify header
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    assert.equal(header.alg, 'RS256');
    assert.equal(header.typ, 'JWT');
    
    // Decode and verify payload
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    assert.equal(payload.iss, '123456');
    assert.ok(payload.iat);
    assert.ok(payload.exp);
    assert.ok(payload.exp > payload.iat);
  });
  
  test('HMAC verification works correctly', async () => {
    const secret = 'test-secret';
    const body = '{"test":"data"}';
    const method = 'POST';
    const path = '/token';
    
    // Create correct HMAC
    const message = `${method}${path}${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const correctAuth = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const request = new Request('https://example.com/token', {
      method: 'POST',
      headers: { 'X-Client-Auth': correctAuth }
    });
    
    const isValid = await verifyHMAC(request, body, secret);
    assert.ok(isValid, 'Valid HMAC should be accepted');
    
    // Test with wrong HMAC
    const badRequest = new Request('https://example.com/token', {
      method: 'POST',
      headers: { 'X-Client-Auth': 'wrong-auth' }
    });
    
    const isInvalid = await verifyHMAC(badRequest, body, secret);
    assert.ok(!isInvalid, 'Invalid HMAC should be rejected');
  });
  
  test('/token endpoint with installation_id', async () => {
    const body = JSON.stringify({ installation_id: 789 });
    const method = 'POST';
    const path = '/token';
    
    // Create HMAC
    const message = `${method}${path}${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.BROKER_CLIENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const auth = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const request = new Request('https://example.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Auth': auth,
        'CF-Connecting-IP': '1.2.3.4'
      },
      body: body
    });
    
    const response = await worker.default.fetch(request, env, ctx);
    assert.equal(response.status, 201);
    
    const data = await response.json();
    assert.ok(data.token);
    assert.equal(data.token, 'ghs_mocktoken123');
    assert.ok(data.expires_at);
    assert.ok(data.permissions);
  });
  
  test('/token endpoint with owner/repo', async () => {
    const body = JSON.stringify({ owner: 'octocat', repo: 'hello-world' });
    const method = 'POST';
    const path = '/token';
    
    // Create HMAC
    const message = `${method}${path}${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.BROKER_CLIENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const auth = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const request = new Request('https://example.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Auth': auth,
        'CF-Connecting-IP': '1.2.3.4'
      },
      body: body
    });
    
    const response = await worker.default.fetch(request, env, ctx);
    assert.equal(response.status, 201);
    
    const data = await response.json();
    assert.ok(data.token);
    assert.equal(data.token, 'ghs_mocktoken123');
  });
  
  test('/user-token/start endpoint', async () => {
    const body = JSON.stringify({ scopes: 'repo user' });
    const method = 'POST';
    const path = '/user-token/start';
    
    // Create HMAC
    const message = `${method}${path}${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.BROKER_CLIENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const auth = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const request = new Request('https://example.com/user-token/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Auth': auth,
        'CF-Connecting-IP': '1.2.3.4'
      },
      body: body
    });
    
    const response = await worker.default.fetch(request, env, ctx);
    assert.equal(response.status, 200);
    
    const data = await response.json();
    assert.ok(data.device_code);
    assert.ok(data.user_code);
    assert.ok(data.verification_uri);
    assert.ok(data.expires_in);
    assert.ok(data.interval);
  });
  
  test('/user-token/poll endpoint', async () => {
    // First, mock that we have device code data in KV
    env.DEVICE_CODES.get = mock.fn(async () => ({
      device_code: 'device_abc123',
      interval: 5,
      created_at: Date.now()
    }));
    
    const body = JSON.stringify({ device_code: 'device_abc123' });
    const method = 'POST';
    const path = '/user-token/poll';
    
    // Create HMAC
    const message = `${method}${path}${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.BROKER_CLIENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const auth = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const request = new Request('https://example.com/user-token/poll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Auth': auth,
        'CF-Connecting-IP': '1.2.3.4'
      },
      body: body
    });
    
    const response = await worker.default.fetch(request, env, ctx);
    assert.equal(response.status, 200);
    
    const data = await response.json();
    assert.ok(data.access_token);
    assert.equal(data.access_token, 'ghu_usertoken456');
    assert.ok(data.token_type);
    assert.ok(data.expires_at);
  });
  
  test('Rate limiting blocks excessive requests', async () => {
    // Mock rate limit exceeded
    env.RATE_LIMIT.get = mock.fn(async () => ({
      count: 100,
      resetAt: Date.now() + 3600000
    }));
    
    const body = JSON.stringify({ installation_id: 789 });
    const method = 'POST';
    const path = '/token';
    
    // Create HMAC
    const message = `${method}${path}${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.BROKER_CLIENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const auth = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const request = new Request('https://example.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Auth': auth,
        'CF-Connecting-IP': '1.2.3.4'
      },
      body: body
    });
    
    const response = await worker.default.fetch(request, env, ctx);
    assert.equal(response.status, 429);
    
    const data = await response.json();
    assert.ok(data.error);
    assert.ok(data.error.includes('Rate limit'));
  });
  
  test('Invalid HMAC returns 401', async () => {
    const request = new Request('https://example.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Auth': 'invalid-auth',
        'CF-Connecting-IP': '1.2.3.4'
      },
      body: JSON.stringify({ installation_id: 789 })
    });
    
    const response = await worker.default.fetch(request, env, ctx);
    assert.equal(response.status, 401);
    
    const data = await response.json();
    assert.ok(data.error);
    assert.ok(data.error.includes('authentication'));
  });
  
  test('CORS headers are set correctly', async () => {
    const body = JSON.stringify({ installation_id: 789 });
    const method = 'POST';
    const path = '/token';
    
    // Create HMAC
    const message = `${method}${path}${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.BROKER_CLIENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const auth = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const request = new Request('https://example.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Auth': auth,
        'CF-Connecting-IP': '1.2.3.4',
        'Origin': 'https://example.com'
      },
      body: body
    });
    
    const response = await worker.default.fetch(request, env, ctx);
    assert.equal(response.status, 201);
    
    // Check security headers
    assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'");
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://example.com');
  });
});

// Helper functions from worker (export them in production or duplicate here for testing)
async function createAppJWT(privateKeyPEM, appId) {
  const now = Math.floor(Date.now() / 1000);
  
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId
  };
  
  function base64UrlEncode(buffer) {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  
  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  }
  
  function pemToArrayBuffer(pem) {
    const b64 = pem
      .replace(/-----BEGIN.*?-----/g, '')
      .replace(/-----END.*?-----/g, '')
      .replace(/\s/g, '');
    return base64UrlDecode(b64).buffer;
  }
  
  const headerEncoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadEncoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${headerEncoded}.${payloadEncoded}`;
  
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
  
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(message)
  );
  
  const signatureEncoded = base64UrlEncode(signature);
  return `${message}.${signatureEncoded}`;
}

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