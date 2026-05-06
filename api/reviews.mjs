export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const API_SECRET_KEY = process.env.API_SECRET_KEY; // твой fptoolsdim

  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  // 1. ПОЛУЧЕНИЕ ЛЕНТЫ (GET)
  if (req.method === 'GET') {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/funpay_reviews?select=*,reactions:funpay_reactions(*)&order=created_at.desc`, { headers });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // 2. ДОБАВЛЕНИЕ ОТЗЫВА (POST)
  if (req.method === 'POST') {
    // Проверка секретного ключа от мамкиных хакеров
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${API_SECRET_KEY}`) {
      return res.status(403).json({ error: 'Неверный токен доступа' });
    }

    const { seller_name, seller_url, reviewer_name, review_text, rating, device_id, time_ago, game_name, price, seller_response } = req.body;

    if (!device_id) return res.status(400).json({ error: 'Нужен device_id' });

    try {
      // ПРОВЕРКА: 1 ОТЗЫВ В ДЕНЬ С ОДНОГО УСТРОЙСТВА
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/funpay_reviews?select=id&device_id=eq.${device_id}&created_at=gte.${yesterday}`, { headers });
      const recentReviews = await checkRes.json();

      if (recentReviews.length > 0) {
        return res.status(429).json({ error: 'Вы можете добавлять только 1 отзыв в день' });
      }

      // СОХРАНЕНИЕ В БД
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/funpay_reviews`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          seller_name, seller_url, reviewer_name, review_text, rating, device_id, time_ago, game_name, price, seller_response
        })
      });

      const newData = await insertRes.json();
      return res.status(200).json({ success: true, data: newData });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
