document.addEventListener('DOMContentLoaded', async () => {
    const feed = document.getElementById('feed');
    
    // Элементы модального окна
    const modal = document.getElementById('appModal');
    const modalText = document.getElementById('modalText');
    const closeModalBtn = document.getElementById('closeModal');
    const addReviewBtn = document.getElementById('addReviewBtn');

    // Функция показа модалки
    const showModal = (actionType) => {
        if (actionType === 'reaction') {
            modalText.innerHTML = 'Ставить реакции на отзывы можно только через мобильное приложение.<br><br><b>Данная возможность будет добавлена в обновлении 1.3!</b>';
        } else if (actionType === 'add') {
            modalText.innerHTML = 'Добавлять свои находки в ленту можно только через мобильное приложение.<br><br><b>Данная возможность будет добавлена в обновлении 1.3!</b>';
        }
        modal.style.display = 'flex';
    };

    // Закрытие модалки
    closeModalBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    // Клик по плавающей кнопке добавления
    addReviewBtn.addEventListener('click', () => showModal('add'));

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
            
            const safeText = review.review_text ? review.review_text.replace(/\n/g, '<br>') : '';
            const safeResponse = review.seller_response ? review.seller_response.replace(/\n/g, '<br>') : '';

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

            const counts = { '😂': 0, '💖': 0, '💩': 0, '😳': 0, '😡': 0 };
            
            if (review.reactions && review.reactions.length > 0) {
                review.reactions.forEach(r => {
                    if (counts[r.emoji] !== undefined) counts[r.emoji]++;
                });
            }

            const topReactions = Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            let reactionsHtml = '<div class="reactions-bar">';
            topReactions.forEach(([emoji, count]) => {
                // Добавили класс clickable-reaction для отслеживания кликов
                reactionsHtml += `<div class="reaction-badge clickable-reaction">${emoji} ${count}</div>`;
            });
            reactionsHtml += `</div>`;

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

        // Вешаем клики на все кнопки реакций после того, как они сгенерировались
        const reactionButtons = document.querySelectorAll('.clickable-reaction');
        reactionButtons.forEach(btn => {
            btn.addEventListener('click', () => showModal('reaction'));
        });

    } catch (error) {
        feed.innerHTML = '<div class="error">Не удалось загрузить ленту</div>';
        console.error(error);
    }
});
