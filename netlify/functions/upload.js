// netlify/functions/upload.js
// Receives: multipart form with audio files + JSON paralinguistic report
// Saves everything to Supabase Storage (audio) + Supabase DB (metadata + report)

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { sessionId, questionIndex, type, data, mimeType, report } = body;

    // Validate session ID (20 char alphanumeric)
    if (!sessionId || !/^[A-Z0-9]{20}$/.test(sessionId)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid session ID' }) };
    }

    // ── AUDIO UPLOAD ──
    if (type === 'audio') {
      const audioBuffer = Buffer.from(data, 'base64');
      const ext = mimeType?.includes('ogg') ? 'ogg' : mimeType?.includes('mp4') ? 'mp4' : 'webm';
      const filePath = `${sessionId}/audio_Q${questionIndex}.${ext}`;

      const { error: storageError } = await supabase.storage
        .from('interview-audio')
        .upload(filePath, audioBuffer, {
          contentType: mimeType || 'audio/webm',
          upsert: true
        });

      if (storageError) throw storageError;

      // Upsert session record
      const { error: dbError } = await supabase
        .from('sessions')
        .upsert({
          session_id: sessionId,
          updated_at: new Date().toISOString(),
          [`audio_q${questionIndex}_path`]: filePath
        }, { onConflict: 'session_id' });

      if (dbError) throw dbError;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type: 'audio', filePath }) };
    }

    // ── REPORT UPLOAD ──
    if (type === 'report') {
      const reportJson = JSON.stringify(report, null, 2);
      const filePath = `${sessionId}/report_paralinguistico.json`;

      const { error: storageError } = await supabase.storage
        .from('interview-audio')
        .upload(filePath, Buffer.from(reportJson), {
          contentType: 'application/json',
          upsert: true
        });

      if (storageError) throw storageError;

      // Mark session as complete
      const { error: dbError } = await supabase
        .from('sessions')
        .upsert({
          session_id: sessionId,
          completed_at: new Date().toISOString(),
          report_path: filePath,
          updated_at: new Date().toISOString()
        }, { onConflict: 'session_id' });

      if (dbError) throw dbError;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type: 'report' }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown type' }) };

  } catch (err) {
    console.error('Upload error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', detail: err.message })
    };
  }
};
