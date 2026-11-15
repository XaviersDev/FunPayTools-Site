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
        iphone: hero.querySelector('.art-iphone'),
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
    const start = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'iphone' : /Windows/i.test(ua) ? 'windows' : 'chrome';

    // пока посетитель ничего не трогал, платформы сменяются сами
    const order = ['windows', 'chrome', 'android', 'iphone'];
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


// ---------------------------------------------------------------- жидкий лёд и жемчуг в первом экране
(() => {
    const hero = document.querySelector('.hero');
    const cv = document.getElementById('liquid');
    const box = document.getElementById('pearls');
    if (!hero || !cv) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // жемчужины свободно по краям экрана: разный размер и глубина, без линий
    const SPOTS = [
        [4, 14, 34, 1.0], [9, 31, 16, .5], [2.5, 52, 22, .8], [7, 72, 40, 1.2], [3, 90, 14, .4],
        [95, 10, 20, .6], [91, 27, 38, 1.1], [97, 46, 14, .4], [93, 64, 28, .9], [89, 84, 18, .6],
        [16, 6, 12, .3], [80, 4, 16, .5], [12, 96, 26, .9], [84, 95, 12, .3],
    ];
    const pearlEls = [];
    function pearls() {
        if (!box) return;
        box.innerHTML = ''; pearlEls.length = 0;
        const small = innerWidth < 700;
        SPOTS.forEach(([x, y, s, depth], i) => {
            if (small && i % 2) return;
            const size = small ? s * .7 : s;
            const p = document.createElement('i');
            p.className = 'pearl' + (depth < .45 ? ' soft' : '');
            p.style.cssText = `left:calc(${x}% - ${size / 2}px);top:calc(${y}% - ${size / 2}px);width:${size}px;height:${size}px;--r:${(i * 53) % 360}deg;--d:${7 + (i % 5)}s`;
            p.dataset.depth = depth;
            box.appendChild(p); pearlEls.push(p);
        });
    }
    pearls();
    let pt; addEventListener('resize', () => { clearTimeout(pt); pt = setTimeout(pearls, 200); });
    let pmx = 0, pmy = 0;
    function movePearls() {
        if (reduce) return;
        const sy = scrollY;
        for (const p of pearlEls) {
            const d = +p.dataset.depth;
            p.style.setProperty('--px', (pmx * -26 * d).toFixed(1));
            p.style.setProperty('--py', (pmy * -26 * d - sy * .12 * d).toFixed(1));
        }
    }
    addEventListener('scroll', movePearls, { passive: true });

    const gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) { cv.remove(); return; }
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `
precision highp float;
uniform vec2 r; uniform float t; uniform vec2 m;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; mat2 R = mat2(.8,.6,-.6,.8); for(int i=0;i<4;i++){ v += a*n(p); p = R*p*2.02 + 3.1; a *= .5; } return v; }
vec3 ice(float x){
  vec3 a = vec3(.56, .78, 1.0);   // голубой
  vec3 b = vec3(.86, .94, 1.0);   // почти белый
  vec3 c = vec3(.42, .66, 1.0);   // насыщенный синий
  vec3 d = vec3(.70, .92, .98);   // бирюзовый отлив
  float k = .5 + .5*cos(6.28318*x);
  float q = .5 + .5*cos(6.28318*(x + .37));
  return mix(mix(a, b, k), mix(c, d, k), q*.55);
}
float field(vec2 uv){
  vec2 q = vec2(fbm(uv + t*.03), fbm(uv + vec2(5.2,1.3) - t*.025));
  vec2 w = vec2(fbm(uv + 2.2*q + vec2(1.7,9.2) + t*.04), fbm(uv + 2.2*q + vec2(8.3,2.8) - t*.035));
  return fbm(uv + 2.4*w);
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5*r) / r.y * 1.05 + m*.12;
  float f = field(uv);
  float fx = field(uv + vec2(.006, 0.)), fy = field(uv + vec2(0., .006));
  vec3 nrm = normalize(vec3((f-fx)*38., (f-fy)*38., 1.));
  vec3 L = normalize(vec3(-.4, .6, .7));
  float spec = pow(max(dot(reflect(-L, nrm), vec3(0.,0.,1.)), 0.), 16.);
  float fres = pow(1. - nrm.z, 1.6);
  vec3 tint = ice(f*2.2 + fres*1.4 + t*.02);
  float band = smoothstep(.32, .72, f);
  vec3 base = vec3(.965, .98, 1.);
  vec3 col = mix(base, tint, clamp(band*1.05 + fres*1.6, 0., .95));
  col += spec*.8;
  gl_FragColor = vec4(col, 1.);
}`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { cv.remove(); return; }
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(pr, 'r'), uT = gl.getUniformLocation(pr, 't'), uM = gl.getUniformLocation(pr, 'm');
    const SCALE = 0.5;
    function size() { cv.width = Math.ceil(innerWidth * SCALE); cv.height = Math.ceil(innerHeight * SCALE); gl.viewport(0, 0, cv.width, cv.height); }
    size(); addEventListener('resize', size);
    let mx = 0, my = 0, tx = 0, ty = 0;
    addEventListener('pointermove', (e) => {
        tx = e.clientX / innerWidth - 0.5; ty = 0.5 - e.clientY / innerHeight;
        pmx = tx; pmy = -ty; movePearls();
    });
    // фон на всю страницу; вкладка в фоне не рисует сама (requestAnimationFrame на паузе)
    let visible = true, raf = 0, time = 7, last = performance.now();
    function frame(now) {
        raf = 0;
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        time += reduce ? 0 : dt;
        mx += (tx - mx) * 0.04; my += (ty - my) * 0.04;
        gl.uniform2f(uR, cv.width, cv.height); gl.uniform1f(uT, time + scrollY * .0015); gl.uniform2f(uM, mx, my);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (visible) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    cv.classList.add('on');
})();
