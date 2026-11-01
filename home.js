// Главная funpay.tools: параллакс, смена платформы в первом экране и ссылки на последние релизы.
(() => {
    const root = document.documentElement;
    const hero = document.querySelector('.hero');
    const nav = document.getElementById('nav');
    const sw = document.getElementById('switch');
    const pill = sw.querySelector('.switch-pill');
    const segs = [...sw.querySelectorAll('.seg')];
    const arts = {
        windows: hero.querySelector('.art-windows'),
        android: hero.querySelector('.art-android'),
        chrome: hero.querySelector('.art-chrome'),
    };
    const hints = [...document.querySelectorAll('.hint-text')];
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const touch = matchMedia('(hover: none)').matches;

    // глубина слоёв фона
    document.querySelectorAll('[data-depth]').forEach(el => el.style.setProperty('--d', el.dataset.depth));

    // ------------------------------------------------ выбор платформы
    let current = null;
    function movePill(seg) {
        pill.style.width = seg.offsetWidth + 'px';
        pill.style.height = seg.offsetHeight + 'px';
        pill.style.transform = `translate(${seg.offsetLeft}px, ${seg.offsetTop}px)`;
    }
    function select(p) {
        const seg = segs.find(s => s.dataset.p === p);
        if (!seg) return;
        movePill(seg);
        if (p === current) return;
        segs.forEach(s => s.classList.toggle('active', s === seg));
        hints.forEach(h => h.classList.toggle('on', h.dataset.for === p));
        hero.dataset.platform = p;
        const prev = current && arts[current];
        Object.entries(arts).forEach(([k, img]) => {
            img.classList.remove('prev');
            if (k !== p && img !== prev) img.classList.remove('on');
        });
        if (prev) {
            prev.classList.remove('on');
            prev.classList.add('prev');
        }
        // новая картинка раскрывается из правого нижнего угла поверх старой
        const next = arts[p];
        next.classList.remove('on');
        void next.offsetWidth;
        next.classList.add('on');
        current = p;
    }

    // платформа посетителя по умолчанию
    const ua = navigator.userAgent;
    const start = /Android/i.test(ua) ? 'android' : /Windows/i.test(ua) ? 'windows' : 'chrome';

    // пока посетитель ничего не трогал, платформы сменяются сами
    const order = ['windows', 'chrome', 'android'];
    let auto = !still;
    let autoTimer = null;
    function scheduleAuto() {
        clearTimeout(autoTimer);
        if (!auto) return;
        autoTimer = setTimeout(() => {
            if (!auto) return;
            if (window.scrollY < innerHeight * 0.6) {
                select(order[(order.indexOf(current) + 1) % order.length]);
            }
            scheduleAuto();
        }, 3800);
    }
    function stopAuto() {
        auto = false;
        clearTimeout(autoTimer);
    }
    segs.forEach(seg => {
        seg.addEventListener('pointerenter', () => { stopAuto(); select(seg.dataset.p); });
        seg.addEventListener('focus', () => { stopAuto(); select(seg.dataset.p); });
        seg.addEventListener('click', () => stopAuto());
    });
    sw.addEventListener('pointerleave', () => { if (!touch) { auto = !still; scheduleAuto(); } });

    select(start);
    scheduleAuto();
    addEventListener('resize', () => current && movePill(segs.find(s => s.dataset.p === current)));
    document.fonts && document.fonts.ready.then(() => current && movePill(segs.find(s => s.dataset.p === current)));

    // ------------------------------------------------ параллакс: мышь и прокрутка
    let tx = 0, ty = 0, mx = 0, my = 0, sy = 0;
    const speeds = [...document.querySelectorAll('[data-speed]')];
    if (!still && !touch) {
        addEventListener('pointermove', e => {
            tx = (e.clientX / innerWidth) * 2 - 1;
            ty = (e.clientY / innerHeight) * 2 - 1;
        }, { passive: true });
    }
    // на телефоне вместо мыши лёгкий наклон телефона
    if (!still && touch && 'DeviceOrientationEvent' in window) {
        addEventListener('deviceorientation', e => {
            if (e.gamma == null) return;
            tx = Math.max(-1, Math.min(1, e.gamma / 30));
            ty = Math.max(-1, Math.min(1, (e.beta - 40) / 30));
        }, { passive: true });
    }

    function frame() {
        mx += (tx - mx) * 0.07;
        my += (ty - my) * 0.07;
        const h = hero.offsetHeight || innerHeight;
        const target = Math.min(1, Math.max(0, scrollY / h));
        sy += (target - sy) * 0.18;
        root.style.setProperty('--mx', mx.toFixed(4));
        root.style.setProperty('--my', my.toFixed(4));
        root.style.setProperty('--sy', sy.toFixed(4));
        // элементы ниже первого экрана едут со своей скоростью
        const vc = innerHeight / 2;
        for (const el of speeds) {
            const r = el.getBoundingClientRect();
            if (r.bottom < -200 || r.top > innerHeight + 200) continue;
            const off = (r.top + r.height / 2 - vc) * parseFloat(el.dataset.speed);
            // целые пиксели, чтобы картинки не мылились
            el.style.setProperty('--py', Math.round(-off) + 'px');
        }
        nav.classList.toggle('solid', scrollY > 30);
        requestAnimationFrame(frame);
    }
    if (still) {
        nav.classList.toggle('solid', scrollY > 30);
        addEventListener('scroll', () => nav.classList.toggle('solid', scrollY > 30), { passive: true });
    } else {
        requestAnimationFrame(frame);
    }

    // ------------------------------------------------ появление при прокрутке
    const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            e.target.classList.add('in');
            io.unobserve(e.target);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.reveal').forEach(el => {
        // соседи появляются по очереди
        const sib = [...el.parentElement.children].filter(c => c.classList.contains('reveal'));
        el.style.setProperty('--delay', (sib.indexOf(el) * 0.06).toFixed(2) + 's');
        io.observe(el);
    });

    // ------------------------------------------------ галерея программы и просмотр на весь экран
    const gImg = document.getElementById('g-img');
    const thumbs = [...document.querySelectorAll('.g-thumb')];
    const shots = thumbs.map(t => ({ src: t.querySelector('img').src, alt: t.getAttribute('aria-label') }));
    let gi = 0;
    function show(i) {
        gi = (i + shots.length) % shots.length;
        thumbs.forEach((t, k) => t.classList.toggle('on', k === gi));
        gImg.classList.add('fade');
        const next = new Image();
        next.onload = () => {
            gImg.src = shots[gi].src;
            gImg.alt = 'FunPay Tools для Windows: ' + shots[gi].alt.toLowerCase();
            requestAnimationFrame(() => gImg.classList.remove('fade'));
        };
        next.onerror = () => gImg.classList.remove('fade');
        next.src = shots[gi].src;
        if (!lb.hidden) lbImg.src = shots[gi].src;
    }
    thumbs.forEach((t, k) => t.addEventListener('click', () => show(k)));
    const lb = document.getElementById('lightbox');
    const lbImg = document.getElementById('lb-img');
    function openLb() {
        lbImg.src = gImg.src;
        lbImg.alt = gImg.alt;
        lb.hidden = false;
        document.body.style.overflow = 'hidden';
    }
    function closeLb() {
        lb.hidden = true;
        document.body.style.overflow = '';
    }
    document.querySelector('.g-main').addEventListener('click', openLb);
    lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
    lb.querySelector('.lb-close').addEventListener('click', closeLb);
    lb.querySelector('.lb-prev').addEventListener('click', () => show(gi - 1));
    lb.querySelector('.lb-next').addEventListener('click', () => show(gi + 1));
    addEventListener('keydown', e => {
        if (lb.hidden) return;
        if (e.key === 'Escape') closeLb();
        if (e.key === 'ArrowLeft') show(gi - 1);
        if (e.key === 'ArrowRight') show(gi + 1);
    });

    // ------------------------------------------------ последние релизы с GitHub
    const gh = repo => fetch(`https://api.github.com/repos/${repo}/releases/latest`).then(r => r.ok ? r.json() : Promise.reject());

    gh('XaviersDev/FunPay-Desktop').then(d => {
        const exe = (d.assets || []).find(a => /\.exe$/i.test(a.name)) || (d.assets || []).find(a => /\.zip$/i.test(a.name));
        if (exe) {
            document.querySelectorAll('#dl-windows, a[href*="FunPay-Desktop/releases/latest/download"]').forEach(a => a.href = exe.browser_download_url);
        }
        document.querySelectorAll('.v-windows').forEach(s => s.textContent = d.tag_name || 'новая версия');
    }).catch(() => {});

    gh('XaviersDev/FunPay-Tools-Android').then(d => {
        const apk = (d.assets || []).find(a => /\.apk$/i.test(a.name));
        if (apk) {
            document.querySelectorAll('#dl-android, .android-download-btn').forEach(a => a.href = apk.browser_download_url);
        }
        document.querySelectorAll('.v-android').forEach(s => s.textContent = d.tag_name || 'новая версия');
    }).catch(() => {});
})();
