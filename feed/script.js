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
            const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
            
            // Обрабатываем переносы строк \n -> <br>
            const safeText = review.review_text ? review.review_text.replace(/\n/g, '<br>') : '';
            const safeResponse = review.seller_response ? review.seller_response.replace(/\n/g, '<br>') : '';

            // Блок ответа продавца
            let responseHtml = '';
            if (review.seller_response) {
                responseHtml = `
                    <div class="review-item-row">
                        <div class="h5 mb5">Ответ продавца</div>
                        <div class="review-item-answer review-compiled-reply">
                            <div>${safeResponse}</div>
                        </div>
                    </div>
                `;
            }

            // БЛОК РЕАКЦИЙ: Вычисляем топ 3 или показываем дефолтные нули
            const counts = { '😂': 0, '💖': 0, '💩': 0, '😳': 0, '😡': 0 };
            
            if (review.reactions && review.reactions.length > 0) {
                review.reactions.forEach(r => {
                    if (counts[r.emoji] !== undefined) counts[r.emoji]++;
                });
            }

            // Сортируем и берем 3 самых популярных эмодзи
            const topReactions = Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            let reactionsHtml = '<div class="reactions-bar">';
            topReactions.forEach(([emoji, count]) => {
                reactionsHtml += `<div class="reaction-badge">${emoji} ${count}</div>`;
            });
            reactionsHtml += `</div>`;

            // Сборка карточки строго по HTML структуре FunPay
            const card = document.createElement('div');
            card.className = 'review-item';
            card.innerHTML = `
                <div class="review-item-row">
                    <div class="review-compiled-review">
                        <div class="review-item-user">
                            <div class="review-item-photo">
                                <img src="https://funpay.com/img/layout/avatar.png" alt="">
                            </div>
                            <div class="user-meta">
                                <div class="review-item-date">${review.time_ago || 'Недавно'}</div>
                                <div class="review-item-detail">${review.game_name || ''}, ${review.price || ''}</div>
                            </div>
                            <div class="review-item-rating">${stars}</div>
                        </div>
                        <div class="review-item-text">
                            ${safeText}
                        </div>
                    </div>
                </div>
                ${responseHtml}
                ${reactionsHtml}
                <a href="${review.seller_url}" target="_blank" class="seller-link">Профиль: ${review.seller_name}</a>
            `;
            feed.appendChild(card);
        });

    } catch (error) {
        feed.innerHTML = '<div class="error">Не удалось загрузить ленту</div>';
        console.error(error);
    }
});
