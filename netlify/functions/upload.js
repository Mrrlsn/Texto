// netlify/functions/upload.js
// Three request types:
//   sign    → returns a Supabase signed upload URL for direct browser upload
//   confirm → records the file path in the DB after successful upload
//   report  → saves the paralinguistic JSON report

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  try {
    const body = JSON.parse(event.body);
    const { sessionId, type } = body;

    if (!sessionId || !/^[A-Z0-9]{20}$/.test(sessionId)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid session ID' }) };
    }

    // ── SIGN: return a signed URL so the browser can PUT audio directly ──
    if (type === 'sign') {
      const { questionIndex, ext, mimeType } = body;
      const filePath = `${sessionId}/audio_Q${questionIndex}.${ext || 'webm'}`;

      const { data, error } = await supabase.storage
        .from('interview-audio')
        .createSignedUploadUrl(filePath);

      if (error) throw error;

      // Ensure session row exists
      await supabase.from('sessions').upsert(
        { session_id: sessionId, updated_at: new Date().toISOString() },
        { onConflict: 'session_id', ignoreDuplicates: true }
      );

      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ signedUrl: data.signedUrl, token: data.token, filePath })
      };
    }

    // ── CONFIRM: browser finished uploading, record path in DB ──
    if (type === 'confirm') {
      const { questionIndex, filePath } = body;
      const col = `audio_q${questionIndex}_path`;

      const { error } = await supabase.from('sessions').upsert(
        { session_id: sessionId, [col]: filePath, updated_at: new Date().toISOString() },
        { onConflict: 'session_id' }
      );
      if (error) throw error;

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // ── REPORT: save paralinguistic JSON to storage + mark session complete ──
    if (type === 'report') {
      const reportJson = JSON.stringify(body.report, null, 2);
      const filePath = `${sessionId}/report_paralinguistico.json`;

      const { error: storageErr } = await supabase.storage
        .from('interview-audio')
        .upload(filePath, Buffer.from(reportJson), {
          contentType: 'application/json',
          upsert: true
        });
      if (storageErr) throw storageErr;

      const { error: dbErr } = await supabase.from('sessions').upsert(
        {
          session_id: sessionId,
          completed_at: new Date().toISOString(),
          report_path: filePath,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'session_id' }
      );
      if (dbErr) throw dbErr;

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown type' }) };

  } catch (err) {
    console.error('upload.js error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
