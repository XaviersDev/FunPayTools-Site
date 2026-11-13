// @name MUVSell Rent
// @author @MUVSell
// @version 1.2.17.1
// @description Перепродажа аренды Steam-аккаунтов MUVSell: выдача логина и пароля после оплаты, коды Steam Guard, продления, оффлайн-игры навсегда, автовыставление лотов, наличие, цены и статистика.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/muvsellrent_banner.png
// @updateUrl https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/muvsellrent.js

(function () {
    var TAG = "[MUVSell Rent]", NS_STORE = "mvs_", NS_UI = "mvs_";

    // ---------------------------------------------------------------- общая часть: одинаково работает на Android и на компьютере
    var REAL = window.fpt;
    var DESKTOP = false;
    try { DESKTOP = REAL.app.platform === "desktop"; } catch (e) {}
    // На Android хранилище и значения полей общие для всех плагинов, поэтому свои ключи помечаем приставкой.
    var fpt = REAL;
    if (!DESKTOP) {
        fpt = Object.create(REAL);
        fpt.on = function (ev, fn) { return REAL.on(ev, fn); };
        fpt.storage = {
            get: function (k) { return REAL.storage.get(NS_STORE + k); },
            set: function (k, v) { return REAL.storage.set(NS_STORE + k, typeof v === "string" ? v : JSON.stringify(v)); },
        };
        fpt.ui = {
            setSlot: function (k, ui) { return REAL.ui.setSlot(k, ui); },
            removeSlot: function (k) { return REAL.ui.removeSlot(k); },
            getState: function (k) { return REAL.ui.getState(NS_UI + k); },
            setState: function (k, v) { return REAL.ui.setState(NS_UI + k, String(v)); },
        };
    }

    function log(m) { try { fpt.app.log(TAG + " " + m); } catch (e) {} }
    function now() { return Date.now() / 1000; }
    function load(key, def) {
        try {
            var raw = fpt.storage.get(key);
            if (raw === null || raw === undefined || raw === "") return def;
            var v = typeof raw === "string" ? JSON.parse(raw) : raw;
            return v === null || v === undefined ? def : v;
        } catch (e) { return def; }
    }
    function save(key, val) {
        try { fpt.storage.set(key, JSON.stringify(val)); } catch (e) { log("не сохранилось " + key + ": " + e); }
    }
    function num(v) {
        if (typeof v === "number") return isFinite(v) ? v : 0;
        var s = String(v === null || v === undefined ? "" : v).replace(/[^\d.,\-]/g, "");
        if (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) s = s.replace(/,/g, ""); else s = s.replace(",", ".");
        var n = parseFloat(s);
        return isFinite(n) ? n : 0;
    }
    function int(v, def) { var n = parseInt(String(v).replace(/[^\d\-]/g, ""), 10); return isFinite(n) ? n : (def === undefined ? 0 : def); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function fill(tpl, vars) {
        return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) {
            return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m;
        });
    }
    function norm(s) { return String(s || "").replace(/[​-‍]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }
    function two(n) { return (n < 10 ? "0" : "") + n; }
    function when(ts) {
        var d = new Date(ts * 1000);
        return two(d.getDate()) + "." + two(d.getMonth() + 1) + "." + d.getFullYear() + " " + two(d.getHours()) + ":" + two(d.getMinutes());
    }
    function lastErr() { try { var e = fpt.lastError && fpt.lastError(); return e ? " (" + e + ")" : ""; } catch (x) { return ""; } }

    // оповещения FunPay в чате (оплата, подтверждение, отзыв, возврат) это не слова покупателя
    var SYSTEM_RX = /оплатил заказ|подтвердил успешное выполнение|написал отзыв к заказу|изменил отзыв к заказу|удалил отзыв к заказу|вернул деньги покупателю|заказ #?[A-Z0-9]+ открыт повторно|has paid for order|confirmed that order|has given feedback|has edited their feedback|has refunded|сплатив замовлення|підтвердив успішне виконання|написав відгук|повернув гроші/i;
    function msgInfo(m) {
        m = m || {};
        var text = String(m.text || "");
        return {
            chatId: String(m.chatId || ""), text: text, mine: !!m.isMe,
            system: !!m.isSystem || SYSTEM_RX.test(text),
            name: String(m.username || m.chatName || ""),
            authorId: String(m.authorId || ""),
        };
    }

    // На Android в событии приходит только строка из списка чатов: длинное сообщение там обрезано. Полный текст берём из переписки.
    function fullMsg(m) {
        if (DESKTOP || !m.chatId) return m;
        var h = null;
        try { h = fpt.chat.getHistory(m.chatId); } catch (e) {}
        var last = h && h.length ? h[h.length - 1] : null;
        if (!last) return m;
        m.text = String(last.text || m.text);
        m.mine = !!last.isMe;
        m.system = SYSTEM_RX.test(m.text) || String(last.authorId || "") === "0" || !!last.badge;
        return m;
    }
    // Новый заказ. На Android приложение шлёт это событие только при включённых напоминаниях о заказах и повторяет его,
    // поэтому оплату ловим ещё и по сообщению FunPay, а каждый заказ разбираем один раз за запуск.
    var lookedOrders = {};
    function onOrder(fn) {
        function once(e) {
            if (!e || !e.orderId) return;
            var id = String(e.orderId).replace(/^#/, "");
            if (lookedOrders[id]) return;
            lookedOrders[id] = 1;
            e.orderId = id;
            fn(e);
        }
        fpt.on("onNewOrder", once);
        if (!DESKTOP) {
            fpt.on("onNewMessage", function (raw) {
                var text = String((raw && raw.text) || "");
                if (!/оплатил заказ|has paid for order|paid for order|сплатив замовлення/i.test(text)) return;
                var m = /#([A-Za-z0-9]{6,12})/.exec(text);
                if (m) once({ orderId: m[1], chatId: raw.chatId, buyerName: raw.username || "", text: text });
            });
        }
    }

    function sendTo(chatId, text) {
        if (!chatId || !text) return false;
        var ok = false;
        try { ok = fpt.chat.send(String(chatId), String(text)); } catch (e) { log("сообщение не ушло: " + e); return false; }
        if (ok === false) log("сообщение не ушло" + lastErr());
        return ok !== false;
    }
    function notify(title, text) {
        try { fpt.app.notify(String(title), String(text || "")); } catch (e) {}
        log(title + (text ? ": " + text : ""));
    }
    function refundOrder(orderId) {
        try { return fpt.orders.refund(String(orderId)) !== false; } catch (e) { return false; }
    }
    function lotActive(lotId, on) {
        try { return fpt.lots.toggle(String(lotId), !!on) !== false; } catch (e) { return false; }
    }

    // --- сеть. На Android есть только GET и POST, заголовки передаются строкой JSON, заголовков ответа нет, а свой Cookie приложение не пропускает.
    function hdr(headers) { return DESKTOP ? (headers || {}) : JSON.stringify(headers || {}); }
    var CAN_ANY_METHOD = DESKTOP || (function () { try { return typeof fpt.network.request === "function"; } catch (e) { return false; } })();
    // opts: { proxy, timeout } (только на компьютере; Android их пропускает)
    function http(method, url, body, headers, opts) {
        method = String(method || "GET").toUpperCase();
        var r = null;
        try {
            if (DESKTOP || (CAN_ANY_METHOD && method !== "GET" && method !== "POST")) {
                r = DESKTOP && opts ? fpt.network.request(method, url, body === undefined ? null : body, hdr(headers), opts) : fpt.network.request(method, url, body === undefined ? null : body, hdr(headers));
            } else if (method === "GET") {
                r = fpt.network.get(url, hdr(headers));
            } else if (method === "POST") {
                r = fpt.network.post(url, body === undefined || body === null ? "" : body, hdr(headers));
            } else {
                return { code: 0, body: "", json: null, headers: {}, error: "Запрос " + method + " на Android пока недоступен" };
            }
        } catch (e) {
            return { code: 0, body: "", json: null, headers: {}, error: String(e) };
        }
        if (typeof r === "string") { try { r = JSON.parse(r); } catch (e2) { r = { code: 200, body: r }; } }
        r = r || {};
        var out = { code: Number(r.code) || 0, body: String(r.body === undefined || r.body === null ? "" : r.body), headers: r.headers || {}, error: r.error || "" };
        out.json = r.json !== undefined && r.json !== null ? r.json : null;
        if (out.json === null && out.body) { try { out.json = JSON.parse(out.body); } catch (e3) {} }
        return out;
    }
    function header(res, name) {
        var h = (res && res.headers) || {}, low = name.toLowerCase();
        for (var k in h) if (k.toLowerCase() === low) return h[k];
        return "";
    }
    function form(obj) {
        return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
    }
    function postJson(url, obj, headers, opts) {
        var h = { "Content-Type": "application/json", "Accept": "application/json" };
        for (var k in (headers || {})) h[k] = headers[k];
        return http("POST", url, JSON.stringify(obj || {}), h, opts);
    }
    function funpayGet(path) {
        var url = /^https?:/.test(path) ? path : "https://funpay.com/" + String(path).replace(/^\/+/, "");
        return http("GET", url, null, { "Accept": "text/html" });
    }

    // --- заказ в одном виде для обеих платформ
    function orderInfo(orderId, eventText) {
        var d = null;
        for (var attempt = 0; attempt < 2 && !d; attempt++) {
            try { d = fpt.orders.getDetails(String(orderId)); } catch (e) {}
        }
        if (!d) return null;
        var params = {};
        if (Array.isArray(d.params)) d.params.forEach(function (p) { if (p && p.name) params[p.name] = p.value; });
        else if (d.params && typeof d.params === "object") params = d.params;
        var title = String(d.lotName || d.shortDesc || "");
        var parts = [title], amount = 0;
        for (var k in params) {
            parts.push(String(params[k]));
            if (!amount && /количество|кол-во|quantity|кількість/i.test(k)) amount = int(params[k], 0);
        }
        if (!amount && eventText) { var q = /(\d+)\s*шт/.exec(String(eventText)); if (q) amount = int(q[1], 0); }
        var lotId = String(d.lotId || "");
        if (!lotId && d.lotUrl) { var lm = /[?&]id=(\d+)/.exec(String(d.lotUrl)); if (lm) lotId = lm[1]; }
        return {
            id: String(d.orderId || d.id || orderId).replace(/^#/, ""),
            title: title, text: parts.join("\n"), amount: amount > 0 ? amount : 1, price: num(d.price),
            game: String(d.game || d.gameTitle || ""), buyerName: String(d.buyerName || ""), buyerId: String(d.buyerId || ""),
            lotId: lotId, chatId: String(d.chatId || ""), status: String(d.status || ""),
            hasReview: !!d.hasReview, stars: int(d.reviewStars || d.reviewRating || 0, 0), iAmBuyer: !!(d.iAmBuyer || d.isBuyer),
        };
    }
    // оценка в отзыве: если приложение её не отдало, читаем со страницы заказа
    function reviewStars(orderId) {
        var o = orderInfo(orderId);
        if (o && o.stars > 0) return o.stars;
        if (o && !o.hasReview && DESKTOP) return 0;
        var r = funpayGet("orders/" + String(orderId).replace(/^#/, "") + "/");
        if (r.code !== 200) return 0;
        var at = r.body.indexOf("review-item");
        if (at < 0) return 0;
        var m = /class="rating(\d)"/.exec(r.body.slice(at, at + 4000));
        return m ? int(m[1], 0) : 0;
    }
    function lotField(fields, name) {
        var f = fields && fields.fields ? fields.fields : fields;
        if (!f || f[name] === undefined || f[name] === null) return "";
        var v = f[name];
        return typeof v === "object" ? String(v.value === undefined || v.value === null ? "" : v.value) : String(v);
    }
    // Названия лота (рус. и англ.) по его ID. В заказе FunPay номера лота нет, есть только название на языке покупателя,
    // поэтому привязку "по ID" сверяем через названия.
    var lotTitleCache = {};
    function lotTitles(lotId, fresh) {
        var id = String(lotId), hit = lotTitleCache[id];
        if (!fresh && hit && now() - hit[0] < 900) return hit[1];
        var f = null;
        try { f = fpt.lots.getFields(id); } catch (e) {}
        var titles = f ? [lotField(f, "fields[summary][ru]"), lotField(f, "fields[summary][en]")].filter(Boolean) : [];
        if (titles.length || !hit) lotTitleCache[id] = [now(), titles];
        return titles.length ? titles : (hit ? hit[1] : []);
    }
    // Подходит ли привязка (текст из названия лота или ID лота) к заказу
    function lotMatches(match, title, lotId) {
        var m = String(match || "").trim(), desc = norm(title);
        if (!m) return false;
        if (/^\d+$/.test(m)) {
            if (lotId && String(lotId) === m) return true;
            return lotTitles(m).some(function (t) { t = norm(t); return t.length > 2 && desc.indexOf(t) >= 0; });
        }
        return desc.indexOf(norm(m)) >= 0;
    }
    function seenOrder(orderId) {
        var done = load("done_orders", []);
        if (done.indexOf(String(orderId)) >= 0) return true;
        done.push(String(orderId));
        if (done.length > 500) done = done.slice(done.length - 500);
        save("done_orders", done);
        return false;
    }

    // --- настройки на экране
    function T(text, o) { var t = { type: "Text", text: String(text) }; if (o) for (var k in o) t[k] = o[k]; return t; }
    function H(text) { return T(text, { bold: true, fontSize: 16 }); }
    function hint(text) { return T(text, { color: "#7A8699", fontSize: 12 }); }
    function Btn(text, onClick, flat, busy) {
        var b = { type: "Button", text: text, onClick: onClick };
        if (flat) b.style = "flat";
        if (busy) b.busyText = busy;
        return b;
    }
    function In(label, key, value, multi) {
        var v = value === null || value === undefined ? "" : String(value);
        if (!DESKTOP) v = v.replace(/\n/g, " ¶ ").replace(/"/g, "'").replace(/\\/g, "/");   // поле на Android не показывает переносы, кавычки и обратную черту
        fpt.ui.setState(key, v);
        return { type: "Input", label: label, stateKey: key, singleLine: !(multi && DESKTOP) };
    }
    function Sw(label, key, value, onChange) {
        fpt.ui.setState(key, value ? "true" : "false");
        var sw = { type: "Switch", stateKey: key };
        if (onChange) sw.onChange = onChange;
        if (DESKTOP) { sw.text = label; return sw; }
        return { type: "Row", children: [sw, T(label)] };
    }
    function gs(key) { var v = fpt.ui.getState(key); return v === null || v === undefined ? "" : String(v); }
    function gm(key) { var v = gs(key); return DESKTOP ? v : v.replace(/\s*¶\s*/g, "\n"); }   // многострочный текст
    function on(key) { return gs(key) === "true"; }
    function Row() { return { type: "Row", children: Array.prototype.slice.call(arguments) }; }
    function Card() { return { type: "Card", children: Array.prototype.slice.call(arguments) }; }
    var showRev = 0;
    function show(children) {
        var root = { type: "Column", children: children };
        if (!DESKTOP) {
            (function mark(n) {
                if (!n || typeof n !== "object") return;
                if (n.stateKey) n.stateKey = NS_UI + n.stateKey;
                (n.children || []).forEach(mark);
            })(root);
            // приложение перечитывает значения полей, только когда описание экрана изменилось
            root.children.push({ type: "Spacer", size: 0, rev: ++showRev });
        }
        fpt.ui.setSlot(PLUGIN_SLOT_KEY, root);
    }
    function toast(t) { try { fpt.app.toast(String(t)); } catch (e) {} }
    var NL_HINT = DESKTOP ? "" : "Перенос строки на телефоне обозначается знаком ¶";
    function tabs(list, current, fn) {
        var rows = [], row = [];
        list.forEach(function (t) {
            row.push(Btn((t[0] === current ? "• " : "") + t[1], fn + "('" + t[0] + "')", t[0] !== current));
            if (row.length === (DESKTOP ? 4 : 2)) { rows.push({ type: "Row", children: row }); row = []; }
        });
        if (row.length) rows.push({ type: "Row", children: row });
        return rows;
    }

    // ---------------------------------------------------------------- MUVSell Rent (по версии 1.2.17 для FunPay Cardinal)
    // Покупатель оплачивает лот на FunPay, плагин арендует Steam-аккаунт на muvsell.store с вашего баланса и присылает логин и пароль.
    var SITE = "https://muvsell.store", API_BASE = SITE + "/api/v1";
    var MIRROR = "https://cold-band-9582.manimanimanimani4444.workers.dev";   // запасной адрес MUVSell (только /api и /downloads)
    var MIN_HOURS = 1, MAX_HOURS = 720;
    var STEAM_SUB = 89, OTHER_SUB = 451, OFF_SUB = 1405;      // Steam "Аккаунты с играми", "Прочие игры", Steam "Оффлайн активации"
    var MANUAL = { steam: [STEAM_SUB, "Steam \"Аккаунты с играми\""], other: [OTHER_SUB, "\"Прочие игры\""] };
    var LOT_AMOUNT = 1000;          // "Наличие" лотов плагина: FunPay вычитает купленные штуки и на нуле выключает лот
    var API_DOWN_SEC = 300;         // MUVSell не отвечает столько подряд: лоты плагина снимаются с продажи
    var RECHECK_SEC = 600, OFF_TICK = 600, NEWS_EVERY = 1800, OFF_MAX_QTY = 10, OFF_AUTO_BATCH = 5, RATE_SECTIONS = 3;
    var EN_RATIO = 0.6;             // английское описание намного короче русского FunPay тоже не принимает
    var EN_SHORT_HINT = "FunPay не принял английское описание: оно намного короче русского. Допишите его во вкладке \"Сообщения\".";
    var TAG_RX = /\brentM-\d+\b/ig;

    var TEXTS = {
        delivery: "🎮 {game}: аккаунт готов!\n\n👤 Логин: {login}\n🔑 Пароль: {password}\n⏳ Срок: {hours} ч., до {expires}\n\n🔐 Код Steam Guard: {guard}\n⌛ Сколько осталось: !время\n📋 Все команды: !помощь\n\n🔄 Продлить этот аккаунт: {word} 3 на 3 ч, {word} 2д на 2 дня.\n🛒 Новая покупка лота выдаст другой аккаунт. Хорошей игры! 🎯",
        extended: "✅ Готово! Аренда {game} продлена на {hours} ч.\n👤 Аккаунт тот же: {login}, вход без изменений.\n🕒 Играйте до {expires}",
        ext_usage: "🔄 Как продлить: напишите {word} и срок, часы или дни.\nНапример: {word} 3 или {word} 2д\nНесколько аккаунтов? Добавьте логин: {word} 3 логин",
        ext_lot_ready: "🧾 Лот для продления создан специально для вас!\n\n🎮 {game} · +{time}\n💰 К оплате: {price} ₽\n👉 {link}\n\n⏱ Лот доступен {minutes} мин. После оплаты время само добавится к аккаунту {login}.",
        ext_lot_fail: "😔 Лот для продления сейчас создать не вышло.\nПопробуйте через пару минут, продавец уже в курсе. Покупка основного лота выдаст новый аккаунт, а не продлит этот.",
        review_offer: "🎁 Небольшой подарок: оставьте отзыв на {stars}★ к этому заказу, и мы бесплатно добавим {bonus} ч. к аренде, пока она идёт.",
        review_bonus: "💚 Спасибо за отзыв! Аренда {login} продлена на {hours} ч. в подарок.\n🕒 Играйте до {expires}",
        kick_ok: "🚪 Готово, все чужие сессии на {login} закрываются (обычно до минуты).\nАренда {game} идёт дальше, просто войдите заново.",
        kick_fail: "⚠️ Не получилось завершить сессии {login}: {reason}",
        pass_wait: "🔑 Меняю пароль на {login}… Новый пришлю сюда через 1-3 минуты.",
        pass_ok: "🔐 Пароль обновлён!\n\n🎮 {game}\n👤 Логин: {login}\n🔑 Новый пароль: {password}\n\nСрок аренды не изменился. Код Steam Guard: {guard}",
        pass_fail: "⚠️ Сменить пароль {login} не удалось: {reason}",
        code: "🔐 Код Steam Guard для {login}: {code}\n⏱ Действует ещё ~{ttl} сек., вводите сразу.",
        code_which: "👥 У вас несколько аккаунтов, уточните логин: {cmd} логин\n{logins}",
        code_fail: "⚠️ Код сейчас не получить. Продавец уже в курсе и поможет вручную.",
        time_left: "⌛ {game} ({login}): осталось {left}, до {expires}",
        creds: "👤 {game}\nЛогин: {login}\nПароль: {password}\n🕒 До {expires}",
        help: "📋 Команды для вашей аренды:\n{commands}",
        warn: "⏳ Аренда {game} ({login}) закончится через {left} ({expires}).\nПродлить этот же аккаунт: напишите {word} и срок, например {word} 3.\nНовая покупка лота выдаст другой аккаунт.",
        ended: "🏁 Аренда {game} ({login}) завершена, доступ к аккаунту закрыт.\nСпасибо, что были с нами! Понравилось? Будем рады отзыву 💚",
        no_rental: "🔎 Не вижу у вас активной аренды. Если только что оплатили, подождите минуту и повторите.",
        problem: "⚠️ Автовыдача не сработала. Продавец уже получил уведомление и скоро всё выдаст вручную. Спасибо за терпение!",
        off_delivery: "💿 {game}: игра навсегда, аккаунт готов!\n\n👤 Логин: {login}\n🔑 Пароль: {password}\n\nКак играть:\n1️⃣ Войдите в Steam с этими данными. Код Steam Guard: {guard} {login}\n2️⃣ Установите {game} и один раз запустите её.\n3️⃣ Steam → \"Перейти в автономный режим\", и играйте оффлайн сколько угодно.\n\n⚠️ Аккаунт общий: не меняйте пароль, почту и настройки и не выходите из автономного режима без нужды.\n📋 Данные ещё раз: !офлайн",
        off_creds: "💿 {game}\nЛогин: {login}\nПароль: {password}\nКод Steam Guard: {guard} {login}",
        off_none: "🔎 Не вижу у вас оффлайн-игр. Если только что оплатили, подождите минуту и повторите.",
        off_code_limit: "⏳ Код для {login} сейчас не выдать: {reason}",
        off_no_guard: "🔓 Для {login} код Steam Guard не нужен: входите только по логину и паролю.",
        ext_title_ru: "⏩ ПРОДЛЕНИЕ {game} на {time} #{tag}",
        ext_title_en: "EXTENSION {game} for {time} #{tag}",
        ext_desc_ru: "Персональный лот для продления аренды {game} на {time}. После оплаты время добавится к вашему аккаунту автоматически, логин и пароль не меняются. Лот создан по вашему запросу и исчезнет после оплаты.",
        ext_desc_en: "Personal offer to extend your {game} rental for {time}. After payment the time is added to the same account automatically - login and password stay the same. This offer was created on your request and will be removed after payment.",
        ap_title_ru: "{game} | Аренда Steam на {time} | Автовыдача ⚡",
        ap_title_en: "{game} | Steam rental {time} | Auto delivery",
        ap_desc_ru: "🎮 Лицензионный Steam-аккаунт {game} в аренду на {time}.\n⚡ Логин и пароль придут в чат сами, сразу после оплаты, круглосуточно.\n🔄 Продлить тот же аккаунт можно командой в чате (ниже). Новая покупка лота выдаст другой аккаунт.\n🔢 Количество в заказе добавляет время на один аккаунт: 4 шт. лота на 1 день = 1 аккаунт на 4 дня. Нужно несколько аккаунтов? Оформите отдельные заказы.\n\n📋 Команды в чате заказа:\n{commands}\n\n⏳ Когда срок выйдет, доступ закроется автоматически.",
        ap_desc_en: "Licensed Steam account {game} for rent for {time}. Login and password arrive in the chat automatically right after payment, 24/7. Chat commands: !code - Steam Guard code, !time - time left, !extend 3 - add 3 hours to the same account, !help - all commands. Buying the offer again gives you a new account. The quantity in one order adds time to a single account: 4 pieces of a 1-day offer = 1 account for 4 days. For several accounts, place separate orders.",
        off_title_ru: "{game} | Оффлайн-активация Steam навсегда | Автовыдача 24/7",
        off_title_en: "{game} | Steam offline activation forever | Auto delivery 24/7",
        off_desc_ru: "✅ Автовыдача 24/7: сразу после оплаты бот пришлёт в чат логин и пароль Steam-аккаунта с игрой {game}, навсегда.\n\n🎮 Как играть:\n1. Войдите в аккаунт в Steam. Код Steam Guard: команда {code} в чате заказа.\n2. Скачайте игру и один раз запустите её.\n3. Steam → \"Перейти в автономный режим\", и играйте без интернета.\n\n🔁 Логин и пароль ещё раз: команда !офлайн.\n\n⚠️ Аккаунт общий: не меняйте пароль и почту, не выходите в онлайн во время игры. Это не ключ и не личный аккаунт: игра в автономном режиме Steam.",
        off_desc_en: "Auto delivery 24/7: right after payment the bot sends the login and password of a Steam account with {game} to the order chat - forever. How to play: log in to Steam (Steam Guard code - type !code in the chat), download the game and launch it once, then Steam - Go Offline and play without internet. Login and password again - !offline. The account is shared: do not change the password or email and do not go online while playing. This is not a key and not a personal account.",
    };
    var TEXTS_EN = {    // те же сообщения для покупателей, которые пишут английские команды (!code, !help…)
        delivery: "🎮 {game}: your account is ready!\n\n👤 Login: {login}\n🔑 Password: {password}\n⏳ Time: {hours} h, until {expires}\n\n🔐 Steam Guard code: {guard}\n⌛ Time left: !time\n📋 All commands: !help\n\n🔄 Extend this account: {word} 3 for 3 h, {word} 2d for 2 days.\n🛒 Buying the lot again gives you a different account. Have fun! 🎯",
        extended: "✅ Done! Your {game} rental is extended by {hours} h.\n👤 Same account: {login}, log in as before.\n🕒 Play until {expires}",
        ext_usage: "🔄 How to extend: type {word} and the time in hours or days.\nFor example: {word} 3 or {word} 2d\nSeveral accounts? Add the login: {word} 3 login",
        ext_lot_ready: "🧾 An extension offer was created just for you!\n\n🎮 {game} · +{time}\n💰 To pay: {price} ₽\n👉 {link}\n\n⏱ The offer is available for {minutes} min. After payment the time is added to {login} automatically.",
        ext_lot_fail: "😔 Couldn't create the extension offer right now.\nPlease try again in a couple of minutes, the seller has been notified. Buying the main lot gives you a new account, it doesn't extend this one.",
        review_offer: "🎁 A small gift: leave a {stars}★ review for this order and we'll add {bonus} h to your rental for free while it's active.",
        review_bonus: "💚 Thanks for the review! Your {login} rental is extended by {hours} h as a gift.\n🕒 Play until {expires}",
        kick_ok: "🚪 Done, all other sessions on {login} are being closed (usually within a minute).\nYour {game} rental continues, just log in again.",
        kick_fail: "⚠️ Couldn't end the sessions on {login}. Please try again later or contact the seller.",
        pass_wait: "🔑 Changing the password on {login}… I'll send the new one here in 1-3 minutes.",
        pass_ok: "🔐 Password updated!\n\n🎮 {game}\n👤 Login: {login}\n🔑 New password: {password}\n\nYour rental time hasn't changed. Steam Guard code: {guard}",
        pass_fail: "⚠️ Couldn't change the password on {login}. The seller has been notified and will help.",
        code: "🔐 Steam Guard code for {login}: {code}\n⏱ Valid for ~{ttl} more sec., enter it right away.",
        code_which: "👥 You have several accounts, please add the login: {cmd} login\n{logins}",
        code_fail: "⚠️ Can't get the code right now. The seller has been notified and will help manually.",
        time_left: "⌛ {game} ({login}): {left} left, until {expires}",
        creds: "👤 {game}\nLogin: {login}\nPassword: {password}\n🕒 Until {expires}",
        help: "📋 Commands for your rental:\n{commands}",
        warn: "⏳ Your {game} rental ({login}) ends in {left} ({expires}).\nTo extend this account, type {word} and the time, e.g. {word} 3.\nBuying the lot again gives you a different account.",
        ended: "🏁 Your {game} rental ({login}) has ended, access to the account is closed.\nThanks for choosing us! If you enjoyed it, we'd love a review 💚",
        no_rental: "🔎 I don't see an active rental for you. If you've just paid, wait a minute and try again.",
        problem: "⚠️ Auto-delivery failed. The seller has been notified and will deliver manually soon. Thanks for your patience!",
        off_delivery: "💿 {game}: lifetime game, your account is ready!\n\n👤 Login: {login}\n🔑 Password: {password}\n\nHow to play:\n1️⃣ Log in to Steam with these details. Steam Guard code: {guard} {login}\n2️⃣ Install {game} and launch it once.\n3️⃣ Steam → \"Go Offline\", then play offline as long as you like.\n\n⚠️ The account is shared: don't change the password, email or settings, and don't leave offline mode unless you need to.\n📋 Details again: !offline",
        off_creds: "💿 {game}\nLogin: {login}\nPassword: {password}\nSteam Guard code: {guard} {login}",
        off_none: "🔎 I don't see any offline games for you. If you've just paid, wait a minute and try again.",
        off_code_limit: "⏳ Can't give a code for {login} right now: the daily code limit is reached. Please try later.",
        off_no_guard: "🔓 {login} doesn't need a Steam Guard code, just log in with the login and password.",
    };
    var TEXT_LABELS = {
        delivery: "Выдача аккаунта", extended: "Аренда продлена (после оплаты)", ext_lot_ready: "Лот для продления готов", ext_lot_fail: "Лот продления создать не удалось",
        ext_usage: "Как продлить (подсказка)", review_offer: "Предложение бонуса за отзыв", review_bonus: "Бонус за отзыв начислен", kick_ok: "Сессии Steam завершены (!кик)",
        kick_fail: "!кик не удался", pass_wait: "Пароль меняется (!пароль)", pass_ok: "Пароль изменён (!пароль)", pass_fail: "!пароль не удался",
        code: "Код Steam Guard", code_which: "Несколько аккаунтов, нужен логин", code_fail: "Код не получен", time_left: "Сколько осталось (!время)", creds: "Данные аккаунта (!данные)",
        help: "Список команд (!помощь)", warn: "Аренда скоро закончится", ended: "Аренда закончилась", no_rental: "Нет активной аренды", problem: "Сбой автовыдачи",
        off_delivery: "Выдача оффлайн-игры (навсегда)", off_creds: "Данные оффлайн-игры (!офлайн)", off_none: "Нет оффлайн-игр", off_code_limit: "Лимит кодов оффлайн-игры", off_no_guard: "Оффлайн-аккаунт без Steam Guard",
        ap_title_ru: "Лот аренды: название (рус.)", ap_title_en: "Лот аренды: название (англ.)", ap_desc_ru: "Лот аренды: описание (рус.)", ap_desc_en: "Лот аренды: описание (англ.)",
        ext_title_ru: "Лот продления: название (рус.)", ext_title_en: "Лот продления: название (англ.)", ext_desc_ru: "Лот продления: описание (рус.)", ext_desc_en: "Лот продления: описание (англ.)",
    };
    var TEXT_KEYS = Object.keys(TEXT_LABELS);
    var HUMAN = {
        bad_key: "неверный API-ключ MUVSell", no_key: "API-ключ MUVSell не задан", balance: "недостаточно средств на балансе MUVSell",
        no_stock: "на MUVSell нет свободных аккаунтов", not_found: "игра или аренда не найдена на MUVSell",
        forbidden: "ключ не привязан к аккаунту или аккаунт заблокирован", bad_request: "MUVSell отклонил запрос", wait: "слишком часто",
        no_account: "аренда создана, но аккаунт не выдан, выдайте вручную с сайта",
        not_covered: "игра не оплачена на MUVSell: нет лицензии на неё и подписки продавца (режим \"только оплаченные\")",
        net: "нет связи с MUVSell ни напрямую, ни через запасной адрес",
    };
    var ERRORS = { 400: "bad_request", 401: "bad_key", 402: "balance", 403: "forbidden", 404: "not_found", 409: "no_stock", 429: "wait" };
    var HIDE_WHY = { stock: "нет аккаунтов", balance: "низкий баланс", api: "MUVSell не отвечает", manual: "\"Скрыть все лоты\"", cover: "выдача не оплачена" };
    var DEFAULTS = {
        enabled: true, key: "", pay: "rub",
        markup: 50, catMarkup: {}, volDiscount: true, minPrice: 1,
        fpEdit: true, hideNoStock: true, hideLowBalance: false, hideApiDown: true, lotsPaused: false, balanceMin: 0,
        autoRefund: false, reviewBonus: false, bonusHours: 2, bonusStars: 5,
        notifyEnd: true, warnMin: 30, extCmd: true, extWord: "!продление", codeWord: "!код", enMsgs: true, extMinutes: 10, buyerCmds: true,
        pollSec: 60, priceMin: 5, notifySales: true, notifyNews: true, texts: {},
        apDurations: [1, 3, 6, 12, 24, 72, 168, 336, 720], lotCap: 20, apOwn: null, apActive: true, apFilter: "", steamRegion: "Россия",
        offMode: "all", offPrice: 10, offMarkup: 30, offAuto: false,
        tagSeq: 1000, knownGames: null, newsPending: [], proxy: "",
    };
    var S = load("settings", null) || {};
    (function () {
        if (S.extTemp !== undefined && S.extCmd === undefined) S.extCmd = !!S.extTemp;     // настройка из прошлой версии плагина
        for (var k in DEFAULTS) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
        if (!S.texts || typeof S.texts !== "object") S.texts = {};
        if (!S.catMarkup || typeof S.catMarkup !== "object") S.catMarkup = {};
    })();
    var MAPS = load("maps", []);        // привязки: {lotId, subcat, titles, gameId, game, hours, auto, manual, price, markup, reprice, autohide, bonus, off, tag, tagged, sold, stock}
    var RENT = load("rentals", {});     // чат → [аренды]
    var HIDDEN = load("hidden", {});    // лот → почему снят с продажи: stock | balance | api | manual | cover
    var SALES = load("sales", []);
    var CREATED = load("created", {});  // "игра:часы" (общие разделы: "steam:игра:часы") → лот, созданный плагином
    var EXT = load("extlots", {});      // метка → временный лот продления
    var ISSUE = load("issuing", {});    // журнал выдачи: заказ → {at, chat}. Запись живёт, пока заказ выдаётся
    var OFF = load("off", []);          // оффлайн-лоты: {lotId, subcat, titles, gameId, game, auto, price, autohide}
    var OBUY = load("offbuys", {});     // чат → [оффлайн-покупки]
    var LANG = load("langs", {});       // чат → "en", если покупатель пишет английские команды
    var lastApiError = "";

    function saveS() { save("settings", S); }
    function saveMaps() { save("maps", MAPS); }
    function saveRent() { save("rentals", RENT); }
    function saveOff() { save("off", OFF); }
    function codeWord() { return String(S.codeWord || "!код").toLowerCase(); }
    function extWord() { return String(S.extWord || "!продление"); }
    function langOf(chatId) { return S.enMsgs && LANG[chatId] === "en" ? "en" : "ru"; }
    function t(key, lang, vars) {
        vars = vars || {};
        var text = (lang === "en" && TEXTS_EN[key]) || (S.texts || {})[key] || TEXTS[key];
        if (vars.guard === undefined) vars.guard = lang === "en" && codeWord() === "!код" ? "!code" : codeWord();
        if (lang === "en") vars.word = "!extend"; else if (vars.word === undefined) vars.word = extWord();
        return fill(text, vars);
    }
    function human(err) { var text = HUMAN[err] || err || "неизвестная ошибка"; return lastApiError && err !== "net" ? text + ": " + lastApiError : text; }
    function ts(iso) { var d = Date.parse(String(iso || "")); return isFinite(d) ? d / 1000 : 0; }
    function tzLabel(lang) { var off = -new Date().getTimezoneOffset() / 60; return off === 3 ? (lang === "en" ? "MSK" : "МСК") : "UTC" + (off >= 0 ? "+" : "") + off; }
    function whenTz(sec, lang) { return when(sec) + " " + tzLabel(lang); }
    function plural(n, one, few, many) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : (a >= 2 && a <= 4 && !(b >= 12 && b <= 14) ? few : many); }
    function dur(hours, lang) {
        if (lang === "en") return durEn(hours);
        if (hours % 24 === 0) { var d = hours / 24; return d + " " + plural(d, "день", "дня", "дней"); }
        return hours + " " + plural(hours, "час", "часа", "часов");
    }
    function shortDur(hours) { return hours % 24 === 0 ? hours / 24 + "д" : hours + "ч"; }
    function leftText(sec, lang) {
        var m = Math.max(1, Math.floor(sec / 60)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), en = lang === "en";
        m = m % 60;
        var parts = [];
        if (d) parts.push(en ? d + (d > 1 ? " days" : " day") : d + " " + plural(d, "день", "дня", "дней"));
        if (h) parts.push(h + (en ? " h" : " ч."));
        if (m && !d) parts.push(m + (en ? " min" : " мин."));
        return parts.join(" ");
    }
    // "1, 3, 24, 7д, 30 дней" → [1, 3, 24, 168, 720]; дни с "д"/"d", остальное часы
    function parseHoursList(text) {
        var out = [], rx = /(\d+)\s*(д|d|ч|h)?/g, m, low = String(text || "").toLowerCase();
        while ((m = rx.exec(low))) {
            var h = int(m[1], 0) * (m[2] === "д" || m[2] === "d" ? 24 : 1);
            if (h >= MIN_HOURS && h <= MAX_HOURS && out.indexOf(h) < 0) out.push(h);
        }
        return out.sort(function (a, b) { return a - b; });
    }
    function parseHours(text) { var list = parseHoursList(text); return list.length === 1 ? list[0] : 0; }
    function rub(v) { return (Math.round(num(v) * 100) / 100) + "₽"; }
    function rid(prefix) { return prefix + "-" + Math.floor(Math.random() * 1e12).toString(36) + Date.now().toString(36); }
    function hash(s) { var a = 5381, b = 52711; s = String(s); for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 33 ^ c) >>> 0; } return a.toString(16) + b.toString(16); }

    // --- API MUVSell. Запрос идёт напрямую, а если muvsell.store не отвечает, через запасной адрес.
    var routeDown = {};
    var ROUTE_NAMES = { px: "прокси", direct: "muvsell.store напрямую", mirror: "запасной адрес MUVSell" };
    function proxyOn() { return DESKTOP && !!String(S.proxy || "").trim(); }
    // Запрос к MUVSell по очереди: прокси из настроек (на компьютере), напрямую, запасной адрес.
    // only: только этот маршрут (проверка связи). Маршрут не ответил: 10 минут его пропускаем.
    function siteReq(method, url, bodyObj, headers, repeatable, only) {
        var routes = [];
        if (proxyOn()) routes.push(["px", url, { proxy: String(S.proxy).trim(), timeout: 25 }]);
        routes.push(["direct", url, DESKTOP ? { timeout: 25 } : null]);
        if (MIRROR && url.indexOf(SITE) === 0) routes.push(["mirror", MIRROR + url.slice(SITE.length), DESKTOP ? { timeout: 25 } : null]);
        if (only) routes = routes.filter(function (r) { return r[0] === only; });
        var live = only ? routes : routes.filter(function (r) { return now() >= (routeDown[r[0]] || 0); });
        if (!live.length) live = routes;
        var res = null;
        for (var i = 0; i < live.length; i++) {
            res = method === "GET" ? http("GET", live[i][1], null, headers, live[i][2]) : postJson(live[i][1], bodyObj || {}, headers, live[i][2]);
            if (res.code) return res;
            // прокси не подключился: запрос до MUVSell не дошёл, идти дальше безопасно и без requestId
            var unsent = /Прокси не отвечает|Прокси не принят/.test(String(res.error || ""));
            if (i === live.length - 1 || !(repeatable || unsent)) return res;   // запрос мог дойти: без requestId повтор списал бы баланс дважды
            routeDown[live[i][0]] = now() + 600;
            log(ROUTE_NAMES[live[i][0]] + " не отвечает (" + String(res.error || "").slice(-150) + "), 10 минут хожу через: " + ROUTE_NAMES[live[i + 1][0]]);
        }
        return res;
    }
    // Проверка связи по каждому маршруту: что отвечает, а что нет
    function netCheck() {
        var names = ["direct", "mirror"], out = [];
        if (proxyOn()) names.unshift("px");
        names.forEach(function (n) {
            var t0 = Date.now(), r = siteReq("GET", API_BASE + "/meta", null, { "Accept": "application/json" }, true, n);
            out.push(ROUTE_NAMES[n] + ": " + (r.code ? "отвечает (" + (Date.now() - t0) + " мс)" : "нет связи" + (r.error ? ", " + String(r.error).slice(0, 80) : "")));
            if (r.code) delete routeDown[n];
        });
        return out.join("; ");
    }
    function siteGet(url) { return siteReq("GET", url, null, { "Accept": "application/json" }, true); }
    function api(method, path, body) {
        if (!String(S.key || "").trim()) return { data: null, err: "no_key" };
        var headers = { "X-API-Key": String(S.key).trim(), "Accept": "application/json", "User-Agent": "MUVSellRent-FunPayTools/1.2.17" };
        var repeatable = method === "GET" || !!(body && body.requestId);     // MUVSell выполняет запрос с requestId один раз
        for (var attempt = 0; attempt < 3; attempt++) {
            var r = siteReq(method, API_BASE + path, body, headers, repeatable);
            if (!r.code) {
                lastApiError = r.error || "";
                if (!repeatable) return { data: null, err: "net" };
                continue;
            }
            var data = r.json && typeof r.json === "object" ? r.json : {};
            if (r.code >= 200 && r.code < 300) { lastApiError = ""; return { data: data, err: null }; }
            lastApiError = String(data.error || "HTTP " + r.code).slice(0, 200);
            if (r.code >= 500 && repeatable && attempt < 2) continue;
            return { data: null, err: ERRORS[r.code] || "http_" + r.code };
        }
        return { data: null, err: "net" };
    }
    // Платный запрос. "Авто" платит рублями, пока они есть; не хватило рублей при долларах на балансе: та же оплата другой валютой.
    function paid(path, body) {
        var r = api("POST", path, body);
        if (r.err === "balance" && S.pay === "auto") {
            var other = {};
            for (var k in body) other[k] = body[k];
            other.payWith = body.payWith === "rub" ? "usd" : "rub";
            r = api("POST", path, other);
        }
        return r;
    }
    var cache = { products: [0, null], bal: [0, null], rate: [0, 90], costs: {}, offcat: [0, null] };
    function balance(force) {
        if (force || !cache.bal[1] || now() - cache.bal[0] > 60) {
            var r = api("GET", "/account/balance");
            if (r.data) cache.bal = [now(), r.data];
        }
        return cache.bal[1];
    }
    function payWith() {
        if (S.pay !== "auto") return S.pay;
        var b = balance() || {};
        return num(b.balanceRub) > 0 ? "rub" : "usd";
    }
    function usdRate() {
        if (now() - cache.rate[0] > 3600) {
            var r = api("GET", "/meta");
            cache.rate = [now(), num((r.data || {}).usdRateRub) || cache.rate[1]];
        }
        return cache.rate[1];
    }
    // (баланс не выше порога?, баланс текстом). "Авто" платит любой валютой: мало, только когда мало обеих.
    function lowBalance(b) {
        var r = num(b.balanceRub), u = num(b.balanceUsd), lim = num(S.balanceMin);
        if (S.pay === "usd") return [u <= lim, "$" + u];
        if (S.pay === "auto") return [r <= lim && u * usdRate() <= lim, rub(r) + " / $" + u];
        return [r <= lim, rub(r)];
    }
    function products(force) {
        if (!String(S.key || "").trim()) return null;
        if (force || !cache.products[1] || now() - cache.products[0] > 300) {
            var r = api("GET", "/rental/products");
            if (r.data) cache.products = [now(), r.data.products || []];
        }
        return cache.products[1];
    }
    function product(gameId) {
        var list = products() || [];
        for (var i = 0; i < list.length; i++) if (list[i].id === gameId) return list[i];
        return null;
    }
    function stockMap(prods) { var out = {}; (prods || []).forEach(function (p) { out[p.id] = p.available ? int(p.inStock, 0) : 0; }); return out; }
    function cost(prod, hours) {
        if (!S.volDiscount && prod.pricePerHourRub !== undefined && prod.pricePerHourRub !== null) return Math.round(num(prod.pricePerHourRub) * hours * 100) / 100;
        var prices = prod.prices || [];
        for (var i = 0; i < prices.length; i++) if (prices[i].hours === hours && prices[i].priceRub !== undefined && prices[i].priceRub !== null) return num(prices[i].priceRub);
        var key = prod.id + ":" + hours, hit = cache.costs[key];
        if (hit && now() - hit[0] < 900) return hit[1];
        var q = api("POST", "/rental/quote", { gameId: prod.id, durationKey: hours + "h", qty: 1 });
        var value = q.data && q.data.totalRub !== undefined && q.data.totalRub !== null ? num(q.data.totalRub) : Math.round(num(prod.pricePerHourRub) * hours * 100) / 100;
        cache.costs[key] = [now(), value];
        return value;
    }
    // Наценка: своя у привязки → раздела FunPay → общая
    function markupOf(m) {
        m = m || {};
        if (m.markup !== undefined && m.markup !== null) return num(m.markup);
        var cat = S.catMarkup[String(m.subcat)];
        return cat !== undefined && cat !== null ? num(cat) : num(S.markup);
    }
    function markupSrc(m) { return m.markup !== undefined && m.markup !== null ? "своя" : (S.catMarkup[String(m.subcat)] !== undefined ? "раздела" : "общая"); }
    // Цена лота вверх до копейки: до целого рубля наценка на копеечных сроках выходила в сотни процентов
    function priceFor(prod, hours, m) {
        var v = Math.max(num(S.minPrice) || 1, cost(prod, hours) * (1 + markupOf(m) / 100));
        return Math.ceil(Math.round(v * 100 * 1e6) / 1e6) / 100;
    }
    function autoPrice(m) { return m.reprice === undefined || m.reprice === null ? !!m.auto : !!m.reprice; }
    function hideOn(m) { return m.autohide === undefined || m.autohide === null ? !!S.hideNoStock : !!m.autohide; }
    function bonusOn(m) { return !m || m.bonus === undefined || m.bonus === null ? !!S.reviewBonus : !!m.bonus; }
    function mapByLot(lotId) { for (var i = 0; i < MAPS.length; i++) if (String(MAPS[i].lotId) === String(lotId)) return MAPS[i]; return null; }
    function offByLot(lotId) { for (var i = 0; i < OFF.length; i++) if (String(OFF[i].lotId) === String(lotId)) return OFF[i]; return null; }
    function mapLabel(m) { return m.offline ? m.game + " навсегда" : m.game + " " + shortDur(int(m.hours, 1)); }
    function note(title, text) { notify("MUVSell Rent: " + title, text || ""); }

    // --- аренды и журнал продаж
    function activeIn(chatId) { var t0 = now(); return (RENT[chatId] || []).filter(function (r) { return r.exp > t0; }); }
    function allActive() {
        var out = [], t0 = now();
        for (var k in RENT) RENT[k].forEach(function (r) { if (r.exp > t0) out.push(r); });
        return out.sort(function (a, b) { return a.exp - b.exp; });
    }
    function recById(rentalId) { for (var k in RENT) for (var i = 0; i < RENT[k].length; i++) if (String(RENT[k][i].id) === String(rentalId)) return RENT[k][i]; return null; }
    function recByOrder(orderId) { for (var k in RENT) for (var i = 0; i < RENT[k].length; i++) if (String(RENT[k][i].order) === String(orderId)) return RENT[k][i]; return null; }
    function accOf(data, login) {
        var items = ((data || {}).rental || {}).items || [];
        for (var i = 0; i < items.length; i++) {
            var accs = items[i].accounts || [];
            for (var j = 0; j < accs.length; j++) if (!login || String(accs[j].login || "").toLowerCase() === String(login).toLowerCase()) return accs[j];
        }
        return null;
    }
    // → false, если такая продажа заказа уже записана (повтор выдачи после перезапуска)
    function sale(kind, rec, hours, costRub, order, refunded) {
        var oid = order ? order.id : "";
        if (order && !refunded && SALES.some(function (s) { return s.order === oid && s.kind === kind; })) return false;
        var rev = 0;
        if (order && !SALES.some(function (s) { return s.order === oid; })) rev = num(order.price);      // выручка заказа считается один раз
        SALES.push({ ts: now(), order: oid, buyer: (order && order.buyerName) || rec.buyer || "", gameId: rec.gameId || "", game: rec.game || "?",
            hours: int(hours, 0), lot: rec.lot || "", rid: rec.id || "", rev: Math.round(rev * 100) / 100, cost: Math.round(num(costRub) * 100) / 100, kind: kind, refunded: !!refunded });
        if (SALES.length > 1500) SALES = SALES.slice(SALES.length - 1500);
        save("sales", SALES);
        return true;
    }
    // Продлевает аренду порциями до 720 ч. key это основа requestId: повтор той же порции MUVSell не продлит и не спишет второй раз.
    function addHours(rec, hours, key) {
        var added = 0, costRub = 0, err = null;
        while (added < hours) {
            var step = Math.min(hours - added, MAX_HOURS);
            var r = paid("/rental/" + rec.id + "/extend", { durationKey: step + "h", payWith: payWith(), requestId: key + ":" + added });
            if (r.err) { err = r.err; break; }
            rec.exp = ts(r.data.endsAt) || rec.exp;
            costRub += num(r.data.cost);
            added += step;
        }
        if (added) { rec.warned = false; rec.ended = false; saveRent(); }
        return { added: added, err: err, cost: costRub };
    }
    // Арендует аккаунт на MUVSell и выдаёт покупателю. Каждая покупка это новый аккаунт.
    function newRental(m, order, chatId, hours) {
        var first = Math.min(hours, MAX_HOURS);
        // ник покупателя на MUVSell не передаём: это чужие личные данные. requestId: один заказ FunPay не купит две аренды даже при повторе.
        var r = paid("/rental/create", { items: [{ gameId: m.gameId, durationKey: first + "h", qty: 1 }], payWith: payWith(), comment: "FunPay #" + order.id, requestId: "fp-" + order.id });
        if (r.err) return { err: r.err };
        var rental = r.data.rental || {}, acc = accOf(r.data, "");
        if (!acc) return { err: "no_account" };
        var lang = langOf(chatId);
        var rec = { id: rental.id, number: rental.number, gameId: m.gameId, game: m.game, login: acc.login || "", exp: ts(rental.endsAt), order: order.id,
            buyer: order.buyerName, chat: chatId, lot: m.lotId, bonus: false, ended: false, warned: false };
        var list = (RENT[chatId] = RENT[chatId] || []);
        var old = list.filter(function (x) { return String(x.id) === String(rec.id); })[0];
        if (old) { old.exp = rec.exp || old.exp; rec = old; } else list.push(rec);     // выдача после обрыва: MUVSell вернул ту же аренду, запись не дублируем
        saveRent();
        var extra = addHours(rec, hours - first, "fp-" + order.id + "-more");          // больше 720 ч за раз MUVSell не выдаёт, остальное докупаем продлением
        if (extra.err) note("заказ #" + order.id, "Выдано " + (first + extra.added) + " ч из " + hours + ": " + human(extra.err));
        var sold = sale("new", rec, first + extra.added, num(rental.totalRub) + extra.cost, order);
        var tail = lang === "ru" && S.enMsgs ? "\n\n🇬🇧 English? Type !help" : "";
        if (!sendTo(chatId, t("delivery", lang, { game: m.game, login: rec.login, password: acc.password || "", hours: first + extra.added, expires: whenTz(rec.exp, lang) }) + tail)) {
            note("покупателю не ушли данные аккаунта", "Заказ #" + order.id + ", " + order.buyerName + ". FunPay не принял сообщение, отправьте вручную: логин " + rec.login + ", пароль " + (acc.password || ""));
        }
        if (sold && bonusOn(m) && SALES.filter(function (s) { return s.order === order.id; }).length === 1) sendTo(chatId, t("review_offer", lang, { bonus: S.bonusHours, stars: S.bonusStars }));
        if (S.notifySales) note("выдан " + rec.login, m.game + ", " + (first + extra.added) + " ч, покупатель " + order.buyerName + ", заказ #" + order.id);
        return { rec: rec };
    }
    // Продлевает аренду, пишет покупателю и заносит в журнал. → null или код ошибки (если не продлено ни часа)
    function extend(rec, hours, chatId, order, textKey, kind) {
        var orderId = order && typeof order === "object" ? order.id : order;
        // оплата лота продления и бонус за отзыв один раз на заказ; продление из настроек плагина каждое своё
        var key = (kind === "ext" || kind === "bonus") && orderId ? "fp-" + orderId + "-" + kind : rid("adm");
        var res = addHours(rec, hours, key);
        if (!res.added) return res.err || "net";
        if (res.err) note("продлено " + res.added + " ч из " + hours, human(res.err));
        sale(kind, rec, res.added, res.cost, order && typeof order === "object" ? order : null);
        var lang = langOf(rec.chat || chatId);
        sendTo(chatId, t(textKey, lang, { login: rec.login, game: rec.game, hours: res.added, expires: whenTz(rec.exp, lang) }));
        if (kind === "ext" && S.notifySales) note("продлён " + rec.login, rec.game + ", +" + res.added + " ч");
        return null;
    }
    var LATE = {};      // заказы, выдача которых продолжается после перезапуска: покупателю про сбой не пишем и деньги сами не возвращаем
    function fail(order, chatId, err, m) {
        if (LATE[order.id]) return note("заказ #" + order.id + " из простоя не выдан", human(err) + ". Проверьте чат: выдайте вручную или оформите возврат.");
        sendTo(chatId, t("problem", langOf(chatId)));
        var refund = S.autoRefund && (err === "no_stock" || err === "balance" || err === "not_covered");
        note("заказ #" + order.id + " не выдан", (m && m.offline ? "Оффлайн-игра: " : "") + human(err) + (refund ? ". Оформляю возврат." : ""));
        if (!refund) return;
        if (!refundOrder(order.id)) return note("возврат не прошёл", "Заказ #" + order.id + lastErr());
        if (m) sale("new", { gameId: m.gameId, game: m.game, lot: m.lotId }, m.hours, 0, order, true);
    }
    // Полный возврат денег: аренда этого заказа заканчивается сразу
    function endRefunded(orderId) {
        var changed = false;
        for (var k in RENT) RENT[k].forEach(function (r) {
            if (String(r.order) !== String(orderId) || r.ended || r.exp <= now()) return;
            var res = api("POST", "/rental/" + r.id + "/terminate", {});
            if (res.err) return note("возврат по заказу #" + orderId, "Аренду " + r.login + " завершить не удалось: " + human(res.err) + ". Завершите её во вкладке \"Аренды\".");
            r.exp = now(); r.ended = true; changed = true;
            note("аренда " + r.login + " завершена", "По заказу #" + orderId + " оформлен возврат.");
        });
        if (changed) saveRent();
    }

    // --- какой привязке соответствует заказ
    function isWordChar(c) { return !!c && /[a-zа-яё0-9_]/i.test(c); }
    function hasWord(text, word) {
        if (!word) return false;
        for (var at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
            if (!isWordChar(text.charAt(at - 1)) && !isWordChar(text.charAt(at + word.length))) return true;
        }
        return false;
    }
    function gameNames(name) {
        var a = norm(name), b = norm(ascii(name)), out = [];
        if (a) out.push(a);
        if (b && b !== a) out.push(b);
        return out;
    }
    function named(game, titleNorm) { return gameNames(game).some(function (x) { return hasWord(titleNorm, x); }); }
    // Срок из названия лота. Игру вырезаем ("7 Days to Die" не срок); сроков нет или несколько: 0
    function titleHours(title, game) {
        var rest = norm(title);
        gameNames(game).forEach(function (n) { rest = rest.split(n).join(" "); });
        var rx = /(^|[^\d.,\/])(\d+)\s*(час[а-яё]*|ч(?![а-яёa-z])|hours?(?![a-z])|hrs?(?![a-z])|h(?![a-z])|день|дня|дней|дн(?![а-яё])|д(?![а-яё])|сут[а-яё]*|days?(?![a-z])|d(?![a-z]))/g, m, found = {};
        while ((m = rx.exec(rest))) { found[int(m[2], 0) * (/^[чh]/.test(m[3]) ? 1 : 24)] = 1; }
        var keys = Object.keys(found);
        var hours = keys.length === 1 ? int(keys[0], 0) : 0;
        return hours >= MIN_HOURS && hours <= MAX_HOURS ? hours : 0;
    }
    var titlesAt = 0;
    function refreshTitles() {
        if (now() - titlesAt < 600 || MAPS.length + OFF.length > 40) return false;
        titlesAt = now();
        var changed = false;
        MAPS.concat(OFF).forEach(function (m) {
            var titles = lotTitles(m.lotId, true);
            if (titles.length && JSON.stringify(titles) !== JSON.stringify(m.titles || [])) { m.titles = titles; changed = true; }
        });
        if (changed) { saveMaps(); saveOff(); }
        return changed;
    }
    // ID привязки (rentM-1001) в описании оплаченного лота надёжнее названия: название могут изменить или повторить
    var orderTags = {};
    function tagsOf(order) {
        if (orderTags[order.id]) return orderTags[order.id];
        var tags = (String(order.text || "").match(TAG_RX) || []);
        if (!tags.length && MAPS.some(function (m) { return m.tag; })) {
            var r = funpayGet("orders/" + order.id + "/");
            if (r.code === 200) tags = r.body.match(TAG_RX) || [];
        }
        return (orderTags[order.id] = tags.map(function (x) { return x.toLowerCase(); }));
    }
    // Номер ID могут носить разные лоты (после переустановки нумерация шла заново). Лот другого срока или с названием другой игры не этот.
    function tagFits(m, order) {
        var hours = titleHours(order.title, m.game);
        if (hours && hours !== int(m.hours, 0)) return false;
        var title = norm(order.title);
        return named(m.game, title) || !MAPS.some(function (x) { return x.gameId !== m.gameId && String(x.subcat) === String(m.subcat) && named(x.game, title); });
    }
    function scoreIn(list, order, kindOf) {
        var desc = norm(order.title), scored = [], top = 0;
        list.forEach(function (m) {
            var n = 0;
            (m.titles || []).forEach(function (title) { var x = norm(title); if (x && desc.indexOf(x) >= 0 && x.length > n) n = x.length; });
            if (n) { scored.push([n, m]); if (n > top) top = n; }
        });
        var found = scored.filter(function (s) { return s[0] === top; }).map(function (s) { return s[1]; });
        var kinds = {};
        found.forEach(function (m) { kinds[kindOf(m)] = 1; });
        return { top: top, found: Object.keys(kinds).length === 1 ? found.slice(0, 1) : found };     // одинаковые названия у лотов одной игры и срока: выдать можно любым
    }
    function rentKind(m) { return m.gameId + ":" + m.hours + ":" + !!m.ext; }
    function matchOrder(order) {
        if (order.lotId) { var direct = mapByLot(order.lotId); if (direct) return [direct]; }
        var tags = tagsOf(order);
        if (tags.length) {
            var tagged = MAPS.filter(function (m) { return m.tag && tags.indexOf(String(m.tag).toLowerCase()) >= 0 && tagFits(m, order); })[0];
            if (tagged) return [tagged];
        }
        var res = scoreIn(MAPS, order, rentKind).found;
        if (!res.length && MAPS.length && refreshTitles()) res = scoreIn(MAPS, order, rentKind).found;
        return res;
    }
    function titleScore(m, order) {
        var desc = norm(order.title), n = 0;
        (m.titles || []).forEach(function (title) { var x = norm(title); if (x && desc.indexOf(x) >= 0 && x.length > n) n = x.length; });
        return n || 1e6;        // привязка нашлась по ID в описании: это точнее любого названия
    }
    function offScored(order) {
        if (!OFF.length) return { top: 0, found: [] };
        if (order.lotId) { var direct = offByLot(order.lotId); if (direct) return { top: 1e7, found: [direct] }; }
        var res = scoreIn(OFF, order, function (o) { return o.gameId; });
        if (!res.found.length && refreshTitles()) res = scoreIn(OFF, order, function (o) { return o.gameId; });
        return res;
    }
    function ambiguous(order, chatId, found) {
        sendTo(chatId, t("problem", langOf(chatId)));
        note("заказ #" + order.id + " подходит под несколько привязок", "Выдайте вручную и сделайте названия лотов разными: " + found.map(function (m) { return mapLabel(m) + " (лот " + m.lotId + ")"; }).join("; "));
    }

    // --- выдача
    function processRent(order, chatId, found) {
        if (found.length > 1) return ambiguous(order, chatId, found);
        var m = found[0];
        if (!String(S.key || "").trim()) return fail(order, chatId, "no_key", m);
        var qty = Math.max(1, order.amount), hours = int(m.hours, 1) * qty;
        log("заказ #" + order.id + ": " + mapLabel(m) + " × " + qty + ", покупатель " + order.buyerName);
        if (m.ext) {    // постоянный лот продления из прошлых версий плагина
            var mine = activeIn(chatId).filter(function (r) { return r.gameId === m.gameId; });
            if (mine.length) {
                var rec = mine[mine.length - 1], err = extend(rec, hours, chatId, order, "extended", "ext");
                if (!err) return;
                if (err !== "bad_request" && err !== "not_found") return fail(order, chatId, err, m);
                rec.exp = 0;
                saveRent();
            }
        }
        var res = newRental(m, order, chatId, hours);
        if (res.err) return fail(order, chatId, res.err, m);
        if (m.auto) refill(m, qty);
    }
    // Метка покупателя для MUVSell: ID на FunPay, без ника
    function buyerRef(order) { return order.buyerId ? "fp:" + order.buyerId : "fpn:" + hash(String(order.buyerName || "").toLowerCase()); }
    // Оффлайн-лот: покупаем игру навсегда на MUVSell (по штуке на единицу заказа) и присылаем данные
    function processOff(order, chatId, offs) {
        if (offs.length > 1) return ambiguous(order, chatId, offs);
        var o = offs[0], m = { gameId: o.gameId, game: o.game, lotId: o.lotId, hours: 0, offline: true };
        if (!String(S.key || "").trim()) return fail(order, chatId, "no_key", m);
        var qty = Math.max(1, order.amount), n = Math.min(qty, OFF_MAX_QTY), got = [], err = null, ref = buyerRef(order);
        log("заказ #" + order.id + ": оффлайн " + o.game + " × " + qty + ", покупатель " + order.buyerName);
        for (var i = 1; i <= n; i++) {
            var body = { gameId: o.gameId, buyerRef: ref, requestId: "fp-" + order.id + "-off-" + i, payWith: payWith(), onlyNew: i > 1 };
            if (S.offMode === "covered") body.cover = "only";
            var r = paid("/offline/buy", body);
            err = r.err;
            if (err === "forbidden" && /не оплачена/.test(lastApiError)) err = "not_covered";
            var p = (r.data || {}).purchase || {};
            if (!err && !p.login) err = "no_account";
            if (err) break;
            got.push(p);
        }
        if (!got.length) return fail(order, chatId, err, m);
        var lang = langOf(chatId), list = (OBUY[chatId] = OBUY[chatId] || []);
        got.forEach(function (p) {
            if (!list.some(function (x) { return x.id === p.id; })) list.push({ id: p.id, number: p.number, gameId: o.gameId, game: o.game, login: p.login, guard: !!p.guard, order: order.id, chat: chatId, lot: o.lotId, ts: now() });
        });
        if (list.length > 200) OBUY[chatId] = list.slice(list.length - 200);
        save("offbuys", OBUY);
        sale("offline", { gameId: o.gameId, game: o.game, lot: o.lotId, id: got[0].id, buyer: order.buyerName }, 0, got.reduce(function (a, p) { return a + num(p.priceRub); }, 0), order);
        var tail = lang === "ru" && S.enMsgs ? "\n\n🇬🇧 English? Type !help" : "";
        got.forEach(function (p) {
            if (!sendTo(chatId, t("off_delivery", lang, { game: o.game, login: p.login, password: p.password || "" }) + tail)) {
                note("покупателю не ушли данные оффлайн-игры", "Заказ #" + order.id + ", " + order.buyerName + ". Отправьте вручную: логин " + p.login + ", пароль " + (p.password || ""));
            }
            tail = "";
        });
        if (err) note("заказ #" + order.id + " на " + qty + " шт.", "Выдано " + got.length + ", дальше не вышло: " + human(err) + ". Остальное выдайте вручную или оформите частичный возврат.");
        else if (qty > n) note("заказ #" + order.id + " на " + qty + " шт.", "За один заказ выдаю не больше " + n + " аккаунтов. Остальное вручную или частичный возврат.");
        if (S.notifySales) note("оффлайн: " + o.game + " навсегда", "Покупатель " + order.buyerName + ", заказ #" + order.id + " (" + got.map(function (p) { return p.login; }).join(", ") + ")");
    }
    // Чей это заказ: лот продления, оффлайн-лот или аренда. null: не наш лот.
    function route(order) {
        var ext = extFor(order);
        if (ext) return { kind: "ext", tag: ext };
        var off = offScored(order), found = matchOrder(order);
        if (off.found.length) {         // название подходит и к аренде: побеждает более точное совпадение
            var score = found.length ? titleScore(found[0], order) : 0;
            if (off.top > score) return { kind: "off", offs: off.found };
            if (off.top === score) return { kind: "amb", found: found.concat(off.found) };
        }
        return found.length ? { kind: "rent", found: found } : null;
    }
    function isRefunded(order) { return /возврат|refund/i.test(String(order.status || "")); }
    // Пока заказ выдаётся, он лежит в журнале ISSUE: приложение закрылось посреди выдачи, и при запуске она продолжится.
    // Повтор безопасен: аренду, продление и оффлайн-покупку MUVSell узнаёт по requestId заказа и второй раз не списывает.
    function deliver(order, chatId, way) {
        ISSUE[order.id] = { at: (ISSUE[order.id] || {}).at || now(), chat: chatId };
        save("issuing", ISSUE);
        try {
            if (way.kind === "ext") payExt(order, chatId, way.tag);
            else if (way.kind === "off") processOff(order, chatId, way.offs);
            else if (way.kind === "amb") ambiguous(order, chatId, way.found);
            else processRent(order, chatId, way.found);
        } catch (ex) {
            log("ошибка при обработке заказа #" + order.id + ": " + ex);
            sendTo(chatId, t("problem", langOf(chatId)));
            note("ошибка в заказе #" + order.id, String(ex).slice(0, 200));
        }
        delete ISSUE[order.id];
        save("issuing", ISSUE);
    }
    var recheckAt = 0;
    onOrder(function (e) {
        if (!e || e.iAmBuyer || !e.orderId) return;
        recheckAt = 0;                  // после заказа снятые лоты мог включить кто-то другой: сверим
        if (!S.enabled || (!MAPS.length && !OFF.length && !Object.keys(EXT).length)) return;
        var o = orderInfo(e.orderId, e.text);
        if (!o) o = { id: String(e.orderId), title: String(e.text || ""), text: String(e.text || ""), amount: 1, price: 0, buyerName: e.buyerName || "", buyerId: "", lotId: "", chatId: "", status: "" };
        if (o.iAmBuyer) return;
        if (!o.buyerName) o.buyerName = e.buyerName || "";
        var chatId = String(e.chatId || o.chatId || "");
        var way = route(o);
        if (!way) return;               // не наш лот: обычный заказ FunPay
        if (seenOrder(o.id)) return;
        if (isRefunded(o)) return log("заказ #" + o.id + ": уже возврат, не выдаю");
        deliver(o, chatId, way);
    });
    // Заказы, выдача которых оборвалась (приложение закрыли или оно упало посреди выдачи)
    function resumeIssues() {
        Object.keys(ISSUE).forEach(function (id) {
            var entry = ISSUE[id] || {}, o = orderInfo(id);
            delete ISSUE[id];
            save("issuing", ISSUE);
            if (!o) return note("выдача заказа #" + id + " оборвалась", "Заказ не открылся. Проверьте чат: получил ли покупатель аккаунт.");
            var chatId = String(entry.chat || o.chatId || "");
            if (isRefunded(o)) return endRefunded(id);
            var age = now() - num(entry.at), way = S.enabled ? route(o) : null;
            if (!way || age > 6 * 3600) return note("выдача заказа #" + id + " оборвалась", "Продолжать не стал" + (way ? ": прошло больше 6 часов" : "") + ". Проверьте чат заказа: получил ли покупатель аккаунт.");
            note("выдача заказа #" + id + " оборвалась", "Продолжаю: второй раз MUVSell не спишет, покупатель получит то, что уже оплачено.");
            LATE[o.id] = 1;
            deliver(o, chatId, way);
            delete LATE[o.id];
        });
    }

    // Заказы, оплаченные, пока программа была закрыта. Есть только на компьютере: там плагин видит список продаж.
    // Не старше 6 часов: выдаём. Старше (до двух суток): напоминаем один раз, выдавать задним числом не стали, его могли обслужить вручную.
    var MISSED_SEC = 6 * 3600;
    function canListSales() { return DESKTOP && fpt.orders && typeof fpt.orders.getSales === "function"; }
    function checkMissed() {
        if (!canListSales() || !S.enabled || (!MAPS.length && !OFF.length && !Object.keys(EXT).length)) return;
        var list = null;
        try { list = fpt.orders.getSales({ state: "paid", pages: 1 }); } catch (e) { list = null; }
        if (!Array.isArray(list)) return;
        var done = load("done_orders", []), checked = 0;
        list.forEach(function (it) {
            var id = String(it.orderId || it.id || "").replace(/^#/, "");
            if (!id || it.status !== "paid" || done.indexOf(id) >= 0 || ISSUE[id] || lookedOrders[id]) return;
            var age = it.ageSec === null || it.ageSec === undefined ? null : num(it.ageSec);
            if (age !== null && age > 2 * 86400) return;            // старый заказ: не наш случай
            if (checked >= 30) return;
            checked++;
            var o = orderInfo(id, "");
            if (!o || o.iAmBuyer || isRefunded(o)) return;
            if (!o.buyerName) o.buyerName = String(it.buyerName || "");
            var way = route(o);
            if (!way) return;                                        // не наш лот
            lookedOrders[id] = 1;
            seenOrder(id);
            var chatId = String(o.chatId || "");
            if (age !== null && age <= MISSED_SEC && chatId) {
                note("заказ #" + id + " оплачен, пока программа была закрыта", "Выдаю.");
                LATE[id] = 1;
                deliver(o, chatId, way);
                delete LATE[id];
            } else {
                note("заказ #" + id + " оплачен, пока программа была закрыта", (o.buyerName || "") + (age !== null ? ", " + leftText(age) + " назад" : "") + ". Выдавать задним числом не стал: проверьте чат, выдайте вручную или оформите возврат.");
            }
        });
    }

    // --- команды покупателя
    function setLang(chatId, cmd) {
        var lang = /^!?[a-z]+$/.test(cmd) ? "en" : "ru";
        if ((LANG[chatId] || "ru") === lang) return;
        if (lang === "en") LANG[chatId] = "en"; else delete LANG[chatId];
        save("langs", LANG);
    }
    function enCode() { return codeWord() === "!код" ? "!code" : codeWord(); }
    function pickRec(chatId, arg, cmd) {
        var rs = activeIn(chatId).filter(function (r) { return !arg || r.login.toLowerCase() === arg.toLowerCase(); }), lang = langOf(chatId);
        if (!rs.length) { sendTo(chatId, t("no_rental", lang)); return null; }
        if (rs.length > 1) {
            if (lang === "en") cmd = { "!код": "!code", "!кик": "!kick", "!пароль": "!password" }[cmd] || (/ 3$/.test(cmd) ? "!extend 3" : cmd);
            sendTo(chatId, t("code_which", lang, { cmd: cmd, logins: rs.map(function (r) { return "• " + r.login; }).join("\n") }));
            return null;
        }
        return rs[0];
    }
    function guard(rec) {
        var codes = (api("GET", "/rental/" + rec.id + "/code").data || {}).codes || [];
        for (var i = 0; i < codes.length; i++) if (String(codes[i].login || "").toLowerCase() === rec.login.toLowerCase()) return codes[i];
        return null;
    }
    // Оффлайн-покупки покупателя (по логину, если указан); один и тот же логин один раз, новые первыми
    function offsOf(chatId, arg) {
        var seen = {}, out = [], list = OBUY[chatId] || [];
        for (var i = list.length - 1; i >= 0; i--) {
            var key = String(list[i].login).toLowerCase();
            if (seen[key] || (arg && key !== arg.toLowerCase())) continue;
            seen[key] = 1;
            out.push(list[i]);
        }
        return out;
    }
    function ttlOf(c) { return c.expiresIn === undefined || c.expiresIn === null ? 30 : int(c.expiresIn, 30); }
    function offCode(chatId, p, again) {
        var lang = langOf(chatId), r = api("GET", "/offline/purchases/" + p.id + "/code"), d = r.data;
        if (d && d.code && ttlOf(d) < 5 && !again) return setTimeout(function () { offCode(chatId, p, true); }, (ttlOf(d) + 1) * 1000);     // код вот-вот сменится: ждём свежий
        if (d && d.code) return sendTo(chatId, t("code", lang, { login: p.login, code: d.code, ttl: ttlOf(d) }));
        if (r.err === "wait") return sendTo(chatId, t("off_code_limit", lang, { login: p.login, reason: lastApiError }));
        if (r.err === "no_stock" && /нет Steam Guard/.test(lastApiError)) return sendTo(chatId, t("off_no_guard", lang, { login: p.login }));
        sendTo(chatId, t("code_fail", lang));
        note("код Steam Guard оффлайн-игры не получен", p.login + ": " + human(r.err || "no_key"));
    }
    function cmdCode(chatId, arg, again) {
        var offs = offsOf(chatId, arg), lang = langOf(chatId);
        if (offs.length) {      // оффлайн-игра: по логину, или единственный аккаунт покупателя вместе с арендами
            var rs = activeIn(chatId).filter(function (r) { return !arg || r.login.toLowerCase() === arg.toLowerCase(); });
            if (offs.length + rs.length > 1) return sendTo(chatId, t("code_which", lang, { cmd: lang === "en" ? enCode() : codeWord(), logins: rs.concat(offs).map(function (x) { return "• " + x.login; }).join("\n") }));
            if (!rs.length) return offCode(chatId, offs[0]);
        }
        var rec = pickRec(chatId, arg, codeWord());
        if (!rec) return;
        var code = guard(rec);
        if (code && ttlOf(code) < 5 && !again) return setTimeout(function () { cmdCode(chatId, arg, true); }, (ttlOf(code) + 1) * 1000);
        if (!code) {
            sendTo(chatId, t("code_fail", lang));
            return note("код Steam Guard не получен", rec.login + ": " + (lastApiError || "у аккаунта нет maFile"));
        }
        sendTo(chatId, t("code", lang, { login: rec.login, code: code.code, ttl: ttlOf(code) }));
    }
    function cmdOffline(chatId, arg) {
        var lang = langOf(chatId), offs = offsOf(chatId, arg);
        if (!offs.length) return sendTo(chatId, t("off_none", lang));
        offs.slice(0, 5).forEach(function (p) {
            var pw = (((api("GET", "/offline/purchases/" + p.id).data || {}).purchase) || {}).password;
            sendTo(chatId, t("off_creds", lang, { game: p.game, login: p.login, password: pw || (lang === "en" ? "ask the seller" : "напишите продавцу") }));
        });
    }
    function cmdTime(chatId) {
        var rs = activeIn(chatId), lang = langOf(chatId);
        if (!rs.length) return sendTo(chatId, t("no_rental", lang));
        sendTo(chatId, rs.map(function (x) { return t("time_left", lang, { game: x.game, login: x.login, left: leftText(x.exp - now(), lang), expires: whenTz(x.exp, lang) }); }).join("\n"));
    }
    function cmdCreds(chatId, arg) {
        var lang = langOf(chatId), list = activeIn(chatId).filter(function (x) { return !arg || x.login.toLowerCase() === arg.toLowerCase(); });
        if (!list.length && offsOf(chatId, arg).length) return cmdOffline(chatId, arg);
        if (!list.length) return sendTo(chatId, t("no_rental", lang));
        list.forEach(function (x) {
            var a = accOf(api("GET", "/rental/" + x.id).data, x.login);
            sendTo(chatId, t("creds", lang, { game: x.game, login: x.login, password: (a && a.password) || (lang === "en" ? "ask the seller" : "напишите продавцу"), expires: whenTz(x.exp, lang) }));
        });
    }
    function commandsText(lang, chatId) {
        var off = !!(chatId && OBUY[chatId] && OBUY[chatId].length), lines;
        if (lang === "en") {
            lines = ["• " + enCode() + ": Steam Guard code", "• !time: time left", "• !data: login and password again"];
            if (off) lines.push("• !offline: your lifetime (offline) games again");
            if (S.extCmd) lines.push("• !extend 3: extend this account by 3 h (or !extend 2d by 2 days)");
            if (S.buyerCmds) lines.push("• !kick: kick everyone else out of the account", "• !password: change the password");
            return lines.join("\n");
        }
        var word = extWord();
        lines = ["• " + codeWord() + ": код Steam Guard", "• !время: сколько осталось", "• !данные: логин и пароль ещё раз"];
        if (off) lines.push("• !офлайн: данные оффлайн-игр (навсегда) ещё раз");
        if (S.extCmd) lines.push("• " + word + " 3: продлить этот аккаунт на 3 ч (или " + word + " 2д на 2 дня)");
        if (S.buyerCmds) lines.push("• !кик: выкинуть всех чужих из аккаунта", "• !пароль: сменить пароль");
        return lines.join("\n");
    }
    function cmdHelp(chatId) { var lang = langOf(chatId); sendTo(chatId, t("help", lang, { commands: commandsText(lang, chatId) })); }
    function cmdKick(chatId, arg) {
        var rec = pickRec(chatId, arg, "!кик");
        if (!rec) return;
        var r = api("POST", "/rental/" + rec.id + "/full-logout", {}), lang = langOf(chatId);
        if (r.err) return sendTo(chatId, t("kick_fail", lang, { login: rec.login, reason: lastApiError || human(r.err) }));
        sendTo(chatId, t("kick_ok", lang, { login: rec.login, game: rec.game }));
    }
    var passWait = [];   // смены пароля, которые ждут новый пароль: {rid, chat, old, tries}
    function changePassword(rec, chatId) {
        var lang = langOf(rec.chat || chatId), old = accOf(api("GET", "/rental/" + rec.id).data, rec.login);
        var r = api("POST", "/rental/" + rec.id + "/change-password", {});
        if (r.err) { var reason = lastApiError || human(r.err); sendTo(chatId, t("pass_fail", lang, { login: rec.login, reason: reason })); return reason; }
        sendTo(chatId, t("pass_wait", lang, { login: rec.login }));
        passWait.push({ rid: rec.id, chat: chatId, old: old ? old.password : "", tries: 0 });
        return "";
    }
    function cmdPassword(chatId, arg) { var rec = pickRec(chatId, arg, "!пароль"); if (rec) changePassword(rec, chatId); }
    // !продление [срок] [логин]: создаёт временный лот на этот срок, оплата продлевает ту же аренду
    function cmdExt(chatId, arg) {
        var word = extWord(), words = arg ? arg.split(/\s+/) : [], logins = {};
        activeIn(chatId).forEach(function (r) { logins[r.login.toLowerCase()] = 1; });       // "!продление на 3 часа": "часа" не логин
        var login = words.filter(function (w) { return logins[w.toLowerCase()]; })[0] || "";
        var span = words.filter(function (w) { return w !== login; }).join(" ");
        var rec = pickRec(chatId, login, word + " 3");
        if (!rec) return;
        var m = mapByLot(rec.lot) || MAPS.filter(function (x) { return x.gameId === rec.gameId && !x.ext; })[0] || null;
        var hours = /\d/.test(span) ? parseHours(span) : int((m || {}).hours, 0);
        if (!hours) return sendTo(chatId, t("ext_usage", langOf(chatId), { word: word }));
        var same = Object.keys(EXT).map(function (k) { return EXT[k]; }).filter(function (x) { return x.rid === rec.id && int(x.hours, 0) === hours && !x.gone && x.until > now() + 60; })[0];
        if (same) return sendTo(chatId, extReady(rec, same));     // лот на этот срок уже ждёт оплату: повторяем ссылку
        makeExtLot(chatId, rec, m, hours);
    }
    var COMMANDS = [    // [синонимы, обработчик, включена ли]
        [["!код", "!code", "!гуард", "!guard", "!кодстим", "!sg"], cmdCode, function () { return codeWord() === "!код"; }],
        [["!время", "!срок", "!time"], cmdTime, function () { return true; }],
        [["!данные", "!логин", "!data", "!acc"], cmdCreds, function () { return true; }],
        [["!помощь", "!команды", "!help", "!commands"], cmdHelp, function () { return true; }],
        [["!офлайн", "!оффлайн", "!offline"], cmdOffline, function () { return true; }],
        [["!extend"], cmdExt, function () { return S.extCmd; }],
        [["!продлить", "!продли"], cmdExt, function () { return S.extCmd && extWord() === "!продление"; }],
        [["!кик", "!kick", "!выкинуть"], cmdKick, function () { return S.buyerCmds; }],
        [["!пароль", "!password", "!pass"], cmdPassword, function () { return S.buyerCmds; }],
    ];
    function isCmd(text) { var s = String(text || "").trim().toLowerCase(); return s.charAt(0) === "!" || s.split(/\s+/)[0] === codeWord(); }
    function onCommand(chatId, text) {
        if (!RENT[chatId] && !OBUY[chatId]) return;     // этому покупателю плагин ничего не выдавал: молчим, на !код может отвечать другой плагин
        var sp = text.trim().split(/\s+/), cmd = sp[0].toLowerCase(), arg = sp.slice(1).join(" ").trim(), handler = null;
        if (cmd === codeWord()) handler = cmdCode;
        else if (S.extCmd && cmd === extWord().toLowerCase()) handler = cmdExt;
        else COMMANDS.forEach(function (c) { if (!handler && c[0].indexOf(cmd) >= 0 && c[2]()) handler = c[1]; });
        if (!handler) return;
        setLang(chatId, cmd);       // английская команда: дальше отвечаем по-английски, русская: по-русски
        handler(chatId, arg);
    }
    function onReview(text) {
        var m = /#([A-Z0-9]{6,12})/.exec(text);
        var rec = m && recByOrder(m[1]);
        if (!rec || rec.bonus || rec.exp <= now() || !bonusOn(mapByLot(rec.lot))) return;
        var orderId = m[1];
        setTimeout(function () {                 // FunPay сохраняет отзыв не мгновенно
            if (rec.bonus || rec.exp <= now()) return;
            var stars = reviewStars(orderId);
            if (!stars || stars < int(S.bonusStars, 5)) return;
            rec.bonus = true;                    // отмечаем до продления: изменение отзыва не даст второй бонус
            saveRent();
            var hours = int(S.bonusHours, 2);
            var err = extend(rec, hours, rec.chat, orderId, "review_bonus", "bonus");
            if (err) return note("бонус за отзыв не начислен", human(err));
            note("бонус за отзыв", rec.login + " +" + hours + " ч за отзыв " + stars + "★");
        }, 4000);
    }
    fpt.on("onNewMessage", function (raw) {
        var m = msgInfo(raw);
        if (!S.enabled || !m.chatId) return;
        if (m.system) {
            if (/написал отзыв к заказу|изменил отзыв к заказу|has given feedback|has edited their feedback|написав відгук/i.test(m.text)) onReview(m.text);
            if (/вернул деньги покупателю|has refunded|повернув гроші/i.test(m.text)) {
                var id = (/#([A-Z0-9]{6,12})/.exec(m.text) || [])[1], hit = false;
                SALES.forEach(function (s) { if (id && s.order === id && !s.refunded) { s.refunded = true; hit = true; } });
                if (hit) save("sales", SALES);
                if (id) { try { endRefunded(id); } catch (e0) { log("завершение аренды по возврату: " + e0); } }
            }
            return;
        }
        if (m.mine || !isCmd(m.text)) return;
        try { onCommand(m.chatId, m.text); } catch (e) { log("ошибка команды: " + e); }
    });
    // --- лоты FunPay: создание, правка и удаление через форму сайта (одинаково на Android и на компьютере)
    var RATE_RX = /много предложений|too many offers|слишком часто/i;   // только отказ "лимит на создание": голое "подождите" бывает и в других ошибках
    var EN_MIN = 140;        // короче FunPay английское описание не принимает
    var LOGGED_OUT = "FunPay не пускает в аккаунт: вход больше не действует";
    var LOGIN_HELP = "Обычно так бывает после выхода из аккаунта или смены пароля. Пока вход не восстановлен, плагин не может снимать лоты с продажи, а новые заказы могут остаться без выдачи. Войдите в аккаунт FunPay в приложении заново.";
    function ascii(s) { return String(s || "").replace(/[^\x20-\x7E\n]/g, "").replace(/[ \t]+/g, " ").trim(); }
    function durEn(hours) {
        if (hours % 24 === 0) { var d = hours / 24; return d + (d > 1 ? " days" : " day"); }
        return hours + (hours > 1 ? " hours" : " hour");
    }
    function unent(s) {
        return String(s || "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    }
    function tagAttr(tag, name) {
        var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"').exec(tag) || new RegExp("(?:^|\\s)" + name + "\\s*=\\s*'([^']*)'").exec(tag);
        return m ? unent(m[1]) : null;
    }
    function hasFlag(tag, name) { return new RegExp('(?:^|\\s)' + name + '(?:\\s|=|$)').test(tag); }
    // Форма лота: query это "node=123" для нового лота или "offer=456" для существующего
    function lotForm(query) {
        var r = funpayGet("lots/offerEdit?" + query);
        if (r.code !== 200) return { err: r.code ? "FunPay ответил " + r.code : "нет связи с FunPay" };
        var at = r.body.search(/<form\b[^>]*form-offer-editor/);
        if (at < 0) {
            if (/<form\b[^>]*account\/login|name="login"[^>]*>|class="[^"]*\bpage-login\b/.test(r.body)) return { err: LOGGED_OUT, lost: true };
            var pc = r.body.indexOf("page-content"), hint = unent(r.body.slice(pc < 0 ? 0 : pc, (pc < 0 ? 0 : pc) + 1500).replace(/^[^>]*>/, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 100);
            if (RATE_RX.test(hint)) return { err: hint, rate: true };      // "Много предложений, подождите": лимит FunPay на создание
            return { err: "FunPay не отдал форму лота" + (pc >= 0 && hint ? ": " + hint : "") };
        }
        var end = r.body.indexOf("</form>", at);
        var html = r.body.slice(at, end < 0 ? r.body.length : end);
        var fields = {}, selects = {}, m;
        var ix = /<input\b([^>]*)>/g;
        while ((m = ix.exec(html))) {
            var name = tagAttr(m[1], "name"), type = (tagAttr(m[1], "type") || "text").toLowerCase();
            if (!name || name === "query") continue;
            if (type === "checkbox") { if (hasFlag(m[1], "checked")) fields[name] = "on"; continue; }
            if (type === "radio" && !hasFlag(m[1], "checked")) continue;
            fields[name] = tagAttr(m[1], "value") || "";
        }
        var tx = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g;
        while ((m = tx.exec(html))) { var tn = tagAttr(m[1], "name"); if (tn) fields[tn] = unent(m[2]).replace(/^\n/, ""); }
        var sx = /<select\b([^>]*)>([\s\S]*?)<\/select>/g;
        while ((m = sx.exec(html))) {
            var sn = tagAttr(m[1], "name");
            if (!sn) continue;
            var g = html.lastIndexOf("form-group", m.index), cls = "";
            if (g >= 0) { var q0 = html.lastIndexOf('"', g), q1 = html.indexOf('"', g); cls = html.slice(q0 + 1, q1); }
            if (/\bhidden\b/.test(cls) && !/\blot-field\b/.test(cls)) continue;    // скрытые служебные списки не трогаем
            var opts = [], chosen = "", ox = /<option\b([^>]*)>([\s\S]*?)<\/option>/g, o;
            while ((o = ox.exec(m[2]))) {
                var v = tagAttr(o[1], "value") || "";
                opts.push([v, unent(o[2].replace(/<[^>]*>/g, "")).trim()]);
                if (hasFlag(o[1], "selected")) chosen = v;
            }
            selects[sn] = opts;
            fields[sn] = chosen;
        }
        return { fields: fields, selects: selects };
    }
    function fpPost(path, fields) {
        var r;
        if (DESKTOP) r = fpt.funpay.request("POST", path, fields) || {};
        else r = http("POST", "https://funpay.com/" + path, form(fields), { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" });
        var j = r.json;
        if (j === undefined || j === null) { try { j = JSON.parse(r.body); } catch (e) { j = null; } }
        if (!j || typeof j !== "object") return { ok: false, error: r.code ? "FunPay ответил " + r.code : "нет связи с FunPay", errors: {} };
        var errors = {};
        if (Array.isArray(j.errors)) j.errors.forEach(function (x) { if (Array.isArray(x)) errors[x[0]] = x[1]; });
        else if (j.errors && typeof j.errors === "object") errors = j.errors;
        var names = Object.keys(errors);
        if (j.error || names.length) return { ok: false, error: String(j.error || names.map(function (n) { return n + ": " + errors[n]; }).join("; ")).slice(0, 200), errors: errors };
        return { ok: true, errors: {} };
    }
    function myLotsIn(sub) {
        var r = funpayGet("lots/" + sub + "/trade");
        if (r.code !== 200) return null;
        var out = [], rx = /<a\b([^>]*\bclass="[^"]*\btc-item\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g, m;
        while ((m = rx.exec(r.body))) {
            var id = tagAttr(m[1], "data-offer") || (/(?:offer|id)=(\d+)/.exec(tagAttr(m[1], "href") || "") || [])[1];
            var d = /class="[^"]*\btc-desc-text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(m[2]);
            if (id) out.push({ id: String(id), desc: d ? unent(d[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "", active: !/\bwarning\b/.test(tagAttr(m[1], "class") || "") });
        }
        return out;
    }
    var PREFER = ["аренд", "rent", "steam", "pc", "пк", "windows", "стандарт", "standard", "друг", "любая", "other"];
    var AVOID = ["android", "ios", "mobile", "(ps)", "ps4", "ps5", "playstation", "xbox", "switch", "nintendo", "epic", "origin"];
    // Что выбрать в выпадающем списке формы: игру по названию, иначе аренду/Steam/PC, иначе первый не мобильный вариант
    function pickOption(opts, game) {
        var list = opts.filter(function (o) { return o[0]; }).map(function (o) { return [o[0], o[1].toLowerCase()]; });
        var g = norm(game), best = null;
        function avoided(t) { return AVOID.some(function (a) { return t.indexOf(a) >= 0; }); }
        list.forEach(function (o) {
            var core = o[1].replace(/^\([^)]*\)\s*/, "");
            if (g && (core === g || (core.length > 3 && g.indexOf(core) >= 0))) {
                var score = [avoided(o[1]) ? 1 : 0, -core.length];
                if (!best || score[0] < best[0][0] || (score[0] === best[0][0] && score[1] < best[0][1])) best = [score, o[0]];
            }
        });
        if (best) return best[1];
        for (var i = 0; i < PREFER.length; i++) for (var j = 0; j < list.length; j++) if (list[j][1].indexOf(PREFER[i]) >= 0) return list[j][0];
        for (var k = 0; k < list.length; k++) if (!avoided(list[k][1])) return list[k][0];
        return list.length ? list[0][0] : "";
    }
    // Создаёт лот. → {id} или {err, rate}
    function createLot(sub, mapFields, game, texts, price, active, amount) {
        var before = myLotsIn(sub);
        if (!before) return { err: "раздел " + sub + " не открылся" };
        var f = lotForm("node=" + sub);
        if (f.err) return { err: f.err, rate: f.rate, lost: f.lost };
        var fields = f.fields, selects = f.selects, name;
        for (name in (mapFields || {})) if (mapFields[name]) fields[name] = String(mapFields[name]);
        var region = norm(S.steamRegion), want = Number(sub) === STEAM_SUB ? ["аренда", region] : [];    // Steam: тип и регион выбираем по подписи варианта
        if (want.length) {
            var hasRegion = false, regions = [];
            for (name in selects) {
                var isType = selects[name].some(function (o) { return norm(o[1]) === "аренда"; });
                selects[name].forEach(function (o) { if (norm(o[1]) === region) hasRegion = true; if (!isType && o[0]) regions.push(o[1]); });
            }
            if (!hasRegion) return { err: "в форме FunPay нет региона \"" + S.steamRegion + "\", есть: " + (regions.slice(0, 15).join(", ") || "нет вариантов") };
        }
        for (name in selects) {
            var wanted = selects[name].filter(function (o) { return o[0] && want.indexOf(norm(o[1])) >= 0; })[0];
            if (wanted) { fields[name] = wanted[0]; continue; }
            var valid = selects[name].some(function (o) { return o[0] && o[0] === fields[name]; });
            var byText = selects[name].filter(function (o) { return o[0] && norm(o[1]) === norm(fields[name]); })[0];   // в карте значение может быть подписью варианта
            if (!valid) fields[name] = byText ? byText[0] : pickOption(selects[name], game);
        }
        fields.offer_id = "0";
        fields.node_id = String(sub);
        fields["fields[summary][ru]"] = texts[0];
        fields["fields[summary][en]"] = texts[1];
        fields["fields[desc][ru]"] = texts[2];
        fields["fields[desc][en]"] = texts[3];
        fields.price = String(price);
        fields.amount = String(amount);
        if (active) fields.active = "on"; else delete fields.active;
        delete fields.auto_delivery;        // автовыдача FunPay выключена: выдаёт плагин
        delete fields.secrets;
        delete fields.deleted;
        var saved = false, reason = "";
        for (var attempt = 0; attempt < 4 && !saved; attempt++) {
            var res = fpPost("lots/offerSave", fields);
            if (res.ok) { saved = true; break; }
            reason = res.error;
            if (RATE_RX.test(reason)) return { err: reason, rate: true };
            var changed = false;
            for (name in res.errors) {      // FunPay назвал незаполненные поля: дозаполняем
                if (!fields[name]) { fields[name] = selects[name] ? pickOption(selects[name], game) : "1"; changed = true; }
            }
            if (!changed) return { err: reason || "FunPay не принял лот" };
        }
        if (!saved) return { err: reason || "FunPay не принял лот" };
        var had = {};
        before.forEach(function (l) { had[l.id] = 1; });
        for (var i = 0; i < 4; i++) {       // новый лот появляется в списке не мгновенно
            var after = myLotsIn(sub) || [];
            var fresh = after.filter(function (l) { return !had[l.id]; });
            var hit = fresh.filter(function (l) { return norm(l.desc).indexOf(norm(texts[0])) === 0; })[0] || (fresh.length === 1 ? fresh[0] : null);
            if (hit) return { id: hit.id };
        }
        return { err: "лот создан, но FunPay его пока не показывает, привяжите его вручную" };
    }
    function editLot(lotId, patch) {
        var f = lotForm("offer=" + lotId);
        if (f.err) return f.err;
        for (var k in patch) f.fields[k] = patch[k];
        delete f.fields.deleted;
        var res = fpPost("lots/offerSave", f.fields);
        if (res.ok) return "";
        if (/коротк|short/i.test(String(res.errors["fields[desc][en]"] || ""))) return EN_SHORT_HINT;
        return res.error || "FunPay не принял лот";
    }
    function deleteLot(lotId) {
        var ok = false;
        try { ok = fpt.lots.delete(String(lotId)) !== false; } catch (e) {}
        return ok;
    }

    // --- карта "игра MUVSell → раздел FunPay" с muvsell.store
    var MAP_URL = SITE + "/downloads/muvsell_funpay_map.json";
    var fpMapCache = [0, null];
    function fpMap(force) {
        if (force || !fpMapCache[1] || now() - fpMapCache[0] > 3600) {
            var r = siteGet(MAP_URL);
            if (r.code === 200 && r.json && Array.isArray(r.json.games) && r.json.games.length) {
                fpMapCache = [now(), r.json];
                save("fpmap", r.json);
            } else {
                log("карта игр не скачалась: " + (r.code || r.error || "нет связи"));
                if (!fpMapCache[1]) fpMapCache = [now() - 3000, load("fpmap", null)];
            }
        }
        return fpMapCache[1] || { games: [] };
    }
    function fpGame(gameId) {
        var games = fpMap().games || [];
        for (var i = 0; i < games.length; i++) if (games[i].game_id === gameId) return games[i];
        return null;
    }

    // --- изменения лотов через карантин: лот на паузе не трогаем, ошибка FunPay ставит его на паузу
    var PROBLEMS = load("problems", {});    // лот → {n, err, until, missing, game}
    var MISSING_RX = /не найден|not found|\b404\b/i;
    var Q_PAUSE = 30, Q_CAP = 720, Q_UNBIND_AFTER = 3;      // пауза после ошибки (мин, удваивается), её потолок, после скольких "не найден" привязка удаляется
    var MANUAL_NAMES = {};
    MANUAL_NAMES[STEAM_SUB] = MANUAL.steam[1];
    MANUAL_NAMES[OTHER_SUB] = MANUAL.other[1];
    var lostNoteAt = 0;
    function loginLost() {
        if (job) { job.lost = true; return; }
        if (now() - lostNoteAt < 6 * 3600) return;
        lostNoteAt = now();
        note(LOGGED_OUT, LOGIN_HELP);
    }
    var qbuf = [];
    function qNote(text) { qbuf.push(text); }
    function flushQ() {
        if (!qbuf.length) return;
        var items = qbuf;
        qbuf = [];
        note("проблемные лоты", items.slice(0, 20).join("; ") + (items.length > 20 ? " и ещё " + (items.length - 20) : "") +
            (items.some(function (x) { return /не найден|пропал/.test(x); }) ? ". Лот удалили на FunPay? \"Автовыставление\" → \"Создать недостающие\" создаст его заново." : ""));
    }
    function lotGone(lotId) { var p = PROBLEMS[String(lotId)]; return !!(p && p.missing); }
    function unbind(m) {
        MAPS = MAPS.filter(function (x) { return x !== m; });
        OFF = OFF.filter(function (x) { return x !== m; });
        delete PROBLEMS[String(m.lotId)];
        delete HIDDEN[String(m.lotId)];
        saveMaps(); saveOff(); save("problems", PROBLEMS); save("hidden", HIDDEN);
    }
    // Лот пропал: ищем среди ваших лотов раздела такой же по названию и перепривязываем
    function replaceLot(m) {
        var lots = m.subcat ? myLotsIn(m.subcat) : null;
        if (!lots) return false;
        var titles = (m.titles || []).map(norm).filter(Boolean), taken = adoptKnown();
        var fresh = lots.filter(function (l) { var d = norm(l.desc); return !taken[l.id] && titles.some(function (x) { return d === x || d.indexOf(x + ",") === 0; }); })[0];
        if (!fresh) return false;
        var old = String(m.lotId);
        m.lotId = String(fresh.id);
        m.tagged = false;               // у нового лота ID в описании ещё нет
        delete PROBLEMS[old];
        if (HIDDEN[old]) { HIDDEN[m.lotId] = HIDDEN[old]; delete HIDDEN[old]; }
        saveMaps(); saveOff(); save("problems", PROBLEMS); save("hidden", HIDDEN);
        qNote(old + " " + mapLabel(m) + ": пропал, привязка перенесена на такой же лот " + fresh.id);
        return true;
    }
    function lotFailed(m, err) {
        var lid = String(m.lotId), missing = MISSING_RX.test(err);
        var p = PROBLEMS[lid] = PROBLEMS[lid] || { n: 0, game: mapLabel(m) };
        p.n++; p.err = String(err).slice(0, 200); p.missing = missing; p.at = now();
        p.until = now() + Math.min(Q_PAUSE * Math.pow(2, p.n - 1), Q_CAP) * 60;
        save("problems", PROBLEMS);
        if (missing && replaceLot(m)) return;
        if (missing && p.n >= Q_UNBIND_AFTER) { unbind(m); return qNote(lid + " " + mapLabel(m) + ": пропал с FunPay, привязка удалена"); }
        if (p.n === 1) qNote(lid + " " + mapLabel(m) + ": пауза " + Math.round((p.until - now()) / 60) + " мин, " + p.err);
    }
    // Открывает форму лота и даёт fn(поля) её изменить: fn возвращает true, если лот надо сохранить.
    // → "ok" (сохранён) | "same" (менять нечего) | "rate" (FunPay просит подождать) | "text" (не принял английское описание) | "" (не вышло)
    function lotDo(m, fn) {
        var lid = String(m.lotId), p = PROBLEMS[lid];
        if (p && p.until > now()) return "";
        var f = lotForm("offer=" + lid), err = f.err || "", res = "same";
        if (!err && fn(f.fields, f)) {
            delete f.fields.deleted;
            var r = fpPost("lots/offerSave", f.fields);
            if (r.ok) res = "ok";
            else err = /коротк|short/i.test(String(r.errors["fields[desc][en]"] || "")) ? EN_SHORT_HINT : (r.error || "FunPay не принял лот");
        }
        if (err) {
            if (f.lost) { loginLost(); return "rate"; }
            if (f.rate || RATE_RX.test(err)) return "rate";
            if (err === EN_SHORT_HINT) return "text";
            if (/нет связи/.test(err)) return "";            // сеть моргнула: лот тут ни при чём
            lotFailed(m, err);
            return "";
        }
        if (p) {
            delete PROBLEMS[lid];
            save("problems", PROBLEMS);
            qNote(lid + " " + mapLabel(m) + ": снова в порядке");
        }
        return res;
    }
    function setActive(m, active) {
        var res = lotDo(m, function (f) {
            var isOn = f.active === "on", amount = f.amount === undefined || f.amount === "" ? null : int(f.amount, 0);
            var topUp = active && m.auto && amount !== null && amount < LOT_AMOUNT / 2;
            if (isOn === active && !topUp) return false;
            if (active) f.active = "on"; else delete f.active;
            if (topUp) f.amount = String(LOT_AMOUNT);       // штуки кончились: FunPay выключил лот сам и без них не включит
            return true;
        });
        return res === "rate" ? "rate" : (res === "ok" || res === "same" ? "ok" : "");
    }
    // FunPay вычитает купленные штуки из "Наличия" и на нуле выключает лот. Считаем проданное и через половину запаса доливаем.
    function refill(m, qty) {
        m.sold = int(m.sold, 0) + qty;
        saveMaps();
        if (m.sold < LOT_AMOUNT / 2 || !S.fpEdit) return;
        later(function () {
            var res = lotDo(m, function (f) {
                if (f.amount === undefined || f.amount === "" || int(f.amount, 0) >= LOT_AMOUNT) return false;
                f.amount = String(LOT_AMOUNT);
                return true;
            });
            if (res === "ok" || res === "same") { m.sold = 0; saveMaps(); }
        });
    }
    function setPrice(m, price) {
        var res = lotDo(m, function (f) {
            if (f.price !== undefined && f.price !== "" && Math.abs(num(f.price) - price) < 0.01) return false;
            f.price = String(price);
            return true;
        });
        if (res === "ok" || res === "same") m.price = price;
        return res;
    }
    // Описание лота с ID привязки последней строкой (чужие ID, например у копии лота, убираются)
    function withTag(text, m) {
        var s = String(text || "").replace(TAG_RX, "").replace(/\s+$/, "");
        return s && m.tag ? s + "\n\n" + m.tag : s;
    }
    function tagNum(tag) { return int(String(tag).slice(6), 0); }
    // Выдаёт привязкам ID (rentM-1001…) и дописывает его в конец описания лота: по нему заказ находит привязку. За проход не больше limit лотов.
    function tagLots(limit) {
        if (!S.fpEdit || Q.length) return;
        MAPS.filter(function (m) { return m.lotId && !m.tagged && !m.ext && !(m.tagSkip > now()); }).slice(0, limit || 10).forEach(function (m) {
            later(function () {
                if (MAPS.indexOf(m) < 0 || m.tagged) return;
                if (!m.tag) {
                    var n = int(S.tagSeq, 1000);
                    MAPS.forEach(function (x) { if (x.tag) n = Math.max(n, tagNum(x.tag)); });
                    S.tagSeq = n + 1;
                    m.tag = "rentM-" + (n + 1);
                    saveS(); saveMaps();
                }
                var res = lotDo(m, function (f) {
                    var ru = f["fields[desc][ru]"] || "", en = f["fields[desc][en]"] || "";
                    f["fields[desc][ru]"] = withTag(ru, m);
                    f["fields[desc][en]"] = withTag(en, m);
                    return f["fields[desc][ru]"] !== ru || f["fields[desc][en]"] !== en;
                });
                if (res === "rate") { Q = []; return; }
                if (res === "ok" || res === "same") { m.tagged = true; saveMaps(); }
                else if (res === "text") { m.tagSkip = now() + 6 * 3600; saveMaps(); }      // FunPay не принял описание этого лота: вернёмся к нему позже
            });
        });
    }

    // --- тексты лотов автовыставления
    function tpl(key) { return (S.texts || {})[key] || TEXTS[key]; }
    function usesStock() { return ["ap_title_ru", "ap_title_en", "ap_desc_ru", "ap_desc_en"].some(function (k) { return tpl(k).indexOf("{stock}") >= 0; }); }
    // stock для {stock}; неизвестно: "?", фоновая сверка допишет число
    function lotTexts(game, hours, stock) {
        function make(key, lang) {
            return tpl(key).split("{game}").join(game).split("{time}").join(dur(hours, lang)).split("{stock}").join(stock === null || stock === undefined ? "?" : String(stock)).split("{commands}").join(commandsText("ru"));
        }
        var ru = make("ap_title_ru", "ru"), en = ascii(make("ap_title_en", "en"));
        if (!en) en = ascii(game + " Steam account rental " + durEn(hours) + " auto delivery");
        var descEn = ascii(make("ap_desc_en", "en"));
        if (descEn.length < EN_MIN) descEn = ascii(descEn + " " + TEXTS.ap_desc_en.split("{game}").join(game).split("{time}").join(durEn(hours)));
        return [ru.slice(0, 100).trim(), en.slice(0, 100).trim(), make("ap_desc_ru", "ru"), descEn];     // длиннее 100 символов FunPay название не принимает
    }
    function enWarning(descRu, descEn) {
        if (descEn.length >= descRu.length * EN_RATIO) return "";
        return "Английское описание (" + descEn.length + ") намного короче русского (" + descRu.length + "): FunPay может не принять лот. Допишите английское хотя бы до " + (Math.floor(descRu.length * EN_RATIO) + 1) + " символов.";
    }
    // Название и описание лота автовыставления по текущим шаблонам. → как у lotDo
    function retext(m, stock) {
        var tx = lotTexts(m.game, int(m.hours, 1), stock);
        var res = lotDo(m, function (f) {
            f["fields[summary][ru]"] = tx[0];
            f["fields[summary][en]"] = tx[1];
            f["fields[desc][ru]"] = withTag(tx[2], m);
            f["fields[desc][en]"] = withTag(tx[3], m);
            return true;
        });
        if (res === "ok") { m.titles = [tx[0], tx[1]]; m.stock = usesStock() ? (stock === undefined ? null : stock) : null; }
        return res;
    }

    // --- временный лот продления: покупатель пишет "!продление 3", плагин создаёт лот на этот срок, оплата продлевает тот же аккаунт
    function extTexts(game, hours, tag) {
        function title(key, lang) {
            var text = fill(tpl(key), { game: game, time: dur(hours, lang), hours: hours, tag: tag }).replace("#" + tag, "");
            text = lang === "en" ? ascii(text) : text.replace(/\s+/g, " ").trim();
            return text.slice(0, 100 - tag.length - 2).trim() + " #" + tag;
        }
        var descEn = ascii(fill(tpl("ext_desc_en"), { game: game, time: durEn(hours), hours: hours, tag: tag }));
        if (descEn.length < EN_MIN) descEn = ascii(descEn + " " + TEXTS.ext_desc_en.split("{game}").join(game).split("{time}").join(durEn(hours)));
        return [title("ext_title_ru", "ru"), title("ext_title_en", "en"), fill(tpl("ext_desc_ru"), { game: game, time: dur(hours), hours: hours, tag: tag }), descEn];
    }
    function extReady(rec, e) {
        var lang = langOf(rec.chat);
        return t("ext_lot_ready", lang, { game: rec.game, login: rec.login, time: dur(int(e.hours, 1), lang), hours: e.hours, price: e.price,
            link: "https://funpay.com/lots/offer?id=" + e.lotId, minutes: Math.max(1, Math.ceil((e.until - now()) / 60)) });
    }
    // Удаляет лот продления, а метку держит ещё сутки: оплата в последние секунды приходит уже после удаления
    function dropExt(tag) {
        var e = EXT[tag];
        if (!e || e.gone) return;
        e.gone = now();
        save("extlots", EXT);
        if (!deleteLot(e.lotId)) log("лот продления " + e.lotId + " не удалён" + lastErr());
    }
    function extCleanup() {
        var changed = false;
        Object.keys(EXT).forEach(function (tag) {
            var e = EXT[tag];
            if (e.gone && e.gone < now() - 86400) { delete EXT[tag]; changed = true; }
            else if (!e.gone && num(e.until) < now()) dropExt(tag);
        });
        if (changed) save("extlots", EXT);
    }
    function extFor(order) {
        var tags = Object.keys(EXT), text = String(order.title || "") + "\n" + String(order.text || "");
        for (var i = 0; i < tags.length; i++) if (new RegExp("#" + tags[i] + "(?![A-Za-z0-9])", "i").test(text)) return tags[i];
        return "";
    }
    var extBusy = {};
    function makeExtLot(chatId, rec, m, hours) {
        if (extBusy[rec.id]) return;
        extBusy[rec.id] = 1;
        try {
            Object.keys(EXT).forEach(function (tag) { if (EXT[tag].rid === rec.id) dropExt(tag); });   // старый лот на другой срок убираем
            var g = fpGame(rec.gameId), prod = product(rec.gameId);
            var sub = (m && m.subcat) || (g && g.funpay && g.funpay.subcategory_id);
            var err = "нет раздела FunPay или игры в каталоге MUVSell", lotId = "", price = 0, tag = "";
            if (prod && sub) {
                price = priceFor(prod, hours, m || { subcat: sub });
                var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
                for (var i = 0; i < 5; i++) tag += abc.charAt(Math.floor(Math.random() * abc.length));
                var res = createLot(int(sub, 0), g && g.funpay ? g.funpay.fields : null, rec.game, extTexts(rec.game, hours, tag), price, true, 1);
                lotId = res.id || "";
                err = res.err || "";
            }
            if (!lotId) {
                sendTo(chatId, t("ext_lot_fail", langOf(chatId)));
                return note("лот продления не создан", (rec.buyer || "") + ", " + rec.game + ", " + dur(hours) + ": " + err);
            }
            var e = { lotId: String(lotId), rid: rec.id, chat: chatId, gameId: rec.gameId, game: rec.game, hours: hours, price: price, mapLot: m ? m.lotId : "",
                until: now() + Math.max(1, int(S.extMinutes, 10)) * 60 };
            EXT[tag] = e;
            save("extlots", EXT);
            sendTo(chatId, extReady(rec, e));
            if (S.notifySales) note("лот продления", (rec.buyer || "") + ": " + rec.game + " +" + dur(hours) + " за " + price + "₽ (лот " + lotId + ")");
        } finally {
            delete extBusy[rec.id];
        }
    }
    function payExt(order, chatId, tag) {
        var e = EXT[tag];
        delete EXT[tag];                    // сразу, чтобы второй заказ того же лота не продлил дважды
        save("extlots", EXT);
        if (!e.gone && !deleteLot(e.lotId)) log("лот продления " + e.lotId + " не удалён" + lastErr());
        var hours = int(e.hours, 1) * Math.max(1, order.amount);
        var rec = recById(e.rid);
        var m = mapByLot(e.mapLot) || { gameId: e.gameId, game: e.game, lotId: "", hours: e.hours };
        if (!String(S.key || "").trim()) return fail(order, chatId, "no_key", m);
        if (rec && rec.exp > now()) {
            var err = extend(rec, hours, chatId, order, "extended", "ext");
            if (!err) return;
            if (err !== "bad_request" && err !== "not_found") return fail(order, chatId, err, m);
            rec.exp = 0;
            saveRent();
        }
        var res = newRental(m, order, chatId, hours);      // аренда уже закончилась: выдаём аккаунт на оплаченное время
        if (res.err) fail(order, chatId, res.err, m);
    }

    // --- автовыставление
    function sellable() {
        var prods = {}, out = [];
        (products() || []).forEach(function (p) { if (p.available) prods[p.id] = p; });
        var q = norm(S.apFilter);
        (fpMap().games || []).forEach(function (g) {
            if (prods[g.game_id] && (!q || norm(g.name).indexOf(q) >= 0)) out.push([g, prods[g.game_id]]);
        });
        return out;
    }
    // Почему привязку пора пересоздать: лот удалён с FunPay или лот плагина стоит не в том разделе
    function stale(m) {
        if (lotGone(m.lotId)) return "удалён с FunPay";
        var g = m.auto && !m.manual ? fpGame(m.gameId) : null;
        if (g && String(g.funpay.subcategory_id) !== String(m.subcat)) return "в чужом разделе";
        return "";
    }
    // Сколько лотов плагина ставить в раздел. У FunPay 20 предложений продавца на раздел, в "Прочих играх" 60.
    function cap(sub) { return int(S.lotCap, 20) * (Number(sub) === OTHER_SUB ? 3 : 1); }
    function pluginLots(sub) { return MAPS.filter(function (m) { return m.auto && String(m.subcat) === String(sub) && !lotGone(m.lotId); }).length; }
    function mkey(m) { return m.gameId + ":" + int(m.hours, 0) + ":" + (m.manual || ""); }
    function gkey(g, hours) { return g.game_id + ":" + hours + ":" + (g.manual || ""); }
    function ckey(g, hours) { return (g.manual ? g.manual + ":" : "") + g.game_id + ":" + hours; }
    function ckeyOf(m) { return (m.manual ? m.manual + ":" : "") + m.gameId + ":" + int(m.hours, 0); }
    // Недостающие лоты по играм: у игры сразу все сроки из "Длительностей", потом следующая игра
    function plan(durations) {
        var have = {}, out = [];
        MAPS.forEach(function (m) { if (!m.ext && !m.manual && !stale(m)) have[m.gameId + ":" + int(m.hours, 0)] = 1; });
        sellable().forEach(function (gp) {
            (durations || S.apDurations || []).forEach(function (h) { if (!have[gp[0].game_id + ":" + h]) out.push({ g: gp[0], prod: gp[1], hours: h }); });
        });
        return out;
    }
    // Перед созданием заново: убираем старую привязку; лот плагина в чужом разделе ещё и удаляем с FunPay
    function dropStale(g, hours) {
        var old = MAPS.filter(function (x) { return x.gameId === g.game_id && int(x.hours, 0) === hours && (x.manual || "") === (g.manual || "") && stale(x); });
        if (!old.length) return;
        old.forEach(function (m) {
            if (stale(m) === "в чужом разделе" && !deleteLot(m.lotId)) log("лот " + m.lotId + " из чужого раздела не удалён" + lastErr());
            MAPS = MAPS.filter(function (x) { return x !== m; });
            delete PROBLEMS[String(m.lotId)];
            delete HIDDEN[String(m.lotId)];
            delete CREATED[ckey(g, hours)];
        });
        saveMaps(); save("problems", PROBLEMS); save("hidden", HIDDEN); save("created", CREATED);
    }
    function newMap(g, lotId, hours, titles, price, stock, extra) {
        var sub = int(g.funpay.subcategory_id, 0);
        var m = { lotId: String(lotId), subcat: sub, titles: titles, gameId: g.game_id, game: g.name, hours: hours, auto: true, price: price, markup: S.apOwn, reprice: true, stock: stock === undefined ? null : stock };
        for (var k in (extra || {})) m[k] = extra[k];
        if (g.manual) m.manual = g.manual;
        MAPS.push(m);
        CREATED[ckey(g, hours)] = { lotId: String(lotId), subcat: sub, titles: titles };
        saveMaps();
        save("created", CREATED);
        return m;
    }
    // Игра для общего раздела (Steam / "Прочие игры") в формате записи карты
    function manualGame(prod, kind) {
        var g = fpGame(prod.id);
        return { game_id: prod.id, name: (g || prod).name, manual: kind, funpay: { subcategory_id: MANUAL[kind][0], fields: {} } };
    }
    // В Steam любая игра каталога, в "Прочие игры" только без своего раздела в карте. Без цены на сайте нельзя: аренда не прошла бы.
    function manualGames(kind) { return (products() || []).filter(function (p) { return p.available && (kind !== "other" || !fpGame(p.id)); }); }
    function manualTodo(kind, gameId) {
        var have = {};
        MAPS.forEach(function (m) { if (m.gameId === gameId && m.manual === kind && !stale(m)) have[int(m.hours, 0)] = 1; });
        return (S.apDurations || []).filter(function (h) { return !have[h]; });
    }

    // --- долгие задачи: по одному шагу за такт, чтобы FunPay не посчитал это спамом
    var job = null, jobResult = "";
    var QH = [], Q = [];        // очереди изменений лотов: срочные (снять и вернуть в продажу) и обычные
    function later(fn) { Q.push(fn); }
    // Задача на диске живёт, пока идёт: программу закрыли посреди неё, и при запуске плагин предложит продолжить.
    // r: как её запустить заново ({kind, ...}, см. runJob). Задачи сами пропускают уже сделанное, поэтому повтор безопасен.
    var JOB_SAVED = load("job", null);
    function startJob(title, r) {
        if (job) { toast("Уже идёт: " + job.title + ". Дождитесь окончания."); return null; }
        job = { title: title, todo: [], n: 0, stop: false, lost: false, waitUntil: 0, finish: null };
        jobResult = "";
        JOB_SAVED = r ? { title: title, resume: r, at: now() } : null;
        save("job", JOB_SAVED);
        return job;
    }
    function jobLine() { return job ? job.title + ": шаг " + job.n + ", в очереди " + job.todo.length + (job.waitUntil > now() ? " (FunPay просит подождать, пауза минуту)" : "") : ""; }
    function finishJob() {
        var j = job, text = "";
        job = null;
        JOB_SAVED = null;
        save("job", null);
        try { text = j.finish ? j.finish(j) : j.title + ": готово."; } catch (e) { text = j.title + ": " + e; }
        if (j.lost) { lostNoteAt = now(); text = LOGGED_OUT + ". " + LOGIN_HELP + " " + text; }
        else if (j.stop) text = j.title + ": остановлено, сделанное сохранено. " + text;
        jobResult = text;
        saveMaps(); saveOff(); save("created", CREATED);
        flushQ();
        note(j.title, text);
        redraw();
    }
    function jobStep() {
        if (!job || job.waitUntil > now()) return;
        if (job.stop || job.lost || !job.todo.length) return finishJob();
        var fn = job.todo.shift();
        job.n++;
        try { fn(job); } catch (e) { log(job.title + ": " + e); }
        if (job && !job.todo.length && job.waitUntil <= now()) finishJob();
    }
    function reasonsText(reasons) {
        var top = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; }).slice(0, 5);
        return top.length ? " Причины: " + top.map(function (r) { return reasons[r] + "× " + r; }).join("; ") + "." : "";
    }

    // --- поиск своих лотов на FunPay (после переустановки плагина лоты остались, а его данных нет)
    // Игра и срок лота по названию. Игра это самое длинное совпадение ("Sons of the Forest", а не "The Forest").
    function titleMatch(title, games) {
        var tn = norm(title), best = null, size = 0;
        games.forEach(function (g) {
            gameNames(g.name).forEach(function (x) { if (x.length > size && hasWord(tn, x)) { best = g; size = x.length; } });
        });
        if (!best && games.length === 1) best = games[0];
        var hours = best ? titleHours(title, best.name) : 0;
        return hours ? { g: best, hours: hours } : null;
    }
    // Название точно по шаблону; цифры могут отличаться только в {stock}
    function byTemplate(fields, g, hours) {
        function shape(s) { return norm(s).replace(/\d+|\?/g, "#"); }
        var texts = lotTexts(g.name, hours).slice(0, 2).map(shape);
        return [fields["fields[summary][ru]"], fields["fields[summary][en]"]].some(function (x) { return x && texts.indexOf(shape(x)) >= 0; });
    }
    function adoptGames() {
        var bySub = {};
        (fpMap().games || []).forEach(function (g) {
            var sub = g.funpay && g.funpay.subcategory_id;
            if (sub) (bySub[sub] = bySub[sub] || []).push(g);
        });
        Object.keys(MANUAL).forEach(function (kind) {
            var sub = MANUAL[kind][0];
            bySub[sub] = (bySub[sub] || []).concat(manualGames(kind).map(function (p) { return manualGame(p, kind); }));
        });
        return bySub;
    }
    function adoptKnown() {
        var known = {};
        MAPS.concat(OFF).forEach(function (x) { known[String(x.lotId)] = 1; });
        for (var k in EXT) known[String(EXT[k].lotId)] = 1;
        return known;
    }
    // Лот выключен, а причина потеряна вместе с данными плагина: как снятый "нет аккаунтов" он вернётся в продажу сам
    function adoptHidden(fields, lotId, res) {
        if (fields.active === "on" || !S.apActive) return;
        HIDDEN[String(lotId)] = "stock";
        save("hidden", HIDDEN);
        res.inactive++;
    }
    function adoptRes() { return { bound: [], off: [], dups: [], dupsOn: 0, unsure: [], unread: {}, offUnread: {}, failed: 0, inactive: 0, limited: "", noData: false }; }
    function adoptFormErr(f, res) {
        if (f.lost) { loginLost(); return true; }
        if (f.rate || RATE_RX.test(f.err)) { res.limited = f.err; return true; }
        res.failed++;
        return true;
    }
    // Оффлайн-лоты: ID в описании у них нет, поэтому только название точно по шаблону
    function adoptOffSteps(j, res, subs) {
        var names = {}, secs = {};
        secs[OFF_SUB] = 1;
        (offCatalog() || []).forEach(function (g) {
            offTexts(g.name).slice(0, 2).forEach(function (x) { names[norm(x)] = g; });
            var s = offSection(g);
            if (s) secs[s.sub] = 1;
        });
        var keys = Object.keys(names);
        if (!keys.length) return;
        var known = adoptKnown(), have = {};
        OFF.forEach(function (o) { have[o.gameId + ":" + o.subcat] = 1; });
        var steps = (subs || Object.keys(secs)).map(function (sub) {
            return function () {
                if (res.limited) return;
                var lots = myLotsIn(sub);
                if (!lots) { res.failed++; res.offUnread[sub] = 1; return; }
                var inner = [];
                lots.forEach(function (lot) {
                    var d = norm(lot.desc), g = names[d];
                    if (!g) keys.forEach(function (n) { if (!g && d.indexOf(n + ",") === 0) g = names[n]; });      // в списке раздела FunPay дописывает параметры
                    if (!g || known[lot.id]) return;
                    inner.push(function () {
                        if (res.limited) return;
                        var f = lotForm("offer=" + lot.id);
                        if (f.err) { adoptFormErr(f, res); res.offUnread[sub] = 1; return; }
                        var ru = f.fields["fields[summary][ru]"], en = f.fields["fields[summary][en]"], label = g.name + " навсегда";
                        if (names[norm(ru)] !== g && names[norm(en)] !== g) { res.unsure.push([lot.id, label]); return; }
                        var key = g.id + ":" + sub;
                        if (have[key]) { res.dups.push([lot.id, label]); if (f.fields.active === "on") res.dupsOn++; return; }
                        have[key] = 1;
                        var o = { lotId: String(lot.id), subcat: int(sub, 0), titles: [ru, en].filter(Boolean), gameId: String(g.id), game: g.name, offline: true, auto: true, price: num(f.fields.price) };
                        OFF.push(o);
                        saveOff();
                        adoptHidden(f.fields, lot.id, res);
                        res.off.push([lot.id, label]);
                    });
                });
                j.todo = inner.concat(j.todo);
            };
        });
        j.todo = steps.concat(j.todo);
    }
    // Свой лот: с ID rentM-… в описании или с названием точно по шаблону. Просто похожие не трогаем: это может быть лот другого поставщика.
    // items: только эти лоты (проверка перед созданием), null: все разделы и оффлайн-лоты. Шаги встают в конец очереди задачи, потом вызывается cb(итог).
    function adoptSteps(j, items, cb) {
        var res = adoptRes();
        res.noData = !items && (!(fpMap().games || []).length || products() === null);
        var only = null, subs = null;
        if (items) {
            only = {}; subs = {};
            items.forEach(function (it) { only[gkey(it.g, it.hours)] = 1; subs[int(it.g.funpay.subcategory_id, 0)] = 1; });
        }
        var bySub = adoptGames(), known = adoptKnown(), have = {}, used = {}, top = int(S.tagSeq, 1000);
        MAPS.forEach(function (m) { if (!stale(m)) have[mkey(m)] = 1; if (m.tag) used[String(m.tag).toLowerCase()] = 1; });
        Object.keys(bySub).forEach(function (sub) {
            if (subs && !subs[sub]) return;
            j.todo.push(function () {
                if (res.limited) return;
                var lots = myLotsIn(sub);
                if (!lots) { res.failed++; return; }
                lots.sort(function (a, b) { return (a.active === false ? 1 : 0) - (b.active === false ? 1 : 0); });      // из двух лотов на один срок привязываем тот, что в продаже
                var inner = [];
                lots.forEach(function (lot) {
                    var hit = known[lot.id] ? null : titleMatch(lot.desc, bySub[sub]);
                    if (!hit) return;
                    var key = gkey(hit.g, hit.hours), label = hit.g.name + " " + shortDur(hit.hours);
                    if (only && !only[key]) return;
                    inner.push(function () {
                        if (res.limited) return;
                        var f = lotForm("offer=" + lot.id);
                        if (f.err) { adoptFormErr(f, res); res.unread[key] = 1; return; }      // есть ли он, неизвестно: лучше не создать, чем выставить дубль
                        var ru = f.fields["fields[desc][ru]"] || "", en = f.fields["fields[desc][en]"] || "", tags = (ru + "\n" + en).match(TAG_RX) || [];
                        tags.forEach(function (x) { top = Math.max(top, tagNum(x)); });          // новые ID не должны совпасть с ID этих лотов
                        if (!tags.length && !byTemplate(f.fields, hit.g, hit.hours)) { res.unsure.push([lot.id, label]); return; }
                        if (have[key]) { res.dups.push([lot.id, label]); if (f.fields.active === "on") res.dupsOn++; return; }
                        var tag = tags.filter(function (x) { return !used[x.toLowerCase()]; })[0];
                        dropStale(hit.g, hit.hours);
                        newMap(hit.g, lot.id, hit.hours, [f.fields["fields[summary][ru]"], f.fields["fields[summary][en]"]].filter(Boolean), num(f.fields.price), null,
                            tag ? { tag: tag, tagged: ru.indexOf(tag) >= 0 && (!en || en.indexOf(tag) >= 0) } : null);
                        adoptHidden(f.fields, lot.id, res);
                        have[key] = 1;
                        known[lot.id] = 1;
                        if (tag) used[tag.toLowerCase()] = 1;
                        res.bound.push([lot.id, label]);
                    });
                });
                j.todo = inner.concat(j.todo);
            });
        });
        if (!items) j.todo.push(function () { if (!res.limited) adoptOffSteps(j, res, null); });
        j.todo.push(function () {
            if (top > int(S.tagSeq, 1000)) { S.tagSeq = top; saveS(); }
            cb(res);
        });
    }
    function listing(items) { return items.slice(0, 15).map(function (x) { return x[0] + " " + x[1]; }).join(", ") + (items.length > 15 ? " и ещё " + (items.length - 15) : ""); }
    function jobAdopt(r) {
        var j = startJob("Поиск лотов", r || { kind: "adopt" }), res = null;
        if (!j) return;
        adoptSteps(j, null, function (r) { res = r; });
        j.finish = function () {
            if (!res) return "Поиск не закончен.";
            var s = res.limited ? "FunPay временно ограничил запросы (" + res.limited + "). Позже запустите поиск ещё раз: привязанное останется. " : "Поиск завершён. ";
            if (res.noData) s += "Каталог или карта разделов MUVSell не загрузились: проверены не все разделы, запустите поиск ещё раз. ";
            s += "Привязано лотов аренды: " + res.bound.length + ".";
            if (res.off.length) s += " Привязано оффлайн-лотов: " + res.off.length + ".";
            if (res.failed) s += " Не открылось (лоты и разделы): " + res.failed + ", запустите поиск ещё раз.";
            if (res.inactive) s += " Из них были выключены: " + res.inactive + ", плагин включит их сам, если у игры есть аккаунты.";
            if (res.bound.length || res.off.length) s += " Цены этих лотов теперь следуют за наценкой плагина.";
            if (res.dups.length) s += " Дубли (такой лот уже привязан, эти не тронуты, можно удалить на FunPay): " + listing(res.dups) + "." + (res.dupsOn ? " В продаже из них: " + res.dupsOn + ", по таким лотам плагин может не выдать аккаунт." : "");
            if (res.unsure.length) s += " Похожие, но не тронуты (нет ID плагина и название не по шаблону): " + listing(res.unsure) + ". Если лот ваш, привяжите его во вкладке \"Привязки\".";
            return s;
        };
    }

    // --- создание лотов
    // Лоты плагина, которых уже нет среди ваших лотов раздела на FunPay, помечаем удалёнными, чтобы их пересоздали
    function markGoneSteps(j, gameIds) {
        var bySub = {};
        MAPS.forEach(function (m) {
            if (m.auto && !m.manual && !stale(m) && (!gameIds || gameIds.indexOf(m.gameId) >= 0)) (bySub[m.subcat] = bySub[m.subcat] || []).push(m);
        });
        Object.keys(bySub).forEach(function (sub) {
            j.todo.push(function () {
                var lots = myLotsIn(sub);
                if (!lots) return;
                var mine = {};
                lots.forEach(function (l) { mine[l.id] = 1; });
                var lost = bySub[sub].filter(function (m) { return !mine[String(m.lotId)]; });
                if (!lost.length || lost.length === bySub[sub].length) return;       // не нашлось ни одного лота плагина: похоже на сбой страницы, раздел не трогаем
                lost.forEach(function (m) { PROBLEMS[String(m.lotId)] = { n: 1, game: mapLabel(m), err: "Предложение не найдено.", missing: true, at: now(), until: now() }; });
                save("problems", PROBLEMS);
            });
        });
    }
    function createStep(j, it, retried) {
        var c = j.c, g = it.g, hours = it.hours, sub = int(g.funpay.subcategory_id, 0), key = ckey(g, hours);
        if (c.limited) return;
        if (c.full[sub]) { c.full[sub][2]++; return; }
        dropStale(g, hours);        // лот удалён с FunPay или стоит в чужом разделе: создаём заново
        if (MAPS.some(function (m) { return mkey(m) === gkey(g, hours) && !m.ext; })) return;
        var price = priceFor(it.prod, hours, { subcat: sub, markup: S.apOwn });
        var old = CREATED[key];
        if (old && !mapByLot(old.lotId)) {      // привязку удаляли, а лот на FunPay остался: возвращаем привязку, дубль не создаём
            var f = lotForm("offer=" + old.lotId);
            if (!f.err) { newMap(g, old.lotId, hours, old.titles || [], price); c.restored++; return; }
            if (f.lost) return loginLost();
            delete CREATED[key];
        }
        if (pluginLots(sub) >= cap(sub)) { c.skipped++; return; }
        var n = int(it.prod.inStock, 0), texts = lotTexts(g.name, hours, n);
        var res = createLot(sub, g.funpay.fields, g.name, texts, price, !!S.apActive, LOT_AMOUNT);
        if (res.lost) return loginLost();
        if (res.rate) {
            if (!retried) {         // короткий антифлуд FunPay за минуту проходит, а настоящий лимит ответит тем же ещё раз
                j.waitUntil = now() + 60;
                j.n--;
                j.todo.unshift(function () { createStep(j, it, true); });
                return;
            }
            c.streak++;
            if (c.streak >= RATE_SECTIONS) { c.limited = res.err || "лимит"; j.todo = []; return; }     // отказали подряд несколько разделов: это дневной лимит аккаунта
            c.full[sub] = [MANUAL_NAMES[sub] || "раздел \"" + g.name + "\"", res.err || "лимит", 1];
            return;
        }
        if (res.id) { newMap(g, res.id, hours, [texts[0], texts[1]], price, usesStock() ? n : null); c.created++; c.streak = 0; }
        else {
            c.failed++;
            c.reasons[res.err] = (c.reasons[res.err] || 0) + 1;
            log("автовыставление: " + g.name + " " + shortDur(hours) + " (раздел " + sub + ") не создан: " + res.err);
        }
    }
    // Создание после сверки с FunPay. planFn составляет список лотов уже после сверки: удалённые в обход плагина тоже в него попадают.
    function jobCreate(planFn, gameIds, r) {
        var j = startJob("Создание лотов", r);
        if (!j) return;
        var c = j.c = { created: 0, restored: 0, skipped: 0, failed: 0, bound: 0, full: {}, streak: 0, limited: "", reasons: {}, nothing: false };
        markGoneSteps(j, gameIds);
        j.todo.push(function () {
            var items = planFn();
            if (!items.length) { c.nothing = true; return; }
            adoptSteps(j, items, function (res) {       // лоты плана могут уже стоять на FunPay без привязки: привязываем, дублей не создаём
                c.bound = res.bound.length;
                if (res.limited) { c.limited = res.limited; return; }
                var done = {};
                MAPS.forEach(function (m) { if (!stale(m)) done[mkey(m)] = 1; });
                items.forEach(function (it) {
                    var k = gkey(it.g, it.hours);
                    if (!done[k] && !res.unread[k]) j.todo.push(function () { createStep(j, it, false); });
                });
            });
        });
        j.finish = function () {
            if (c.nothing) return "Нечего создавать: все лоты на FunPay на месте.";
            var s = c.limited ? "FunPay временно запретил создавать лоты (до суток, если за день создано много лотов). Ответ FunPay: " + c.limited + ". Позже нажмите \"Создать недостающие\": плагин дозальёт только оставшиеся. " : "Создание лотов завершено. ";
            s += "Создано: " + c.created + ", восстановлено привязок: " + (c.restored + c.bound) + (c.skipped ? ", пропущено по лимиту раздела: " + c.skipped : "") + ", ошибок: " + c.failed + ".";
            for (var sub in c.full) s += " " + c.full[sub][0] + ": FunPay не принимает новые лоты (" + c.full[sub][1] + "), пропущено: " + c.full[sub][2] + ".";
            return s + reasonsText(c.reasons);
        };
    }
    function jobReprice(r) {
        var j = startJob("Пересчёт цен", r || { kind: "reprice" });
        if (!j) return;
        var prods = {}, c = { updated: 0, same: 0, failed: 0, limited: false };
        (products(true) || []).forEach(function (p) { prods[p.id] = p; });
        MAPS.filter(function (m) { return autoPrice(m) && prods[m.gameId] && !m.ext; }).forEach(function (m) {
            j.todo.push(function () {
                if (c.limited) return;
                var res = setPrice(m, priceFor(prods[m.gameId], int(m.hours, 1), m));
                if (res === "rate") { c.limited = true; j.todo = []; }
                else if (res === "ok") c.updated++; else if (res === "same") c.same++; else c.failed++;
            });
        });
        j.finish = function () {
            var manual = MAPS.filter(function (m) { return !autoPrice(m); }).length;
            return (c.limited ? "FunPay временно ограничил изменения, повторите позже. " : "Пересчёт цен завершён. ") + "Обновлено: " + c.updated + ", без изменений: " + c.same + ", ошибок: " + c.failed + (manual ? ", с ручной ценой (не трогались): " + manual : "") + ".";
        };
    }
    // Перечитывает названия и цены всех привязанных лотов (заодно проверяет, что лоты живы)
    function jobTitles(r) {
        var j = startJob("Обновление названий", r || { kind: "titles" });
        if (!j) return;
        var c = { ok: 0, failed: 0 };
        MAPS.concat(OFF).forEach(function (m) {
            j.todo.push(function () {
                var res = lotDo(m, function (f) {
                    var titles = [f["fields[summary][ru]"], f["fields[summary][en]"]].filter(Boolean);
                    if (titles.length) m.titles = titles;
                    if (f.price !== undefined && f.price !== "") m.price = num(f.price);
                    return false;
                });
                if (res === "rate") { j.todo = []; return; }
                if (res) c.ok++; else c.failed++;
            });
        });
        j.finish = function () { return "Названия обновлены. Прочитано: " + c.ok + ", ошибок: " + c.failed + "."; };
    }
    function jobRetext(r) {
        var j = startJob("Перезапись текстов", r || { kind: "retext" });
        if (!j) return;
        var stock = stockMap(products()), c = { done: 0, failed: 0, limited: false, rejected: false };
        MAPS.filter(function (m) { return m.auto; }).forEach(function (m) {
            j.todo.push(function () {
                if (c.limited || c.rejected) return;
                var res = retext(m, stock[m.gameId]);
                if (res === "rate") { c.limited = true; j.todo = []; }
                else if (res === "text") { c.rejected = true; c.failed++; j.todo = []; }        // шаблон у всех лотов один: остальные FunPay отклонит так же
                else if (res === "ok") c.done++; else c.failed++;
            });
        });
        j.finish = function () {
            return (c.limited ? "FunPay временно ограничил изменения, повторите позже. " : c.rejected ? EN_SHORT_HINT + " " : "Тексты переписаны. ") + "Обновлено: " + c.done + ", ошибок: " + c.failed + ".";
        };
    }
    // lots: удалять и сами лоты с FunPay, иначе только привязки
    function jobDelete(targets, lots) {
        var j = startJob("Удаление", lots ? { kind: "delete", lots: targets.map(function (m) { return String(m.lotId); }) } : null);
        if (!j) return;
        var c = { deleted: 0, failed: 0 };
        targets.forEach(function (m) {
            j.todo.push(function () {
                var gone = true;
                if (lots && !deleteLot(m.lotId)) {
                    var f = lotForm("offer=" + m.lotId);
                    if (f.lost) return loginLost();
                    gone = !!f.err && MISSING_RX.test(f.err);       // уже удалён на FunPay: чистим привязку
                }
                if (!gone) { c.failed++; return; }
                MAPS = MAPS.filter(function (x) { return x !== m; });
                delete HIDDEN[String(m.lotId)];
                delete PROBLEMS[String(m.lotId)];
                if (lots) delete CREATED[ckeyOf(m)];
                c.deleted++;
            });
        });
        j.finish = function () {
            save("hidden", HIDDEN); save("problems", PROBLEMS);
            return "Удаление завершено. Удалено: " + c.deleted + ", ошибок: " + c.failed + ". Осталось привязок: " + MAPS.length + ".";
        };
    }

    // --- оффлайн-лоты (игра навсегда)
    var offCat = [0, null], offAcc = [0, null];
    function offCatalog(force) {
        if (!String(S.key || "").trim()) return null;
        if (force || !offCat[1] || now() - offCat[0] > 120) {
            var r = api("GET", "/offline/catalog");
            if (r.data) offCat = [now(), r.data.games || []];
            else if (force) return null;
        }
        return offCat[1];
    }
    // Подписка продавца и лицензии на игры
    function offAccess(force) {
        if (force || !offAcc[1] || now() - offAcc[0] > 120) {
            var r = api("GET", "/offline/access");
            if (r.data) offAcc = [now(), r.data]; else return null;
        }
        return offAcc[1];
    }
    // Почему оффлайн-лот игры не продавать: "" продаётся, "stock" нет аккаунтов, "cover" режим "только оплаченные", а у игры нет ни лицензии, ни подписки
    function offWhy(g) {
        if (!g.inStock) return "stock";
        return S.offMode === "covered" && !g.covered ? "cover" : "";
    }
    function offTexts(game) {
        function make(key) { return TEXTS[key].split("{game}").join(game).split("{code}").join(codeWord()); }
        var ru = make("off_title_ru"), en = ascii(make("off_title_en")) || "Steam offline activation forever, auto delivery";
        return [ru.slice(0, 100).trim(), en.slice(0, 100).trim(), make("off_desc_ru"), ascii(make("off_desc_en"))];
    }
    // Цена оффлайн-лота: выдача оплачена (лицензия, подписка продавца): "Цена оплаченных", иначе цена MUVSell за выдачу с наценкой
    function offPrice(g) {
        var base = Math.max(1, Math.ceil(num(S.offPrice) || 1));
        if (g.covered) return base;
        return Math.max(base, Math.ceil(num(g.priceRub) * (1 + num(S.offMarkup) / 100)));
    }
    function offCount(sub) { return OFF.filter(function (o) { return o.auto && String(o.subcat) === String(sub); }).length; }
    function offInSteam(o) { return String(o.subcat) === String(OFF_SUB); }
    // Игры FunPay и их разделы с главной страницы сайта: [{names: [...], subs: [{id, name}]}]. Кэш на час, при ошибке повтор через 5 минут.
    var fpCats = [0, null];
    function fpCategories() {
        if (fpCats[1] && now() - fpCats[0] < 3600) return fpCats[1];
        if (!fpCats[1] && now() - fpCats[0] < 300) return null;
        var r = funpayGet("");
        if (r.code !== 200 || r.body.indexOf("promo-game-item") < 0) { fpCats = [now(), fpCats[1]]; return fpCats[1]; }
        var out = [];
        r.body.split(/class="[^"]*\bpromo-game-item\b/).slice(1).forEach(function (chunk) {
            var names = [], subs = [], m;
            var tx = /class="[^"]*\bgame-title\b[^"]*"[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/g;
            while ((m = tx.exec(chunk))) names.push(norm(unent(m[1].replace(/<[^>]*>/g, ""))));
            var lx = /<a\b[^>]*href="[^"]*\/(?:lots|chips)\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/g;
            while ((m = lx.exec(chunk))) subs.push({ id: int(m[1], 0), name: norm(unent(m[2].replace(/<[^>]*>/g, ""))) });
            if (names.length && subs.length) out.push({ names: names, subs: subs });
        });
        fpCats = [now(), out.length ? out : fpCats[1]];
        return fpCats[1];
    }
    // Раздел "Оффлайн активации" самой игры на FunPay: {sub, name} или null, если такого раздела нет. Сначала карта MUVSell;
    // игры, которой в карте ещё нет (только что добавлена на сайт), ищем на FunPay по точному названию: похожее не берём,
    // иначе лот встал бы в раздел чужой игры.
    var OFF_SECTION = "оффлайн активации";
    function offSection(g) {
        var list = fpMap().offline || [];
        for (var i = 0; i < list.length; i++) if (String(list[i].game_id) === String(g.id)) return { sub: int(list[i].subcategory_id, 0), name: list[i].name || g.name };
        var want = norm(g.name), cats = fpCategories() || [];
        for (var j = 0; j < cats.length; j++) {
            if (cats[j].names.indexOf(want) < 0) continue;
            var hit = cats[j].subs.filter(function (x) { return x.name === OFF_SECTION || x.name === "офлайн активации"; })[0];
            if (hit) return { sub: hit.id, name: g.name };
        }
        return null;
    }
    // Игры, которые сейчас можно продавать, без лота в разделе самой игры. Лот в Steam не в счёт: он только по выбору продавца.
    function offPlan(cat) {
        var have = {};
        OFF.forEach(function (o) { if (!offInSteam(o)) have[String(o.gameId)] = 1; });
        return cat.filter(function (g) { return !offWhy(g) && !have[String(g.id)] && offSection(g); });
    }
    function offHomeless(cat) {
        var have = {};
        OFF.forEach(function (o) { have[String(o.gameId)] = 1; });
        return cat.filter(function (g) { return !offWhy(g) && !have[String(g.id)] && !offSection(g); });
    }
    function offCreate(g, sub, fpName) {
        var texts = offTexts(g.name), price = offPrice(g);
        var res = createLot(sub, null, fpName || g.name, texts, price, true, LOT_AMOUNT);
        if (!res.id) return res;
        var o = { lotId: String(res.id), subcat: sub, titles: [texts[0], texts[1]], gameId: String(g.id), game: g.name, offline: true, auto: true, price: price };
        OFF.push(o);
        saveOff();
        return { o: o };
    }
    // "Выставить недостающие": оффлайн-лоты игр, которые можно продавать, каждая в свой раздел
    function jobOffCreate(r) {
        var j = startJob("Оффлайн-лоты", r || { kind: "offcreate" });
        if (!j) return;
        var found = adoptRes(), c = { created: 0, skipped: 0, failed: 0, streak: 0, limited: "", full: {}, refused: [], reasons: {}, plan: 0, homeless: [] };
        function step(g, retried) {
            if (c.limited) return;
            var sec = offSection(g);
            if (c.full[sec.sub]) { c.refused.push(g.name); return; }
            if (offCount(sec.sub) >= cap(sec.sub)) { c.skipped++; return; }
            var res = offCreate(g, sec.sub, sec.name);
            if (res.lost) return loginLost();
            if (res.rate) {
                if (!retried) { j.waitUntil = now() + 60; j.n--; j.todo.unshift(function () { step(g, true); }); return; }
                c.streak++;
                if (c.streak >= RATE_SECTIONS) { c.limited = res.err || "лимит"; j.todo = []; return; }
                c.full[sec.sub] = 1;
                c.refused.push(g.name);
                return;
            }
            if (res.o) { c.created++; c.streak = 0; }
            else { c.failed++; c.reasons[res.err] = (c.reasons[res.err] || 0) + 1; log("оффлайн-лот " + g.name + " (раздел " + sec.sub + ") не создан: " + res.err); }
        }
        j.todo.push(function () { adoptOffSteps(j, found, null); });        // лоты, оставшиеся на FunPay после переустановки, привязываем, дублей не создаём
        j.todo.push(function () {
            if (found.limited) { c.limited = found.limited; return; }
            var cat = offCatalog(true) || [];
            c.homeless = offHomeless(cat);
            var items = offPlan(cat).filter(function (g) { return !found.offUnread[offSection(g).sub]; });      // раздел не прочитался: лучше не создать, чем выставить дубль
            c.plan = items.length;
            items.forEach(function (g) { j.todo.push(function () { step(g, false); }); });
        });
        j.finish = function () {
            var s = c.limited ? "FunPay временно запретил создавать лоты. Ответ FunPay: " + c.limited + ". Позже нажмите \"Выставить недостающие\" ещё раз. " :
                c.plan ? "Оффлайн-лоты выставлены: каждая игра в свой раздел \"Оффлайн активации\". " : "Выставлять нечего: у всех игр, которые можно продавать, лоты уже есть. ";
            s += "Создано: " + c.created + "." + (found.off.length ? " Привязано уже стоявших на FunPay: " + found.off.length + "." : "") + (c.skipped ? " Пропущено по лимиту раздела: " + c.skipped + "." : "") +
                (c.refused.length ? " FunPay не принял новый лот, повторите позже: " + c.refused.join(", ") + "." : "") + " Ошибок: " + c.failed + ".";
            if (c.homeless.length) s += " Нет своего раздела на FunPay: " + c.homeless.slice(0, 10).map(function (g) { return g.name; }).join(", ") + (c.homeless.length > 10 ? " и ещё " + (c.homeless.length - 10) : "") + ". Их можно выставить в Steam кнопкой \"В Steam\".";
            return s + reasonsText(c.reasons);
        };
    }
    // "В Steam": лот выбранной игры в Steam → "Оффлайн активации"
    function jobOffSteam(gameId) {
        var j = startJob("Оффлайн-лот в Steam", { kind: "offsteam", game: String(gameId) });
        if (!j) return;
        var found = adoptRes(), text = "";
        j.todo.push(function () { adoptOffSteps(j, found, [OFF_SUB]); });
        j.todo.push(function () {
            var g = (offCatalog() || []).filter(function (x) { return String(x.id) === String(gameId); })[0];
            if (!g) { text = "Игры нет в оффлайн-каталоге MUVSell или он не загрузился."; return; }
            if (found.limited) { text = "FunPay не принял запрос: " + found.limited + ". Попробуйте позже."; return; }
            if (found.offUnread[OFF_SUB]) { text = "FunPay не открыл раздел Steam. Попробуйте позже."; return; }
            if (OFF.some(function (o) { return String(o.gameId) === String(g.id) && offInSteam(o); })) { text = "Лот \"" + g.name + "\" уже стоял в Steam, привязан."; return; }
            var res = offCreate(g, OFF_SUB);
            if (res.lost) return loginLost();
            text = res.o ? "\"" + g.name + "\" выставлена в Steam → \"Оффлайн активации\". Цена: " + res.o.price + " ₽." :
                res.rate ? "FunPay не принял новый лот: " + res.err + ". Попробуйте позже." : "Лот \"" + g.name + "\" не создан: " + (res.err || "?");
        });
        j.finish = function () { return text; };
    }

    // Запуск задачи по описанию: с кнопки и при продолжении после перезапуска
    function runJob(r) {
        var k = r.kind;
        if (k === "create") return jobCreate(function () { return plan(); }, null, r);
        if (k === "news") return jobCreate(function () { return plan().filter(function (it) { return (r.games || []).indexOf(it.g.game_id) >= 0; }); }, r.games || [], r);
        if (k === "manual") {
            var prod = manualGames(r.mkind).filter(function (p) { return p.id === r.game; })[0];
            if (!prod) return toast("Игры нет в каталоге MUVSell или он не загрузился");
            return jobCreate(function () { return manualTodo(r.mkind, prod.id).map(function (h) { return { g: manualGame(prod, r.mkind), prod: prod, hours: h }; }); }, [], r);
        }
        if (k === "adopt") return jobAdopt(r);
        if (k === "reprice") return jobReprice(r);
        if (k === "titles") return jobTitles(r);
        if (k === "retext") return jobRetext(r);
        if (k === "offcreate") return jobOffCreate(r);
        if (k === "offsteam") return jobOffSteam(r.game);
        if (k === "delete") {
            var ids = r.lots || [];
            return jobDelete(MAPS.filter(function (m) { return ids.indexOf(String(m.lotId)) >= 0; }), true);
        }
    }

    // --- фон: наличие, цены, окончания аренды, новые игры
    var state = { low: false, priceAt: 0, pollAt: 0, apiBad: 0, apiDown: false, rehideNote: 0, offAt: 0, newsAt: 0, offWarned: {}, offFail: {}, enShort: false }, busy = false;
    // Связь с MUVSell. "" сайт отвечает (ошибка ключа или баланса тоже ответ), иначе причина: нет связи или 5xx.
    function apiErr() {
        if (!String(S.key || "").trim()) return "";
        var r = api("GET", "/meta");
        if (r.err === "net" || /^http_5/.test(String(r.err))) {
            state.apiBad = state.apiBad || now();
            return r.err === "net" ? "нет связи" : (lastApiError || r.err);
        }
        if (state.apiDown && !S.hideApiDown) note("MUVSell снова отвечает", "");
        state.apiBad = 0;
        state.apiDown = false;
        return "";
    }
    var syncLog = null;
    function lotsWord(n) { return n + " " + plural(n, "лот", "лота", "лотов"); }
    function syncReport() {
        var L = syncLog;
        syncLog = null;
        if (!L) return;
        function names(list, why) { return list.filter(function (x) { return x[1] === why; }).map(function (x) { return mapLabel(x[0]); }); }
        var a = names(L.hid, "stock"), b = names(L.shown, "stock");
        if (a.length) note("сняты с продажи", "Нет аккаунтов на MUVSell: " + a.slice(0, 15).join("; "));
        if (b.length) note("снова в продаже", "Аккаунты появились: " + b.slice(0, 15).join("; "));
        a = names(L.hid, "cover"); b = names(L.shown, "cover");
        if (a.length) note("оффлайн-лоты сняты с продажи", "Выдача не оплачена (нет лицензии на игру, подписка продавца не действует): " + a.slice(0, 15).join("; "));
        if (b.length) note("оффлайн-лоты снова в продаже", "Выдача оплачена: " + b.slice(0, 15).join("; "));
        var n = names(L.shown, "api").length;
        if (n) note("MUVSell снова отвечает", "Вернул в продажу " + lotsWord(n) + ".");
        n = names(L.hid, "manual").length;
        if (n) note("лоты скрыты", "Снял с продажи " + lotsWord(n) + " плагина. Вернуть: кнопка \"Вернуть все лоты\".");
        n = names(L.shown, "manual").length;
        if (n) note("лоты возвращены", "Вернул в продажу " + lotsWord(n) + ".");
        if (L.again.length) {
            log("снятые лоты снова были в продаже, снял ещё раз: " + L.again.map(function (m) { return m.lotId; }).join(", "));
            if (now() - state.rehideNote >= 3600) {
                state.rehideNote = now();
                note("снятые лоты снова оказались в продаже", "Снял ещё раз: " + L.again.slice(0, 15).map(mapLabel).join("; ") + ". Их включает кто-то ещё: вы вручную, автовосстановление лотов или другой плагин.");
            }
        }
    }
    // Снимает лоты с продажи и возвращает, когда причина ушла: "Скрыть все лоты" (manual), MUVSell не отвечает (api), мало баланса (balance),
    // нет аккаунтов игры (stock), оффлайн-выдача не оплачена (cover). Сами изменения встают в срочную очередь: по лоту за такт.
    function syncLots() {
        if (!S.fpEdit || QH.length) return;
        var lots = MAPS.concat(OFF).filter(function (m) { return m.lotId && !m.off; });
        var want = {}, err = S.lotsPaused ? "" : apiErr();
        if (S.lotsPaused) lots.forEach(function (m) { want[String(m.lotId)] = "manual"; });
        else if (err) {
            var down = now() - state.apiBad;
            if (down < API_DOWN_SEC) return;         // короткий сбой: ничего не трогаем
            if (!state.apiDown) {
                state.apiDown = true;
                note("MUVSell не отвечает уже " + Math.floor(down / 60) + " мин", err + (S.hideApiDown ? ". Снимаю с продажи все лоты плагина. Верну сам, когда сайт заработает." : ". Лоты не трогаю: скрытие при сбое выключено."));
            }
            if (!S.hideApiDown) return;
            lots.forEach(function (m) { want[String(m.lotId)] = "api"; });
        } else if (S.hideLowBalance || lots.some(function (m) { return hideOn(m) || m.offline; })) {
            if (!String(S.key || "").trim()) return;
            var low = false;
            if (S.hideLowBalance) {
                var b = balance(true);
                if (!b) return;                      // нет данных: ничего не трогаем
                var lb = lowBalance(b);
                low = lb[0];
                if (low !== state.low) {
                    state.low = low;
                    note("баланс", low ? "Баланс MUVSell " + lb[1] + ", это не выше порога. Снимаю лоты с продажи, пополните баланс на сайте." : "Баланс пополнен (" + lb[1] + "), возвращаю лоты.");
                }
            }
            if (low) lots.forEach(function (m) { want[String(m.lotId)] = "balance"; });
            else {
                var prods = products(true);
                if (!prods) return;
                var stock = stockMap(prods), offs = {};
                if (lots.some(function (m) { return m.offline; })) {
                    var cat = offCatalog(true);
                    if (!cat) lots = lots.filter(function (m) { return !m.offline; });       // оффлайн-каталог не получен: оффлайн-лоты не трогаем
                    else cat.forEach(function (g) { offs[String(g.id)] = offWhy(g); });
                }
                lots.forEach(function (m) {
                    if (m.offline) {                 // не оплачено: снимаем всегда; нет аккаунтов: если включено автоскрытие
                        var why = offs[String(m.gameId)] === undefined ? "stock" : offs[String(m.gameId)];
                        if (why === "cover" || (why === "stock" && hideOn(m))) want[String(m.lotId)] = why;
                    } else if (hideOn(m) && !(stock[m.gameId] > 0)) want[String(m.lotId)] = "stock";
                });
            }
        }
        var dirty = false;
        lots.forEach(function (m) {
            var lid = String(m.lotId), why = want[lid];
            if (why && !HIDDEN[lid]) {
                QH.push(function () {
                    if (HIDDEN[lid]) return;
                    var res = setActive(m, false);
                    if (res === "rate") { QH = []; return; }     // лимит FunPay: остальное на следующем проходе
                    if (res) { HIDDEN[lid] = why; save("hidden", HIDDEN); syncLog.hid.push([m, why]); }
                });
            } else if (why && HIDDEN[lid] !== why) { HIDDEN[lid] = why; dirty = true; }      // уже снят: запоминаем новую причину, FunPay не трогаем
            else if (!why && HIDDEN[lid]) {
                QH.push(function () {
                    if (!HIDDEN[lid]) return;
                    var res = setActive(m, true);
                    if (res === "rate") { QH = []; return; }
                    if (res) { var reason = HIDDEN[lid]; delete HIDDEN[lid]; save("hidden", HIDDEN); syncLog.shown.push([m, reason]); }
                });
            }
        });
        if (dirty) save("hidden", HIDDEN);
        // Снятый плагином лот мог включить кто-то другой (вручную, автовосстановление, другой плагин): сверяем с FunPay и снимаем снова
        if (Object.keys(HIDDEN).length && now() >= recheckAt) {
            recheckAt = now() + RECHECK_SEC;
            var bySub = {};
            MAPS.concat(OFF).forEach(function (m) { if (HIDDEN[String(m.lotId)] && m.subcat && !m.off) (bySub[m.subcat] = bySub[m.subcat] || []).push(m); });
            Object.keys(bySub).forEach(function (sub) {
                QH.push(function () {
                    var mine = myLotsIn(sub);
                    if (!mine) return;
                    var onNow = {};
                    mine.forEach(function (l) { if (l.active) onNow[l.id] = 1; });
                    bySub[sub].forEach(function (m) {
                        if (!onNow[String(m.lotId)] || !HIDDEN[String(m.lotId)]) return;
                        QH.push(function () { if (HIDDEN[String(m.lotId)] && setActive(m, false) === "ok") syncLog.again.push(m); });
                    });
                });
            });
        }
    }
    // {stock} в шаблонах лотов: переписывает лоты автовыставления, у которых число свободных аккаунтов изменилось. Снятые с продажи ждут возврата.
    function syncStockTexts(limit) {
        if (!S.fpEdit || !usesStock() || Q.length) return;
        var prods = products();
        if (!prods) return;
        var stock = stockMap(prods);
        MAPS.filter(function (m) { return m.auto && m.lotId && !m.off && !HIDDEN[String(m.lotId)] && stock[m.gameId] !== undefined && m.stock !== stock[m.gameId]; }).slice(0, limit || 20).forEach(function (m) {
            later(function () {
                var res = retext(m, stock[m.gameId]);
                if (res === "ok") saveMaps();
                if (res === "rate") Q = [];
                if (res === "text") {
                    Q = [];
                    if (!state.enShort) { state.enShort = true; qNote("число свободных аккаунтов в лотах не обновляется. " + EN_SHORT_HINT); }
                }
            });
        });
    }
    function syncPrices() {
        if (Q.length) return;
        var prods = {}, changes = [];
        (products(true) || []).forEach(function (p) { prods[p.id] = p; });
        var targets = MAPS.filter(function (m) { return autoPrice(m) && prods[m.gameId] && !m.off && !m.ext && num(m.price) !== priceFor(prods[m.gameId], int(m.hours, 1), m); });
        targets.slice(0, 30).forEach(function (m) {
            later(function () {
                var old = m.price, price = priceFor(prods[m.gameId], int(m.hours, 1), m), res = setPrice(m, price);
                if (res === "rate") { Q = []; return; }
                if (res === "ok") changes.push(mapLabel(m) + ": " + (old ? old + "₽" : "?") + " → " + price + "₽");
                if (res) saveMaps();
            });
        });
        if (targets.length) later(function () { if (changes.length) note("цены обновлены у " + lotsWord(changes.length), changes.slice(0, 15).join("; ")); });
    }
    function endNotices() {
        var t0 = now(), dirty = false;
        for (var chat in RENT) {
            RENT[chat].forEach(function (r) {
                if (r.ended || !r.exp) return;
                var left = r.exp - t0, lang = langOf(r.chat);
                if (left > 0 && left <= num(S.warnMin) * 60 && !r.warned) {
                    r.warned = true;
                    dirty = true;
                    sendTo(r.chat, t("warn", lang, { game: r.game, login: r.login, left: leftText(left, lang), minutes: Math.max(1, Math.floor(left / 60)), expires: whenTz(r.exp, lang) }));
                }
                if (left > 0) return;
                if (String(S.key || "").trim()) {    // продлить могли и на сайте: сверяемся, прежде чем прощаться
                    var res = api("GET", "/rental/" + r.id);
                    if (res.err === "net" || res.err === "wait" || /^http_5/.test(String(res.err))) return;     // MUVSell не ответил: идёт ли аренда, не знаем
                    var rental = (res.data || {}).rental || {};
                    if (rental.status === "active" && ts(rental.endsAt) > t0) { r.exp = ts(rental.endsAt); dirty = true; return; }
                }
                r.ended = true;
                dirty = true;
                if (S.notifyEnd) sendTo(r.chat, t("ended", lang, { game: r.game, login: r.login }));
                log("аренда закончилась: " + r.login + ", " + r.game + ", " + (r.buyer || ""));
            });
        }
        var cutoff = t0 - 86400;
        for (var c in RENT) {
            var keep = RENT[c].filter(function (r) { return r.exp > cutoff; });
            if (keep.length !== RENT[c].length) { dirty = true; if (keep.length) RENT[c] = keep; else delete RENT[c]; }
        }
        if (dirty) saveRent();
    }
    function passwords() {
        passWait = passWait.filter(function (p) {
            var rec = recById(p.rid);
            if (!rec) return false;
            p.tries++;
            var a = accOf(api("GET", "/rental/" + p.rid).data, rec.login), lang = langOf(rec.chat);
            if (a && a.password && a.password !== p.old) {
                sendTo(p.chat, t("pass_ok", lang, { game: rec.game, login: rec.login, password: a.password }));
                return false;
            }
            if (p.tries >= 30) {
                sendTo(p.chat, t("pass_fail", lang, { login: rec.login, reason: "смена затянулась, продавец уже уведомлён" }));
                note("пароль не сменился", rec.login + ": смена не завершилась за 5 минут, проверьте на сайте.");
                return false;
            }
            return true;
        });
    }
    // Подписка продавца: за 3 дня до конца и когда закончилась, по одному уведомлению
    function offSubWarn(acc) {
        var sub = acc.subscription || {}, end = ts(sub.endsAt);
        if (!end) return;
        var left = end - now(), only = S.offMode === "covered", key, text;
        if (sub.active && left < 3 * 86400) {
            key = "3:" + end;
            text = "Подписка продавца на оффлайн-игры закончится " + whenTz(end) + ". Продлить можно во вкладке \"Оффлайн\". " + (only ? "Без неё лоты игр без лицензии снимутся с продажи." : "Без неё выдачи игр без лицензии снова станут платными.");
        } else if (!sub.active && left > -2 * 86400) {
            key = "0:" + end;
            text = "Подписка продавца на оффлайн-игры закончилась. " + (only ? "Лоты игр без лицензии сняты с продажи." : "Выдачи игр без лицензии теперь по цене MUVSell, цены их лотов подняты по наценке.");
        } else return;
        if (state.offWarned[key]) return;
        state.offWarned[key] = 1;
        note("подписка продавца", text);
    }
    // Раз в OFF_TICK: уведомления о подписке продавца, цены оффлайн-лотов автовыставления и автодобавление лотов новых игр
    function offTick() {
        if (now() - state.offAt < OFF_TICK || !(OFF.length || S.offAuto) || !String(S.key || "").trim() || Q.length) return;
        state.offAt = now();
        var acc = offAccess(true);
        if (acc) offSubWarn(acc);
        var cat = offCatalog(true);
        if (!cat) return;
        var by = {};
        cat.forEach(function (g) { by[String(g.id)] = g; });
        if (S.fpEdit) OFF.forEach(function (o) {
            if (!o.auto || !by[String(o.gameId)]) return;
            var price = offPrice(by[String(o.gameId)]);
            if (num(o.price) !== price) later(function () { var res = setPrice(o, price); if (res === "rate") Q = []; else if (res) saveOff(); });
        });
        if (!S.offAuto) return;
        var made = [], tried = 0;
        offPlan(cat).forEach(function (g) {
            var sec = offSection(g);
            if (tried >= OFF_AUTO_BATCH || now() - num(state.offFail[g.id]) <= 6 * 3600 || offCount(sec.sub) >= cap(sec.sub)) return;
            tried++;
            later(function () {
                var res = offCreate(g, sec.sub, sec.name);
                if (res.lost) { Q = []; return loginLost(); }
                if (res.o) return made.push(res.o);
                state.offFail[g.id] = now();         // эту игру через 6 ч, чтобы она не держала остальные
                if (res.rate) { Q = []; return; }
                note("оффлайн-лот \"" + g.name + "\" не создан", (res.err || "?") + ". Повторю через 6 ч.");
            });
        });
        if (tried) later(function () { if (made.length && S.notifyNews) note("выставлены оффлайн-лоты новых игр", made.map(function (o) { return o.game + ": " + o.price + " ₽"; }).join("; ")); });
    }
    // Новые игры на MUVSell: одно уведомление. Первый запуск: известны игры с привязками; без привязок вообще запоминаем весь каталог молча.
    function newGamesCheck() {
        var prods = (products() || []).filter(function (p) { return p.available; });
        if (!prods.length) return;
        var known = {}, list = S.knownGames;
        if (!list) { list = MAPS.map(function (m) { return m.gameId; }); if (!list.length) list = prods.map(function (p) { return p.id; }); }
        list.forEach(function (id) { known[id] = 1; });
        var fresh = prods.filter(function (p) { return !known[p.id]; });
        prods.forEach(function (p) { known[p.id] = 1; });
        S.knownGames = Object.keys(known).sort();
        if (fresh.length) {
            fpMap(true);        // каталог свежий, а карта в кэше до часа: без этого новые игры числились бы "без раздела"
            var sections = {};
            (fpMap().games || []).forEach(function (g) { sections[g.game_id] = 1; });
            var auto = fresh.filter(function (p) { return sections[p.id]; }), manual = fresh.filter(function (p) { return !sections[p.id]; });
            S.newsPending = auto.map(function (p) { return p.id; });
            if (S.notifyNews) note("на MUVSell вышли новые игры", fresh.slice(0, 15).map(function (p) { return p.name; }).join(", ") + (fresh.length > 15 ? " и ещё " + (fresh.length - 15) : "") +
                (auto.length ? ". Кнопка \"Выставить новые игры\" во вкладке \"Автовыставление\" создаст лоты на все сроки из длительностей." : "") +
                (manual.length ? " Без своего раздела на FunPay: " + manual.slice(0, 10).map(function (p) { return p.name; }).join(", ") + ". Их можно выставить в Steam или в \"Прочие игры\"." : ""));
        }
        saveS();
    }
    function slowPass() {
        if (passWait.length) passwords();
        if (Object.keys(EXT).length) extCleanup();
        if (now() - state.pollAt < Math.max(15, int(S.pollSec, 60))) return;
        state.pollAt = now();
        if (!S.enabled) return;
        endNotices();
        syncLots();
        if (job) return;
        tagLots(10);
        syncStockTexts(20);
        if (S.fpEdit && !Q.length && now() - state.priceAt > Math.max(1, num(S.priceMin) || 5) * 60) { state.priceAt = now(); syncPrices(); }
        offTick();
        if (now() - state.newsAt > NEWS_EVERY) { state.newsAt = now(); newGamesCheck(); }
        flushQ();
    }
    // Один шаг изменений лотов за такт: срочное (снять и вернуть в продажу), затем долгая задача, затем остальное
    function fastPass() {
        if (QH.length) {
            syncLog = syncLog || { hid: [], shown: [], again: [] };
            QH.shift()();
            if (!QH.length) syncReport();
            return;
        }
        if (syncLog) syncReport();
        if (job) return jobStep();
        if (Q.length) Q.shift()();
    }
    setInterval(function () {
        if (busy) return;
        busy = true;
        try { slowPass(); } catch (e) { log("ошибка фоновой проверки: " + e); } finally { busy = false; }
    }, 10000);
    setInterval(function () {
        if (busy || (!QH.length && !job && !Q.length && !syncLog)) return;
        busy = true;
        try { fastPass(); } catch (e) { log("ошибка работы с лотами: " + e); } finally { busy = false; }
    }, 3000);
    setTimeout(function () {
        try { if (Object.keys(ISSUE).length) resumeIssues(); } catch (e) { log("продолжение выдачи: " + e); }
        try { checkMissed(); } catch (e2) { log("заказы из простоя: " + e2); }
        if (JOB_SAVED && !job) note("задача \"" + JOB_SAVED.title + "\" оборвалась", "Программу закрыли, пока она шла. Продолжить можно в настройках плагина, на главной вкладке.");
    }, 15000);

    // --- настройки
    var view = "main", draft = {}, textKey = 0, period = "7", planShown = null, sure = "", sureRid = "", manualFound = null, offFound = null, offDraft = null;
    var PERIODS = { today: "Сегодня", yday: "Вчера", "7": "7 дней", "30": "30 дней", all: "Всё время" };
    function redraw() {}        // экран перерисовывается только по нажатию: иначе на телефоне сбросится то, что вы сейчас печатаете
    function tri(v, global) { return v === undefined || v === null ? "как в общих (" + (global ? "да" : "нет") + ")" : (v ? "да" : "нет"); }
    function cycle(v) { return v === undefined || v === null ? true : (v ? false : null); }
    function ask(key) { if (sure === key) { sure = ""; return true; } sure = key; sureRid = rid(key.split(":")[0]); render(); return false; }
    function durList(list) { return (list || []).map(function (h) { return h % 24 === 0 ? h / 24 + "д" : String(h); }).join(", "); }
    function hasKey() { return !!String(S.key || "").trim(); }
    function searchGames(list, q) {
        q = norm(q);
        return list.filter(function (p) { return !q || norm(p.name).indexOf(q) >= 0; })
            .sort(function (a, b) { return (int(b.inStock, 0) > 0) - (int(a.inStock, 0) > 0) || String(a.name).localeCompare(String(b.name)); }).slice(0, 8);
    }
    function statsFor(p) {
        var d0 = new Date(), day0 = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime() / 1000, from = 0, to = Infinity;
        if (p === "today") from = day0; else if (p === "yday") { from = day0 - 86400; to = day0; } else if (p !== "all") from = now() - int(p, 7) * 86400;
        var a = { orders: {}, refunded: {}, n: 0, ext: 0, bonus: 0, off: 0, rev: 0, cost: 0, hours: 0, refund: 0, games: {} };
        SALES.forEach(function (s) {
            if (s.ts < from || s.ts >= to) return;
            if (s.order && (s.kind === "new" || s.kind === "ext" || s.kind === "offline")) { a.orders[s.order] = 1; if (s.refunded) a.refunded[s.order] = 1; }
            if (s.refunded) { a.refund += num(s.rev); return; }         // возвраты не считаем ни выручкой, ни расходом
            if (s.kind === "new") a.n++; else if (s.kind === "ext") a.ext++; else if (s.kind === "offline") a.off++; else a.bonus++;
            a.rev += num(s.rev); a.cost += num(s.cost); a.hours += int(s.hours, 0);
            a.games[s.game] = (a.games[s.game] || 0) + num(s.rev) - num(s.cost);
        });
        a.sold = Object.keys(a.orders).length - Object.keys(a.refunded).length;
        a.refunds = Object.keys(a.refunded).length;
        return a;
    }
    function resumeCard() {
        if (!JOB_SAVED || job) return null;
        return Card(
            T("Задача \"" + JOB_SAVED.title + "\" оборвалась: программу закрыли, пока она шла.", { bold: true }),
            hint("Сделанное сохранено. Если продолжить, плагин доделает только оставшееся."),
            Row(Btn("Продолжить", "window.mvsJob('resume')"), Btn("Забыть", "window.mvsJob('drop')", true))
        );
    }
    function render() {
        var kids = [H("MUVSell Rent")].concat(tabs([["main", "Главная"], ["maps", "Привязки"], ["rent", "Аренды"], ["stat", "Статистика"], ["auto", "Автовыставление"], ["off", "Оффлайн"], ["set", "Настройки"], ["text", "Сообщения"]], view, "window.mvsView"));
        var i;
        if (view === "main") {
            kids.push(Sw("Плагин работает", "m_on", S.enabled, "window.mvsOn()"));
            if (resumeCard()) kids.push(resumeCard());
            kids.push(Card(
                In("API-ключ MUVSell (сайт muvsell.store, Профиль, API)", "m_key", S.key),
                Row(Btn("Сохранить ключ", "window.mvsKey()", false, "Проверяю..."), Btn("Баланс", "window.mvsBalance()", true, "Проверяю..."))
            ));
            var todo = [];
            if (!hasKey()) todo.push("впишите API-ключ");
            if (!MAPS.length && !OFF.length) todo.push("привяжите лот к игре во вкладке \"Привязки\" или создайте лоты во вкладке \"Автовыставление\"");
            kids.push(todo.length ? T("Чтобы заработало: " + todo.join("; ") + ".", { color: "#D98A00" }) : T("Всё готово к работе. Привязок: " + MAPS.length + ", оффлайн-лотов: " + OFF.length + ", аренд сейчас: " + allActive().length + ".", { color: "#2E9E5B" }));
            var hidden = Object.keys(HIDDEN).length, probs = Object.keys(PROBLEMS);
            if (state.apiDown) kids.push(T("MUVSell не отвечает." + (S.hideApiDown ? " Лоты плагина сняты с продажи и вернутся сами." : ""), { color: "#D94A4A" }));
            kids.push(Card(
                T("Лоты", { bold: true }),
                T(S.lotsPaused ? "Все лоты плагина скрыты кнопкой." : "Снято с продажи сейчас: " + hidden + (QH.length ? " · в очереди изменений: " + QH.length : "")),
                Row(Btn(S.lotsPaused ? "Вернуть все лоты" : (sure === "hideall" ? "Точно скрыть все лоты?" : "Скрыть все лоты"), "window.mvsMain('hide')", true), Btn("Пересчитать цены", "window.mvsMain('reprice')", true), Btn("Обновить названия", "window.mvsMain('titles')", true)),
                job ? T(jobLine()) : (jobResult ? T(jobResult) : hint("Скрытые лоты плагин возвращает в продажу сам, когда причина уходит."))
            ));
            if (probs.length) {
                var pc0 = [T("Проблемные лоты: " + probs.length, { bold: true })];
                probs.slice(0, 8).forEach(function (lid) { var p = PROBLEMS[lid]; pc0.push(T(lid + " " + (p.game || "") + ": " + (p.err || "") + (p.until > now() ? " · пауза ещё " + Math.ceil((p.until - now()) / 60) + " мин" : ""))); });
                pc0.push(Btn("Снять паузы", "window.mvsMain('unpause')", true));
                kids.push({ type: "Card", children: pc0 });
            }
            kids.push(Card(
                T("Как это работает", { bold: true }),
                T("1. На muvsell.store создайте ключ API и пополните баланс."),
                T("2. Создайте лоты во вкладке \"Автовыставление\" или привяжите свой лот к игре: сколько часов аренды выдавать за 1 шт."),
                T("3. Покупатель оплачивает лот, плагин арендует аккаунт на MUVSell по цене сайта и присылает логин и пароль. Разница цен это ваш заработок."),
                T("Каждая покупка лота выдаёт новый аккаунт, количество в заказе добавляет время. Продлить свой аккаунт покупатель может командой " + extWord() + ": плагин создаст для него временный лот."),
                T("Вкладка \"Оффлайн\": продажа игры навсегда (общий Steam-аккаунт, игра в автономном режиме).")
            ));
            kids.push(hint("Команды покупателя: " + codeWord() + ", !время, !данные, " + extWord() + ", !кик, !пароль, !офлайн, !помощь. Английские команды (!code, !help) переключают ответы на английский."));
        } else if (view === "maps") {
            MAPS.forEach(function (m, n) {
                var prod = product(m.gameId), lid = String(m.lotId), p = PROBLEMS[lid];
                kids.push({ type: "Card", children: [
                    T(mapLabel(m) + (m.ext ? " · лот продления" : "") + (m.manual ? " · " + (m.manual === "steam" ? "Steam" : "Прочие игры") : "") + (m.off ? " · выключена" : ""), { bold: true }),
                    T("Лот " + lid + (m.tag ? " · " + m.tag : "") + ((m.titles || [])[0] ? " · " + m.titles[0] : "")),
                    T("Наценка: " + markupOf(m) + "% (" + markupSrc(m) + ") · цена: " + (autoPrice(m) ? "следует за MUVSell" : "не меняется") + (m.price ? " · " + m.price + "₽" : "") +
                        (prod ? " · на MUVSell " + int(prod.inStock, 0) + " акк." : "") + (HIDDEN[lid] ? " · снят с продажи: " + (HIDE_WHY[HIDDEN[lid]] || HIDDEN[lid]) : "") + (p ? " · ошибка FunPay: " + p.err : "")),
                    Row(Btn(autoPrice(m) ? "Не менять цену" : "Вести цену", "window.mvsMap('reprice'," + n + ")", true), Btn(m.off ? "Включить" : "Выключить", "window.mvsMap('off'," + n + ")", true)),
                    Row(Btn("Скрывать без аккаунтов: " + tri(m.autohide, S.hideNoStock), "window.mvsMap('hide'," + n + ")", true), Btn("Бонус за отзыв: " + tri(m.bonus, S.reviewBonus), "window.mvsMap('bonus'," + n + ")", true)),
                    In("Своя наценка, % (пусто: раздела или общая)", "mm_" + n, m.markup === undefined || m.markup === null ? "" : m.markup),
                    Row(Btn("Сохранить наценку", "window.mvsMap('markup'," + n + ")", true), Btn(sure === "mapdel:" + n ? "Точно удалить?" : "Удалить привязку", "window.mvsMap('del'," + n + ")", true)),
                ] });
            });
            if (!MAPS.length) kids.push(hint("Привязок пока нет."));
            var nc = [T("Новая привязка", { bold: true })];
            if (!draft.lotId) {
                nc.push(In("ID лота или ссылка на лот FunPay", "d_lot", gs("d_lot")));
                nc.push(Btn("Найти лот", "window.mvsDraftLot()", false, "Ищу..."));
            } else if (!draft.gameId) {
                nc.push(T("Лот " + draft.lotId + ": " + (draft.titles[0] || "без названия")));
                nc.push(In("Название игры (или его часть)", "d_q", gs("d_q")));
                nc.push(Row(Btn("Найти игру", "window.mvsDraftSearch()", false, "Ищу..."), Btn("Отмена", "window.mvsDraftCancel()", true)));
                (draft.found || []).forEach(function (p, n) {
                    nc.push(Row(T(p.name + " · " + int(p.inStock, 0) + " акк. · " + num(p.pricePerHourRub) + "₽/ч"), Btn("Выбрать", "window.mvsDraftGame(" + n + ")", true)));
                });
                if (draft.found && !draft.found.length) nc.push(hint("Ничего не найдено."));
            } else {
                nc.push(T("Лот " + draft.lotId + ": " + (draft.titles[0] || "без названия")));
                nc.push(T("Игра: " + draft.game));
                nc.push(In("Сколько аренды за 1 шт.: часы числом или дни с буквой д (3, 7д)", "d_hours", gs("d_hours")));
                nc.push(Row(Btn("Привязать", "window.mvsDraftSave()"), Btn("Отмена", "window.mvsDraftCancel()", true)));
            }
            kids.push({ type: "Card", children: nc });
            kids.push(hint("Плагин сам дописывает в конец описания каждого привязанного лота его ID (например rentM-1001) и находит оплаченный лот по нему, а не только по названию."));
        } else if (view === "rent") {
            var act = allActive();
            if (!act.length) kids.push(hint("Сейчас никто ничего не арендует."));
            act.forEach(function (r) {
                kids.push(Card(
                    T(r.game + " · " + r.login, { bold: true }),
                    T((r.buyer || "") + " · заказ #" + r.order + " · осталось " + leftText(r.exp - now()) + ", до " + when(r.exp)),
                    In("Продлить на (часы или дни с буквой д)", "x_" + r.id, ""),
                    Row(Btn("Продлить", "window.mvsRent('ext','" + r.id + "')", true, "..."), Btn("Код", "window.mvsRent('code','" + r.id + "')", true, "..."), Btn("Сменить пароль", "window.mvsRent('pass','" + r.id + "')", true, "..."),
                        Btn(sure === "rentend:" + r.id ? "Точно завершить?" : "Завершить", "window.mvsRent('end','" + r.id + "')", true, "..."))
                ));
            });
        } else if (view === "stat") {
            kids.push({ type: "Row", children: Object.keys(PERIODS).map(function (p) { return Btn((p === period ? "• " : "") + PERIODS[p], "window.mvsPeriod('" + p + "')", p !== period); }) });
            var a = statsFor(period);
            kids.push(Card(
                T("Заказов: " + a.sold + " · выдач аренды: " + a.n + " · продлений: " + a.ext + " · оффлайн-игр: " + a.off + " · бонусов: " + a.bonus),
                T("Возвратов: " + a.refunds + (a.refund ? " на " + a.refund.toFixed(2) + "₽" : "") + " · часов аренды: " + a.hours),
                T("Выручка: " + a.rev.toFixed(2) + "₽ · расход на MUVSell: " + a.cost.toFixed(2) + "₽"),
                T("Прибыль: " + (a.rev - a.cost).toFixed(2) + "₽", { bold: true })
            ));
            Object.keys(a.games).sort(function (x, y) { return a.games[y] - a.games[x]; }).slice(0, 8).forEach(function (g) { kids.push(T(g + ": " + a.games[g].toFixed(2) + "₽")); });
            kids.push(hint("Выручка считается по сумме заказа на FunPay, без учёта комиссии вывода. Возвраты в прибыль не входят."));
            kids.push(Btn(sure === "statclear" ? "Точно удалить весь журнал продаж?" : "Сбросить статистику", "window.mvsStat('clear')", true));
        } else if (view === "auto") {
            kids.push(hint("Плагин сам создаёт лоты для игр из каталога MUVSell: по одному на каждую игру и срок, в нужном разделе FunPay, с ценой по наценке. Лоты сразу привязаны."));
            if (resumeCard()) kids.push(resumeCard());
            if (job || jobResult) {
                kids.push(Card(
                    T(job ? jobLine() : jobResult, { bold: !!job }),
                    job ? Row(Btn("Обновить", "window.mvsView('auto')", true), Btn("Остановить", "window.mvsJob('stop')", true)) : Btn("Скрыть", "window.mvsJob('hide')", true)
                ));
                if (job) kids.push(hint("Можно закрыть настройки: работа идёт в фоне, по одному шагу раз в несколько секунд."));
            }
            kids.push(Card(
                In("Сроки аренды через запятую: часы числом или дни с буквой д", "a_durs", durList(S.apDurations)),
                In("Не больше стольких лотов плагина в одном разделе (в \"Прочих играх\" втрое больше)", "a_cap", S.lotCap),
                In("Наценка новых лотов, % (пусто: раздела или общая)", "a_own", S.apOwn === null || S.apOwn === undefined ? "" : S.apOwn),
                In("Только игры с такими словами в названии (пусто: все)", "a_filter", S.apFilter),
                In("Регион лотов в Steam \"Аккаунты с играми\" (как в списке на FunPay)", "a_region", S.steamRegion),
                Sw("Создавать лоты сразу активными", "a_active", S.apActive, ""),
                Row(Btn("Сохранить", "window.mvsAuto('save')"), Btn("Показать план", "window.mvsAuto('plan')", true, "Считаю..."))
            ));
            if (planShown) {
                var pc = [T("К созданию: " + planShown.length + " " + plural(planShown.length, "лот", "лота", "лотов"), { bold: true })];
                planShown.slice(0, 10).forEach(function (p) { pc.push(T(p.g.name + ", " + dur(p.hours) + ": " + priceFor(p.prod, p.hours, { subcat: p.g.funpay.subcategory_id, markup: S.apOwn }) + "₽ (раздел " + p.g.funpay.subcategory_id + ")")); });
                if (planShown.length > 10) pc.push(hint("и ещё " + (planShown.length - 10)));
                kids.push({ type: "Card", children: pc });
            }
            var autos = MAPS.filter(function (m) { return m.auto; }).length, news = (S.newsPending || []).length;
            kids.push(Card(
                T("Лотов автовыставления: " + autos, { bold: true }),
                Row(Btn(sure === "create" ? "Точно создать?" : "Создать недостающие", "window.mvsAuto('create')"), Btn("Найти мои лоты на FunPay", "window.mvsAuto('adopt')", true)),
                news ? Btn("Выставить новые игры (" + news + ")", "window.mvsAuto('news')", true) : hint("Перед созданием плагин сверяет лоты с FunPay: удалённые на сайте пересоздаются, уже стоящие привязываются, дубли не создаются."),
                Row(Btn(sure === "retext" ? "Точно переписать?" : "Переписать тексты по шаблонам", "window.mvsAuto('retext')", true), Btn(sure === "delete" ? "Точно удалить " + autos + "?" : "Удалить их с FunPay", "window.mvsAuto('delete')", true))
            ));
            var mc = [T("Общие разделы: Steam \"Аккаунты с играми\" и \"Прочие игры\"", { bold: true }),
                hint("Сюда игра выставляется по вашему выбору, сразу на все сроки. В Steam можно любую игру, в \"Прочие игры\" только те, у которых на FunPay нет своего раздела. Лимит предложений в разделе общий на все игры."),
                In("Название игры (или его часть)", "a_mq", gs("a_mq")),
                Row(Btn("Найти для Steam", "window.mvsAuto('find','steam')", true, "Ищу..."), Btn("Найти для \"Прочих игр\"", "window.mvsAuto('find','other')", true, "Ищу..."))];
            if (manualFound) {
                manualFound.list.forEach(function (p, n) {
                    var left = manualTodo(manualFound.kind, p.id).length, total = (S.apDurations || []).length;
                    mc.push(Row(T(p.name + " · " + (total - left) + "/" + total + " сроков · " + int(p.inStock, 0) + " акк."), left ? Btn("Выставить", "window.mvsAuto('manual'," + n + ")", true) : T("уже выставлена")));
                });
                if (!manualFound.list.length) mc.push(hint("Ничего не найдено."));
            }
            kids.push({ type: "Card", children: mc });
            kids.push(hint("Названия и описания лотов правятся во вкладке \"Сообщения\" (шаблоны \"Лот аренды\"). В них можно вписать {stock}: число свободных аккаунтов, плагин обновляет его сам. Начните с одной игры: впишите её название в фильтр." +
                (DESKTOP ? " При удалении лотов программа спросит разрешение." : "")));
        } else if (view === "off") {
            kids.push(hint("Игра навсегда: покупатель получает общий Steam-аккаунт с игрой и играет в автономном режиме. После оплаты плагин берёт игру на MUVSell и присылает логин, пароль и инструкцию. Код Steam Guard: " + codeWord() + ", данные ещё раз: !офлайн."));
            if (job || jobResult) kids.push(Card(T(job ? jobLine() : jobResult, { bold: !!job }), job ? Row(Btn("Обновить", "window.mvsView('off')", true), Btn("Остановить", "window.mvsJob('stop')", true)) : Btn("Скрыть", "window.mvsJob('hide')", true)));
            var cat = hasKey() ? offCatalog() : null, acc = hasKey() ? offAccess() : null, byId = {}, covered = S.offMode === "covered";
            (cat || []).forEach(function (g) { byId[String(g.id)] = g; });
            var sub = (acc || {}).subscription || {}, head;
            if (acc) head = "Подписка продавца: " + (sub.active ? "действует до " + whenTz(ts(sub.endsAt)) + ", за 24 часа выдано " + int(sub.usedToday, 0) + " из " + (sub.perDay === undefined ? "?" : sub.perDay) : "нет (" + num(sub.priceRub) + " ₽ за " + sub.days + " дн.)") + " · лицензий на игры: " + (acc.licenses || []).length;
            else head = "Подписка и лицензии: MUVSell не ответил или не задан API-ключ.";
            var planN = cat ? offPlan(cat).length : 0, homeless = cat ? offHomeless(cat).length : 0;
            kids.push(Card(
                T("Чем оплачиваются выдачи", { bold: true }),
                hint("Лицензия на игру: один раз, дальше её выдачи бесплатны навсегда. Подписка продавца: весь каталог бесплатно, пока действует. Без них: цена MUVSell за каждую выдачу."),
                T(head),
                Row(Btn(sure === "offsub" ? "Точно оплатить с баланса MUVSell?" : (sub.active ? "Продлить подписку" : "Оформить подписку") + (acc ? " за " + num(sub.priceRub) + " ₽" : ""), "window.mvsOff('sub')", true, "..."),
                    Btn("Режим: " + (covered ? "только оплаченные" : "все игры"), "window.mvsOff('mode')", true))
            ));
            kids.push(Card(
                T("Цены и выставление", { bold: true }),
                In("Цена лота, когда выдача оплачена (лицензия или подписка), ₽", "o_price", S.offPrice),
                In("Наценка на цену MUVSell, когда выдача не оплачена, %", "o_markup", S.offMarkup),
                Sw("Сам выставлять оффлайн-лоты новых игр", "o_auto", S.offAuto, ""),
                Row(Btn("Сохранить", "window.mvsOff('save')"), Btn(sure === "offcreate" ? "Точно выставить " + planN + "?" : "Выставить недостающие (" + planN + ")", "window.mvsOff('create')", true)),
                hint("Лоты встают в раздел самой игры → \"Оффлайн активации\"." + (homeless ? " Без своего раздела на FunPay: " + homeless + ", их можно выставить только в Steam." : ""))
            ));
            var fc = [T("Лицензии и Steam → \"Оффлайн активации\"", { bold: true }), In("Название игры (или его часть)", "o_q", gs("o_q")), Btn("Найти игру", "window.mvsOff('find')", true, "Ищу...")];
            (offFound || []).forEach(function (g, n) {
                fc.push(T(g.name + " · " + (g.inStock ? "есть аккаунты" : "нет аккаунтов") + " · выдача " + num(g.priceRub) + " ₽" + (g.licensed ? " · лицензия есть" : "")));
                fc.push(Row(g.licensed ? T("") : Btn(sure === "offlic:" + n ? "Точно купить за " + num(g.licensePriceRub) + " ₽?" : "Лицензия за " + num(g.licensePriceRub) + " ₽", "window.mvsOff('lic'," + n + ")", true, "..."),
                    Btn("Выставить в Steam", "window.mvsOff('steam'," + n + ")", true)));
            });
            if (offFound && !offFound.length) fc.push(hint("Ничего не найдено."));
            kids.push({ type: "Card", children: fc });
            OFF.forEach(function (o, n) {
                var g = byId[String(o.gameId)], lid = String(o.lotId);
                var mark = HIDDEN[lid] ? "снят с продажи: " + (HIDE_WHY[HIDDEN[lid]] || HIDDEN[lid]) : (!cat ? "" : (!g || !g.inStock ? "аккаунтов нет или игра снята" : (g.covered ? "выдача оплачена" : "по цене MUVSell")));
                kids.push(Card(
                    T(o.game + " навсегда" + (offInSteam(o) ? " · Steam" : ""), { bold: true }),
                    T("Лот " + lid + (o.price ? " · " + o.price + "₽" : "") + (mark ? " · " + mark : "") + (o.auto ? "" : " · свой лот")),
                    Row(Btn("Скрывать без аккаунтов: " + tri(o.autohide, S.hideNoStock), "window.mvsOff('hide'," + n + ")", true),
                        Btn(sure === "offdel:" + n ? "Точно?" : (o.auto ? "Удалить с FunPay" : "Отвязать"), "window.mvsOff('del'," + n + ")", true))
                ));
            });
            var bc = [T("Привязать свой лот", { bold: true })];
            if (!offDraft) { bc.push(In("ID лота или ссылка на лот FunPay, который продаёт игру навсегда", "o_lot", gs("o_lot"))); bc.push(Btn("Найти лот", "window.mvsOff('lot')", true, "Ищу...")); }
            else {
                bc.push(T("Лот " + offDraft.lotId + ": " + (offDraft.titles[0] || "без названия") + ". Найдите игру выше и нажмите \"Привязать\"."));
                (offFound || []).forEach(function (g, n) { bc.push(Row(T(g.name), Btn("Привязать", "window.mvsOff('bind'," + n + ")", true))); });
                bc.push(Btn("Отмена", "window.mvsOff('cancel')", true));
            }
            kids.push({ type: "Card", children: bc });
        } else if (view === "set") {
            kids.push(Card(
                T("Цены", { bold: true }),
                In("Общая наценка, %", "s_markup", S.markup),
                In("Наценки разделов FunPay: раздел=процент через запятую (например 451=40, 89=60)", "s_cat", Object.keys(S.catMarkup).map(function (k) { return k + "=" + S.catMarkup[k]; }).join(", ")),
                In("Лот не дешевле, ₽", "s_minprice", S.minPrice),
                In("Как часто сверять цены, минут", "s_pricemin", S.priceMin),
                Sw("Считать от цены срока со скидкой, а не от цены часа", "s_vol", S.volDiscount, ""),
                Btn("Чем платить на MUVSell: " + ({ rub: "рубли", usd: "доллары", auto: "рубли, а не хватило: доллары" }[S.pay] || S.pay), "window.mvsPay()", true),
                hint("Наценка: своя у привязки, иначе раздела, иначе общая. Цена округляется вверх до копейки.")
            ));
            kids.push(Card(
                T("Связь с MUVSell", { bold: true }),
                DESKTOP ? In("Прокси для MUVSell: ip:порт, ip:порт:логин:пароль или socks5://ip:порт (пусто: без прокси)", "s_proxy", S.proxy)
                    : hint("Прокси для MUVSell работает только в программе для компьютера. На телефоне плагин ходит напрямую, а если muvsell.store не отвечает, через запасной адрес."),
                Btn("Проверить связь", "window.mvsNet()", true, "Проверяю..."),
                hint("Порядок: " + (DESKTOP ? "прокси (если задан), " : "") + "напрямую, запасной адрес MUVSell. Маршрут, который не ответил, плагин пропускает 10 минут.")
            ));
            kids.push(Card(
                T("Лоты", { bold: true }),
                Sw("Плагин может менять цену, тексты и видимость лотов", "s_edit", S.fpEdit, ""),
                Sw("Снимать лот с продажи, пока на MUVSell нет аккаунтов", "s_hide", S.hideNoStock, ""),
                Sw("Снимать все лоты, если MUVSell не отвечает 5 минут", "s_down", S.hideApiDown, ""),
                Sw("Снимать лоты, когда баланс MUVSell ниже порога", "s_low", S.hideLowBalance, ""),
                In("Порог баланса", "s_balmin", S.balanceMin),
                In("Как часто сверять наличие, секунд (от 15)", "s_poll", S.pollSec)
            ));
            kids.push(Card(
                T("Покупатель", { bold: true }),
                Sw("Вернуть деньги, если нет аккаунтов или баланса", "s_refund", S.autoRefund, ""),
                Sw("Бонус за отзыв", "s_bonus", S.reviewBonus, ""),
                In("Часов за отзыв", "s_bh", S.bonusHours),
                In("От скольки звёзд", "s_bs", S.bonusStars),
                Sw("Писать покупателю, что аренда закончилась", "s_end", S.notifyEnd, ""),
                In("Предупреждать за, минут (0: не писать)", "s_warn", S.warnMin),
                Sw("Продление по команде: временный лот на нужный срок", "s_extcmd", S.extCmd, ""),
                In("Слово для продления", "s_word", S.extWord),
                In("Сколько минут временный лот ждёт оплату", "s_extmin", S.extMinutes),
                In("Команда кода Steam Guard (если на !код отвечает ещё и другой плагин)", "s_code", S.codeWord),
                Sw("Отвечать по-английски тем, кто пишет английские команды", "s_en", S.enMsgs, ""),
                Sw("Разрешить покупателю !кик и !пароль", "s_cmds", S.buyerCmds, ""),
                Sw("Уведомлять меня о выдачах и продлениях", "s_ntf", S.notifySales, ""),
                Sw("Уведомлять о новых играх на MUVSell", "s_news", S.notifyNews, "")
            ));
            kids.push(Btn("Сохранить настройки", "window.mvsSet()"));
            if (DESKTOP && S.autoRefund) kids.push(hint("При первом возврате программа спросит разрешение. Выберите \"Разрешать всегда\"."));
        } else {
            var key = TEXT_KEYS[textKey];
            kids.push(Row(Btn("Назад", "window.mvsTextNext(-1)", true), Btn("Сообщение: " + TEXT_LABELS[key] + " (следующее)", "window.mvsTextNext(1)", true)));
            kids.push(Card(
                In("Текст", "t_text", (S.texts || {})[key] || TEXTS[key], true),
                Row(Btn("Сохранить", "window.mvsTextSave()"), Btn("Вернуть стандартный", "window.mvsTextReset()", true))
            ));
            kids.push(hint("Переменные: {game}, {login}, {password}, {hours}, {expires}, {left}, {code}, {ttl}, {word}, {guard}, {bonus}, {stars}, {reason}, {commands}. В текстах лотов: {game}, {time}, {stock}, {commands}, {tag}; в сообщении о лоте продления ещё {price}, {link}, {minutes}. Покупателям, которые пишут английские команды, уходят встроенные английские тексты. " + NL_HINT));
        }
        kids.push(hint("Автор оригинального плагина: @MUVSell. Версия по MUVSell Rent 1.2.17."));
        show(kids);
    }
    window.mvsView = function (v) { view = v; sure = ""; render(); };
    window.mvsOn = function () { S.enabled = on("m_on"); saveS(); };
    window.mvsKey = function () {
        S.key = gs("m_key").trim();
        saveS();
        cache.products = [0, null];
        cache.bal = [0, null];
        offCat = [0, null]; offAcc = [0, null];
        if (S.key) { var b = balance(true); toast(b ? "Ключ принят. Баланс: " + num(b.balanceRub) + " ₽ / " + num(b.balanceUsd) + " $" : "Ключ сохранён, но проверить его не вышло: " + (lastApiError || "нет связи с muvsell.store")); }
        render();
    };
    window.mvsBalance = function () {
        var b = balance(true);
        toast(b ? (b.username ? b.username + ": " : "") + num(b.balanceRub) + " ₽ / " + num(b.balanceUsd) + " $" : "Баланс не получен: " + human(hasKey() ? "net" : "no_key"));
        render();
    };
    window.mvsMain = function (act) {
        if (act === "hide") {
            if (!S.lotsPaused && !ask("hideall")) return;
            S.lotsPaused = !S.lotsPaused;
            saveS();
            state.pollAt = 0;
            toast(S.lotsPaused ? "Снимаю с продажи все лоты плагина" : "Возвращаю лоты в продажу");
        } else if (act === "reprice") {
            if (!products(true)) toast("Каталог MUVSell не загрузился"); else jobReprice();
        } else if (act === "titles") jobTitles();
        else if (act === "unpause") { PROBLEMS = {}; save("problems", PROBLEMS); toast("Паузы сняты"); }
        render();
    };
    window.mvsDraftLot = function () {
        var text = gs("d_lot"), m = /id=(\d+)/.exec(text) || /(\d{4,})/.exec(text);
        if (!m) { toast("Не вижу ID лота"); return render(); }
        if (mapByLot(m[1])) { toast("Лот " + m[1] + " уже привязан"); return render(); }
        if (offByLot(m[1])) { toast("Лот " + m[1] + " уже привязан как оффлайн-лот"); return render(); }
        var lf = null;
        try { lf = fpt.lots.getFields(m[1]); } catch (e) {}
        var titles = lf ? [lotField(lf, "fields[summary][ru]"), lotField(lf, "fields[summary][en]")].filter(Boolean) : [];
        if (!titles.length) { toast("Лот " + m[1] + " не открывается" + lastErr()); return render(); }
        draft = { lotId: m[1], titles: titles, subcat: int(lotField(lf, "node_id"), 0) };
        render();
    };
    window.mvsDraftSearch = function () {
        var prods = products();
        if (!prods) { toast("Каталог MUVSell не загрузился: " + human(hasKey() ? "net" : "no_key")); return render(); }
        draft.found = searchGames(prods, gs("d_q"));
        render();
    };
    window.mvsDraftGame = function (n) {
        var p = (draft.found || [])[n];
        if (!p) return;
        draft.gameId = p.id;
        draft.game = p.name;
        render();
    };
    window.mvsDraftCancel = function () { draft = {}; render(); };
    window.mvsDraftSave = function () {
        var hours = parseHours(gs("d_hours"));
        if (!hours) return toast("Нужен срок от " + MIN_HOURS + " до " + MAX_HOURS + " ч: число часов или дни с буквой д");
        MAPS = MAPS.filter(function (m) { return String(m.lotId) !== String(draft.lotId); });
        MAPS.push({ lotId: draft.lotId, subcat: draft.subcat || 0, titles: draft.titles, gameId: draft.gameId, game: draft.game, hours: hours, reprice: false });
        saveMaps();
        toast("Привязано: лот " + draft.lotId + ", " + draft.game + ", " + dur(hours) + " за 1 шт.");
        draft = {};
        ["d_lot", "d_q", "d_hours"].forEach(function (k) { fpt.ui.setState(k, ""); });
        render();
    };
    window.mvsMap = function (act, n) {
        var m = MAPS[n];
        if (!m) return render();
        if (act === "del") { if (!ask("mapdel:" + n)) return; MAPS.splice(n, 1); delete HIDDEN[String(m.lotId)]; delete PROBLEMS[String(m.lotId)]; save("hidden", HIDDEN); save("problems", PROBLEMS); }
        else if (act === "reprice") m.reprice = !autoPrice(m);
        else if (act === "off") m.off = !m.off;
        else if (act === "hide") m.autohide = cycle(m.autohide);
        else if (act === "bonus") m.bonus = cycle(m.bonus);
        else if (act === "markup") { var v = gs("mm_" + n).trim(); m.markup = v === "" ? null : num(v); state.priceAt = 0; }
        saveMaps();
        render();
    };
    window.mvsRent = function (act, rentalId) {
        var rec = recById(rentalId);
        if (!rec) return render();
        if (act === "code") { var c = guard(rec); toast(c ? rec.login + ": " + c.code + " (ещё ~" + ttlOf(c) + " с)" : "Код не получен: " + (lastApiError || "у аккаунта нет maFile")); }
        else if (act === "ext") {
            var h = parseHours(gs("x_" + rentalId));
            if (!h) { toast("Укажите срок: часы числом или дни с буквой д"); return render(); }
            var err = extend(rec, h, rec.chat, null, "extended", "adm");
            toast(err ? "Не продлено: " + human(err) : "Продлено на " + dur(h));
        } else if (act === "pass") {
            var bad = changePassword(rec, rec.chat);
            toast(bad ? "Пароль не сменился: " + bad : "Пароль меняется, новый уйдёт покупателю в чат");
        } else if (act === "end") {
            if (!ask("rentend:" + rentalId)) return;
            var r = api("POST", "/rental/" + rentalId + "/terminate", {});
            if (r.err) toast("Не завершено: " + human(r.err));
            else { rec.exp = now(); rec.ended = true; saveRent(); toast("Аренда завершена"); }
        }
        render();
    };
    window.mvsPeriod = function (p) { period = p; render(); };
    window.mvsStat = function (act) {
        if (act === "clear") { if (!ask("statclear")) return; SALES = []; save("sales", SALES); toast("Журнал продаж очищен"); }
        render();
    };
    window.mvsPay = function () { var a = ["rub", "usd", "auto"]; S.pay = a[(a.indexOf(S.pay) + 1) % a.length]; saveS(); render(); };
    function cmdWord(text, def, bang) {
        var w = String(text || "").trim().split(/\s+/)[0].toLowerCase() || def;
        return bang && w.charAt(0) !== "!" ? "!" + w : w;
    }
    window.mvsSet = function () {
        S.markup = num(gs("s_markup")); S.minPrice = Math.max(0.01, num(gs("s_minprice")) || 1); S.priceMin = Math.max(1, int(gs("s_pricemin"), 5));
        var cm = {};
        gs("s_cat").split(/[,;]+/).forEach(function (x) { var m = /(\d+)\s*[=:]\s*(-?[\d.,]+)/.exec(x); if (m) cm[m[1]] = num(m[2]); });
        S.catMarkup = cm;
        S.volDiscount = on("s_vol"); S.fpEdit = on("s_edit"); S.hideNoStock = on("s_hide"); S.hideLowBalance = on("s_low"); S.hideApiDown = on("s_down");
        S.balanceMin = Math.max(0, num(gs("s_balmin"))); S.pollSec = Math.max(15, int(gs("s_poll"), 60));
        S.autoRefund = on("s_refund"); S.reviewBonus = on("s_bonus"); S.bonusHours = clamp(int(gs("s_bh"), 2), 1, 720); S.bonusStars = clamp(int(gs("s_bs"), 5), 1, 5);
        S.notifyEnd = on("s_end"); S.warnMin = Math.max(0, int(gs("s_warn"), 30));
        S.extWord = cmdWord(gs("s_word"), "!продление", true);
        S.codeWord = cmdWord(gs("s_code"), "!код", false);
        S.buyerCmds = on("s_cmds"); S.notifySales = on("s_ntf"); S.notifyNews = on("s_news"); S.enMsgs = on("s_en");
        S.extCmd = on("s_extcmd"); S.extMinutes = clamp(int(gs("s_extmin"), 10), 1, 120);
        if (DESKTOP) {
            var px = gs("s_proxy").trim();
            if (px !== String(S.proxy || "")) { S.proxy = px; routeDown = {}; }
        }
        saveS();
        cache.costs = {};
        state.priceAt = 0;
        toast("Сохранено");
        render();
    };
    window.mvsNet = function () {
        if (DESKTOP) { var px = gs("s_proxy").trim(); if (px !== String(S.proxy || "")) { S.proxy = px; saveS(); } }
        toast(netCheck());
        render();
    };
    window.mvsJob = function (act) {
        if (act === "stop" && job) job.stop = true;
        if (act === "resume" && JOB_SAVED && !job) {
            if (!hasKey()) toast("Сначала впишите API-ключ MUVSell");
            else { var r = JOB_SAVED.resume; products(true); fpMap(true); runJob(r); if (!job) { JOB_SAVED = null; save("job", null); } }
        }
        if (act === "drop") { JOB_SAVED = null; save("job", null); }
        if (act === "hide") jobResult = "";
        render();
    };
    function readyForLots() {
        if (!hasKey()) { toast("Сначала впишите API-ключ MUVSell"); return false; }
        if (!S.fpEdit) { toast("В настройках выключено \"Плагин может менять цену, тексты и видимость лотов\""); return false; }
        if (!products(true)) { toast("Каталог MUVSell не загрузился: " + (lastApiError || "нет связи")); return false; }
        return true;
    }
    window.mvsAuto = function (act, arg) {
        if (act === "save" || act === "plan") {
            var durs = parseHoursList(gs("a_durs"));
            if (!durs.length) { toast("Укажите хотя бы один срок"); return render(); }
            S.apDurations = durs;
            S.lotCap = clamp(int(gs("a_cap"), 20), 1, 200);
            var own = gs("a_own").trim();
            S.apOwn = own === "" ? null : num(own);
            S.apFilter = gs("a_filter").trim();
            S.steamRegion = gs("a_region").trim() || "Россия";
            S.apActive = on("a_active");
            saveS();
            planShown = null;
            if (act === "save") { toast("Сохранено"); return render(); }
        }
        if (act === "plan") {
            if (!hasKey()) { toast("Сначала впишите API-ключ MUVSell"); return render(); }
            if (!products(true)) { toast("Каталог MUVSell не загрузился: " + (lastApiError || "нет связи")); return render(); }
            if (!(fpMap(true).games || []).length) { toast("Карта игр с muvsell.store не загрузилась"); return render(); }
            planShown = plan();
            if (!planShown.length) toast("Создавать нечего: лоты на все игры и сроки уже есть");
            return render();
        }
        if (act === "find") {
            var prods = products();
            if (!prods) { toast("Каталог MUVSell не загрузился: " + human(hasKey() ? "net" : "no_key")); return render(); }
            fpMap();
            manualFound = { kind: arg, list: searchGames(manualGames(arg), gs("a_mq")) };
            return render();
        }
        if (act === "manual") {
            var prod = manualFound && manualFound.list[arg], kind = manualFound && manualFound.kind;
            if (!prod || !readyForLots()) return render();
            runJob({ kind: "manual", mkind: kind, game: prod.id });
            return render();
        }
        if (act === "create" || act === "news") {
            if (!readyForLots()) return render();
            if (!(fpMap().games || []).length) { toast("Карта игр с muvsell.store не загрузилась"); return render(); }
            if (act === "create") { if (!ask("create")) return; planShown = null; runJob({ kind: "create" }); }
            else {
                var ids = S.newsPending || [];
                S.newsPending = [];
                saveS();
                runJob({ kind: "news", games: ids });
            }
            return render();
        }
        if (act === "adopt") { if (hasKey()) { products(true); fpMap(true); } runJob({ kind: "adopt" }); return render(); }
        var autos = MAPS.filter(function (m) { return m.auto; });
        if (!autos.length) { toast("Лотов автовыставления нет"); return render(); }
        if (!ask(act)) return;
        if (act === "retext") jobRetext();
        if (act === "delete") jobDelete(autos, true);
        render();
    };
    window.mvsOff = function (act, arg) {
        var r, g = offFound && offFound[arg];
        if (act === "mode") {
            S.offMode = S.offMode === "covered" ? "all" : "covered";
            saveS();
            state.offAt = 0; state.pollAt = 0;
            toast(S.offMode === "covered" ? "Только оплаченные: продаются и выставляются игры с лицензией или по подписке, остальные лоты снимутся с продажи." : "Все игры: оплаченные выдачи бесплатны, остальные по цене MUVSell.");
        } else if (act === "save") {
            S.offPrice = Math.max(1, num(gs("o_price")) || 1); S.offMarkup = Math.max(0, num(gs("o_markup"))); S.offAuto = on("o_auto");
            saveS();
            state.offAt = 0;
            toast("Сохранено");
        } else if (act === "create") {
            if (!hasKey()) toast("Сначала впишите API-ключ MUVSell");
            else if (!S.fpEdit) toast("В настройках выключено \"Плагин может менять цену, тексты и видимость лотов\"");
            else { if (!ask("offcreate")) return; fpMap(true); jobOffCreate(); }
        } else if (act === "sub") {
            if (!ask("offsub")) return;
            r = paid("/offline/subscription", { payWith: payWith(), requestId: sureRid });      // двойное нажатие: тот же requestId
            if (r.err) toast("Не оплачено: " + human(r.err));
            else { cache.bal = [0, null]; offAcc = [0, null]; offCat = [0, null]; state.offAt = 0; toast(r.data.replay ? "Уже оплачено" : "Подписка продавца оплачена"); }
        } else if (act === "find") {
            var cat = offCatalog(true);
            if (!cat) toast("Оффлайн-каталог MUVSell не получен: " + human(hasKey() ? "net" : "no_key")); else offFound = searchGames(cat, gs("o_q"));
        } else if (act === "lic" && g) {
            if (!ask("offlic:" + arg)) return;
            r = paid("/offline/licenses", { gameId: g.id, payWith: payWith(), requestId: sureRid });
            if (r.err) toast("Не куплено: " + human(r.err));
            else { cache.bal = [0, null]; offAcc = [0, null]; offCat = [0, null]; offFound = null; state.offAt = 0; toast(r.data.replay ? "Уже куплено" : "Лицензия на " + g.name + " куплена"); }
        } else if (act === "steam" && g) {
            if (!S.fpEdit) toast("В настройках выключено \"Плагин может менять цену, тексты и видимость лотов\""); else jobOffSteam(g.id);
        } else if (act === "hide" && OFF[arg]) { OFF[arg].autohide = cycle(OFF[arg].autohide); saveOff(); }
        else if (act === "del" && OFF[arg]) {
            if (!ask("offdel:" + arg)) return;
            var o = OFF[arg];
            if (o.auto && !deleteLot(o.lotId) && !/404|не найден/i.test(String(lotForm("offer=" + o.lotId).err || ""))) toast("FunPay не удалил лот" + lastErr());
            else { OFF.splice(arg, 1); delete HIDDEN[String(o.lotId)]; saveOff(); save("hidden", HIDDEN); }
        } else if (act === "lot") {
            var text = gs("o_lot"), m = /id=(\d+)/.exec(text) || /(\d{4,})/.exec(text);
            if (!m) toast("Не вижу ID лота");
            else if (mapByLot(m[1])) toast("Лот " + m[1] + " уже привязан к аренде, сначала удалите ту привязку");
            else if (offByLot(m[1])) toast("Лот " + m[1] + " уже оффлайн-лот");
            else {
                var lf = null;
                try { lf = fpt.lots.getFields(m[1]); } catch (e) {}
                var titles = lf ? [lotField(lf, "fields[summary][ru]"), lotField(lf, "fields[summary][en]")].filter(Boolean) : [];
                if (!titles.length) toast("Лот " + m[1] + " не открывается" + lastErr());
                else offDraft = { lotId: m[1], titles: titles, subcat: int(lotField(lf, "node_id"), 0) };
            }
        } else if (act === "bind" && g && offDraft) {
            OFF.push({ lotId: String(offDraft.lotId), subcat: offDraft.subcat || 0, titles: offDraft.titles, gameId: String(g.id), game: g.name, offline: true });
            saveOff();
            toast("Привязано: лот " + offDraft.lotId + ", " + g.name + " навсегда");
            offDraft = null;
            fpt.ui.setState("o_lot", "");
        } else if (act === "cancel") offDraft = null;
        render();
    };
    window.mvsTextNext = function (step) { textKey = (textKey + (step || 1) + TEXT_KEYS.length) % TEXT_KEYS.length; render(); };
    window.mvsTextSave = function () {
        var text = gm("t_text").trim(), key = TEXT_KEYS[textKey];
        if (!text) return toast("Текст пустой");
        S.texts[key] = text;
        saveS();
        var warn = "";
        if (/^ap_desc/.test(key)) { var tx = lotTexts("Counter-Strike 2", 24, 5); warn = enWarning(tx[2], tx[3]); }
        toast(warn || "Сохранено");
    };
    window.mvsTextReset = function () { delete S.texts[TEXT_KEYS[textKey]]; saveS(); render(); };

    render();
    log("запущен: привязок " + MAPS.length + ", оффлайн-лотов " + OFF.length + ", активных аренд " + allActive().length);
})();
