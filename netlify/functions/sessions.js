// netlify/functions/sessions.js
// Admin-only endpoint: list sessions, get signed download URLs

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Auth check
  const auth = event.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (token !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── LIST SESSIONS ──
  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };

    return { statusCode: 200, headers, body: JSON.stringify({ sessions: data }) };
  }

  // ── GET SIGNED DOWNLOAD URLs ──
  if (event.httpMethod === 'POST') {
    const { sessionId } = JSON.parse(event.body || '{}');
    if (!sessionId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing sessionId' }) };

    // List all files for this session
    const { data: files, error: listError } = await supabase.storage
      .from('interview-audio')
      .list(sessionId);

    if (listError) return { statusCode: 500, headers, body: JSON.stringify({ error: listError.message }) };

    // Generate signed URLs (valid 1 hour)
    const urls = {};
    for (const file of (files || [])) {
      const filePath = `${sessionId}/${file.name}`;
      const { data: signed, error: signError } = await supabase.storage
        .from('interview-audio')
        .createSignedUrl(filePath, 3600);

      if (!signError && signed) {
        urls[file.name] = signed.signedUrl;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ sessionId, files: urls }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
