// api/upload.mjs (Разместите на Vercel)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Токен и репо хранятся в переменных окружения Vercel
  const GITHUB_TOKEN = process.env.GITHUB_PAT; 
  const REPO_OWNER = process.env.GITHUB_OWNER; // например 'AlliSighs'
  const REPO_NAME = process.env.GITHUB_REPO; // например 'fptools-catalog'
  
  try {
    const rawBody = JSON.stringify(req.body);
    
    // Ограничение: 5 МБ
    const sizeInMB = Buffer.byteLength(rawBody, 'utf8') / (1024 * 1024);
    if (sizeInMB > 5) return res.status(400).json({ error: 'Файл слишком большой (Макс 5 МБ)' });

    // Простая проверка: нет ли огромных Base64 строк (картинок)
    if (rawBody.includes('data:image/')) {
      return res.status(400).json({ error: 'Встраивание картинок запрещено' });
    }

    // Генерируем уникальное имя файла
    const author = req.body.author ? req.body.author.replace(/[^a-zA-Z0-9]/g, '') : 'anon';
    const fileName = `packs/${author}_${Date.now()}.json`;

    // Конвертируем JSON в Base64 для GitHub API
    const contentEncoded = Buffer.from(rawBody).toString('base64');

    // Запрос к GitHub API для создания файла
    const githubUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${fileName}`;
    const ghResponse = await fetch(githubUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'FPTools-Catalog'
      },
      body: JSON.stringify({
        message: `Upload new pack by ${author}`,
        content: contentEncoded
      })
    });

    if (!ghResponse.ok) throw new Error('Ошибка загрузки на GitHub');

    return res.status(200).json({ success: true, message: 'Пак успешно загружен!' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
