export default async function handler(req, res) {
  // Разрешаем только POST-запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { secret, nickname, key } = req.body;

  // Проверка секретного ключа от бота
  if (secret !== process.env.DONATERS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'XaviersDev/FunPayTools-Site';
  const FILE_PATH = 'donaters.json';

  try {
    const getUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
    
    // 1. Получаем текущий файл donaters.json из GitHub
    const getRes = await fetch(getUrl, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha = undefined;
    let donaters = {};

    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha; // SHA нужен для коммита изменений
      
      const content = Buffer.from(fileData.content, 'base64').toString('utf8');
      donaters = JSON.parse(content);
    } else if (getRes.status !== 404) {
      // Если ошибка не 404 (файл не найден), то выбрасываем исключение
      const errData = await getRes.text();
      throw new Error(`Failed to fetch donaters.json: ${errData}`);
    }

    // ==========================================
    // ЖЕСТКИЕ ПРОВЕРКИ УЯЗВИМОСТЕЙ
    // ==========================================

    // ПРОВЕРКА 1: Занят ли уже этот никнейм? (Защита от кражи/перезаписи чужого ника)
    if (donaters.hasOwnProperty(nickname)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nickname already registered' 
      });
    }

    // ПРОВЕРКА 2: Использовался ли уже этот ключ? (Защита от размножения одного ключа)
    for (const existingNick in donaters) {
      if (donaters[existingNick] === key) {
        return res.status(400).json({ 
          success: false, 
          error: 'Key already exists' 
        });
      }
    }

    // ==========================================
    // ЕСЛИ ВСЁ ЧИСТО - ЗАПИСЫВАЕМ
    // ==========================================
    
    // Привязываем ключ к новому нику (остальные записи остаются нетронутыми!)
    donaters[nickname] = key;

    // Кодируем обратно в base64 для отправки в GitHub
    const newContent = Buffer.from(JSON.stringify(donaters, null, 2)).toString('base64');
    
    // 2. Отправляем обновленный файл обратно в репозиторий
    const putRes = await fetch(getUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `🤖 Bot: Update donater style for ${nickname}`,
        content: newContent,
        sha: sha 
      })
    });

    if (!putRes.ok) {
      const errData = await putRes.text();
      throw new Error(`Failed to commit donaters.json: ${errData}`);
    }

    // Успешный ответ боту/тестеру
    return res.status(200).json({ success: true, message: 'Saved successfully to GitHub' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
