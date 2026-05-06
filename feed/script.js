document.addEventListener("DOMContentLoaded", async () => {
    const feedContainer = document.getElementById("feed-container");

    try {
        // Запрашиваем отзывы через наше Vercel API
        const response = await fetch('/api/reviews');
        const reviews = await response.json();

        if (reviews.length === 0) {
            feedContainer.innerHTML = '<div class="h-screen flex items-center justify-center text-white/50">Отзывов пока нет.</div>';
            return;
        }

        feedContainer.innerHTML = ''; // Очищаем "Загрузку..."

        reviews.forEach(review => {
            // Считаем реакции, находим топ 3
            const reactionCounts = {};
            if (review.reactions) {
                review.reactions.forEach(r => {
                    reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
                });
            }
            const topReactions = Object.entries(reactionCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);

            // Создаем слайд (один экран)
            const slide = document.createElement('div');
            slide.className = 'slide p-4';

            let reactionsHTML = '';
            if (topReactions.length > 0) {
                topReactions.forEach(([emoji, count]) => {
                    reactionsHTML += `
                        <div class="flex flex-col items-center group cursor-pointer relative">
                            <div class="text-3xl bg-white/5 p-3 rounded-full border border-white/10 hover:bg-white/10 transition-all">${emoji}</div>
                            <span class="text-xs text-white/60 mt-1 font-bold">${count}</span>
                        </div>
                    `;
                });
            } else {
                reactionsHTML = `
                    <div class="flex flex-col items-center opacity-50">
                        <div class="text-3xl bg-white/5 p-3 rounded-full border border-white/10">🤍</div>
                        <span class="text-xs mt-1">0</span>
                    </div>
                `;
            }

            slide.innerHTML = `
                <div class="glow-bg"></div>
                <div class="relative z-10 w-full max-w-md bg-[#0a0512]/80 backdrop-blur-md border border-purple-900/20 p-6 rounded-3xl shadow-2xl">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <div class="flex text-yellow-400 text-sm mb-1">${stars}</div>
                            <span class="text-xs text-white/40">От: ${review.reviewer_name}</span>
                        </div>
                    </div>
                    <p class="text-lg md:text-xl font-medium leading-relaxed mb-6 text-white/90">
                        «${review.review_text}»
                    </p>
                    <div class="flex justify-between items-end border-t border-white/5 pt-4">
                        <div class="flex flex-col">
                            <span class="text-xs text-white/40 mb-1">Продавец:</span>
                            <a href="${review.seller_url}" target="_blank" class="text-sm font-bold text-purple-300 hover:text-purple-200 transition-colors flex items-center gap-1">
                                ${review.seller_name} ↗
                            </a>
                        </div>
                    </div>
                </div>

                <!-- Боковая панель TikTok (Реакции) -->
                <div class="absolute right-4 bottom-20 flex flex-col items-center gap-6 z-20">
                    ${reactionsHTML}
                </div>
            `;
            feedContainer.appendChild(slide);
        });

    } catch (error) {
        feedContainer.innerHTML = '<div class="h-screen flex items-center justify-center text-red-500">Ошибка загрузки</div>';
        console.error(error);
    }
});
