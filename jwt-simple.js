// Simple JWT implementation for GitHub App authentication
// This is a minimal implementation specifically for GitHub App JWTs

export async function signJWT(payload, privateKey) {
  // Import the crypto key
  const cryptoKey = await importPrivateKey(privateKey);
  
  // Create the JWT header
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  
  // Encode header and payload
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  
  // Create the signature
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await sign(data, cryptoKey);
  
  // Return the complete JWT
  return `${data}.${signature}`;
}

async function importPrivateKey(pem) {
  // Remove PEM headers and newlines
  const pemContents = pem
    .replace(/-----BEGIN.*?-----/g, '')
    .replace(/-----END.*?-----/g, '')
    .replace(/\s/g, '');
  
  // Decode base64
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  // Import the key
  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
}

async function sign(data, key) {
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(data)
  );
  
  return base64url(signature);
}

function base64url(input) {
  let output;
  
  if (typeof input === 'string') {
    output = btoa(input);
  } else if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    const bytes = new Uint8Array(input);
    const binary = String.fromCharCode(...bytes);
    output = btoa(binary);
  } else {
    throw new Error('Invalid input type for base64url');
  }
  
  // Convert to base64url
  return output
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}