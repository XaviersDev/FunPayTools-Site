export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { secret, nickname, key, action } = req.body;


  if (secret !== process.env.DONATERS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!nickname) {
    return res.status(400).json({ error: 'nickname is required' });
  }

  const isDelete = action === 'delete';

  // Для записи нужен ключ; для удаления он не требуется.
  if (!isDelete && !key) {
    return res.status(400).json({ error: 'key is required' });
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


    if (isDelete) {
      // Идемпотентное удаление: если ника нет - считаем успехом, ничего не коммитим.
      if (!Object.prototype.hasOwnProperty.call(donaters, nickname)) {
        return res.status(200).json({
          success: true,
          message: 'Nickname not found, nothing to delete',
          removed: false
        });
      }
      delete donaters[nickname];
    } else {
      donaters[nickname] = key;
    }


    const newContent = Buffer.from(JSON.stringify(donaters, null, 2)).toString('base64');

    const commitMessage = isDelete
      ? `🤖 Bot: Remove donater style for ${nickname}`
      : `🤖 Bot: Update donater style for ${nickname}`;

    const putRes = await fetch(getUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: newContent,
        sha: sha
      })
    });

    if (!putRes.ok) {
      const errData = await putRes.text();
      throw new Error(`Failed to commit donaters.json: ${errData}`);
    }


    return res.status(200).json({
      success: true,
      message: isDelete ? 'Removed successfully from GitHub' : 'Saved successfully to GitHub',
      removed: isDelete ? true : undefined
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

