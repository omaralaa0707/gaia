const { createClient } = require('@supabase/supabase-js');

// Public endpoint - no auth required.
// Receives homepage feedback submissions and stores them for review in the
// admin panel's Feedback tab.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, rating, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  const ratingNum = rating != null ? Number(rating) : null;
  if (ratingNum != null && (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5)) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
  }

  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { error } = await db.from('feedback').insert({
      name: String(name).trim(),
      email: String(email).trim(),
      rating: ratingNum,
      message: String(message).trim(),
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
