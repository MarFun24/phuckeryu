/**
 * GET /api/auth/login
 * 
 * Redirects to Canva's OAuth authorization page.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.CANVA_CLIENT_ID;
  
  if (!clientId) {
    return res.status(500).send('CANVA_CLIENT_ID not configured');
  }

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

  res.redirect(302, authUrl.toString());
}
