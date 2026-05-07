export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  // ПОЛУЧЕНИЕ КАТАЛОГА (GET)
  if (req.method === 'GET') {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/funpay_catalogs?order=created_at.desc`, { headers });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ПУБЛИКАЦИЯ ПАКА (POST)
  if (req.method === 'POST') {
    const { author, name, description, pack_data } = req.body;

    if (!author || !name || !pack_data) {
      return res.status(400).json({ error: 'Не заполнены обязательные поля' });
    }

    try {
      // Проверка размера JSON (защита от спама огромными файлами, лимит ~200 KB)
      const dataSize = Buffer.byteLength(JSON.stringify(pack_data), 'utf8');
      if (dataSize > 200000) {
        return res.status(400).json({ error: 'Файл слишком большой. Максимум 200 КБ.' });
      }

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/funpay_catalogs`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ author, name, description, pack_data })
      });

      const newData = await insertRes.json();
      return res.status(200).json({ success: true, data: newData });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
