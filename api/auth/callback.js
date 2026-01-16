import { parse } from 'cookie';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Auth failed: ${error} - ${error_description || ''}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Retrieve code_verifier from cookie
  const cookies = parse(req.headers.cookie || '');
  const codeVerifier = cookies.code_verifier;

  if (!codeVerifier) {
    return res.status(400).send('Missing code_verifier. Please start the auth flow again at /api/auth/login');
  }

  try {
    const tokenResponse = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        code_verifier: codeVerifier,  // <-- THIS IS WHAT WAS MISSING
        client_id: process.env.CANVA_CLIENT_ID,
        client_secret: process.env.CANVA_CLIENT_SECRET,
        redirect_uri: 'https://phuckeryuniversity.vercel.app/api/auth/callback',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
    }

    // Clear the cookie
    res.setHeader('Set-Cookie', 'code_verifier=; HttpOnly; Secure; Path=/; Max-Age=0');

    return res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; max-width: 800px; margin: 0 auto;">
          <h1>✅ Success!</h1>
          <p>Add this to Vercel Environment Variables as <strong>CANVA_ACCESS_TOKEN</strong>:</p>
          <textarea readonly style="width:100%;height:100px;font-family:monospace;">${tokenData.access_token}</textarea>
          <p style="margin-top:20px;">Refresh token (save this too as <strong>CANVA_REFRESH_TOKEN</strong>):</p>
          <textarea readonly style="width:100%;height:60px;font-family:monospace;">${tokenData.refresh_token || 'N/A'}</textarea>
          <p style="color:orange;margin-top:20px;">⚠️ Copy these NOW and add to Vercel, then redeploy!</p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`);
  }
}
