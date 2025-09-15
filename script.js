document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Внедряем новые стили для шоукейса с иконками ---
    // Это позволяет нам менять только JS-файл, как вы и просили.
    function injectShowcaseStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .showcase-item {
                opacity: 0;
                transform: translateY(40px);
                transition: opacity 0.6s ease-out, transform 0.6s ease-out;
            }
            .visible {
                opacity: 1;
                transform: translateY(0);
            }
            .showcase-image {
                perspective: none; /* Убираем 3D-эффект, он не нужен для иконок */
            }
            .showcase-icon-container {
                display: flex;
                justify-content: center;
                align-items: center;
                background: linear-gradient(145deg, rgba(30, 36, 45, 0.5), rgba(22, 27, 34, 0.5));
                border-radius: 24px;
                min-height: 300px;
            }
            .showcase-icon-container .material-icons {
                font-size: 140px; /* Делаем иконки ОЧЕНЬ большими */
                background: var(--accent-gradient);
                -webkit-background-clip: text;
                background-clip: text;
                color: transparent;
                text-shadow: 0 0 40px rgba(107, 102, 255, 0.4);
                transition: transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
            }
            .showcase-item:hover .showcase-icon-container .material-icons {
                transform: scale(1.1) rotate(-8deg);
            }
            /* Меняем порядок для четных элементов, чтобы текст был справа */
            .showcase-item:nth-child(even) .showcase-text {
                grid-column: 2;
            }
        `;
        document.head.appendChild(style);
    }

    // --- 2. Заменяем данные о скриншотах на данные об иконках ---
    function getShowcaseData() {
        // Здесь мы просто возвращаем массив данных. Никаких запросов к серверу.
        // Вы можете легко поменять иконки, заголовки и описания здесь.
        return [
            {
                icon: 'auto_awesome',
                title: 'Магия Искусственного Интеллекта',
                description: 'Превращайте короткие заметки в профессиональные ответы. ИИ анализирует контекст диалога для создания идеального сообщения, экономя ваше время и нервы.'
            },
            {
                icon: 'palette',
                title: 'Полная кастомизация интерфейса',
                description: 'Измените FunPay до неузнаваемости. Настройте анимированные фоны, цвета, шрифты, и даже расположение элементов, создав уникальное рабочее пространство.'
            },
            {
                icon: 'monitoring',
                title: 'Глубокая аналитика продаж',
                description: 'Получайте полную картину вашего бизнеса. Анализируйте доход, средний чек, количество заказов и самых активных покупателей за любой выбранный период.'
            },
            {
                icon: 'rocket_launch',
                title: 'Автоматизация рутины',
                description: 'Экономьте часы времени с помощью авто-поднятия, авто-приветствий, массового управления ценами и уведомлений в Discord.'
            }
        ];
    }
    
    // --- 3. Строим HTML для шоукейса на основе новых данных ---
    const showcaseGrid = document.getElementById('showcase-grid-container');
    if (showcaseGrid) {
        const itemsData = getShowcaseData();
        showcaseGrid.innerHTML = ''; // Очищаем контейнер
        
        itemsData.forEach(itemData => {
            const item = document.createElement('div');
            item.className = 'showcase-item';
            // Создаем HTML с иконкой вместо изображения
            item.innerHTML = `
                <div class="showcase-text">
                    <h3>${itemData.title}</h3>
                    <p>${itemData.description}</p>
                </div>
                <div class="showcase-image showcase-icon-container">
                    <span class="material-icons">${itemData.icon}</span>
                </div>
            `;
            showcaseGrid.appendChild(item);
        });
    }

    // --- Весь остальной код остается прежним ---
    
    injectShowcaseStyles(); // Вызываем нашу новую функцию для стилей

    const preloader = document.getElementById('preloader');
    window.addEventListener('load', () => {
        preloader.classList.add('hidden');
        document.body.classList.add('loaded');
    });

    const parallaxBg = document.querySelector('.hero-bg-parallax');
    window.addEventListener('scroll', () => {
        const offset = window.pageYOffset;
        if (parallaxBg) {
            parallaxBg.style.transform = `translateY(${offset * 0.3}px)`;
        }
    });

    function animateValue(element, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            let value = Math.floor(progress * (end - start) + start);
            element.innerHTML = value.toLocaleString() + (element.dataset.target.includes('%') ? '%' : '+');
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const counter = entry.target;
                const targetValue = parseInt(counter.dataset.target, 10);
                animateValue(counter, 0, targetValue, 1500);
                statsObserver.unobserve(counter);
            }
        });
    }, { threshold: 0.8 });

    document.querySelectorAll('.stat-number').forEach(counter => {
        statsObserver.observe(counter);
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.hero-content, .section-title, .stats-grid, .cta-section, .showcase-item').forEach(section => {
        observer.observe(section);
    });
});