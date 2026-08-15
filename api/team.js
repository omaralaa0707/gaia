const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { slug } = req.query;

    if (slug) {
      const { data, error } = await db
        .from('therapists')
        .select('id, name, role, photo_url, bio, details, slug, active')
        .eq('slug', slug)
        .eq('active', true)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Not found' });
      return res.json({ therapist: data });
    }

    let query = db
      .from('therapists')
      .select('id, name, role, photo_url, bio, details, slug, specialties')
      .eq('active', true)
      .order('name');

    const { service } = req.query;
    // specialties is jsonb, not a Postgres array — .contains() must get a JSON
    // string here or it serializes as `cs.{service}` (array-literal syntax),
    // which Postgres rejects with "invalid input syntax for type json". (This
    // exact bug 500'd every ACPP service page until fixed — avoiding it here
    // from the start.)
    if (service) query = query.contains('specialties', JSON.stringify([service]));

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ therapists: pinFirst(data || [], 'Yasmin Magdy') });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Moves the therapist with the given name to the front of the list
// (e.g. the co-founder), leaving everyone else in their existing order.
function pinFirst(list, name) {
  const idx = list.findIndex(t => t.name === name);
  if (idx <= 0) return list;
  const [pinned] = list.splice(idx, 1);
  return [pinned, ...list];
}
