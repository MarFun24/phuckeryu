import { randomBytes, createHash } from 'crypto';

/**
 * GET /api/auth/login
 * 
 * Redirects to Canva's OAuth authorization page with PKCE.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.CANVA_CLIENT_ID;
  
  if (!clientId) {
    return res.status(500).send('CANVA_CLIENT_ID not configured');
  }

  // Generate PKCE values
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  // Store code_verifier in a cookie for the callback to retrieve
  res.setHeader('Set-Cookie', `code_verifier=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);

  const scopes = [
    'asset:read',
    'brandtemplate:content:read',
    'brandtemplate:meta:read',
    'design:content:read',
    'design:content:write',
    'design:meta:read',
  ].join(' ');

  const authUrl = new URL('https://www.canva.com/api/oauth/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', 'https://phuckeryuniversity.vercel.app/api/auth/callback');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', 'canva_auth_' + Date.now());
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  res.redirect(302, authUrl.toString());
}
