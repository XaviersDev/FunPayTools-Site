export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  const { review_id, emoji, device_id, user_name, user_url } = req.body;

  if (!review_id || !emoji || !device_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  
  const safeUserName = user_name || "Аноним";
  const safeUserUrl = user_url || "#";

  try {
    
    const checkUrl = `${SUPABASE_URL}/rest/v1/funpay_reactions?review_id=eq.${review_id}&emoji=eq.${encodeURIComponent(emoji)}&device_id=eq.${encodeURIComponent(device_id)}&select=id`;
    
    const checkRes = await fetch(checkUrl, { headers });
    const existingReactions = await checkRes.json();

    if (existingReactions && existingReactions.length > 0) {
      
      const reactionId = existingReactions[0].id;
      const deleteUrl = `${SUPABASE_URL}/rest/v1/funpay_reactions?id=eq.${reactionId}`;
      
      await fetch(deleteUrl, { method: 'DELETE', headers });
      return res.status(200).json({ success: true, action: 'removed' });

    } else {
      
      const insertUrl = `${SUPABASE_URL}/rest/v1/funpay_reactions`;
      const insertBody = JSON.stringify({ 
        review_id, 
        emoji, 
        device_id,
        user_name: safeUserName,
        user_url: safeUserUrl
      });
      
      const insertRes = await fetch(insertUrl, { method: 'POST', headers, body: insertBody });

      if (!insertRes.ok) {
        throw new Error('Failed to insert reaction to Supabase');
      }

      return res.status(200).json({ success: true, action: 'added' });
    }
  } catch (error) {
    console.error('Reaction Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
