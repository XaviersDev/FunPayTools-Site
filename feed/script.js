document.addEventListener('DOMContentLoaded', async () => {
    const feed = document.getElementById('feed');

    try {
        const response = await fetch('/api/reviews');
        if (!response.ok) throw new Error('Ошибка сервера');
        
        const reviews = await response.json();
        feed.innerHTML = '';

        if (reviews.length === 0) {
            feed.innerHTML = '<div class="error">Лента пока пуста</div>';
            return;
        }

        reviews.forEach(review => {
            // Генерация звезд
            const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
            
            // Если аватарки нет, ставим иконку шлема/юзера
            const avatarHtml = `<div class="avatar">👤</div>`;

            // Обработка блока ответа продавца
            let responseHtml = '';
            if (review.seller_response) {
                responseHtml = `
                    <div class="seller-response">
                        <div class="response-label">ОТВЕТ ПРОДАВЦА</div>
                        <div class="response-text">${review.seller_response}</div>
                    </div>
                `;
            }

            // Обработка реакций (Топ 3)
            let reactionsHtml = '';
            if (review.reactions && review.reactions.length > 0) {
                const counts = {};
                review.reactions.forEach(r => counts[r.emoji] = (counts[r.emoji] || 0) + 1);
                
                // Сортируем и берем 3 самых популярных
                const topReactions = Object.entries(counts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3);

                reactionsHtml = `<div class="reactions-bar">`;
                topReactions.forEach(([emoji, count]) => {
                    reactionsHtml += `<div class="reaction-btn">${emoji} ${count}</div>`;
                });
                reactionsHtml += `</div>`;
            }

            // Сборка карточки (как на скрине)
            const card = document.createElement('div');
            card.className = 'review-card';
            card.innerHTML = `
                <div class="card-header">
                    ${avatarHtml}
                    <div class="meta-info">
                        <div class="meta-top">
                            <span>${review.time_ago || 'Недавно'} <span class="game-info">${review.game_name || ''}, ${review.price || ''}</span></span>
                            <div class="stars">${stars}</div>
                        </div>
                    </div>
                </div>
                <div class="review-text">
                    ${review.review_text}
                </div>
                ${responseHtml}
                ${reactionsHtml}
                <a href="${review.seller_url}" target="_blank" class="seller-link">Профиль продавца (${review.seller_name})</a>
            `;
            feed.appendChild(card);
        });

    } catch (error) {
        feed.innerHTML = '<div class="error">Не удалось загрузить ленту</div>';
        console.error(error);
    }
});
