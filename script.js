document.addEventListener('DOMContentLoaded', () => {

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
                perspective: none;
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
                font-size: 140px;
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
            .showcase-item:nth-child(even) .showcase-text {
                grid-column: 2;
            }
        `;
        document.head.appendChild(style);
    }

    function getShowcaseData() {
        return [
            {
                icon: 'auto_awesome',
                title: 'Магия Искусственного Интеллекта',
                description: 'Превращайте короткие заметки в профессиональные ответы. ИИ анализирует контекст диалога для создания идеального сообщения, экономя ваше время и нервы.'
            },
            {
                icon: 'palette',
                title: 'Полная кастомизация интерфейса FunPay',
                description: 'Измените FunPay до неузнаваемости. Настройте анимированные фоны, цвета, шрифты, и даже расположение элементов, создав уникальное рабочее пространство.'
            },
            {
                icon: 'analytics',
                title: 'Глубокая аналитика продаж на FunPay',
                description: 'Получайте полную картину вашего бизнеса. Анализируйте доход, средний чек, количество заказов и самых активных покупателей за любой выбранный период.'
            },
            {
                icon: 'rocket_launch',
                title: 'Автоматизация рутины',
                description: 'Экономьте часы времени с помощью авто-поднятия, авто-приветствий, массового управления ценами и уведомлений в Discord.'
            }
        ];
    }
    
    const showcaseGrid = document.getElementById('showcase-grid-container');
    if (showcaseGrid) {
        const itemsData = getShowcaseData();
        showcaseGrid.innerHTML = '';
        
        itemsData.forEach(itemData => {
            const item = document.createElement('div');
            item.className = 'showcase-item';
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
    
    injectShowcaseStyles();

    const preloader = document.getElementById('preloader');
    setTimeout(() => {
        preloader.classList.add('hidden');
        document.body.classList.add('loaded');
    }, 100);

    const parallaxBg = document.querySelector('.hero-bg-parallax');
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                const offset = window.pageYOffset;
                if (parallaxBg) {
                    parallaxBg.style.transform = `translateY(${offset * 0.3}px)`;
                }
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });

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

    const repo = 'XaviersDev/FunPay-Tools-Android';
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    
    setTimeout(() => {
        fetch(apiUrl)
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(data => {
                const apkAsset = data.assets.find(asset => asset.name.endsWith('.apk'));
                
                if (apkAsset) {
                    const downloadUrl = apkAsset.browser_download_url;
                    document.querySelectorAll('.android-download-btn').forEach(btn => {
                        btn.href = downloadUrl;
                    });
                }
                
                const versionInfo = document.querySelector('.version-info');
                if (versionInfo) {
                    const version = data.tag_name.replace('v', '');
                    versionInfo.textContent = `Версия ${version} • Android 8.0+`;
                }
            })
            .catch(error => {
                console.error('Error fetching latest release:', error);
            });
    }, 500);
});

