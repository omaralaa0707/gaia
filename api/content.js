const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { validateSlotChange } = require('../lib/content-guardian');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content-slots.json'), 'utf8'));

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = supabase();

  if (req.method === 'GET') {
    const page = req.query.page;
    const historySlotId = req.query.history;

    if (historySlotId) {
      const { data: pc, error: pcErr } = await db.from('page_content').select('id').eq('slot_id', historySlotId).single();
      if (pcErr) return res.status(500).json({ error: pcErr.message });
      const { data: versions, error: vErr } = await db
        .from('content_versions')
        .select('value, created_at')
        .eq('page_content_id', pc.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (vErr) return res.status(500).json({ error: vErr.message });
      return res.json({ versions });
    }

    if (!page) return res.status(400).json({ error: 'page query param required' });

    const { data, error } = await db.from('page_content').select('slot_id, value').eq('page', page);
    if (error) return res.status(500).json({ error: error.message });

    const slots = {};
    for (const row of data || []) slots[row.slot_id] = row.value;
    return res.json({ slots });
  }

  if (req.method === 'POST') {
    const pwd = req.headers['x-admin-password'];
    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { slotId, type, value } = req.body || {};
    const result = validateSlotChange(manifest, slotId, type, value);
    if (!result.ok) {
      return res.status(400).json({ ok: false, reason: result.reason });
    }

    const { data: existing, error: fetchErr } = await db
      .from('page_content')
      .select('id, value')
      .eq('slot_id', slotId)
      .single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const { error: versionErr } = await db
      .from('content_versions')
      .insert({ page_content_id: existing.id, value: existing.value, created_by: 'admin' });
    if (versionErr) return res.status(500).json({ error: versionErr.message });

    const { error: updateErr } = await db
      .from('page_content')
      .update({ value: result.sanitizedValue, updated_at: new Date().toISOString(), updated_by: 'admin' })
      .eq('id', existing.id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.json({ ok: true, value: result.sanitizedValue });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
