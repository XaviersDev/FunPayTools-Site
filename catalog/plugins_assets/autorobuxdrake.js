// @name AutoRobux
// @author @drakelovc
// @version 1.0.1
// @description Авто-выдача Robux: через сервис RBXCrate или выкупом GamePass покупателя со своих аккаунтов Roblox. Сам считает цену GamePass с учётом комиссии.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/autorobux_banner.png

(function () {
    var TAG = "[AutoRobux]", NS_STORE = "arx_", NS_UI = "arx_";

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

    // ---------------------------------------------------------------- autorobuxdrake
    // Два способа выдачи Robux: через сервис RBXCrate (по ключу API) и выкуп GamePass покупателя со своих аккаунтов Roblox.
    var GUIDE_URL = "https://telegra.ph/Kak-sozdat-GamePass-dlya-AutoRobux-07-06";
    var MSG_RU = {
        ask_username: "💎 Спасибо за оплату!\nК выдаче: {robux} Robux.\n\nСоздайте GamePass на {gamepass_price} Robux, чтобы после комиссии Roblox 30% вышло {robux} Robux.\nЕсли Roblox не даёт включить продажу GamePass, сначала откройте настройки плейса и заполните Experience Rating / Questionnaire.\nПосле создания пришлите Roblox username + placeId/ссылку на плейс.\nИнструкция: " + GUIDE_URL + "\n\nПример:\nMyRobloxNick\nhttps://www.roblox.com/games/1234567890/...",
        accepted: "✅ Заказ принят в обработку.\nRobux будут начислены через RBXCrate. Статус можно уточнить у продавца.",
        failed: "❌ Не удалось создать выдачу Robux автоматически.\nПродавец уже получил уведомление и проверит заказ вручную.",
        bad_username: "❗ Не смог распознать Roblox username и placeId. Пришлите ник и ссылку на плейс/числовой placeId.",
        timeout: "⌛ Время на отправку Roblox username/placeId истекло. Напишите продавцу.",
        blacklisted: "⛔ Ваш заказ не может быть обработан автоматически. Продавец проверит его вручную.",
        completed: "✅ Robux успешно отправлены! Подтвердите заказ на FunPay.",
        provider_error: "⚠️ RBXCrate сообщил об ошибке выдачи. Продавец уже уведомлён и проверит заказ.",
        gamepass_not_found: "⚠️ GamePass пока не найден. Проверьте, что он создан, выставлен на продажу и находится на указанном плейсе. После исправления напишите !resend.",
        seller_mismatch: "⚠️ GamePass должен принадлежать аккаунту {username}. Проверьте аккаунт и пришлите данные заново или напишите !resend после исправления.",
        regional_pricing: "⚠️ Для GamePass включены региональные цены. Отключите их или создайте новый GamePass, затем напишите !resend.",
        roblox_user_not_found: "⚠️ Roblox username не найден. Проверьте ник и пришлите данные заново.",
        status: "📦 Статус заказа #{order_id}: {status}",
        reminder: "⏳ Напоминание: пришлите Roblox username и placeId/ссылку на плейс для выдачи Robux.",
        guide: "📘 Как подготовить данные для выдачи Robux через GamePass:\n1. Открой Roblox Studio или страницу своего плейса.\n2. Создай GamePass на нужном плейсе.\n3. Включи продажу GamePass.\n4. Пришли сюда свой Roblox username и ссылку на плейс вида:\nhttps://www.roblox.com/games/1234567890/name\nЕсли кнопка продажи GamePass недоступна, сначала заполни Experience Rating / Questionnaire в настройках плейса.\nПодробная инструкция: " + GUIDE_URL,
        gp_ask: "💎 Спасибо за оплату!\nСоздайте GamePass на ровно {expected_price} Robux и пришлите ссылку/ID сюда.\n\nПеред продажей Roblox может попросить заполнить Experience Rating / Questionnaire для плейса. Если кнопка продажи GamePass недоступна, сначала откройте настройки плейса, заполните рейтинг/возрастные вопросы, сохраните и только потом выставляйте GamePass на продажу.\n\nПроверяю цену автоматически. Если цена другая, подскажу правильную.",
        gp_wrong_price: "❗ Цена GamePass {actual} ≠ требуемой {expected}. Создайте новый GamePass с правильной ценой и пришлите ID снова.",
        gp_success: "✅ Robux отправлены! Подтвердите заказ на FunPay.",
        gp_failure: "❌ Не удалось приобрести GamePass. Средства возвращены.",
    };
    var MSG_EN = {
        ask_username: "💎 Thanks for your payment!\nDelivery amount: {robux} Robux.\n\nCreate a GamePass priced at {gamepass_price} Robux so after Roblox 30% fee you receive {robux} Robux.\nIf Roblox does not allow you to put the GamePass on sale, complete the place Experience Rating / Questionnaire first.\nThen send your Roblox username and placeId/place link.\nGuide: " + GUIDE_URL,
        accepted: "✅ Order accepted. RBXCrate will process the Robux delivery.",
        failed: "❌ Could not create the RBXCrate delivery automatically. Seller has been notified.",
        bad_username: "❗ Could not parse Roblox username and placeId. Send username and place link/placeId.",
        timeout: "⌛ Time to send Roblox username/placeId expired. Contact the seller.",
        blacklisted: "⛔ Your order cannot be processed automatically. Seller will review it manually.",
        completed: "✅ Robux delivered! Please confirm the FunPay order.",
        provider_error: "⚠️ RBXCrate reported a delivery error. Seller has been notified.",
        gamepass_not_found: "⚠️ GamePass not found yet. Make sure it is created and on sale, then type !resend.",
        seller_mismatch: "⚠️ GamePass must belong to {username}. Check the account, then type !resend.",
        regional_pricing: "⚠️ Regional pricing is enabled. Disable it or create a new GamePass, then type !resend.",
        roblox_user_not_found: "⚠️ Roblox username not found. Check the username and send it again.",
        status: "📦 Order #{order_id} status: {status}",
        reminder: "⏳ Reminder: send Roblox username and placeId/place link for Robux delivery.",
        guide: "📘 Create the GamePass, put it on sale, and send your Roblox username + place link. If selling is blocked, complete the place Experience Rating / Questionnaire first. Guide: " + GUIDE_URL,
        gp_ask: "💎 Thanks for your payment!\nCreate a GamePass priced at exactly {expected_price} Robux and send its link or ID here.\nIf Roblox does not allow selling it, complete the place Experience Rating / Questionnaire first.\nI check the price automatically.",
        gp_wrong_price: "❗ GamePass price {actual} ≠ required {expected}. Create a new GamePass with the right price and send its ID again.",
        gp_success: "✅ Robux sent! Please confirm the FunPay order.",
        gp_failure: "❌ Could not purchase the GamePass. Your money has been refunded.",
    };
    var MSG_LABELS = {
        ask_username: "RBXCrate: запрос ника и плейса", accepted: "RBXCrate: заказ создан", failed: "RBXCrate: не удалось создать",
        bad_username: "RBXCrate: не разобрал данные", timeout: "RBXCrate: время вышло", blacklisted: "Покупатель в чёрном списке",
        completed: "RBXCrate: Robux отправлены", provider_error: "RBXCrate: ошибка выдачи", gamepass_not_found: "RBXCrate: GamePass не найден",
        seller_mismatch: "RBXCrate: чужой GamePass", regional_pricing: "RBXCrate: региональные цены", roblox_user_not_found: "RBXCrate: ник не найден",
        status: "Команда !status", reminder: "Напоминание покупателю", guide: "Команда !guide",
        gp_ask: "Выкуп: просим GamePass", gp_wrong_price: "Выкуп: неверная цена", gp_success: "Выкуп: Robux отправлены", gp_failure: "Выкуп: не получилось",
    };
    var MSG_KEYS = Object.keys(MSG_LABELS);
    var API = {
        create: "/api/orders/gamepass", info: "/api/orders/info", cancel: "/api/orders/cancel", resend: "/api/orders/gamepass/resend",
        stock: "/api/orders/stock", balance: "/api/shared/balance",
    };
    var DEFAULTS = {
        mode: DESKTOP ? "gamepass" : "rbxcrate",   // gamepass | rbxcrate | pause
        maps: [],                                  // {id, match, lotId, per, extra}
        autoBase: false, baseKeys: ["робукс", "robux", "game pass", "gamepass"],
        minRobux: 1, maxRobux: 100000,
        waitHours: 24, reminderMin: 10, lang: "ru",
        blacklistOn: true, blacklist: [],          // {name, chatId, reason, ts}
        // RBXCrate
        base: "https://rbxcrate.com", token: "", auth: "api-key", preOrder: true, ownership: true,
        test: true, pollSec: 60, refundOnError: false, oos: "wait", maxResend: 3, precheck: false,
        lowBalance: 0, lowStock: 0, manageLots: false, cancelErrorMin: 0, blacklistAfterErrors: 0,
        // выкуп GamePass
        accounts: [], gpRefund: true, gpAttempts: 5, lastIdx: 0,
        ru: {}, en: {},
    };
    var S = load("settings", null) || {};
    (function () { for (var k in DEFAULTS) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); })();
    var waiting = load("waiting", {});     // чат → ожидание данных от покупателя
    var orders = load("orders", []);       // журнал выдач
    var langs = load("langs", {});         // чат → ru/en
    var problems = load("problems", []);

    function saveS() { save("settings", S); }
    function saveOrders() { if (orders.length > 1000) orders = orders.slice(orders.length - 1000); save("orders", orders); }
    function msg(key, chatId, vars) {
        var lang = (chatId && langs[chatId]) || S.lang || "ru";
        var text = lang === "en" ? (S.en[key] || MSG_EN[key] || S.ru[key] || MSG_RU[key]) : (S.ru[key] || MSG_RU[key]);
        return fill(text || "", vars || {});
    }
    function problem(kind, orderId, buyer, lot, detail) {
        problems.push({ ts: now(), kind: kind, orderId: String(orderId || ""), buyer: buyer || "", lot: String(lot || "").slice(0, 120), detail: String(detail || "").slice(0, 300) });
        if (problems.length > 100) problems = problems.slice(problems.length - 100);
        save("problems", problems);
    }
    function blacklisted(name, chatId) {
        var n = String(name || "").toLowerCase();
        return S.blacklist.some(function (b) { return (n && String(b.name || "").toLowerCase() === n) || (chatId && b.chatId === chatId); });
    }
    function gamepassPrice(robux) { return Math.floor((robux * 10 + 6) / 7); }   // цена пасса, чтобы после комиссии 30% вышло robux
    function expectedRobux(m, amount) {
        if (m.fixed !== undefined && m.fixed !== null) return int(m.fixed, 0) * amount;
        return amount * int(m.per, 0) + int(m.extra, 0);
    }
    function autoMap(desc) {
        var d = norm(desc);
        if (!S.baseKeys.some(function (k) { k = norm(k); return k && d.indexOf(k) >= 0; })) return null;
        var m = /(\d{1,6})\s*(?:ед\.?\s*)?(?:робукс(?:ов|ы|а)?|robux|rbx)(?![a-zа-я0-9])/i.exec(d) || /(?:робукс(?:ов|ы|а)?|robux|rbx)\D{0,12}(\d{1,6})/i.exec(d);
        return m ? { id: "auto", match: "по описанию", fixed: int(m[1], 0), per: 0, extra: 0 } : null;
    }
    function matchMap(title, lotId) {
        var desc = norm(title), i, m;
        for (i = 0; i < S.maps.length; i++) {
            m = norm(S.maps[i].match);
            if (m && !/^\d+$/.test(m) && desc && (m === desc || desc.indexOf(m) >= 0 || m.indexOf(desc) >= 0)) return S.maps[i];
        }
        for (i = 0; i < S.maps.length; i++) {
            var id = String(S.maps[i].lotId || "").trim() || (/^\d+$/.test(String(S.maps[i].match).trim()) ? String(S.maps[i].match).trim() : "");
            if (id && lotMatches(id, title, lotId)) return S.maps[i];
        }
        return S.autoBase ? autoMap(title) : null;
    }

    // --- разбор того, что прислал покупатель
    var USERNAME_RX = /^[A-Za-z0-9_]{3,20}$/;
    function extractPlace(text) {
        var m = /(?:roblox\.com\/(?:games|places)\/(\d+)|[?&]placeId=(\d+)|\bplace(?:id)?\s*[:=]?\s*(\d+)\b)/i.exec(text || "");
        if (m) return int(m[1] || m[2] || m[3], 0);
        var t = /\b\d{6,}\b/.exec(text || "");
        return t ? int(t[0], 0) : 0;
    }
    function extractUser(text) {
        var raw = String(text || "").trim();
        var p = /roblox\.com\/(?:users\/(\d+)\/(?:profile)?|@([A-Za-z0-9_]{3,20}))/i.exec(raw);
        if (p && p[2]) return p[2];
        if (!p) { var c = raw.replace(/^@/, "").trim(); if (USERNAME_RX.test(c)) return c; }
        var skip = { roblox: 1, games: 1, places: 1, placeid: 1, www: 1, https: 1, http: 1, com: 1, place: 1 };
        var tokens = raw.replace(/https?:\/\/\S+/g, " ").match(/@?[A-Za-z0-9_]{3,20}/g) || [];
        for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i].replace(/^@/, "");
            if (skip[t.toLowerCase()] || /^\d+$/.test(t)) continue;
            if (USERNAME_RX.test(t)) return t;
        }
        return "";
    }
    function extractGamepass(text) {
        var s = String(text || "").trim();
        if (/^\d+$/.test(s)) return int(s, 0);
        var m = /\/game-pass\/(\d+)/i.exec(s);
        return m ? int(m[1], 0) : 0;
    }

    // --- RBXCrate
    function crateHeaders() {
        var h = { "User-Agent": "FunPayTools AutoRobux/1.0" };
        var t = String(S.token || "").trim();
        if (t && S.auth === "bearer") h["Authorization"] = "Bearer " + t;
        else if (t && S.auth === "x-api-key") h["X-API-Key"] = t;
        else if (t) h["api-key"] = t;
        return h;
    }
    function crate(path, payload) {
        var url = String(S.base || "").replace(/\/+$/, "") + path;
        var r = payload === undefined ? http("GET", url, null, crateHeaders()) : postJson(url, payload, crateHeaders());
        var data = r.json !== null ? r.json : { text: r.body.slice(0, 500) };
        var ok = r.code >= 200 && r.code < 300;
        return { ok: ok, code: r.code, data: data, reason: ok ? "" : (r.code ? "HTTP " + r.code + ": " + JSON.stringify(data).slice(0, 300) : "нет связи с RBXCrate" + (r.error ? " (" + r.error + ")" : "")) };
    }
    function crateCreate(ctx) {
        var payload = {
            orderId: String(ctx.orderId), robloxUsername: String(ctx.username), robuxAmount: int(ctx.robux, 0), placeId: int(ctx.placeId, 0),
            isPreOrder: !!S.preOrder, checkOwnership: !!S.ownership,
        };
        if (S.test) return { ok: true, test: true, data: { payload: payload }, reason: "тестовый режим: запрос не отправлен" };
        var res = crate(API.create, payload);
        if (!res.ok && res.code === 409 && res.data && res.data.code === "ORDER_ALREADY_EXISTS") { res.ok = true; res.reason = "ORDER_ALREADY_EXISTS"; }
        return res;
    }
    function payloadOf(data) { return data && data.data && typeof data.data === "object" ? data.data : (data || {}); }

    // --- Roblox (выкуп GamePass с аккаунта продавца)
    var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    function rbxHeaders(cookie, extra) {
        var h = { "User-Agent": UA };
        var c = String(cookie || "").trim();
        if (c) h["Cookie"] = c.indexOf(".ROBLOSECURITY=") === 0 ? c : ".ROBLOSECURITY=" + c;
        for (var k in (extra || {})) h[k] = extra[k];
        return h;
    }
    function rbxWho(cookie) {
        var r = http("GET", "https://users.roblox.com/v1/users/authenticated", null, rbxHeaders(cookie));
        return r.code === 200 && r.json && r.json.id ? { id: r.json.id, name: r.json.name || r.json.displayName || "" } : null;
    }
    function rbxBalance(cookie, userId) {
        var r = http("GET", "https://economy.roblox.com/v1/users/" + userId + "/currency", null, rbxHeaders(cookie));
        return r.code === 200 && r.json ? int(r.json.robux, 0) : -1;
    }
    function gamepassInfo(id) {
        var r = http("GET", "https://apis.roblox.com/game-passes/v1/game-passes/" + id + "/product-info", null, rbxHeaders(""));
        if (r.code !== 200 || !r.json) return null;
        var price = r.json.PriceInRobux;
        return { productId: r.json.ProductId, price: price === null || price === undefined ? null : int(price, 0), creatorId: (r.json.Creator || {}).Id };
    }
    function rbxPurchase(cookie, info) {
        var url = "https://economy.roblox.com/v1/purchases/products/" + info.productId;
        var ping = http("POST", url, "", rbxHeaders(cookie));
        var token = header(ping, "x-csrf-token");
        if (!token) return { ok: false, reason: DESKTOP ? "Roblox не выдал токен запроса" : "на Android недоступны заголовки ответа, выкуп работает только на компьютере" };
        var body = JSON.stringify({ expectedCurrency: 1, expectedPrice: info.price, expectedSellerId: info.creatorId });
        for (var attempt = 0; attempt < 2; attempt++) {
            var r = http("POST", url, body, rbxHeaders(cookie, { "X-CSRF-Token": token, "Content-Type": "application/json" }));
            var d = r.json || {};
            if (d.purchased) return { ok: true, data: d };
            var reason = d.errorMsg || d.reason || "";
            var fresh = header(r, "x-csrf-token");
            if (attempt === 0 && fresh && (r.code === 403 || /token validation failed/i.test(reason))) { token = fresh; continue; }
            return { ok: false, reason: reason || "Roblox ответил " + r.code };
        }
        return { ok: false, reason: "Roblox не принял токен запроса" };
    }
    function buyout(info, expected) {
        if (!S.accounts.length) return { status: "refund", reasons: ["нет настроенных аккаунтов Roblox"] };
        if (info.price !== expected) return { status: "refund", reasons: ["цена GamePass изменилась: " + info.price + " ≠ " + expected] };
        var reasons = [], n = S.accounts.length, start = int(S.lastIdx, 0) % n;
        for (var i = 0; i < n; i++) {
            var idx = (start + i) % n, acc = S.accounts[idx], label = acc.label || ("аккаунт " + (idx + 1));
            var who = rbxWho(acc.cookie);
            if (!who) { reasons.push(label + ": не удалось войти (cookie устарела?)"); continue; }
            if (info.creatorId !== undefined && info.creatorId !== null && String(who.id) === String(info.creatorId)) {
                return { status: "refuse", reasons: ["GamePass принадлежит аккаунту " + label] };
            }
            var bal = rbxBalance(acc.cookie, who.id);
            if (bal < expected) { reasons.push(label + ": не хватает Robux (" + bal + " < " + expected + ")"); continue; }
            var res = rbxPurchase(acc.cookie, info);
            if (res.ok) return { status: "success", idx: idx, label: label, data: res.data };
            reasons.push(label + ": " + res.reason);
        }
        return { status: "refund", reasons: reasons.length ? reasons : ["не удалось выкупить GamePass"] };
    }

    function doRefund(orderId, reason) {
        if (refundOrder(orderId)) notify("AutoRobux: возврат по заказу #" + orderId, reason);
        else notify("AutoRobux: возврат не прошёл", "Заказ #" + orderId + lastErr() + ". Причина возврата: " + reason);
    }

    // --- новый заказ
    onOrder(function (e) {
        if (!e || e.iAmBuyer || !e.orderId || S.mode === "pause") return;
        var o = orderInfo(e.orderId, e.text);
        if (o && o.iAmBuyer) return;
        var title = (o && o.title) || String(e.text || ""), lotId = o ? o.lotId : "", amount = o ? o.amount : 1;
        var chatId = String(e.chatId || (o && o.chatId) || ""), buyer = e.buyerName || (o && o.buyerName) || "";
        var m = matchMap(title, lotId);
        if (!m) {
            if (/робукс|robux|rbx/i.test(title)) problem("lot_not_found", e.orderId, buyer, title, "нет привязки для этого лота");
            return;
        }
        if (seenOrder(e.orderId)) return;
        if (S.blacklistOn && blacklisted(buyer, chatId)) {
            sendTo(chatId, msg("blacklisted", chatId));
            return notify("AutoRobux: заказ #" + e.orderId + " остановлен", buyer + " в чёрном списке");
        }
        var robux = expectedRobux(m, amount);
        if (robux < int(S.minRobux, 1) || robux > int(S.maxRobux, 100000)) {
            return notify("AutoRobux: заказ #" + e.orderId + " не обработан", robux + " Robux вне пределов " + S.minRobux + "-" + S.maxRobux);
        }
        var price = gamepassPrice(robux);
        if (S.mode === "gamepass" && !DESKTOP) {
            return notify("AutoRobux: заказ #" + e.orderId + " не обработан", "Выкуп GamePass работает только на компьютере. Переключите плагин на RBXCrate или выдайте заказ вручную.");
        }
        if (S.mode === "gamepass" && !S.accounts.length) {
            return notify("AutoRobux: заказ #" + e.orderId, "Нет аккаунтов Roblox для выкупа. Добавьте аккаунт в настройках плагина.");
        }
        waiting[chatId] = {
            mode: S.mode, orderId: String(e.orderId), buyer: buyer, title: title.slice(0, 200), amount: amount, sold: o ? o.price : 0,
            robux: robux, price: price, attempts: 0, ts: now(),
        };
        save("waiting", waiting);
        if (S.mode === "gamepass") sendTo(chatId, msg("gp_ask", chatId, { expected_price: price }));
        else sendTo(chatId, msg("ask_username", chatId, { robux: robux, gamepass_price: price, order_id: e.orderId }));
        log("заказ #" + e.orderId + ": к выдаче " + robux + " Robux, жду данные от " + buyer);
    });

    function lastOrder(chatId) {
        for (var i = orders.length - 1; i >= 0; i--) if (orders[i].chatId === chatId) return orders[i];
        return null;
    }
    function finishGamepass(chatId, w, info, gid) {
        var res = buyout(info, w.price);
        if (res.status === "success") {
            S.lastIdx = (res.idx + 1) % Math.max(1, S.accounts.length);
            saveS();
            orders.push({ kind: "gamepass", orderId: w.orderId, chatId: chatId, buyer: w.buyer, robux: w.robux, price: w.price, gamepass: gid, account: res.label, status: "Completed", sold: w.sold, created: now() });
            saveOrders();
            sendTo(chatId, msg("gp_success", chatId));
            return notify("AutoRobux: заказ #" + w.orderId + " выдан", "GamePass " + gid + " выкуплен за " + w.price + " Robux, " + res.label);
        }
        var reason = res.reasons.join("; ");
        if (res.status === "refuse") {
            waiting[chatId] = w;
            save("waiting", waiting);
            sendTo(chatId, "❌ Этот GamePass принадлежит нашему аккаунту, выкуп невозможен. Создайте GamePass на другом аккаунте.");
            return notify("AutoRobux: заказ #" + w.orderId, "Отказ от выкупа: " + reason);
        }
        orders.push({ kind: "gamepass", orderId: w.orderId, chatId: chatId, buyer: w.buyer, robux: w.robux, price: w.price, gamepass: gid, status: "Error", reason: reason, sold: w.sold, created: now() });
        saveOrders();
        problem("buyout_failed", w.orderId, w.buyer, w.title, reason);
        if (S.gpRefund) {
            sendTo(chatId, msg("gp_failure", chatId));
            doRefund(w.orderId, "выкуп не удался: " + reason);
        } else {
            sendTo(chatId, msg("failed", chatId));
            notify("AutoRobux: заказ #" + w.orderId + " не выдан", reason);
        }
    }
    function finishCrate(chatId, w, username, placeId) {
        var ctx = { orderId: w.orderId, username: username, placeId: placeId, robux: w.robux };
        var res = crateCreate(ctx);
        var p = payloadOf(res.data);
        orders.push({
            kind: "rbxcrate", orderId: w.orderId, chatId: chatId, buyer: w.buyer, username: username, placeId: placeId, robux: w.robux, price: w.price,
            status: res.test ? "Test" : (p.status || (res.ok ? "accepted" : "failed")), reason: res.reason || "", sold: w.sold, created: now(), resend: 0,
        });
        saveOrders();
        if (res.ok) {
            sendTo(chatId, msg("accepted", chatId));
            return notify(res.test ? "AutoRobux: тестовый заказ #" + w.orderId : "AutoRobux: заказ #" + w.orderId + " создан в RBXCrate", username + ", плейс " + placeId + ", " + w.robux + " Robux");
        }
        sendTo(chatId, msg("failed", chatId));
        notify("AutoRobux: RBXCrate не принял заказ #" + w.orderId, res.reason);
        problem("rbxcrate_api_error", w.orderId, w.buyer, w.title, res.reason);
        if (/OUT_OF_STOCK|HTTP 402/.test(res.reason)) {
            if (S.oos === "refund") return doRefund(w.orderId, "в RBXCrate нет Robux");
            if (S.oos === "ask") notify("AutoRobux: в RBXCrate нет Robux", "Заказ #" + w.orderId + " ждёт вашего решения, возврат не сделан.");
        }
        if (S.refundOnError) doRefund(w.orderId, res.reason);
    }

    fpt.on("onNewMessage", function (raw) {
        var m = msgInfo(raw);
        if (m.mine || m.system || !m.chatId || S.mode === "pause") return;
        var text = m.text.trim(), low = text.toLowerCase();
        if (!text) return;
        var w = waiting[m.chatId], last = null;

        if (["!eng", "!en", "!english"].indexOf(low) >= 0) { langs[m.chatId] = "en"; save("langs", langs); return sendTo(m.chatId, "✅ Language switched to English."); }
        if (["!ru", "!rus", "!рус"].indexOf(low) >= 0) { langs[m.chatId] = "ru"; save("langs", langs); return sendTo(m.chatId, "✅ Язык переключён на русский."); }
        if (["!guide", "!гайд", "!help", "!помощь"].indexOf(low) >= 0) {
            if (w || lastOrder(m.chatId)) sendTo(m.chatId, msg("guide", m.chatId));
            return;
        }
        if (["!status", "!статус"].indexOf(low) >= 0) {
            last = lastOrder(m.chatId);
            if (last) sendTo(m.chatId, msg("status", m.chatId, { order_id: last.orderId, status: last.status }));
            return;
        }
        if (["!resend", "!перепроверить", "!повтор"].indexOf(low) >= 0) {
            last = lastOrder(m.chatId);
            if (!last || last.kind !== "rbxcrate" || !last.placeId) return;
            if (int(last.resend, 0) >= int(S.maxResend, 3)) return sendTo(m.chatId, "❌ Лимит повторных проверок исчерпан. Напишите продавцу.");
            var rs = crate(API.resend, { orderId: String(last.orderId), placeId: int(last.placeId, 0) });
            last.resend = int(last.resend, 0) + 1;
            if (rs.ok && last.status === "Error") last.status = "Pending";
            saveOrders();
            sendTo(m.chatId, rs.ok ? "🔁 Отправил заказ на повторную проверку." : "❌ Не удалось отправить повторную проверку. Продавец уведомлён.");
            if (!rs.ok) notify("AutoRobux: повторная проверка #" + last.orderId + " не прошла", rs.reason);
            return;
        }
        if (!w) return;
        m = fullMsg(m);
        if (m.mine || m.system) return;
        text = m.text.trim();
        low = text.toLowerCase();

        if (w.mode === "gamepass") {
            var gid = extractGamepass(text);
            if (!gid) return;
            var info = gamepassInfo(gid);
            if (!info || info.price === null) return sendTo(m.chatId, "⚠️ Не удалось проверить GamePass. Убедитесь, что ID/ссылка корректны, и пришлите снова.");
            if (info.price !== w.price) {
                w.attempts = int(w.attempts, 0) + 1;
                if (w.attempts >= int(S.gpAttempts, 5)) {
                    delete waiting[m.chatId];
                    save("waiting", waiting);
                    if (S.gpRefund) {
                        sendTo(m.chatId, msg("gp_failure", m.chatId));
                        doRefund(w.orderId, "неверная цена GamePass, попыток: " + w.attempts);
                    } else {
                        sendTo(m.chatId, msg("failed", m.chatId));
                        notify("AutoRobux: заказ #" + w.orderId, "Покупатель " + w.attempts + " раз прислал GamePass с неверной ценой.");
                    }
                    return;
                }
                save("waiting", waiting);
                return sendTo(m.chatId, msg("gp_wrong_price", m.chatId, { actual: info.price, expected: w.price }));
            }
            delete waiting[m.chatId];
            save("waiting", waiting);
            return finishGamepass(m.chatId, w, info, gid);
        }

        if (/за сколько|сколько став|какая цена|цена пас|price|how much/.test(low)) return sendTo(m.chatId, "Создайте GamePass на ровно " + w.price + " Robux.");
        var username = extractUser(text) || w.username || "", placeId = extractPlace(text);
        if (username && !placeId) {
            w.username = username;
            save("waiting", waiting);
            return sendTo(m.chatId, "✅ Username принят. Теперь пришлите placeId или ссылку на плейс.");
        }
        if (!username || !placeId) return sendTo(m.chatId, msg("bad_username", m.chatId));
        if (S.precheck) {
            var u = postJson("https://users.roblox.com/v1/usernames/users", { usernames: [username], excludeBannedUsers: false });
            if (u.code === 200 && u.json && !(u.json.data || []).length) return sendTo(m.chatId, msg("roblox_user_not_found", m.chatId));
            var pl = http("GET", "https://apis.roblox.com/universes/v1/places/" + placeId + "/universe", null, {});
            if (pl.code === 404) return sendTo(m.chatId, "❗ Плейс не найден. Проверьте placeId/ссылку на плейс.");
        }
        delete waiting[m.chatId];
        save("waiting", waiting);
        finishCrate(m.chatId, w, username, placeId);
    });

    // --- фон: напоминания, истёкшее ожидание, статусы RBXCrate, остатки
    var lastPoll = 0, busy = false, lowBalanceSaid = false, lowStockSaid = false, lotsState = null;
    var ERR_KEYS = { gamepass_not_found: "gamepass_not_found", GAMEPASS_NOT_FOUND: "gamepass_not_found", GAMEPASS_SELLER_MISMATCH: "seller_mismatch", gamepass_seller_mismatch: "seller_mismatch", REGIONAL_PRICING_NOT_SUPPORTED: "regional_pricing", ROBLOX_USER_NOT_FOUND: "roblox_user_not_found" };
    function pollCrate() {
        var changed = false, t = now();
        orders.forEach(function (o) {
            if (o.kind !== "rbxcrate") return;
            if (["accepted", "Pending", "Queued", "Queued_Deferred"].indexOf(String(o.status)) >= 0) {
                var info = crate(API.info, { orderId: String(o.orderId) });
                if (!info.ok) return;
                var p = payloadOf(info.data);
                var st = p.status || (p.order || {}).status;
                if (!st || st === o.status) return;
                o.status = st;
                o.updated = t;
                changed = true;
                if (st === "Completed" && !o.saidDone) {
                    o.saidDone = true;
                    sendTo(o.chatId, msg("completed", o.chatId));
                    notify("AutoRobux: заказ #" + o.orderId + " выполнен", o.username + ", " + o.robux + " Robux");
                }
                if (st === "Error") {
                    var err = p.error || {};
                    var reason = err.reason || p.reason || "unknown_error";
                    o.reason = reason + (err.message || p.message ? ": " + (err.message || p.message) : "");
                    o.errorAt = t;
                    notify("AutoRobux: RBXCrate не выдал заказ #" + o.orderId, o.reason);
                    if (!o.saidError) {
                        o.saidError = true;
                        sendTo(o.chatId, msg(ERR_KEYS[reason] || "provider_error", o.chatId, { username: o.username }));
                    }
                    var lim = int(S.blacklistAfterErrors, 0);
                    if (lim > 0) {
                        var n = orders.filter(function (x) { return x.chatId === o.chatId && x.status === "Error"; }).length;
                        if (n >= lim && !blacklisted(o.buyer, o.chatId)) {
                            S.blacklist.push({ name: o.buyer, chatId: o.chatId, reason: n + " ошибок RBXCrate", ts: t });
                            saveS();
                        }
                    }
                }
            }
            var after = int(S.cancelErrorMin, 0);
            if (o.status === "Error" && after > 0 && o.errorAt && t - o.errorAt >= after * 60 && !o.cancelTried) {
                o.cancelTried = true;
                changed = true;
                var c = crate(API.cancel, { orderId: String(o.orderId) });
                notify("AutoRobux: отмена заказа #" + o.orderId + " в RBXCrate", c.ok ? "отменён" : c.reason);
            }
        });
        if (changed) saveOrders();
        if (!String(S.token || "").trim() || S.test) return;
        if (num(S.lowBalance) > 0) {
            var b = crate(API.balance);
            var bal = b.ok ? b.data.balance : null;
            if (typeof bal === "number") {
                if (bal < num(S.lowBalance) && !lowBalanceSaid) notify("AutoRobux: мало денег в RBXCrate", "Баланс " + bal + " USD");
                lowBalanceSaid = bal < num(S.lowBalance);
            }
        }
        if (int(S.lowStock, 0) > 0 || S.manageLots) {
            var s = crate(API.stock);
            var stock = s.ok ? s.data.robuxAvailable : null;
            if (typeof stock === "number") {
                if (int(S.lowStock, 0) > 0) {
                    if (stock < int(S.lowStock, 0) && !lowStockSaid) notify("AutoRobux: мало Robux в RBXCrate", "Осталось " + stock);
                    lowStockSaid = stock < int(S.lowStock, 0);
                }
                if (S.manageLots && lotsState !== (stock > 0)) {
                    lotsState = stock > 0;
                    S.maps.forEach(function (mp) {
                        var id = String(mp.lotId || "").trim() || (/^\d+$/.test(String(mp.match).trim()) ? String(mp.match).trim() : "");
                        if (id && lotActive(id, lotsState)) log("лот " + id + (lotsState ? " включён" : " выключен") + ": в RBXCrate " + stock + " Robux");
                    });
                }
            }
        }
    }
    setInterval(function () {
        if (busy) return;
        busy = true;
        try {
            var t = now(), dirty = false;
            for (var chat in waiting) {
                var w = waiting[chat];
                if (w.mode !== "gamepass" && num(S.reminderMin) > 0 && !w.reminded && t - w.ts >= num(S.reminderMin) * 60) {
                    w.reminded = true;
                    dirty = true;
                    sendTo(chat, msg("reminder", chat));
                }
                if (t - w.ts >= clamp(num(S.waitHours) || 24, 1, 168) * 3600) {
                    delete waiting[chat];
                    dirty = true;
                    if (w.mode === "gamepass") {
                        sendTo(chat, S.gpRefund ? "⌛ Время на отправку GamePass истекло. Средства возвращены." : msg("timeout", chat));
                        if (S.gpRefund) doRefund(w.orderId, "покупатель не прислал GamePass вовремя");
                    } else {
                        sendTo(chat, msg("timeout", chat));
                    }
                    notify("AutoRobux: заказ #" + w.orderId, "Покупатель не прислал данные вовремя.");
                }
            }
            if (dirty) save("waiting", waiting);
            if (S.mode === "rbxcrate" && t - lastPoll >= clamp(int(S.pollSec, 60), 30, 3600)) { lastPoll = t; pollCrate(); }
        } catch (e) {
            log("ошибка фоновой проверки: " + e);
        } finally {
            busy = false;
        }
    }, 20000);

    // --- настройки
    var view = "main", msgKey = 0, msgLang = "ru";
    var MODES = { gamepass: "Выкуп GamePass со своих аккаунтов", rbxcrate: "Сервис RBXCrate", pause: "Пауза" };
    var OOS = { wait: "ждать", refund: "вернуть деньги", ask: "спросить меня" };
    function statusName(s) {
        return { Completed: "выполнен", Error: "ошибка", accepted: "принят", Pending: "в обработке", Queued: "в очереди", Queued_Deferred: "в очереди", Test: "тест", failed: "не создан", Cancelled: "отменён" }[s] || s;
    }
    function render() {
        var kids = [H("AutoRobux")].concat(tabs([["main", "Главная"], ["maps", "Лоты"], ["crate", "RBXCrate"], ["gp", "Выкуп"], ["msgs", "Сообщения"], ["ord", "Заказы"], ["bl", "Чёрный список"]], view, "window.arxView"));
        if (view === "main") {
            kids.push(T("Сейчас заказы выдаёт: " + MODES[S.mode], { bold: true }));
            kids.push(Row(Btn("Выкуп GamePass", "window.arxMode('gamepass')", S.mode !== "gamepass"), Btn("RBXCrate", "window.arxMode('rbxcrate')", S.mode !== "rbxcrate"), Btn("Пауза", "window.arxMode('pause')", S.mode !== "pause")));
            if (!DESKTOP) kids.push(T("Выкуп GamePass работает только в FunPay Tools для компьютера. На телефоне используйте RBXCrate.", { color: "#D98A00" }));
            var todo = [];
            if (!S.maps.length && !S.autoBase) todo.push("привяжите лот во вкладке \"Лоты\"");
            if (S.mode === "rbxcrate" && !String(S.token).trim()) todo.push("впишите ключ во вкладке \"RBXCrate\"");
            if (S.mode === "rbxcrate" && S.test) todo.push("выключите тестовый режим, когда проверите настройки");
            if (S.mode === "gamepass" && !S.accounts.length) todo.push("добавьте аккаунт Roblox во вкладке \"Выкуп\"");
            kids.push(todo.length ? T("Чтобы заработало: " + todo.join("; ") + ".", { color: "#D98A00" }) : T("Всё готово к работе.", { color: "#2E9E5B" }));
            kids.push(Card(
                T("Как это работает", { bold: true }),
                T("Выкуп GamePass: покупатель создаёт GamePass на нужную цену и присылает ссылку, плагин проверяет цену и покупает его с вашего аккаунта Roblox."),
                T("RBXCrate: покупатель присылает ник и ссылку на плейс, плагин создаёт заказ в сервисе, а тот сам находит и выкупает GamePass."),
                T("Цена GamePass считается с учётом комиссии Roblox 30%: чтобы покупатель получил 700 Robux, пасс должен стоить 1000.")
            ));
            kids.push(Card(
                In("Сколько часов ждать данные от покупателя", "g_wait", S.waitHours),
                In("Напомнить через, минут (0: не напоминать)", "g_rem", S.reminderMin),
                In("Меньше скольки Robux не выдавать", "g_min", S.minRobux),
                In("Больше скольки Robux не выдавать", "g_max", S.maxRobux),
                Btn("Язык сообщений по умолчанию: " + (S.lang === "en" ? "английский" : "русский"), "window.arxLang()", true),
                Btn("Сохранить", "window.arxMainSave()")
            ));
            kids.push(hint("Ждут данные: " + Object.keys(waiting).length + ". Команды покупателя: !guide, !status, !resend, !en, !ru."));
        } else if (view === "maps") {
            kids.push(hint("Сколько Robux выдать: \"за 1 шт.\" умножается на количество в заказе, \"сверху\" добавляется один раз."));
            S.maps.forEach(function (m, i) {
                kids.push(Card(
                    T(m.match + (m.lotId ? " · лот " + m.lotId : ""), { bold: true }),
                    T(m.per + " Robux за 1 шт." + (int(m.extra, 0) ? " + " + m.extra + " сверху" : "") + " · GamePass на 1 шт.: " + gamepassPrice(expectedRobux(m, 1)) + " Robux"),
                    Btn("Удалить", "window.arxMapDel(" + i + ")", true)
                ));
            });
            kids.push(Card(
                T("Новая привязка", { bold: true }),
                In("Название лота как на FunPay или его часть", "n_match", gs("n_match")),
                In("ID лота (не обязательно)", "n_lot", gs("n_lot")),
                In("Robux за 1 шт.", "n_per", gs("n_per")),
                In("Robux сверху (можно 0)", "n_extra", gs("n_extra") || "0"),
                Btn("Добавить привязку", "window.arxMapAdd()")
            ));
            kids.push(Card(
                Sw("Брать количество Robux из названия лота, если привязки нет", "a_on", S.autoBase, ""),
                In("Слова, по которым узнаём такие лоты, через запятую", "a_keys", S.baseKeys.join(", ")),
                Btn("Сохранить", "window.arxAutoSave()", true)
            ));
            kids.push(Card(
                T("Проверка", { bold: true }),
                In("Название лота", "c_title", gs("c_title")),
                In("Количество в заказе", "c_amount", gs("c_amount") || "1"),
                Btn("Посчитать", "window.arxCalc()", true)
            ));
        } else if (view === "crate") {
            kids.push(Card(
                In("Ключ API RBXCrate", "r_token", S.token),
                In("Адрес сервиса", "r_base", S.base),
                Btn("Как передавать ключ: " + S.auth, "window.arxAuth()", true),
                Sw("Тестовый режим: заказ в RBXCrate не отправляется", "r_test", S.test, ""),
                Sw("Предзаказ, если Robux сейчас нет (isPreOrder)", "r_pre", S.preOrder, ""),
                Sw("Проверять, что GamePass принадлежит покупателю", "r_own", S.ownership, ""),
                Sw("Проверять ник и плейс в Roblox до отправки", "r_chk", S.precheck, ""),
                Sw("Вернуть деньги, если RBXCrate не принял заказ", "r_ref", S.refundOnError, ""),
                Sw("Выключать лоты, когда в RBXCrate нет Robux", "r_lots", S.manageLots, ""),
                Btn("Если Robux нет в наличии: " + OOS[S.oos], "window.arxOos()", true),
                In("Как часто проверять статусы, секунд", "r_poll", S.pollSec),
                In("Сколько раз покупатель может написать !resend", "r_resend", S.maxResend),
                In("Отменять заказ с ошибкой через, минут (0: не отменять)", "r_cancel", S.cancelErrorMin),
                In("В чёрный список после скольки ошибок (0: никогда)", "r_bl", S.blacklistAfterErrors),
                In("Предупредить, если баланс ниже, USD (0: не следить)", "r_lowbal", S.lowBalance),
                In("Предупредить, если Robux меньше (0: не следить)", "r_lowstock", S.lowStock),
                Row(Btn("Сохранить", "window.arxCrateSave()"), Btn("Баланс и остаток", "window.arxCrateCheck()", true, "Проверяю..."))
            ));
        } else if (view === "gp") {
            if (!DESKTOP) kids.push(T("На телефоне выкуп не работает: приложение не даёт плагину отправить cookie Roblox и не отдаёт заголовки ответа. Выкупом заказы выдаёт FunPay Tools для компьютера.", { color: "#D98A00" }));
            kids.push(hint("Cookie .ROBLOSECURITY хранится только на этом устройстве и отправляется только на roblox.com."));
            S.accounts.forEach(function (a, i) {
                kids.push(Card(
                    T(a.label || ("Аккаунт " + (i + 1)), { bold: true }),
                    T("Cookie: " + String(a.cookie).slice(0, 6) + "..." + String(a.cookie).slice(-4)),
                    Row(Btn("Проверить и баланс", "window.arxAccCheck(" + i + ")", true, "Проверяю..."), Btn("Удалить", "window.arxAccDel(" + i + ")", true))
                ));
            });
            kids.push(Card(
                T("Новый аккаунт Roblox", { bold: true }),
                In("Название для себя", "k_label", gs("k_label")),
                In("Cookie .ROBLOSECURITY", "k_cookie", gs("k_cookie")),
                Btn("Добавить", "window.arxAccAdd()", false, "Проверяю...")
            ));
            kids.push(Card(
                Sw("Вернуть деньги, если выкупить не получилось", "k_ref", S.gpRefund, ""),
                In("Сколько раз покупатель может прислать GamePass с неверной ценой", "k_att", S.gpAttempts),
                Btn("Сохранить", "window.arxGpSave()", true)
            ));
        } else if (view === "msgs") {
            var key = MSG_KEYS[msgKey];
            var cur = msgLang === "en" ? (S.en[key] || MSG_EN[key] || "") : (S.ru[key] || MSG_RU[key]);
            kids.push(Row(Btn("Сообщение: " + MSG_LABELS[key] + " (следующее)", "window.arxMsgNext()", true), Btn("Язык: " + (msgLang === "en" ? "английский" : "русский"), "window.arxMsgLang()", true)));
            kids.push(Card(
                In("Текст", "t_text", cur, true),
                Row(Btn("Сохранить", "window.arxMsgSave()"), Btn("Вернуть стандартный", "window.arxMsgReset()", true))
            ));
            kids.push(hint("Переменные: {robux}, {gamepass_price}, {order_id}, {status}, {username}, {expected_price}, {actual}, {expected}. " + NL_HINT));
        } else if (view === "ord") {
            var done = orders.filter(function (o) { return o.status === "Completed"; });
            var sum = 0, rb = 0;
            done.forEach(function (o) { sum += num(o.sold); rb += int(o.robux, 0); });
            kids.push(T("Выдано заказов: " + done.length + " · " + rb + " Robux · на " + sum.toFixed(2), { bold: true }));
            orders.slice(-12).reverse().forEach(function (o) {
                var i = orders.indexOf(o);
                var card = [T("#" + o.orderId + " · " + (o.buyer || "") + " · " + o.robux + " Robux · " + statusName(o.status), { bold: true })];
                if (o.username) card.push(T(o.username + ", плейс " + o.placeId));
                if (o.reason) card.push(hint(o.reason));
                var btns = [];
                if (o.kind === "rbxcrate" && o.status !== "Test") {
                    btns.push(Btn("Статус", "window.arxOrd('info'," + i + ")", true, "..."));
                    if (o.status !== "Completed") { btns.push(Btn("Повторить", "window.arxOrd('resend'," + i + ")", true, "...")); btns.push(Btn("Отменить", "window.arxOrd('cancel'," + i + ")", true, "...")); }
                }
                if (o.status !== "Completed") btns.push(Btn("Вернуть деньги", "window.arxOrd('refund'," + i + ")", true, "..."));
                if (btns.length) card.push({ type: "Row", children: btns.slice(0, 2) });
                if (btns.length > 2) card.push({ type: "Row", children: btns.slice(2) });
                kids.push({ type: "Card", children: card });
            });
            if (!orders.length) kids.push(hint("Заказов пока не было."));
            if (problems.length) {
                kids.push(T("Что пошло не так", { bold: true }));
                problems.slice(-6).reverse().forEach(function (p) { kids.push(hint(when(p.ts) + " · #" + p.orderId + " · " + p.detail + (p.lot ? " · " + p.lot : ""))); });
                kids.push(Btn("Очистить список", "window.arxProblemsClear()", true));
            }
        } else {
            kids.push(Sw("Не выдавать заказы покупателям из списка", "b_on", S.blacklistOn, "window.arxBlToggle()"));
            S.blacklist.forEach(function (b, i) {
                kids.push(Row(T((b.name || b.chatId) + (b.reason ? " · " + b.reason : "")), Btn("Убрать", "window.arxBlDel(" + i + ")", true)));
            });
            if (!S.blacklist.length) kids.push(hint("Список пуст."));
            kids.push(Card(In("Ник покупателя на FunPay", "b_name", gs("b_name")), Btn("Добавить", "window.arxBlAdd()", true)));
        }
        kids.push(hint("Автор оригинального плагина: @drakelovc"));
        show(kids);
    }
    window.arxView = function (v) { view = v; render(); };
    window.arxMode = function (mode) {
        if (mode === "gamepass" && !DESKTOP) return toast("Выкуп GamePass работает только на компьютере");
        S.mode = mode;
        saveS();
        for (var chat in waiting) if (waiting[chat].mode !== mode) delete waiting[chat];
        save("waiting", waiting);
        render();
    };
    window.arxLang = function () { S.lang = S.lang === "en" ? "ru" : "en"; saveS(); render(); };
    window.arxMainSave = function () {
        S.waitHours = clamp(int(gs("g_wait"), 24), 1, 168);
        S.reminderMin = Math.max(0, int(gs("g_rem"), 10));
        S.minRobux = Math.max(1, int(gs("g_min"), 1));
        S.maxRobux = Math.max(S.minRobux, int(gs("g_max"), 100000));
        saveS();
        toast("Сохранено");
        render();
    };
    window.arxMapAdd = function () {
        var match = gs("n_match").trim(), lot = gs("n_lot").trim(), per = int(gs("n_per"), -1), extra = Math.max(0, int(gs("n_extra"), 0));
        if (!match && !lot) return toast("Укажите название лота или его ID");
        if (per < 0 || (per === 0 && extra === 0)) return toast("Укажите, сколько Robux выдавать");
        var max = 0;
        S.maps.forEach(function (m) { max = Math.max(max, int(String(m.id).slice(1), 0)); });
        S.maps.push({ id: "m" + (max + 1), match: match || lot, lotId: /^\d+$/.test(lot) ? lot : "", per: per, extra: extra });
        saveS();
        ["n_match", "n_lot", "n_per"].forEach(function (k) { fpt.ui.setState(k, ""); });
        toast("Привязка добавлена");
        render();
    };
    window.arxMapDel = function (i) { S.maps.splice(i, 1); saveS(); render(); };
    window.arxAutoSave = function () {
        S.autoBase = on("a_on");
        S.baseKeys = gs("a_keys").split(",").map(function (k) { return k.trim(); }).filter(Boolean);
        saveS();
        toast("Сохранено");
    };
    window.arxCalc = function () {
        var m = matchMap(gs("c_title"), "");
        if (!m) return toast("Привязка для такого названия не найдена");
        var robux = expectedRobux(m, Math.max(1, int(gs("c_amount"), 1)));
        toast("Привязка \"" + m.match + "\": выдать " + robux + " Robux, GamePass на " + gamepassPrice(robux));
    };
    window.arxAuth = function () { var a = ["api-key", "bearer", "x-api-key"]; S.auth = a[(a.indexOf(S.auth) + 1) % a.length]; saveS(); render(); };
    window.arxOos = function () { var a = ["wait", "refund", "ask"]; S.oos = a[(a.indexOf(S.oos) + 1) % a.length]; saveS(); render(); };
    window.arxCrateSave = function () {
        var base = gs("r_base").trim().replace(/\/+$/, "");
        if (!/^https:\/\//.test(base)) return toast("Адрес сервиса должен начинаться с https://");
        S.base = base;
        S.token = gs("r_token").trim();
        S.test = on("r_test"); S.preOrder = on("r_pre"); S.ownership = on("r_own"); S.precheck = on("r_chk");
        S.refundOnError = on("r_ref"); S.manageLots = on("r_lots");
        S.pollSec = clamp(int(gs("r_poll"), 60), 30, 3600);
        S.maxResend = Math.max(0, int(gs("r_resend"), 3));
        S.cancelErrorMin = Math.max(0, int(gs("r_cancel"), 0));
        S.blacklistAfterErrors = Math.max(0, int(gs("r_bl"), 0));
        S.lowBalance = Math.max(0, num(gs("r_lowbal")));
        S.lowStock = Math.max(0, int(gs("r_lowstock"), 0));
        saveS();
        toast("Сохранено");
        render();
    };
    window.arxCrateCheck = function () {
        var b = crate(API.balance), s = crate(API.stock);
        toast(b.ok || s.ok ? "Баланс: " + (b.ok ? b.data.balance + " USD" : "не получен") + ", Robux в наличии: " + (s.ok ? s.data.robuxAvailable : "не получено") :
            "RBXCrate не ответил: " + (b.reason || s.reason));
        render();
    };
    window.arxAccAdd = function () {
        var cookie = gs("k_cookie").trim().replace(/^\.ROBLOSECURITY=/, "");
        if (cookie.length < 50) { toast("Вставьте cookie .ROBLOSECURITY целиком"); return render(); }
        var who = DESKTOP ? rbxWho(cookie) : null;
        if (!who && DESKTOP) { toast("Roblox не принял cookie. Проверьте, что она скопирована целиком."); return render(); }
        S.accounts.push({ id: "a" + Date.now(), label: gs("k_label").trim() || (who ? who.name : "Аккаунт " + (S.accounts.length + 1)), cookie: cookie });
        saveS();
        fpt.ui.setState("k_cookie", ""); fpt.ui.setState("k_label", "");
        toast(who ? "Добавлен аккаунт " + who.name : "Аккаунт сохранён");
        render();
    };
    window.arxAccDel = function (i) { S.accounts.splice(i, 1); saveS(); render(); };
    window.arxAccCheck = function (i) {
        var a = S.accounts[i];
        if (!a) return;
        var who = rbxWho(a.cookie);
        toast(who ? who.name + ": " + rbxBalance(a.cookie, who.id) + " Robux" : "Войти не удалось. Cookie устарела или Roblox не отвечает.");
        render();
    };
    window.arxGpSave = function () { S.gpRefund = on("k_ref"); S.gpAttempts = clamp(int(gs("k_att"), 5), 1, 20); saveS(); toast("Сохранено"); };
    window.arxMsgNext = function () { msgKey = (msgKey + 1) % MSG_KEYS.length; render(); };
    window.arxMsgLang = function () { msgLang = msgLang === "en" ? "ru" : "en"; render(); };
    window.arxMsgSave = function () {
        var text = gm("t_text").trim();
        if (!text) return toast("Текст пустой");
        S[msgLang][MSG_KEYS[msgKey]] = text;
        saveS();
        toast("Сохранено");
    };
    window.arxMsgReset = function () { delete S[msgLang][MSG_KEYS[msgKey]]; saveS(); render(); };
    window.arxOrd = function (act, i) {
        var o = orders[i];
        if (!o) return render();
        if (act === "refund") {
            var ok = refundOrder(o.orderId);
            if (ok) { o.status = "Cancelled"; o.reason = "деньги возвращены покупателю"; saveOrders(); }
            toast(ok ? "Деньги возвращены" : "Возврат не прошёл" + lastErr());
            return render();
        }
        var res = act === "info" ? crate(API.info, { orderId: String(o.orderId) }) :
            act === "cancel" ? crate(API.cancel, { orderId: String(o.orderId) }) :
                crate(API.resend, { orderId: String(o.orderId), placeId: int(o.placeId, 0) });
        if (res.ok && act === "info") {
            var p = payloadOf(res.data);
            o.status = p.status || (p.order || {}).status || o.status;
        }
        if (res.ok && act === "cancel") o.status = "Cancelled";
        if (res.ok && act === "resend" && o.status === "Error") o.status = "Pending";
        saveOrders();
        toast(res.ok ? (act === "info" ? "Статус: " + statusName(o.status) : act === "cancel" ? "Заказ отменён в RBXCrate" : "Отправлен на повторную проверку") : res.reason);
        render();
    };
    window.arxProblemsClear = function () { problems = []; save("problems", problems); render(); };
    window.arxBlToggle = function () { S.blacklistOn = on("b_on"); saveS(); };
    window.arxBlAdd = function () {
        var name = gs("b_name").trim();
        if (!name) return toast("Укажите ник");
        if (!blacklisted(name, "")) S.blacklist.push({ name: name, chatId: "", reason: "добавлен вручную", ts: now() });
        saveS();
        fpt.ui.setState("b_name", "");
        render();
    };
    window.arxBlDel = function (i) { S.blacklist.splice(i, 1); saveS(); render(); };

    render();
    log("запущен, режим: " + MODES[S.mode] + ", привязок: " + S.maps.length);
})();
