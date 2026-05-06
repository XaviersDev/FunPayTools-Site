export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const API_SECRET_KEY = process.env.API_SECRET_KEY;

  
  if (req.method === 'GET') {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/funpay_reviews?select=*,reactions:funpay_reactions(*)&order=created_at.desc`, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${API_SECRET_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { seller_name, seller_url, reviewer_name, review_text, rating, device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: 'device_id is req
