export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { secret, nickname, key } = req.body;

  if (secret !== process.env.DONATERS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'XaviersDev/FunPayTools-Site';
  const FILE_PATH = 'donaters.json';

  try {
    const getUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
    
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
      sha = fileData.sha; 
      
      const content = Buffer.from(fileData.content, 'base64').toString('utf8');
      donaters = JSON.parse(content);
    } else if (getRes.status !== 404) {
      const errData = await getRes.text();
      throw new Error(`Failed to fetch donaters.json: ${errData}`);
    }

    // ==========================================
    // ЛОГИКА ОТКАЗА: ЕСЛИ КЛЮЧ УЖЕ ИСПОЛЬЗУЕТСЯ
    // ==========================================
    for (const existingNick in donaters) {
      // Если находим в базе точно такой же ключ
      if (donaters[existingNick] === key) {
        // Проверяем, не тот же ли это самый человек просто обновляет стиль
        if (existingNick !== nickname) {
          // Отказываем! Ключ уже привязан к чужому нику
          return res.status(400).json({ 
            success: false, 
            error: 'Key already exists' 
          });
        }
      }
    }

    // Записываем новый ключ для ника (остальные данные не трогаются)
    donaters[nickname] = key;

    // Превращаем обратно в base64
    const newContent = Buffer.from(JSON.stringify(donaters, null, 2)).toString('base64');
    
    // Сохраняем обратно в GitHub
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

    return res.status(200).json({ success: true, message: 'Saved successfully to GitHub' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
