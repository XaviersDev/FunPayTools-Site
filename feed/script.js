// Функция защиты от XSS-хакеров
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', async () => {
    const feed = document.getElementById('feed');
    
    const themeToggleBtn = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-theme');
        themeIcon.textContent = 'light_mode';
    }

    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

    const modal = document.getElementById('appModal');
    const modalText = document.getElementById('modalText');
    const closeModalBtn = document.getElementById('closeModal');
    const addReviewBtn = document.getElementById('addReviewBtn');

    const showModal = (actionType) => {
        if (actionType === 'reaction') {
            modalText.innerHTML = 'Ставить реакции на отзывы можно только через мобильное приложение!</b>';
        } else if (actionType === 'add') {
            modalText.innerHTML = 'Добавлять свои смешные находки в ленту можно только через мобильное приложение!</b>';
        }
        modal.style.display = 'flex';
    };

    closeModalBtn.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
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
            
            // ПРОГОНЯЕМ ВСЕ ДАННЫЕ ОТ ПОЛЬЗОВАТЕЛЕЙ ЧЕРЕЗ ФИЛЬТР ЗАЩИТЫ
            const safeText = escapeHTML(review.review_text).replace(/\n/g, '<br>');
            const safeResponse = escapeHTML(review.seller_response).replace(/\n/g, '<br>');
            const safeGameName = escapeHTML(review.game_name);
            const safePrice = escapeHTML(review.price);
            const safeTimeAgo = escapeHTML(review.time_ago);
            const safeSellerName = escapeHTML(review.seller_name);
            
            // Защита от опасных ссылок (javascript:alert(1))
            let safeUrl = review.seller_url || '#';
            if (!safeUrl.startsWith('http')) safeUrl = '#';

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
                                <div class="review-item-date">${safeTimeAgo || 'Недавно'}</div>
                                <div class="review-item-detail">${safeGameName || ''}, ${safePrice || ''}</div>
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
                <a href="${safeUrl}" target="_blank" class="seller-link">Профиль: ${safeSellerName}</a>
            `;
            feed.appendChild(card);
        });

        const reactionButtons = document.querySelectorAll('.clickable-reaction');
        reactionButtons.forEach(btn => {
            btn.addEventListener('click', () => showModal('reaction'));
        });

    } catch (error) {
        feed.innerHTML = '<div class="error">Не удалось загрузить ленту</div>';
        console.error(error);
    }
});
