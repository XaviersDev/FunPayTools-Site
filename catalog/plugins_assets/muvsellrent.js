// @name MUVSell Rent
// @author @MUVSell
// @version 1.1.0
// @description Перепродажа аренды Steam-аккаунтов MUVSell: выдача логина и пароля после оплаты, коды Steam Guard, продления, автовыставление лотов, наличие, цены и статистика.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/muvsellrent_banner.png

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
    function http(method, url, body, headers) {
        method = String(method || "GET").toUpperCase();
        var r = null;
        try {
            if (DESKTOP || (CAN_ANY_METHOD && method !== "GET" && method !== "POST")) {
                r = fpt.network.request(method, url, body === undefined ? null : body, hdr(headers));
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
    function postJson(url, obj, headers) {
        var h = { "Content-Type": "application/json", "Accept": "application/json" };
        for (var k in (headers || {})) h[k] = headers[k];
        return http("POST", url, JSON.stringify(obj || {}), h);
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

    // ---------------------------------------------------------------- MUVSell Rent
    // Покупатель оплачивает лот на FunPay, плагин арендует Steam-аккаунт на muvsell.store с вашего баланса и присылает логин и пароль.
    var SITE = "https://muvsell.store", API_BASE = SITE + "/api/v1";
    var MIN_HOURS = 1, MAX_HOURS = 720;
    var TEXTS = {
        delivery: "🎮 {game}: аккаунт готов!\n\n👤 Логин: {login}\n🔑 Пароль: {password}\n⏳ Срок: {hours} ч., до {expires}\n\n🔐 Код Steam Guard: !код\n⌛ Сколько осталось: !время\n📋 Все команды: !помощь\n\n🛒 Новая покупка лота выдаст другой аккаунт. Хорошей игры! 🎯",
        extended: "✅ Готово! Аренда {game} продлена на {hours} ч.\n👤 Аккаунт тот же: {login}, вход без изменений.\n🕒 Играйте до {expires}",
        ext_usage: "🔄 Как продлить: напишите {word} и срок, часы или дни.\nНапример: {word} 3 или {word} 2д\nНесколько аккаунтов? Добавьте логин: {word} 3 логин",
        ext_links: "🔄 Чтобы продлить этот же аккаунт, купите лот продления:\n{links}\nПосле оплаты время само добавится к аккаунту {login}.",
        ext_lot_ready: "🧾 Лот для продления создан специально для вас!\n\n🎮 {game} · +{time}\n💰 К оплате: {price} ₽\n👉 {link}\n\n⏱ Лот доступен {minutes} мин. После оплаты время само добавится к аккаунту {login}.",
        ext_lot_fail: "😔 Лот для продления сейчас создать не вышло.\nПопробуйте через пару минут, продавец уже в курсе. Покупка основного лота выдаст новый аккаунт, а не продлит этот.",
        ext_title_ru: "⏩ ПРОДЛЕНИЕ {game} на {time} #{tag}",
        ext_title_en: "EXTENSION {game} for {time} #{tag}",
        ext_desc_ru: "Персональный лот для продления аренды {game} на {time}. После оплаты время добавится к вашему текущему аккаунту, логин и пароль не меняются. Лот создан для одного покупателя и скоро исчезнет.",
        ext_desc_en: "Personal offer to extend your {game} rental for {time}. After payment the time is added to the same account, login and password stay the same. This offer is made for one buyer and will disappear soon.",
        ap_title_ru: "{game} | Аренда Steam на {time} | Автовыдача ⚡",
        ap_title_en: "{game} | Steam rental {time} | Auto delivery",
        ap_desc_ru: "🎮 Лицензионный Steam-аккаунт {game} в аренду на {time}.\n⚡ Логин и пароль придут в чат сами, сразу после оплаты, круглосуточно.\n🔄 Продлить тот же аккаунт можно командой в чате (ниже). Новая покупка лота выдаст другой аккаунт.\n\n📋 Команды в чате заказа:\n{commands}\n\n⏳ Когда срок выйдет, доступ закроется автоматически.",
        ap_desc_en: "Licensed Steam account {game} for rent for {time}. Login and password arrive in the chat automatically right after payment, 24/7. Chat commands: !code - Steam Guard code, !time - time left, !extend 3 - add 3 hours to the same account, !help - all commands. Buying the offer again gives you a new account.",
        ext_none: "🔄 Отдельного лота продления сейчас нет. Напишите продавцу, он продлит аренду вручную. Покупка основного лота выдаст новый аккаунт.",
        review_offer: "🎁 Небольшой подарок: оставьте отзыв на {stars}★ к этому заказу, и мы бесплатно добавим {bonus} ч. к аренде, пока она идёт.",
        review_bonus: "💚 Спасибо за отзыв! Аренда {login} продлена на {hours} ч. в подарок.\n🕒 Играйте до {expires}",
        kick_ok: "🚪 Готово, все чужие сессии на {login} закрываются (обычно до минуты).\nАренда {game} идёт дальше, просто войдите заново.",
        kick_fail: "⚠️ Не получилось завершить сессии {login}: {reason}",
        pass_wait: "🔑 Меняю пароль на {login}… Новый пришлю сюда через 1-3 минуты.",
        pass_ok: "🔐 Пароль обновлён!\n\n🎮 {game}\n👤 Логин: {login}\n🔑 Новый пароль: {password}\n\nСрок аренды не изменился. Код Steam Guard: !код",
        pass_fail: "⚠️ Сменить пароль {login} не удалось: {reason}",
        code: "🔐 Код Steam Guard для {login}: {code}\n⏱ Действует ещё ~{ttl} сек., вводите сразу.",
        code_which: "👥 У вас несколько аккаунтов, уточните логин: {cmd} логин\n{logins}",
        code_fail: "⚠️ Код сейчас не получить. Продавец уже в курсе и поможет вручную.",
        time_left: "⌛ {game} ({login}): осталось {left}, до {expires}",
        creds: "👤 {game}\nЛогин: {login}\nПароль: {password}\n🕒 До {expires}",
        help: "📋 Команды для вашей аренды:\n{commands}",
        warn: "⏳ Аренда {game} ({login}) закончится через {left} ({expires}).\nПродлить этот же аккаунт: напишите {word}.\nНовая покупка лота выдаст другой аккаунт.",
        ended: "🏁 Аренда {game} ({login}) завершена, доступ к аккаунту закрыт.\nСпасибо, что были с нами! Понравилось? Будем рады отзыву 💚",
        no_rental: "🔎 Не вижу у вас активной аренды. Если только что оплатили, подождите минуту и повторите.",
        problem: "⚠️ Автовыдача не сработала. Продавец уже получил уведомление и скоро всё выдаст вручную. Спасибо за терпение!",
    };
    var TEXT_LABELS = {
        delivery: "Выдача аккаунта", extended: "Аренда продлена", ext_usage: "Как продлить (подсказка)", ext_links: "Как продлить (постоянный лот продления)", ext_lot_ready: "Лот продления готов", ext_lot_fail: "Лот продления создать не удалось",
        ext_title_ru: "Название лота продления (рус.)", ext_title_en: "Название лота продления (англ.)", ext_desc_ru: "Описание лота продления (рус.)", ext_desc_en: "Описание лота продления (англ.)",
        ap_title_ru: "Автовыставление: название (рус.)", ap_title_en: "Автовыставление: название (англ.)", ap_desc_ru: "Автовыставление: описание (рус.)", ap_desc_en: "Автовыставление: описание (англ.)",
        ext_none: "Как продлить (лота продления нет)",
        review_offer: "Предложение бонуса за отзыв", review_bonus: "Бонус за отзыв начислен", kick_ok: "Сессии закрыты (!кик)", kick_fail: "!кик не удался",
        pass_wait: "Пароль меняется (!пароль)", pass_ok: "Пароль изменён", pass_fail: "!пароль не удался", code: "Код Steam Guard (!код)",
        code_which: "Несколько аккаунтов, нужен логин", code_fail: "Код не получен", time_left: "Сколько осталось (!время)", creds: "Данные аккаунта (!данные)",
        help: "Список команд (!помощь)", warn: "Аренда скоро закончится", ended: "Аренда закончилась", no_rental: "Нет активной аренды", problem: "Сбой автовыдачи",
    };
    var TEXT_KEYS = Object.keys(TEXT_LABELS);
    var HUMAN = {
        bad_key: "неверный API-ключ MUVSell", no_key: "API-ключ MUVSell не задан", balance: "недостаточно средств на балансе MUVSell",
        no_stock: "на MUVSell нет свободных аккаунтов", not_found: "игра или аренда не найдена на MUVSell",
        forbidden: "ключ не привязан к аккаунту или аккаунт заблокирован", bad_request: "MUVSell отклонил запрос", wait: "слишком часто",
        no_account: "аренда создана, но аккаунт не выдан, выдайте вручную с сайта", net: "нет связи с muvsell.store",
    };
    var ERRORS = { 400: "bad_request", 401: "bad_key", 402: "balance", 403: "forbidden", 404: "not_found", 409: "no_stock", 429: "wait" };
    var DEFAULTS = {
        enabled: true, key: "", pay: "rub",
        markup: 50, volDiscount: true, minPrice: 1,
        fpEdit: true, hideNoStock: true, hideLowBalance: false, balanceMin: 0,
        autoRefund: false, reviewBonus: false, bonusHours: 2, bonusStars: 5,
        notifyEnd: true, warnMin: 30, extWord: "!продление", buyerCmds: true,
        pollSec: 60, priceMin: 5, notifySales: true, texts: {},
        extTemp: true, extMinutes: 10,
        apDurations: [1, 3, 6, 12, 24, 72, 168, 336, 720], lotCap: 20, apOwn: null, apActive: true, apFilter: "",
    };
    var S = load("settings", null) || {};
    (function () { for (var k in DEFAULTS) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); })();
    var MAPS = load("maps", []);        // {lotId, titles, gameId, game, hours, markup, reprice, autohide, bonus, off, ext, price}
    var RENT = load("rentals", {});     // чат → [аренды]
    var HIDDEN = load("hidden", {});    // лот → почему снят: stock | balance
    var SALES = load("sales", []);
    var lastApiError = "";

    function saveS() { save("settings", S); }
    function saveMaps() { save("maps", MAPS); }
    function saveRent() { save("rentals", RENT); }
    function t(key, vars) { return fill((S.texts || {})[key] || TEXTS[key], vars || {}); }
    function human(err) { var text = HUMAN[err] || err || "неизвестная ошибка"; return lastApiError && err !== "net" ? text + ": " + lastApiError : text; }
    function ts(iso) { var d = Date.parse(String(iso || "")); return isFinite(d) ? d / 1000 : 0; }
    function tzLabel() { var off = -new Date().getTimezoneOffset() / 60; return off === 3 ? "МСК" : "UTC" + (off >= 0 ? "+" : "") + off; }
    function whenTz(sec) { return when(sec) + " " + tzLabel(); }
    function plural(n, one, few, many) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : (a >= 2 && a <= 4 && !(b >= 12 && b <= 14) ? few : many); }
    function dur(hours) {
        if (hours % 24 === 0) { var d = hours / 24; return d + " " + plural(d, "день", "дня", "дней"); }
        return hours + " " + plural(hours, "час", "часа", "часов");
    }
    function leftText(sec) {
        var m = Math.max(1, Math.floor(sec / 60)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
        m = m % 60;
        var parts = [];
        if (d) parts.push(d + " " + plural(d, "день", "дня", "дней"));
        if (h) parts.push(h + " ч.");
        if (m && !d) parts.push(m + " мин.");
        return parts.join(" ");
    }
    function parseHours(text) {
        var m = /^(\d+)\s*(д|d|ч|h)?/.exec(String(text || "").trim().toLowerCase());
        if (!m) return 0;
        var h = int(m[1], 0) * (m[2] === "д" || m[2] === "d" ? 24 : 1);
        return h >= MIN_HOURS && h <= MAX_HOURS ? h : 0;
    }

    // --- API MUVSell
    function api(method, path, body) {
        if (!String(S.key || "").trim()) return { data: null, err: "no_key" };
        var headers = { "X-API-Key": String(S.key).trim(), "Accept": "application/json", "User-Agent": "MUVSellRent-FunPayTools/1.0" };
        for (var attempt = 0; attempt < 3; attempt++) {
            var r = method === "GET" ? http("GET", API_BASE + path, null, headers) : postJson(API_BASE + path, body || {}, headers);
            if (!r.code) {
                lastApiError = r.error || "";
                if (method !== "GET") return { data: null, err: "net" };   // POST не повторяем: повтор мог бы списать баланс дважды
                continue;
            }
            var data = r.json && typeof r.json === "object" ? r.json : {};
            if (r.code >= 200 && r.code < 300) { lastApiError = ""; return { data: data, err: null }; }
            lastApiError = String(data.error || "HTTP " + r.code).slice(0, 200);
            if (r.code >= 500 && method === "GET" && attempt < 2) continue;
            return { data: null, err: ERRORS[r.code] || "http_" + r.code };
        }
        return { data: null, err: "net" };
    }
    var cache = { products: [0, null], bal: [0, null], rate: [0, 90], costs: {} };
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
    function cost(prod, hours) {
        if (!S.volDiscount && prod.pricePerHourRub !== undefined && prod.pricePerHourRub !== null) return Math.round(num(prod.pricePerHourRub) * hours * 100) / 100;
        var prices = prod.prices || [];
        for (var i = 0; i < prices.length; i++) if (prices[i].hours === hours && prices[i].priceRub !== undefined && prices[i].priceRub !== null) return num(prices[i].priceRub);
        var key = prod.id + ":" + hours, hit = cache.costs[key];
        if (hit && now() - hit[0] < 900) return hit[1];
        var q = api("POST", "/rental/quote", { gameId: prod.id, durationKey: hours + "h", qty: 1 });
        var rub = q.data && q.data.totalRub !== undefined && q.data.totalRub !== null ? num(q.data.totalRub) : Math.round(num(prod.pricePerHourRub) * hours * 100) / 100;
        cache.costs[key] = [now(), rub];
        return rub;
    }
    function markupOf(m) { return m && m.markup !== undefined && m.markup !== null ? num(m.markup) : num(S.markup); }
    function priceFor(prod, hours, m) { return Math.ceil(Math.max(num(S.minPrice) || 1, cost(prod, hours) * (1 + markupOf(m) / 100))); }
    function hideOn(m) { return m.autohide === undefined || m.autohide === null ? !!S.hideNoStock : !!m.autohide; }
    function bonusOn(m) { return !m || m.bonus === undefined || m.bonus === null ? !!S.reviewBonus : !!m.bonus; }
    function mapByLot(lotId) { for (var i = 0; i < MAPS.length; i++) if (String(MAPS[i].lotId) === String(lotId)) return MAPS[i]; return null; }
    function mapLabel(m) { return m.game + ", " + dur(int(m.hours, 1)) + (m.ext ? " (продление)" : ""); }

    // --- аренды
    function activeIn(chatId) { var t0 = now(); return (RENT[chatId] || []).filter(function (r) { return r.exp > t0; }); }
    function allActive() {
        var out = [], t0 = now();
        for (var c in RENT) RENT[c].forEach(function (r) { if (r.exp > t0) out.push(r); });
        return out.sort(function (a, b) { return a.exp - b.exp; });
    }
    function recById(id) { for (var c in RENT) for (var i = 0; i < RENT[c].length; i++) if (String(RENT[c][i].id) === String(id)) return RENT[c][i]; return null; }
    function recByOrder(orderId) { for (var c in RENT) for (var i = 0; i < RENT[c].length; i++) if (String(RENT[c][i].order) === String(orderId)) return RENT[c][i]; return null; }
    function accOf(data, login) {
        var items = ((data || {}).rental || {}).items || [];
        for (var i = 0; i < items.length; i++) {
            var accs = items[i].accounts || [];
            for (var j = 0; j < accs.length; j++) if (!login || String(accs[j].login || "").toLowerCase() === String(login).toLowerCase()) return accs[j];
        }
        return null;
    }
    function sale(kind, rec, hours, costRub, order, refunded) {
        var rev = 0;
        if (order && !SALES.some(function (s) { return s.order === order.id; })) rev = order.price;
        SALES.push({ ts: now(), order: order ? order.id : (rec.order || ""), buyer: (order && order.buyerName) || rec.buyer || "", gameId: rec.gameId || "", game: rec.game || "?",
            hours: int(hours, 0), lot: rec.lot || "", rid: rec.id || "", rev: Math.round(rev * 100) / 100, cost: Math.round(num(costRub) * 100) / 100, kind: kind, refunded: !!refunded });
        if (SALES.length > 1500) SALES = SALES.slice(SALES.length - 1500);
        save("sales", SALES);
    }
    function addHours(rec, hours) {
        var added = 0, costRub = 0, err = null;
        while (added < hours) {
            var step = Math.min(hours - added, MAX_HOURS);
            var r = api("POST", "/rental/" + rec.id + "/extend", { durationKey: step + "h", payWith: payWith() });
            if (r.err) { err = r.err; break; }
            rec.exp = ts(r.data.endsAt) || rec.exp;
            costRub += num(r.data.cost);
            added += step;
        }
        if (added) { rec.warned = false; rec.ended = false; saveRent(); }
        return { added: added, err: err, cost: costRub };
    }
    function newRental(m, order, chatId, hours) {
        var first = Math.min(hours, MAX_HOURS);
        // ник покупателя на MUVSell не передаём: это чужие личные данные
        var r = api("POST", "/rental/create", { items: [{ gameId: m.gameId, durationKey: first + "h", qty: 1 }], payWith: payWith(), comment: "FunPay #" + order.id });
        if (r.err) return { err: r.err };
        var rental = r.data.rental || {}, acc = accOf(r.data, "");
        if (!acc) return { err: "no_account" };
        var rec = { id: rental.id, number: rental.number, gameId: m.gameId, game: m.game, login: acc.login || "", exp: ts(rental.endsAt), order: order.id,
            buyer: order.buyerName, chat: chatId, lot: m.lotId, bonus: false, ended: false, warned: false };
        (RENT[chatId] = RENT[chatId] || []).push(rec);
        saveRent();
        var extra = addHours(rec, hours - first);     // больше 720 ч за раз MUVSell не выдаёт, остальное докупаем продлением
        if (extra.err) notify("MUVSell Rent: заказ #" + order.id, "Выдано " + (first + extra.added) + " ч из " + hours + ": " + human(extra.err));
        sale("new", rec, first + extra.added, num(rental.totalRub) + extra.cost, order);
        sendTo(chatId, t("delivery", { game: m.game, login: rec.login, password: acc.password || "", hours: first + extra.added, expires: whenTz(rec.exp), word: S.extWord }));
        if (bonusOn(m)) sendTo(chatId, t("review_offer", { bonus: S.bonusHours, stars: S.bonusStars }));
        if (S.notifySales) notify("MUVSell Rent: выдан " + rec.login, m.game + ", " + (first + extra.added) + " ч, покупатель " + order.buyerName + ", заказ #" + order.id);
        return { rec: rec };
    }
    function extend(rec, hours, chatId, order, textKey, kind) {
        var res = addHours(rec, hours);
        if (!res.added) return res.err || "net";
        if (res.err) notify("MUVSell Rent: продлено " + res.added + " ч из " + hours, human(res.err));
        sale(kind, rec, res.added, res.cost, order || null);
        sendTo(chatId, t(textKey, { login: rec.login, game: rec.game, hours: res.added, expires: whenTz(rec.exp) }));
        if (kind === "ext" && S.notifySales) notify("MUVSell Rent: продлён " + rec.login, rec.game + ", +" + res.added + " ч");
        return null;
    }
    function fail(order, chatId, err, m) {
        sendTo(chatId, t("problem"));
        var refund = S.autoRefund && (err === "no_stock" || err === "balance");
        notify("MUVSell Rent: заказ #" + order.id + " не выдан", human(err) + (refund ? ". Оформляю возврат." : ""));
        if (!refund) return;
        if (!refundOrder(order.id)) return notify("MUVSell Rent: возврат не прошёл", "Заказ #" + order.id + lastErr());
        if (m) sale("new", { gameId: m.gameId, game: m.game, lot: m.lotId }, m.hours, 0, order, true);
    }

    // --- какой привязке соответствует заказ
    var titlesAt = 0;
    function refreshTitles() {
        if (now() - titlesAt < 600 || MAPS.length > 40) return false;
        titlesAt = now();
        var changed = false;
        MAPS.forEach(function (m) {
            var titles = lotTitles(m.lotId, true);
            if (titles.length && JSON.stringify(titles) !== JSON.stringify(m.titles || [])) { m.titles = titles; changed = true; }
        });
        if (changed) saveMaps();
        return changed;
    }
    function matchOrder(order) {
        if (order.lotId) { var direct = mapByLot(order.lotId); if (direct) return [direct]; }
        var desc = norm(order.title);
        function find() {
            var scored = [], top = 0;
            MAPS.forEach(function (m) {
                var n = 0;
                (m.titles || []).forEach(function (title) { var x = norm(title); if (x && desc.indexOf(x) >= 0 && x.length > n) n = x.length; });
                if (n) { scored.push([n, m]); if (n > top) top = n; }
            });
            var found = scored.filter(function (s) { return s[0] === top; }).map(function (s) { return s[1]; });
            var kinds = {};
            found.forEach(function (m) { kinds[m.gameId + ":" + m.hours + ":" + !!m.ext] = 1; });
            return Object.keys(kinds).length === 1 ? found.slice(0, 1) : found;
        }
        var res = find();
        if (!res.length && MAPS.length && refreshTitles()) res = find();
        return res;
    }

    onOrder(function (e) {
        if (!S.enabled || !e || e.iAmBuyer || !e.orderId || (!MAPS.length && !Object.keys(EXT).length)) return;
        var o = orderInfo(e.orderId, e.text);
        if (!o) o = { id: String(e.orderId), title: String(e.text || ""), amount: 1, price: 0, buyerName: e.buyerName || "", lotId: "", chatId: "" };
        if (o.iAmBuyer) return;
        if (!o.buyerName) o.buyerName = e.buyerName || "";
        var chatId = String(e.chatId || o.chatId || "");
        var extTag = extFor(o);
        if (extTag) {
            if (seenOrder(o.id)) return;
            try { payExt(o, chatId, extTag); } catch (ex0) {
                log("ошибка продления по заказу #" + o.id + ": " + ex0);
                sendTo(chatId, t("problem"));
                notify("MUVSell Rent: ошибка в заказе #" + o.id, String(ex0).slice(0, 200));
            }
            return;
        }
        var found = matchOrder(o);
        if (!found.length) return;                // не наш лот
        if (seenOrder(o.id)) return;
        try {
            if (found.length > 1) {
                sendTo(chatId, t("problem"));
                return notify("MUVSell Rent: заказ #" + o.id + " подходит под несколько привязок",
                    "Выдайте вручную и сделайте названия лотов разными: " + found.map(function (m) { return mapLabel(m) + " (лот " + m.lotId + ")"; }).join("; "));
            }
            var m = found[0];
            if (!String(S.key || "").trim()) return fail(o, chatId, "no_key", m);
            var hours = int(m.hours, 1) * Math.max(1, o.amount);
            log("заказ #" + o.id + ": " + mapLabel(m) + " × " + o.amount + ", покупатель " + o.buyerName);
            if (m.ext) {
                var mine = activeIn(chatId).filter(function (r) { return r.gameId === m.gameId; });
                if (mine.length) {
                    var rec = mine[mine.length - 1];
                    var err = extend(rec, hours, chatId, o, "extended", "ext");
                    if (!err) return;
                    if (err !== "bad_request" && err !== "not_found") return fail(o, chatId, err, m);
                    rec.exp = 0;                  // аренда на сайте уже закрыта, выдаём новый аккаунт на оплаченное время
                    saveRent();
                }
            }
            var res = newRental(m, o, chatId, hours);
            if (res.err) fail(o, chatId, res.err, m);
        } catch (ex) {
            log("ошибка при обработке заказа #" + o.id + ": " + ex);
            sendTo(chatId, t("problem"));
            notify("MUVSell Rent: ошибка в заказе #" + o.id, String(ex).slice(0, 200));
        }
    });

    // --- команды покупателя
    function pickRec(chatId, arg, cmd) {
        var rs = activeIn(chatId).filter(function (r) { return !arg || r.login.toLowerCase() === arg.toLowerCase(); });
        if (!rs.length) { sendTo(chatId, t("no_rental")); return null; }
        if (rs.length > 1) { sendTo(chatId, t("code_which", { cmd: cmd, logins: rs.map(function (r) { return "• " + r.login; }).join("\n") })); return null; }
        return rs[0];
    }
    function guard(rec) {
        var r = api("GET", "/rental/" + rec.id + "/code");
        var codes = (r.data || {}).codes || [];
        for (var i = 0; i < codes.length; i++) if (String(codes[i].login || "").toLowerCase() === rec.login.toLowerCase()) return codes[i];
        return null;
    }
    function commandsText() {
        var lines = ["• !код: код Steam Guard", "• !время: сколько осталось", "• !данные: логин и пароль ещё раз", S.extTemp ? "• " + S.extWord + " 3: продлить этот аккаунт на 3 ч (или " + S.extWord + " 2д на 2 дня)" : "• " + S.extWord + ": как продлить этот аккаунт"];
        if (S.buyerCmds) lines.push("• !кик: выкинуть всех чужих из аккаунта", "• !пароль: сменить пароль");
        return lines.join("\n");
    }
    var passWait = [];   // смены пароля, которые ждут новый пароль: {rid, chat, old, tries}
    function onCommand(chatId, text) {
        var sp = text.trim().split(/\s+/), cmd = sp[0].toLowerCase(), arg = sp.slice(1).join(" ").trim();
        if (!RENT[chatId]) return;      // этому покупателю плагин ничего не выдавал: молчим, на !код может отвечать другой плагин
        var rec, r;
        if (cmd === String(S.extWord || "!продление").toLowerCase() || cmd === "!extend") {
            var words = arg ? arg.split(/\s+/) : [];
            var spans = words.filter(function (w) { return /^\d+[дdчh]?$/i.test(w); });
            rec = pickRec(chatId, words.filter(function (w) { return spans.indexOf(w) < 0; })[0] || "", S.extWord + " 3");
            if (!rec) return;
            var em = mapByLot(rec.lot) || MAPS.filter(function (x) { return x.gameId === rec.gameId && !x.ext; })[0] || null;
            var links = MAPS.filter(function (x) { return x.ext && x.gameId === rec.gameId && !x.off; })
                .map(function (x) { return "• " + dur(int(x.hours, 1)) + " за 1 шт.: https://funpay.com/lots/offer?id=" + x.lotId; });
            if (!S.extTemp || !S.fpEdit) {
                return sendTo(chatId, links.length ? t("ext_links", { links: links.join("\n"), login: rec.login, game: rec.game, word: S.extWord }) : t("ext_none", { login: rec.login, game: rec.game }));
            }
            var eh = spans.length ? parseHours(spans[0]) : int((em || {}).hours, 0);
            if (!eh) return sendTo(chatId, t("ext_usage", { word: S.extWord }));
            var same = Object.keys(EXT).map(function (k) { return EXT[k]; }).filter(function (x) { return x.rid === rec.id && int(x.hours, 0) === eh && x.until > now() + 60; })[0];
            if (same) return sendTo(chatId, extReady(rec, same));     // лот на этот срок уже ждёт оплату: повторяем ссылку
            return makeExtLot(chatId, rec, em, eh);
        }
        if (["!код", "!code", "!гуард", "!guard", "!кодстим", "!sg"].indexOf(cmd) >= 0) {
            rec = pickRec(chatId, arg, "!код");
            if (!rec) return;
            var code = guard(rec);
            if (!code) {
                sendTo(chatId, t("code_fail"));
                return notify("MUVSell Rent: код Steam Guard не получен", rec.login + ": " + (lastApiError || "у аккаунта нет maFile"));
            }
            return sendTo(chatId, t("code", { login: rec.login, code: code.code, ttl: code.expiresIn === undefined ? 30 : code.expiresIn }));
        }
        if (["!время", "!срок", "!time"].indexOf(cmd) >= 0) {
            var rs = activeIn(chatId);
            if (!rs.length) return sendTo(chatId, t("no_rental"));
            return sendTo(chatId, rs.map(function (x) { return t("time_left", { game: x.game, login: x.login, left: leftText(x.exp - now()), expires: whenTz(x.exp) }); }).join("\n"));
        }
        if (["!данные", "!логин", "!data", "!acc"].indexOf(cmd) >= 0) {
            var list = activeIn(chatId).filter(function (x) { return !arg || x.login.toLowerCase() === arg.toLowerCase(); });
            if (!list.length) return sendTo(chatId, t("no_rental"));
            return list.forEach(function (x) {
                var a = accOf(api("GET", "/rental/" + x.id).data, x.login);
                sendTo(chatId, t("creds", { game: x.game, login: x.login, password: (a && a.password) || "напишите продавцу", expires: whenTz(x.exp) }));
            });
        }
        if (["!помощь", "!команды", "!help", "!commands"].indexOf(cmd) >= 0) return sendTo(chatId, t("help", { commands: commandsText() }));
        if (!S.buyerCmds) return;
        if (["!кик", "!kick", "!выкинуть"].indexOf(cmd) >= 0) {
            rec = pickRec(chatId, arg, "!кик");
            if (!rec) return;
            r = api("POST", "/rental/" + rec.id + "/full-logout", {});
            if (r.err) return sendTo(chatId, t("kick_fail", { login: rec.login, reason: lastApiError || human(r.err) }));
            return sendTo(chatId, t("kick_ok", { login: rec.login, game: rec.game }));
        }
        if (["!пароль", "!password", "!pass"].indexOf(cmd) >= 0) {
            rec = pickRec(chatId, arg, "!пароль");
            if (!rec) return;
            var old = accOf(api("GET", "/rental/" + rec.id).data, rec.login);
            r = api("POST", "/rental/" + rec.id + "/change-password", {});
            if (r.err) return sendTo(chatId, t("pass_fail", { login: rec.login, reason: lastApiError || human(r.err) }));
            sendTo(chatId, t("pass_wait", { login: rec.login }));
            passWait.push({ rid: rec.id, chat: chatId, old: old ? old.password : "", tries: 0 });
        }
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
            var err = extend(rec, hours, rec.chat, null, "review_bonus", "bonus");
            if (err) return notify("MUVSell Rent: бонус за отзыв не начислен", human(err));
            notify("MUVSell Rent: бонус за отзыв", rec.login + " +" + hours + " ч за отзыв " + stars + "★");
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
            }
            return;
        }
        if (m.mine || m.text.trim().charAt(0) !== "!") return;
        try { onCommand(m.chatId, m.text); } catch (e) { log("ошибка команды: " + e); }
    });

    // --- лоты FunPay: создание, правка и удаление через форму сайта (одинаково на Android и на компьютере)
    var RATE_RX = /много предложений|подождите|too many|слишком часто/i;
    var EN_MIN = 140;        // короче FunPay английское описание не принимает
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
        if (at < 0) return { err: "FunPay не отдал форму лота" };
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
            if (id) out.push({ id: String(id), desc: d ? unent(d[1].replace(/<[^>]*>/g, " ")) : "" });
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
        if (f.err) return { err: f.err };
        var fields = f.fields, selects = f.selects, name;
        for (name in (mapFields || {})) if (mapFields[name]) fields[name] = String(mapFields[name]);
        for (name in selects) {
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
            var hit = fresh.filter(function (l) { return norm(l.desc) === norm(texts[0]); })[0] || (fresh.length === 1 ? fresh[0] : null);
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
        return res.ok ? "" : (res.error || "FunPay не принял лот");
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
            var r = http("GET", MAP_URL, null, { "Accept": "application/json" });
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

    // --- автовыставление
    var CREATED = load("created", {});      // "игра:часы" → {lotId, subcat, titles}: чтобы не плодить дубли
    function lotTexts(game, hours) {
        function make(key, lang) {
            return t(key).replace(/\{game\}/g, game).replace(/\{time\}/g, lang === "en" ? durEn(hours) : dur(hours)).replace(/\{commands\}/g, commandsText());
        }
        var ru = make("ap_title_ru", "ru").slice(0, 100), en = ascii(make("ap_title_en", "en"));
        if (!en) en = ascii(game + " Steam account rental " + durEn(hours) + " auto delivery");
        var descEn = ascii(make("ap_desc_en", "en"));
        if (descEn.length < EN_MIN) descEn = ascii(descEn + " " + TEXTS.ap_desc_en.replace(/\{game\}/g, game).replace(/\{time\}/g, durEn(hours)));
        return [ru, en.slice(0, 100), make("ap_desc_ru", "ru"), descEn];
    }
    function sellable() {
        var prods = {}, out = [];
        (products() || []).forEach(function (p) { if (p.available) prods[p.id] = p; });
        var q = norm(S.apFilter);
        (fpMap().games || []).forEach(function (g) {
            if (prods[g.game_id] && (!q || norm(g.name).indexOf(q) >= 0)) out.push([g, prods[g.game_id]]);
        });
        return out;
    }
    function plan() {
        var have = {};
        MAPS.forEach(function (m) { if (!m.ext) have[m.gameId + ":" + int(m.hours, 0)] = 1; });
        var out = [];
        sellable().forEach(function (gp) {
            (S.apDurations || []).forEach(function (h) { if (!have[gp[0].game_id + ":" + h]) out.push({ g: gp[0], prod: gp[1], hours: h }); });
        });
        return out;
    }
    function newMap(g, lotId, hours, titles, price) {
        var sub = int(g.funpay.subcategory_id, 0);
        var m = { lotId: String(lotId), subcat: sub, titles: titles, gameId: g.game_id, game: g.name, hours: hours, auto: true, price: price, markup: S.apOwn, reprice: true };
        MAPS.push(m);
        CREATED[g.game_id + ":" + hours] = { lotId: String(lotId), subcat: sub, titles: titles };
        saveMaps();
        save("created", CREATED);
        return m;
    }
    var job = null;         // долгая работа идёт по одному лоту за шаг, чтобы FunPay не посчитал это спамом
    function jobLine() {
        if (!job) return "";
        var s = job.stats;
        return job.title + ": " + job.i + " из " + job.items.length + " · готово " + s.done + (s.restored ? " · восстановлено " + s.restored : "") + (s.skipped ? " · пропущено " + s.skipped : "") + " · ошибок " + s.failed;
    }
    function startJob(kind, title, items) {
        if (job && !job.over) return false;
        job = { kind: kind, title: title, items: items, i: 0, stats: { done: 0, restored: 0, skipped: 0, failed: 0 }, reasons: {}, counts: {}, over: false, limited: false };
        return true;
    }
    function jobReason(text) { job.reasons[text] = (job.reasons[text] || 0) + 1; }
    function finishJob() {
        job.over = true;
        var s = job.stats, top = Object.keys(job.reasons).sort(function (a, b) { return job.reasons[b] - job.reasons[a]; }).slice(0, 4);
        job.result = (job.limited ? "FunPay временно запретил менять лоты (обычно на несколько часов). Позже запустите ещё раз, плагин доделает только оставшееся. " : "") +
            job.title + " завершено. Готово: " + s.done + (s.restored ? ", восстановлено привязок: " + s.restored : "") + (s.skipped ? ", пропущено по лимиту раздела: " + s.skipped : "") + ", ошибок: " + s.failed +
            (top.length ? ". Причины: " + top.map(function (r) { return job.reasons[r] + "× " + r; }).join("; ") : "");
        notify("MUVSell Rent", job.result);
        save("created", CREATED);
        saveMaps();
    }
    function jobStep() {
        if (!job || job.over) return;
        if (job.stop || job.i >= job.items.length) return finishJob();
        var it = job.items[job.i++], s = job.stats;
        if (job.kind === "create") {
            var g = it.g, hours = it.hours, sub = int(g.funpay.subcategory_id, 0), key = g.game_id + ":" + hours;
            if (MAPS.some(function (m) { return !m.ext && m.gameId === g.game_id && int(m.hours, 0) === hours; })) return;
            var price = priceFor(it.prod, hours, { markup: S.apOwn });
            var old = CREATED[key];
            if (old && !mapByLot(old.lotId)) {          // привязку удаляли, а лот на FunPay остался: возвращаем привязку, дубль не создаём
                if (lotTitles(old.lotId, true).length) { newMap(g, old.lotId, hours, old.titles || [], price); s.restored++; return; }
                delete CREATED[key];
            }
            if (job.counts[sub] === undefined) job.counts[sub] = MAPS.filter(function (m) { return m.auto && String(m.subcat) === String(sub); }).length;
            if (job.counts[sub] >= int(S.lotCap, 20)) { s.skipped++; return; }
            var texts = lotTexts(g.name, hours);
            var res = createLot(sub, g.funpay.fields, g.name, texts, price, !!S.apActive, 1000);
            if (res.rate) { job.limited = true; job.i--; return finishJob(); }
            if (res.id) { newMap(g, res.id, hours, [texts[0], texts[1]], price); job.counts[sub]++; s.done++; }
            else { s.failed++; jobReason(res.err + " (" + g.name + ", " + dur(hours) + ")"); log("автовыставление: " + g.name + " " + dur(hours) + " не создан: " + res.err); }
        } else if (job.kind === "delete") {
            var gone = deleteLot(it.lotId) || !lotTitles(it.lotId, true).length;      // уже удалён на FunPay: просто чистим привязку
            if (gone) {
                MAPS = MAPS.filter(function (m) { return m !== it; });
                delete HIDDEN[it.lotId];
                delete CREATED[it.gameId + ":" + it.hours];
                save("hidden", HIDDEN);
                s.done++;
            } else { s.failed++; jobReason("лот " + it.lotId + " не удалён" + lastErr()); }
        } else if (job.kind === "retext") {
            var tx = lotTexts(it.game, int(it.hours, 1));
            var err = editLot(it.lotId, { "fields[summary][ru]": tx[0], "fields[summary][en]": tx[1], "fields[desc][ru]": tx[2], "fields[desc][en]": tx[3] });
            if (RATE_RX.test(err)) { job.limited = true; job.i--; return finishJob(); }
            if (!err) { it.titles = [tx[0], tx[1]]; s.done++; } else { s.failed++; jobReason(err); }
        }
    }

    // --- временный лот продления: покупатель пишет "!продление 3", плагин создаёт лот на этот срок, оплата продлевает тот же аккаунт
    var EXT = load("extlots", {});          // метка → {lotId, rid, chat, gameId, game, hours, price, mapLot, until}
    function extTexts(game, hours, tag) {
        function title(key, lang) {
            var text = t(key, { game: game, time: lang === "en" ? durEn(hours) : dur(hours), hours: hours, tag: tag }).replace("#" + tag, "");
            text = lang === "en" ? ascii(text) : text.replace(/\s+/g, " ").trim();
            return text.slice(0, 100 - tag.length - 2).trim() + " #" + tag;
        }
        var descEn = ascii(t("ext_desc_en", { game: game, time: durEn(hours), hours: hours, tag: tag }));
        if (descEn.length < EN_MIN) descEn = ascii(descEn + " " + TEXTS.ext_desc_en.replace(/\{game\}/g, game).replace(/\{time\}/g, durEn(hours)));
        return [title("ext_title_ru", "ru"), title("ext_title_en", "en"), t("ext_desc_ru", { game: game, time: dur(hours), hours: hours, tag: tag }), descEn];
    }
    function extReady(rec, e) {
        return t("ext_lot_ready", { game: rec.game, login: rec.login, time: dur(int(e.hours, 1)), hours: e.hours, price: e.price,
            link: "https://funpay.com/lots/offer?id=" + e.lotId, minutes: Math.max(1, Math.ceil((e.until - now()) / 60)) });
    }
    function dropExt(tag) {
        var e = EXT[tag];
        delete EXT[tag];
        save("extlots", EXT);
        if (e && !deleteLot(e.lotId)) log("лот продления " + e.lotId + " не удалён" + lastErr());
    }
    function extCleanup() {
        Object.keys(EXT).forEach(function (tag) { if (num(EXT[tag].until) < now()) dropExt(tag); });
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
                price = priceFor(prod, hours, m);
                var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
                for (var i = 0; i < 5; i++) tag += abc.charAt(Math.floor(Math.random() * abc.length));
                var res = createLot(int(sub, 0), g && g.funpay ? g.funpay.fields : null, rec.game, extTexts(rec.game, hours, tag), price, true, 1);
                lotId = res.id || "";
                err = res.err || "";
            }
            if (!lotId) {
                sendTo(chatId, t("ext_lot_fail"));
                return notify("MUVSell Rent: лот продления не создан", (rec.buyer || "") + ", " + rec.game + ", " + dur(hours) + ": " + err);
            }
            var e = { lotId: String(lotId), rid: rec.id, chat: chatId, gameId: rec.gameId, game: rec.game, hours: hours, price: price, mapLot: m ? m.lotId : "",
                until: now() + Math.max(1, int(S.extMinutes, 10)) * 60 };
            EXT[tag] = e;
            save("extlots", EXT);
            sendTo(chatId, extReady(rec, e));
            if (S.notifySales) notify("MUVSell Rent: лот продления", (rec.buyer || "") + ": " + rec.game + " +" + dur(hours) + " за " + price + "₽ (лот " + lotId + ")");
        } finally {
            delete extBusy[rec.id];
        }
    }
    function payExt(order, chatId, tag) {
        var e = EXT[tag];
        delete EXT[tag];                    // сразу, чтобы второй заказ того же лота не продлил дважды
        save("extlots", EXT);
        if (!deleteLot(e.lotId)) log("лот продления " + e.lotId + " не удалён" + lastErr());
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

    // --- фон: наличие, цены, окончания аренды
    var state = { low: false, priceAt: 0, pollAt: 0 }, busy = false;
    function syncLots() {
        if (!S.fpEdit) return;
        var lots = MAPS.filter(function (m) { return m.lotId && !m.off; });
        if (!lots.length) return;
        var want = {};
        if (S.hideLowBalance || lots.some(hideOn)) {
            var low = false;
            if (S.hideLowBalance) {
                var b = balance(true);
                if (!b) return;                  // нет данных: ничего не трогаем
                var bal = num(S.pay === "usd" ? b.balanceUsd : b.balanceRub);
                low = bal <= num(S.balanceMin);
                if (low !== state.low) {
                    state.low = low;
                    notify("MUVSell Rent: баланс", low ? "Баланс MUVSell " + bal + ", это не выше порога. Снимаю лоты с продажи, пополните баланс на сайте." : "Баланс пополнен (" + bal + "), возвращаю лоты.");
                }
            }
            if (low) {
                lots.forEach(function (m) { want[m.lotId] = "balance"; });
            } else {
                var prods = products(true);
                if (!prods) return;
                var stock = {};
                prods.forEach(function (p) { stock[p.id] = p.available ? int(p.inStock, 0) : 0; });
                lots.forEach(function (m) { if (hideOn(m) && !(stock[m.gameId] > 0)) want[m.lotId] = "stock"; });
            }
        }
        var gone = [], back = [];
        lots.forEach(function (m) {
            var id = String(m.lotId);
            if (want[id] && !HIDDEN[id]) {
                if (lotActive(id, false)) { HIDDEN[id] = want[id]; if (want[id] === "stock") gone.push(mapLabel(m)); }
            } else if (!want[id] && HIDDEN[id]) {
                if (lotActive(id, true)) { if (HIDDEN[id] === "stock") back.push(mapLabel(m)); delete HIDDEN[id]; }
            }
        });
        if (gone.length || back.length) save("hidden", HIDDEN);
        if (gone.length) notify("MUVSell Rent: сняты с продажи", "Нет аккаунтов на MUVSell: " + gone.slice(0, 10).join("; "));
        if (back.length) notify("MUVSell Rent: снова в продаже", "Аккаунты появились: " + back.slice(0, 10).join("; "));
    }
    function reprice(targets) {
        var updated = 0, changes = [];
        for (var i = 0; i < targets.length; i++) {
            var m = targets[i], prod = product(m.gameId);
            if (!prod) continue;
            var price = priceFor(prod, int(m.hours, 1), m);
            if (num(m.price) === price) continue;
            var ok = false;
            try { ok = fpt.lots.changePrice(String(m.lotId), DESKTOP ? String(price) : price) !== false; } catch (e) {}
            if (!ok) { log("цена лота " + m.lotId + " не сменилась" + lastErr()); continue; }
            changes.push(mapLabel(m) + ": " + (m.price ? m.price + "₽" : "?") + " → " + price + "₽");
            m.price = price;
            updated++;
            if (updated >= 10) break;            // не больше десяти лотов за проход, FunPay не любит спешку
        }
        if (updated) saveMaps();
        return changes;
    }
    function syncPrices() {
        if (!products(true)) return;
        var changes = reprice(MAPS.filter(function (m) { return m.reprice && !m.off; }));
        if (changes.length) notify("MUVSell Rent: цены обновлены", changes.slice(0, 8).join("; "));
    }
    function endNotices() {
        var t0 = now(), dirty = false;
        for (var chat in RENT) {
            RENT[chat].forEach(function (r) {
                if (r.ended || !r.exp) return;
                var left = r.exp - t0;
                if (left > 0 && left <= num(S.warnMin) * 60 && !r.warned) {
                    r.warned = true;
                    dirty = true;
                    sendTo(r.chat, t("warn", { game: r.game, login: r.login, left: leftText(left), expires: whenTz(r.exp), word: S.extWord }));
                }
                if (left > 0) return;
                var d = api("GET", "/rental/" + r.id).data;      // продлить могли и на сайте: сверяемся, прежде чем прощаться
                var rental = (d || {}).rental || {};
                if (rental.status === "active" && ts(rental.endsAt) > t0) { r.exp = ts(rental.endsAt); dirty = true; return; }
                r.ended = true;
                dirty = true;
                if (S.notifyEnd) sendTo(r.chat, t("ended", { game: r.game, login: r.login }));
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
            var a = accOf(api("GET", "/rental/" + p.rid).data, rec.login);
            if (a && a.password && a.password !== p.old) {
                sendTo(p.chat, t("pass_ok", { game: rec.game, login: rec.login, password: a.password }));
                return false;
            }
            if (p.tries >= 30) {
                sendTo(p.chat, t("pass_fail", { login: rec.login, reason: "смена затянулась, продавец уже уведомлён" }));
                notify("MUVSell Rent: пароль не сменился", rec.login + ": смена не завершилась за 5 минут, проверьте на сайте.");
                return false;
            }
            return true;
        });
    }
    setInterval(function () {
        if (busy) return;
        busy = true;
        try {
            if (passWait.length) passwords();
            if (Object.keys(EXT).length) extCleanup();
            if (S.enabled && now() - state.pollAt >= Math.max(15, int(S.pollSec, 60))) {
                state.pollAt = now();
                endNotices();
                syncLots();
                if (S.fpEdit && now() - state.priceAt > Math.max(1, num(S.priceMin) || 5) * 60) { state.priceAt = now(); syncPrices(); }
            }
        } catch (e) {
            log("ошибка фоновой проверки: " + e);
        } finally {
            busy = false;
        }
    }, 10000);
    setInterval(function () {
        if (busy || !job || job.over) return;
        busy = true;
        try { jobStep(); } catch (e) { log("ошибка работы с лотами: " + e); job.stats.failed++; } finally { busy = false; }
    }, 4000);

    // --- настройки
    var view = "main", draft = {}, textKey = 0, period = "7", planShown = null, sure = "";
    var PERIODS = { today: "Сегодня", "7": "7 дней", "30": "30 дней", all: "Всё время" };
    function tri(v, global) { return v === undefined || v === null ? "как в общих (" + (global ? "да" : "нет") + ")" : (v ? "да" : "нет"); }
    function render() {
        var kids = [H("MUVSell Rent")].concat(tabs([["main", "Главная"], ["maps", "Привязки"], ["rent", "Аренды"], ["stat", "Статистика"], ["auto", "Автовыставление"], ["set", "Настройки"], ["text", "Сообщения"]], view, "window.mvsView"));
        if (view === "main") {
            kids.push(Sw("Плагин работает", "m_on", S.enabled, "window.mvsOn()"));
            kids.push(Card(
                In("API-ключ MUVSell (сайт muvsell.store, Профиль, API)", "m_key", S.key),
                Row(Btn("Сохранить ключ", "window.mvsKey()", false, "Проверяю..."), Btn("Баланс", "window.mvsBalance()", true, "Проверяю..."))
            ));
            var todo = [];
            if (!String(S.key).trim()) todo.push("впишите API-ключ");
            if (!MAPS.length) todo.push("привяжите лот к игре во вкладке \"Привязки\"");
            kids.push(todo.length ? T("Чтобы заработало: " + todo.join("; ") + ".", { color: "#D98A00" }) : T("Всё готово к работе. Привязок: " + MAPS.length + ", аренд сейчас: " + allActive().length + ".", { color: "#2E9E5B" }));
            kids.push(Card(
                T("Как это работает", { bold: true }),
                T("1. На muvsell.store создайте ключ API и пополните баланс."),
                T("2. Создайте лот на FunPay и привяжите его к игре: сколько часов аренды выдавать за 1 шт."),
                T("3. Покупатель оплачивает лот, плагин арендует аккаунт на MUVSell по цене сайта и присылает логин и пароль. Разница цен это ваш заработок."),
                T("Время за заказ: часы привязки × количество. Лот на 1 час можно продавать почасово."),
                T("Чтобы покупатель мог продлить тот же аккаунт, сделайте отдельный лот и отметьте привязку как \"лот продления\".")
            ));
            kids.push(hint("Команды покупателя: !код, !время, !данные, " + S.extWord + ", !кик, !пароль, !помощь."));
        } else if (view === "maps") {
            MAPS.forEach(function (m, i) {
                var prod = product(m.gameId);
                var card = [
                    T(mapLabel(m) + (m.off ? " · выключена" : ""), { bold: true }),
                    T("Лот " + m.lotId + ((m.titles || [])[0] ? " · " + m.titles[0] : "")),
                    T("Наценка: " + (m.markup === undefined || m.markup === null ? S.markup + "% (общая)" : m.markup + "%") + " · цена: " + (m.reprice ? "следует за MUVSell" : "не меняется") +
                        (prod ? " · на MUVSell " + int(prod.inStock, 0) + " акк." : "") + (HIDDEN[m.lotId] ? " · снят с продажи" : "")),
                    Row(Btn(m.reprice ? "Не менять цену" : "Вести цену", "window.mvsMap('reprice'," + i + ")", true), Btn(m.off ? "Включить" : "Выключить", "window.mvsMap('off'," + i + ")", true)),
                    Row(Btn("Скрывать без аккаунтов: " + tri(m.autohide, S.hideNoStock), "window.mvsMap('hide'," + i + ")", true), Btn("Бонус за отзыв: " + tri(m.bonus, S.reviewBonus), "window.mvsMap('bonus'," + i + ")", true)),
                    In("Своя наценка, % (пусто: общая)", "mm_" + i, m.markup === undefined || m.markup === null ? "" : m.markup),
                    Row(Btn("Сохранить наценку", "window.mvsMap('markup'," + i + ")", true), Btn("Удалить привязку", "window.mvsMap('del'," + i + ")", true)),
                ];
                kids.push({ type: "Card", children: card });
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
                (draft.found || []).forEach(function (p, i) {
                    nc.push(Row(T(p.name + " · " + int(p.inStock, 0) + " акк. · " + num(p.pricePerHourRub) + "₽/ч"), Btn("Выбрать", "window.mvsDraftGame(" + i + ")", true)));
                });
                if (draft.found && !draft.found.length) nc.push(hint("Ничего не найдено."));
            } else {
                nc.push(T("Лот " + draft.lotId + ": " + (draft.titles[0] || "без названия")));
                nc.push(T("Игра: " + draft.game));
                nc.push(In("Сколько аренды за 1 шт.: часы числом или дни с буквой д (3, 7д)", "d_hours", gs("d_hours")));
                nc.push(Sw("Это лот продления: оплата добавляет время к текущему аккаунту покупателя", "d_ext", on("d_ext"), ""));
                nc.push(Row(Btn("Привязать", "window.mvsDraftSave()"), Btn("Отмена", "window.mvsDraftCancel()", true)));
            }
            kids.push({ type: "Card", children: nc });
            kids.push(Btn("Пересчитать цены сейчас", "window.mvsReprice()", true, "Считаю..."));
        } else if (view === "rent") {
            var act = allActive();
            if (!act.length) kids.push(hint("Сейчас никто ничего не арендует."));
            act.forEach(function (r) {
                kids.push(Card(
                    T(r.game + " · " + r.login, { bold: true }),
                    T((r.buyer || "") + " · заказ #" + r.order + " · осталось " + leftText(r.exp - now()) + ", до " + when(r.exp)),
                    In("Продлить на (часы или дни с буквой д)", "x_" + r.id, ""),
                    Row(Btn("Продлить", "window.mvsRent('ext','" + r.id + "')", true, "..."), Btn("Код", "window.mvsRent('code','" + r.id + "')", true, "..."), Btn("Завершить", "window.mvsRent('end','" + r.id + "')", true, "..."))
                ));
            });
        } else if (view === "stat") {
            kids.push({ type: "Row", children: Object.keys(PERIODS).map(function (p) { return Btn((p === period ? "• " : "") + PERIODS[p], "window.mvsPeriod('" + p + "')", p !== period); }) });
            var from = 0, d0 = new Date();
            if (period === "today") from = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime() / 1000;
            else if (period !== "all") from = now() - int(period, 7) * 86400;
            var a = { n: 0, ext: 0, bonus: 0, rev: 0, cost: 0, hours: 0, ref: 0 }, games = {};
            SALES.forEach(function (s) {
                if (s.ts < from) return;
                if (s.refunded) { a.ref++; return; }
                if (s.kind === "new") a.n++; else if (s.kind === "ext") a.ext++; else a.bonus++;
                a.rev += num(s.rev); a.cost += num(s.cost); a.hours += int(s.hours, 0);
                games[s.game] = (games[s.game] || 0) + num(s.rev) - num(s.cost);
            });
            kids.push(Card(
                T("Выдач: " + a.n + " · продлений: " + a.ext + " · бонусов: " + a.bonus + " · возвратов: " + a.ref),
                T("Часов аренды: " + a.hours),
                T("Выручка: " + a.rev.toFixed(2) + "₽ · расход на MUVSell: " + a.cost.toFixed(2) + "₽"),
                T("Прибыль: " + (a.rev - a.cost).toFixed(2) + "₽", { bold: true })
            ));
            Object.keys(games).sort(function (x, y) { return games[y] - games[x]; }).slice(0, 8).forEach(function (g) { kids.push(T(g + ": " + games[g].toFixed(2) + "₽")); });
            kids.push(hint("Выручка считается по сумме заказа на FunPay, без учёта комиссии вывода."));
        } else if (view === "auto") {
            kids.push(hint("Плагин сам создаёт лоты для игр из каталога MUVSell: по одному на каждую игру и срок, в нужном разделе FunPay, с ценой по наценке. Лоты сразу привязаны."));
            if (job) {
                kids.push(Card(
                    T(job.over ? job.result : jobLine(), { bold: !job.over }),
                    job.over ? Btn("Скрыть", "window.mvsJob('hide')", true) : Row(Btn("Обновить", "window.mvsView('auto')", true), Btn("Остановить", "window.mvsJob('stop')", true))
                ));
                if (!job.over) kids.push(hint("Можно закрыть настройки: работа идёт в фоне, по одному лоту раз в несколько секунд."));
            }
            kids.push(Card(
                In("Сроки аренды через запятую: часы числом или дни с буквой д", "a_durs", (S.apDurations || []).map(function (h) { return h % 24 === 0 ? h / 24 + "д" : String(h); }).join(", ")),
                In("Не больше стольких лотов плагина в одном разделе", "a_cap", S.lotCap),
                In("Наценка новых лотов, % (пусто: общая)", "a_own", S.apOwn === null || S.apOwn === undefined ? "" : S.apOwn),
                In("Только игры с такими словами в названии (пусто: все)", "a_filter", S.apFilter),
                Sw("Создавать лоты сразу активными", "a_active", S.apActive, ""),
                Row(Btn("Сохранить", "window.mvsAuto('save')"), Btn("Показать план", "window.mvsAuto('plan')", true, "Считаю..."))
            ));
            if (planShown) {
                var pc = [T("К созданию: " + planShown.length + " " + plural(planShown.length, "лот", "лота", "лотов"), { bold: true })];
                planShown.slice(0, 10).forEach(function (p) { pc.push(T(p.g.name + ", " + dur(p.hours) + ": " + priceFor(p.prod, p.hours, { markup: S.apOwn }) + "₽ (раздел " + p.g.funpay.subcategory_id + ")")); });
                if (planShown.length > 10) pc.push(hint("и ещё " + (planShown.length - 10)));
                if (planShown.length) pc.push(Btn(sure === "create" ? "Точно создать " + planShown.length + "?" : "Создать недостающие лоты", "window.mvsAuto('create')"));
                kids.push({ type: "Card", children: pc });
            }
            var autos = MAPS.filter(function (m) { return m.auto; }).length;
            kids.push(Card(
                T("Лотов автовыставления: " + autos, { bold: true }),
                Row(Btn("Переписать их тексты по шаблонам", "window.mvsAuto('retext')", true), Btn(sure === "delete" ? "Точно удалить " + autos + "?" : "Удалить их с FunPay", "window.mvsAuto('delete')", true))
            ));
            kids.push(hint("Названия и описания лотов правятся во вкладке \"Сообщения\" (шаблоны \"Автовыставление\"). Начните с одной игры: впишите её название в фильтр и посмотрите, какой лот получится." +
                (DESKTOP ? " При удалении лотов программа спросит разрешение." : "")));
        } else if (view === "set") {
            kids.push(Card(
                T("Цены", { bold: true }),
                In("Общая наценка, %", "s_markup", S.markup),
                In("Лот не дешевле, ₽", "s_minprice", S.minPrice),
                In("Как часто сверять цены, минут", "s_pricemin", S.priceMin),
                Sw("Считать от цены срока со скидкой, а не от цены часа", "s_vol", S.volDiscount, ""),
                Btn("Чем платить на MUVSell: " + ({ rub: "рубли", usd: "доллары", auto: "рубли, пока есть" }[S.pay] || S.pay), "window.mvsPay()", true)
            ));
            kids.push(Card(
                T("Лоты", { bold: true }),
                Sw("Плагин может менять цену и видимость лотов", "s_edit", S.fpEdit, ""),
                Sw("Снимать лот с продажи, пока на MUVSell нет аккаунтов", "s_hide", S.hideNoStock, ""),
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
                In("Слово для продления", "s_word", S.extWord),
                Sw("По команде продления создавать временный лот на нужный срок", "s_exttemp", S.extTemp, ""),
                In("Сколько минут временный лот ждёт оплату", "s_extmin", S.extMinutes),
                Sw("Разрешить покупателю !кик и !пароль", "s_cmds", S.buyerCmds, ""),
                Sw("Уведомлять меня о выдачах и продлениях", "s_ntf", S.notifySales, "")
            ));
            kids.push(Btn("Сохранить настройки", "window.mvsSet()"));
            if (DESKTOP && S.autoRefund) kids.push(hint("При первом возврате программа спросит разрешение. Выберите \"Разрешать всегда\"."));
        } else {
            var key = TEXT_KEYS[textKey];
            kids.push(Btn("Сообщение: " + TEXT_LABELS[key] + " (следующее)", "window.mvsTextNext()", true));
            kids.push(Card(
                In("Текст", "t_text", (S.texts || {})[key] || TEXTS[key], true),
                Row(Btn("Сохранить", "window.mvsTextSave()"), Btn("Вернуть стандартный", "window.mvsTextReset()", true))
            ));
            kids.push(hint("Переменные: {game}, {login}, {password}, {hours}, {expires}, {left}, {code}, {ttl}, {word}, {links}, {bonus}, {stars}, {reason}, {commands}. В текстах лотов: {game}, {time}, {commands}, {tag}; в сообщении о лоте продления ещё {price}, {link}, {minutes}. " + NL_HINT));
        }
        kids.push(hint("Автор оригинального плагина: @MUVSell"));
        show(kids);
    }
    window.mvsView = function (v) { view = v; render(); };
    window.mvsOn = function () { S.enabled = on("m_on"); saveS(); };
    window.mvsKey = function () {
        S.key = gs("m_key").trim();
        saveS();
        cache.products = [0, null];
        cache.bal = [0, null];
        if (S.key) { var b = balance(true); toast(b ? "Ключ принят. Баланс: " + num(b.balanceRub) + " ₽ / " + num(b.balanceUsd) + " $" : "Ключ сохранён, но проверить его не вышло: " + (lastApiError || "нет связи с muvsell.store")); }
        render();
    };
    window.mvsBalance = function () {
        var b = balance(true);
        toast(b ? (b.username ? b.username + ": " : "") + num(b.balanceRub) + " ₽ / " + num(b.balanceUsd) + " $" : "Баланс не получен: " + human(String(S.key).trim() ? "net" : "no_key"));
        render();
    };
    window.mvsDraftLot = function () {
        var text = gs("d_lot"), m = /id=(\d+)/.exec(text) || /(\d{4,})/.exec(text);
        if (!m) { toast("Не вижу ID лота"); return render(); }
        if (mapByLot(m[1])) { toast("Лот " + m[1] + " уже привязан"); return render(); }
        var lf = null;
        try { lf = fpt.lots.getFields(m[1]); } catch (e) {}
        var titles = lf ? [lotField(lf, "fields[summary][ru]"), lotField(lf, "fields[summary][en]")].filter(Boolean) : [];
        if (!titles.length) { toast("Лот " + m[1] + " не открывается" + lastErr()); return render(); }
        draft = { lotId: m[1], titles: titles, subcat: int(lotField(lf, "node_id"), 0) };
        render();
    };
    window.mvsDraftSearch = function () {
        var prods = products();
        if (!prods) { toast("Каталог MUVSell не загрузился: " + human(String(S.key).trim() ? "net" : "no_key")); return render(); }
        var q = gs("d_q").trim().toLowerCase();
        draft.found = prods.filter(function (p) { return !q || String(p.name || "").toLowerCase().indexOf(q) >= 0; })
            .sort(function (a, b) { return (int(b.inStock, 0) > 0) - (int(a.inStock, 0) > 0) || String(a.name).localeCompare(String(b.name)); }).slice(0, 8);
        render();
    };
    window.mvsDraftGame = function (i) {
        var p = (draft.found || [])[i];
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
        MAPS.push({ lotId: draft.lotId, subcat: draft.subcat || 0, titles: draft.titles, gameId: draft.gameId, game: draft.game, hours: hours, reprice: false, ext: on("d_ext") });
        saveMaps();
        toast("Привязано: лот " + draft.lotId + ", " + draft.game + ", " + dur(hours) + " за 1 шт.");
        draft = {};
        ["d_lot", "d_q", "d_hours"].forEach(function (k) { fpt.ui.setState(k, ""); });
        fpt.ui.setState("d_ext", "false");
        render();
    };
    window.mvsMap = function (act, i) {
        var m = MAPS[i];
        if (!m) return render();
        if (act === "del") { MAPS.splice(i, 1); delete HIDDEN[m.lotId]; save("hidden", HIDDEN); }
        else if (act === "reprice") m.reprice = !m.reprice;
        else if (act === "off") m.off = !m.off;
        else if (act === "hide") m.autohide = m.autohide === undefined || m.autohide === null ? true : (m.autohide ? false : null);
        else if (act === "bonus") m.bonus = m.bonus === undefined || m.bonus === null ? true : (m.bonus ? false : null);
        else if (act === "markup") { var v = gs("mm_" + i).trim(); m.markup = v === "" ? null : num(v); }
        saveMaps();
        render();
    };
    window.mvsReprice = function () {
        if (!products(true)) { toast("Каталог MUVSell не загрузился"); return render(); }
        var changes = reprice(MAPS.filter(function (m) { return m.reprice && !m.off; }));
        toast(changes.length ? "Обновлено цен: " + changes.length : "Цены уже верные (или ни у одной привязки не включено ведение цены)");
        render();
    };
    window.mvsRent = function (act, rid) {
        var rec = recById(rid);
        if (!rec) return render();
        if (act === "code") { var c = guard(rec); toast(c ? rec.login + ": " + c.code + " (ещё ~" + (c.expiresIn === undefined ? 30 : c.expiresIn) + " с)" : "Код не получен: " + (lastApiError || "у аккаунта нет maFile")); }
        else if (act === "ext") {
            var h = parseHours(gs("x_" + rid));
            if (!h) { toast("Укажите срок: часы числом или дни с буквой д"); return render(); }
            var err = extend(rec, h, rec.chat, null, "extended", "ext");
            toast(err ? "Не продлено: " + human(err) : "Продлено на " + dur(h));
        } else if (act === "end") {
            var r = api("POST", "/rental/" + rid + "/terminate", {});
            if (r.err) toast("Не завершено: " + human(r.err));
            else { rec.exp = now(); rec.ended = true; saveRent(); toast("Аренда завершена"); }
        }
        render();
    };
    window.mvsPeriod = function (p) { period = p; render(); };
    window.mvsPay = function () { var a = ["rub", "usd", "auto"]; S.pay = a[(a.indexOf(S.pay) + 1) % a.length]; saveS(); render(); };
    window.mvsSet = function () {
        S.markup = num(gs("s_markup")); S.minPrice = Math.max(1, num(gs("s_minprice")) || 1); S.priceMin = Math.max(1, int(gs("s_pricemin"), 5));
        S.volDiscount = on("s_vol"); S.fpEdit = on("s_edit"); S.hideNoStock = on("s_hide"); S.hideLowBalance = on("s_low");
        S.balanceMin = Math.max(0, num(gs("s_balmin"))); S.pollSec = Math.max(15, int(gs("s_poll"), 60));
        S.autoRefund = on("s_refund"); S.reviewBonus = on("s_bonus"); S.bonusHours = clamp(int(gs("s_bh"), 2), 1, 720); S.bonusStars = clamp(int(gs("s_bs"), 5), 1, 5);
        S.notifyEnd = on("s_end"); S.warnMin = Math.max(0, int(gs("s_warn"), 30));
        var word = gs("s_word").trim().split(/\s+/)[0] || "!продление";
        S.extWord = word.charAt(0) === "!" ? word : "!" + word;
        S.buyerCmds = on("s_cmds"); S.notifySales = on("s_ntf");
        S.extTemp = on("s_exttemp"); S.extMinutes = clamp(int(gs("s_extmin"), 10), 1, 120);
        saveS();
        cache.costs = {};
        toast("Сохранено");
        render();
    };
    window.mvsJob = function (act) {
        if (act === "stop" && job) job.stop = true;
        if (act === "hide") job = null;
        render();
    };
    window.mvsAuto = function (act) {
        if (act !== sure) { var was = sure; sure = ""; if ((act === "create" || act === "delete") && was !== act) { if (act === "delete" || planShown) { sure = act; return render(); } } }
        if (act === "save" || act === "plan") {
            var durs = [];
            gs("a_durs").split(/[,;]+/).forEach(function (x) { var h = parseHours(x); if (h && durs.indexOf(h) < 0) durs.push(h); });
            if (!durs.length) { toast("Укажите хотя бы один срок"); return render(); }
            S.apDurations = durs.sort(function (a, b) { return a - b; });
            S.lotCap = clamp(int(gs("a_cap"), 20), 1, 200);
            var own = gs("a_own").trim();
            S.apOwn = own === "" ? null : num(own);
            S.apFilter = gs("a_filter").trim();
            S.apActive = on("a_active");
            saveS();
            planShown = null;
            if (act === "save") { toast("Сохранено"); return render(); }
        }
        if (act === "plan" || act === "create") {
            if (!String(S.key).trim()) { toast("Сначала впишите API-ключ MUVSell"); return render(); }
            if (!products(true)) { toast("Каталог MUVSell не загрузился: " + (lastApiError || "нет связи")); return render(); }
            if (!(fpMap(act === "plan").games || []).length) { toast("Карта игр с muvsell.store не загрузилась"); return render(); }
            var p = plan();
            if (act === "plan") { planShown = p; if (!p.length) toast("Создавать нечего: лоты на все игры и сроки уже есть"); return render(); }
            sure = "";
            if (!p.length) { toast("Создавать нечего"); return render(); }
            if (!S.fpEdit) { toast("В настройках выключено \"Плагин может менять цену и видимость лотов\""); return render(); }
            if (!startJob("create", "Создание лотов", p)) toast("Уже идёт другая работа с лотами");
            planShown = null;
            return render();
        }
        var autos = MAPS.filter(function (m) { return m.auto; });
        sure = "";
        if (!autos.length) { toast("Лотов автовыставления нет"); return render(); }
        if (act === "retext" && !startJob("retext", "Перезапись текстов", autos)) toast("Уже идёт другая работа с лотами");
        if (act === "delete" && !startJob("delete", "Удаление лотов", autos)) toast("Уже идёт другая работа с лотами");
        render();
    };
    window.mvsTextNext = function () { textKey = (textKey + 1) % TEXT_KEYS.length; render(); };
    window.mvsTextSave = function () {
        var text = gm("t_text").trim();
        if (!text) return toast("Текст пустой");
        S.texts[TEXT_KEYS[textKey]] = text;
        saveS();
        toast("Сохранено");
    };
    window.mvsTextReset = function () { delete S.texts[TEXT_KEYS[textKey]]; saveS(); render(); };

    render();
    log("запущен: привязок " + MAPS.length + ", активных аренд " + allActive().length);
})();
