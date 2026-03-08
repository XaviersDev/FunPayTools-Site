document.addEventListener('DOMContentLoaded', () => {

    // ─── PRELOADER ─────────────────────────────────────────────────
    const preloader = document.getElementById('preloader');
    if (preloader) {
        setTimeout(() => {
            preloader.classList.add('hidden');
            document.body.classList.add('loaded');
        }, 900);
    } else {
        document.body.classList.add('loaded');
    }

    // ─── HERO CANVAS (particle field) ──────────────────────────────
    const canvas = document.getElementById('hero-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let particles = [];
        let W, H;

        function resize() {
            W = canvas.width = canvas.offsetWidth;
            H = canvas.height = canvas.offsetHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        function Particle() {
            this.reset = function () {
                this.x = Math.random() * W;
                this.y = Math.random() * H;
                this.r = Math.random() * 1.5 + 0.3;
                this.alpha = Math.random() * 0.4 + 0.1;
                this.vx = (Math.random() - 0.5) * 0.3;
                this.vy = (Math.random() - 0.5) * 0.3;
            };
            this.reset();
        }

        for (let i = 0; i < 120; i++) particles.push(new Particle());

        function drawParticles() {
            ctx.clearRect(0, 0, W, H);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.reset();
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(139,92,246,${p.alpha})`;
                ctx.fill();
            });

            // draw connecting lines
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 90) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(139,92,246,${0.08 * (1 - dist / 90)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(drawParticles);
        }
        drawParticles();
    }

    // ─── HEADER SCROLL ─────────────────────────────────────────────
    const header = document.getElementById('site-header');
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });

    // ─── BURGER MENU ───────────────────────────────────────────────
    const burger = document.getElementById('burger');
    const mobileMenu = document.getElementById('mobile-menu');
    burger && burger.addEventListener('click', () => {
        mobileMenu.classList.toggle('open');
        burger.classList.toggle('open');
    });
    mobileMenu && mobileMenu.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            mobileMenu.classList.remove('open');
            burger.classList.remove('open');
        });
    });

    // ─── REVEAL ON SCROLL ──────────────────────────────────────────
    const revealEls = document.querySelectorAll('.reveal, .reveal-delay');
    const revealObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                e.target.classList.add('visible');
                revealObs.unobserve(e.target);
            }
        });
    }, { threshold: 0.08 });
    revealEls.forEach(el => revealObs.observe(el));

    // ─── STAT COUNTERS ─────────────────────────────────────────────
    function animateNum(el, target, duration = 1400) {
        const start = performance.now();
        const update = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(eased * target);
            if (progress < 1) requestAnimationFrame(update);
            else el.textContent = target;
        };
        requestAnimationFrame(update);
    }

    const statObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                const target = parseInt(e.target.dataset.target, 10);
                animateNum(e.target, target);
                statObs.unobserve(e.target);
            }
        });
    }, { threshold: 0.5 });
    document.querySelectorAll('.stat-num').forEach(el => statObs.observe(el));

    // ─── ANDROID TABS ──────────────────────────────────────────────
    const atabs = document.querySelectorAll('.atab');
    const tabPanes = document.querySelectorAll('.tab-pane');
    atabs.forEach(tab => {
        tab.addEventListener('click', () => {
            atabs.forEach(t => t.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById('tab-' + tab.dataset.tab);
            if (target) target.classList.add('active');
        });
    });

    // ─── FEATURES TABS ─────────────────────────────────────────────
    const ftabs = document.querySelectorAll('.ftab');
    const fpanes = document.querySelectorAll('.fpane');
    ftabs.forEach(tab => {
        tab.addEventListener('click', () => {
            ftabs.forEach(t => t.classList.remove('active'));
            fpanes.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById('fpane-' + tab.dataset.ftab);
            if (target) target.classList.add('active');
        });
    });

    // ─── FAQ ACCORDION ─────────────────────────────────────────────
    document.querySelectorAll('.faq-item').forEach(item => {
        const btn = item.querySelector('.faq-q');
        btn && btn.addEventListener('click', () => {
            const isOpen = item.classList.contains('open');
            document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
            if (!isOpen) item.classList.add('open');
        });
    });

    // ─── FETCH LATEST RELEASE FROM GITHUB ──────────────────────────
    const REPO = 'XaviersDev/FunPay-Tools-Android';
    setTimeout(() => {
        fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(data => {
                const apk = data.assets.find(a => a.name.endsWith('.apk'));
                const version = data.tag_name || 'v1.2';

                if (apk) {
                    document.querySelectorAll('.android-download-btn').forEach(btn => {
                        btn.href = apk.browser_download_url;
                    });
                } else {
                    // fallback to releases page
                    document.querySelectorAll('.android-download-btn').forEach(btn => {
                        btn.href = `https://github.com/${REPO}/releases/latest`;
                    });
                }

                // update hero badge
                const heroBadge = document.querySelector('.badge-new');
                if (heroBadge) heroBadge.textContent = `🔥 Новинка ${version}`;

                // update version badge in download block
                const vb = document.querySelector('.version-badge');
                if (vb) vb.textContent = version;
            })
            .catch(() => {
                document.querySelectorAll('.android-download-btn').forEach(btn => {
                    if (btn.getAttribute('href') === '#') {
                        btn.href = `https://github.com/${REPO}/releases/latest`;
                    }
                });
            });
    }, 600);

    // ─── ACTIVE NAV LINK ON SCROLL ─────────────────────────────────
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    const navObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                navLinks.forEach(link => {
                    link.classList.toggle('active',
                        link.getAttribute('href') === '#' + e.target.id
                    );
                });
            }
        });
    }, { threshold: 0.35 });
    sections.forEach(s => navObs.observe(s));

    // ─── SMOOTH MOBILE MENU LINK SCROLL ───────────────────────────
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const id = a.getAttribute('href');
            if (id === '#') return;
            const target = document.querySelector(id);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

});
