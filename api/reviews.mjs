export default async function handler(req, res) {
  // Эти переменные ты добавишь в настройках Vercel, никто их не увидит в GitHub
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const API_SECRET_KEY = process.env.API_SECRET_KEY;

  // 1. ОТДАЧА ОТЗЫВОВ ДЛЯ ЛЕНТЫ (Для сайта)
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

  // 2. ПРИЕМ ОТЗЫВА ИЗ ANDROID ПРИЛОЖЕНИЯ
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${API_SECRET_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { seller_name, seller_url, reviewer_name, review_text, rating, device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: 'device_id is required' });

    // Проверка лимита (1 отзыв в сутки)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/funpay_reviews?device_id=eq.${device_id}&created_at=gte.${yesterday}&select=id`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const existing = await checkRes.json();

    if (existing && existing.length > 0) {
      return res.status(429).json({ error: 'Лимит: 1 отзыв в день. Ждите 24 часа.' });
    }

    // Добавление отзыва
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/funpay_reviews`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ seller_name, seller_url, reviewer_name, review_text, rating, device_id })
    });

    const inserted = await insertRes.json();
    return res.status(201).json({ success: true, data: inserted });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
