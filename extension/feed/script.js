// СЮДА ВСТАВИШЬ СВОИ ДАННЫЕ ИЗ SUPABASE ПОЗЖЕ
const SUPABASE_URL = 'ТВОЙ_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'ТВОЙ_SUPABASE_ANON_KEY';

document.addEventListener('DOMContentLoaded', () => {
    fetchReviews();
});

async function fetchReviews() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/funpay_reviews?select=*,funpay_reactions(*)&order=created_at.desc`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        
        const reviews = await response.json();
        renderFeed(reviews);
    } catch (error) {
        document.getElementById('feed-container').innerHTML = '<div class="loading">Ошибка загрузки. Попробуй позже.</div>';
    }
}

function renderFeed(reviews) {
    const container = document.getElementById('feed-container');
    const template = document.getElementById('review-template');
    
    container.innerHTML = ''; // Очищаем "Загрузка..."

    reviews.forEach(review => {
        const clone = template.content.cloneNode(true);
        
        // Звезды
        const starsHtml = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        clone.querySelector('.stars').textContent = starsHtml;
        
        // Тексты
        clone.querySelector('.reviewer-name').textContent = `От: ${review.reviewer_name}`;
        clone.querySelector('.review-text').textContent = `«${review.review_text}»`;
        clone.querySelector('.seller-link').textContent = `${review.seller_name} ↗`;
        clone.querySelector('.seller-link').href = review.seller_url;

        // Эмодзи (Топ 3)
        const reactions = review.funpay_reactions || [];
        const reactionCounts = {};
        reactions.forEach(r => {
            reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
        });

        // Сортируем и берем 3 самых популярных эмодзи
        const topReactions = Object.entries(reactionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        const sidebar = clone.querySelector('.sidebar');
        if (topReactions.length > 0) {
            topReactions.forEach(([emoji, count]) => {
                sidebar.innerHTML += `
                    <div class="reaction-btn">
                        <div class="emoji-circle">${emoji}</div>
                        <span class="reaction-count">${count}</span>
                    </div>
                `;
            });
        } else {
            // Заглушка, если нет лайков
            sidebar.innerHTML = `
                <div class="reaction-btn" style="opacity: 0.5;">
                    <div class="emoji-circle">🤍</div>
                    <span class="reaction-count">0</span>
                </div>
            `;
        }

        container.appendChild(clone);
    });
}
