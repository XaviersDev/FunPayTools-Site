// @name AutoSMM
// @author @xvimp
// @version 1.0.0
// @description Авто-накрутка через SMM-панели: после оплаты просит у покупателя ссылку, создаёт заказ у поставщика, следит за статусом и возвращает деньги при сбое.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/autosmm_banner.png

(function () {
    var TAG = "[AutoSMM]", NS_STORE = "smm_", NS_UI = "smm_";

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
        try { d = fpt.orders.getDetails(String(orderId)); } catch (e) {}
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

    // ---------------------------------------------------------------- AutoSMM
    var SLOTS = ["after_payment", "after_confirmation", "success", "failure"];
    var SLOT_NAMES = {
        after_payment: "После оплаты (просим ссылку)",
        after_confirmation: "Заказ создан у поставщика",
        success: "Заказ выполнен",
        failure: "Заказ не выполнен",
    };
    var DEFAULTS = {
        enabled: true,
        providers: [{ id: "p1", name: "Twiboost", url: "https://twiboost.com/api/v2", key: "" }],
        maps: [],                       // {id, match, provider, service, mult}
        domains: ["t.me", "vk.com", "instagram.com", "tiktok.com", "youtube.com", "youtu.be", "twitch.tv", "twitter.com", "x.com", "vt.tiktok.com", "vm.tiktok.com"],
        confirm: true,                  // переспросить ссылку перед запуском
        refund: true,                   // вернуть деньги, если заказ не создан или не выполнен
        waitHours: 24,                  // сколько ждать ссылку
        pollSec: 300,                   // как часто спрашивать статус у поставщика
        autoLots: false,                // включать обратно привязанные лоты
        autoLotsMin: 30,
        extraLots: [],
        notifyNew: false,
        messages: {
            after_payment: [
                "❤️ Спасибо за оплату! Пришлите корректную ссылку (https://...).",
                "✅ Заказ оплачен. Пришлите ссылку на цель накрутки (https://...).",
            ],
            after_confirmation: [
                "✅ Заказ создан. ID у поставщика: {provider_order_id}\n🔗 Отслеживание: !прогресс",
                "🚀 Заказ запущен в работу. ID: {provider_order_id}\nКоманда отслеживания: !прогресс",
            ],
            success: [
                "🎉 Заказ выполнен! ID: {provider_order_id}\nПожалуйста, подтвердите заказ на FunPay.",
                "✅ Готово! ID: {provider_order_id}. Подтвердите заказ на FunPay.",
            ],
            failure: [
                "❌ Заказ не выполнен. Средства возвращены.",
                "❌ К сожалению, заказ не был выполнен. Деньги вернулись на ваш баланс FunPay.",
            ],
        },
    };
    var S = load("settings", null) || {};
    (function () {
        for (var k in DEFAULTS) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
        if (!S.messages || typeof S.messages !== "object") S.messages = {};
        SLOTS.forEach(function (s) {
            if (!Array.isArray(S.messages[s]) || !S.messages[s].length) S.messages[s] = DEFAULTS.messages[s].slice();
        });
    })();
    var waiting = load("waiting", {});   // чат → заказ, который ждёт ссылку
    var active = load("active", {});     // чат → заказ в работе у поставщика
    var orders = load("orders", []);     // журнал заказов

    function saveS() { save("settings", S); }
    function pick(list) { return list[Math.floor(Math.random() * list.length)] || ""; }
    function provider(id) { for (var i = 0; i < S.providers.length; i++) if (S.providers[i].id === id) return S.providers[i]; return null; }
    function newId(prefix, list) {
        var max = 0;
        list.forEach(function (x) { var n = int(String(x.id || "").slice(prefix.length), 0); if (n > max) max = n; });
        return prefix + (max + 1);
    }

    // --- панель поставщика (общий для SMM-панелей формат: key, action, ...)
    function smm(p, data) {
        var body = { key: p.key };
        for (var k in data) body[k] = data[k];
        for (var attempt = 0; attempt < 3; attempt++) {
            var r = http("POST", p.url, form(body), { "Content-Type": "application/x-www-form-urlencoded" });
            if (r.code === 429) return { rate: true };
            if (r.code >= 200 && r.code < 300 && r.json !== null) return { data: r.json };
            // запрос на создание не повторяем: поставщик мог его принять и списать деньги
            if (data.action === "add") return { error: r.code ? "поставщик ответил " + r.code : "нет связи с поставщиком" };
        }
        return { error: "поставщик не ответил" };
    }
    function validLink(text) {
        var rx = /https?:\/\/[^\s<>"']+/ig, m;
        var allowed = S.domains.map(function (d) { return String(d).toLowerCase().replace(/^\./, ""); }).filter(Boolean);
        while ((m = rx.exec(text || ""))) {
            var url = m[0].replace(/[.,);\]]+$/, "");
            var host = (/^https?:\/\/([^\/?#:]+)/i.exec(url) || [])[1];
            if (!host) continue;
            host = host.toLowerCase();
            for (var i = 0; i < allowed.length; i++) {
                if (host === allowed[i] || host.slice(-allowed[i].length - 1) === "." + allowed[i]) return url;
            }
        }
        return null;
    }
    function classify(status, remains) {
        var s = String(status || "").trim().toLowerCase();
        if (["completed", "done", "success", "partial"].indexOf(s) >= 0) return "success";
        if (remains !== null && remains !== undefined && remains !== "" && int(remains, -1) === 0) return "success";
        if (["failed", "error", "canceled", "cancelled"].indexOf(s) >= 0) return "failure";
        return "in_progress";
    }
    function matchMap(lotId, title) {
        var desc = String(title || "").toLowerCase();
        for (var i = 0; i < S.maps.length; i++) {
            var match = String(S.maps[i].match || "").trim();
            if (!match) continue;
            if ((lotId && match === String(lotId)) || desc.indexOf(match.toLowerCase()) >= 0) return S.maps[i];
        }
        return null;
    }

    function doRefund(orderId, reason) {
        if (!S.refund) return notify("AutoSMM: нужен возврат вручную", "Заказ #" + orderId + ". Причина: " + reason);
        if (refundOrder(orderId)) notify("AutoSMM: возврат по заказу #" + orderId, reason);
        else notify("AutoSMM: возврат не прошёл", "Заказ #" + orderId + lastErr() + ". Верните вручную. Причина: " + reason);
    }

    function place(chatId, w, link) {
        var p = provider(w.map.provider);
        if (!p || !p.key) {
            sendTo(chatId, "❌ Поставщик не настроен. Свяжитесь с продавцом.");
            return doRefund(w.orderId, "поставщик не найден или у него нет ключа");
        }
        var qty = Math.max(1, Math.round(w.units * (num(w.map.mult) || 1)));
        var res = smm(p, { action: "add", service: int(w.map.service, 0), link: link, quantity: qty });
        if (res.rate) {
            waiting[chatId] = w;       // ссылка уже есть, попробуем ещё раз позже
            w.link = link;
            w.retryAt = now() + 120;
            save("waiting", waiting);
            return sendTo(chatId, "⏳ Сервис временно перегружен, попробуем чуть позже.");
        }
        if (res.error) {
            sendTo(chatId, "❌ Ошибка при создании заказа. Средства будут возвращены.");
            return doRefund(w.orderId, "ошибка создания заказа: " + res.error);
        }
        var poid = res.data && res.data.order;
        if (!poid) {
            sendTo(chatId, "❌ Поставщик отклонил заказ. Средства будут возвращены.");
            return doRefund(w.orderId, "поставщик: " + (res.data && res.data.error ? res.data.error : JSON.stringify(res.data).slice(0, 200)));
        }
        orders.push({
            orderId: w.orderId, chatId: chatId, buyer: w.buyer, provider: p.id, poid: poid, link: link, qty: qty,
            sold: w.price, cost: 0, status: "in_progress", created: now(), finished: 0,
        });
        if (orders.length > 1000) orders = orders.slice(orders.length - 1000);
        save("orders", orders);
        active[chatId] = { orderId: w.orderId, poid: poid, provider: p.id, created: now() };
        save("active", active);
        sendTo(chatId, fill(pick(S.messages.after_confirmation), { provider_order_id: poid }));
        log("заказ #" + w.orderId + " отправлен поставщику " + p.name + ", ID " + poid + ", количество " + qty);
    }

    onOrder(function (e) {
        if (!S.enabled || !e || e.iAmBuyer || !e.orderId) return;
        var o = orderInfo(e.orderId, e.text);
        if (o && o.iAmBuyer) return;
        var title = (o && o.title) || String(e.text || ""), lotId = o ? o.lotId : "";
        var m = matchMap(lotId, title);
        if (!m) return;
        if (seenOrder(e.orderId)) return;
        var chatId = String(e.chatId || (o && o.chatId) || "");
        var buyer = e.buyerName || (o && o.buyerName) || "";
        if (S.notifyNew) notify("AutoSMM: новый заказ #" + e.orderId, buyer + " · " + (o ? o.price : 0) + " · кол-во " + (o ? o.amount : 1) + " · " + (title || m.match));
        if (active[chatId]) {
            return sendTo(chatId, "⚠️ У вас уже есть активный заказ в обработке.\nДождитесь его завершения. Проверить прогресс: !прогресс");
        }
        waiting[chatId] = { orderId: String(e.orderId), buyer: buyer, map: m, units: o ? o.amount : 1, price: o ? o.price : 0, confirm: false, link: "", ts: now() };
        save("waiting", waiting);
        sendTo(chatId, pick(S.messages.after_payment));
    });

    function findOrder(poid) {
        for (var i = orders.length - 1; i >= 0; i--) if (String(orders[i].poid) === String(poid)) return orders[i];
        return null;
    }
    fpt.on("onNewMessage", function (raw) {
        var m = msgInfo(raw);
        if (m.mine || m.system || !m.chatId) return;
        var text = m.text.trim(), low = text.toLowerCase();
        if (!text) return;

        if (low === "!прогресс") {
            var a = active[m.chatId];
            if (!a) return sendTo(m.chatId, "ℹ️ У вас нет активных заказов.");
            var p = provider(a.provider);
            if (!p) return sendTo(m.chatId, "📊 Заказ #" + a.orderId + " в обработке (ID: " + a.poid + ").");
            var st = smm(p, { action: "status", order: a.poid });
            if (!st.data) return sendTo(m.chatId, "❌ Не удалось получить статус, попробуйте позже.");
            return sendTo(m.chatId, "📊 Прогресс заказа #" + a.orderId + "\n🔢 ID у поставщика: " + a.poid + "\n📈 Статус: " + (st.data.status || "?") +
                "\n📉 Осталось: " + (st.data.remains === undefined ? "?" : st.data.remains));
        }
        var chk = /^чек\s+(\S+)$/.exec(low);
        if (chk) {
            var rec = findOrder(chk[1]);
            if (!rec || rec.chatId !== m.chatId) return sendTo(m.chatId, "❌ Заказ не найден.");
            var pc = provider(rec.provider);
            var sc = pc ? smm(pc, { action: "status", order: rec.poid }) : {};
            if (!sc.data) return sendTo(m.chatId, "❌ Ошибка при проверке.");
            return sendTo(m.chatId, "Статус заказа " + rec.poid + ": " + (sc.data.status || "?") + " (осталось: " + (sc.data.remains === undefined ? "?" : sc.data.remains) + ")");
        }
        var rf = /^рефилл\s+(\S+)$/.exec(low);
        if (rf) {
            var rr = findOrder(rf[1]);
            if (!rr || rr.chatId !== m.chatId) return sendTo(m.chatId, "❌ Заказ не найден.");
            var pr = provider(rr.provider);
            var sr = pr ? smm(pr, { action: "refill", order: rr.poid }) : {};
            if (!sr.data) return sendTo(m.chatId, "❌ Ошибка при запросе рефилла.");
            return sendTo(m.chatId, sr.data.refill || sr.data.status ? "🔄 Запрос на рефилл отправлен." : "⚠️ Рефилл недоступен для этого заказа.");
        }

        var w = waiting[m.chatId];
        if (!w || !S.enabled) return;
        m = fullMsg(m);
        if (m.mine || m.system) return;
        text = m.text.trim();
        low = text.toLowerCase();
        if (w.confirm) {
            if (["+", "да", "yes", "ок", "ok"].indexOf(low) >= 0) {
                delete waiting[m.chatId];
                save("waiting", waiting);
                return place(m.chatId, w, w.link);
            }
            if (["-", "нет", "no", "отмена", "cancel"].indexOf(low) >= 0) {
                delete waiting[m.chatId];
                save("waiting", waiting);
                sendTo(m.chatId, "🚫 Отменено. Средства будут возвращены.");
                return doRefund(w.orderId, "покупатель отменил");
            }
        }
        var link = validLink(text);
        if (!link) return sendTo(m.chatId, "❗ Не вижу корректной ссылки. Пришлите ссылку на разрешённый сайт (https://...).");
        if (S.confirm) {
            w.confirm = true;
            w.link = link;
            save("waiting", waiting);
            return sendTo(m.chatId, "🔗 Запускаем накрутку на:\n" + link + "\nВсё верно? Ответьте \"+\" или \"-\".");
        }
        delete waiting[m.chatId];
        save("waiting", waiting);
        place(m.chatId, w, link);
    });

    // --- фон: статусы, просроченные ссылки, включение лотов
    var lastPoll = now(), lastLots = 0, backoff = 0, pollBusy = false;
    function pollStatuses() {
        var changed = false;
        for (var i = 0; i < orders.length; i++) {
            var o = orders[i];
            if (o.status !== "in_progress") continue;
            var p = provider(o.provider);
            if (!p) continue;
            var res = smm(p, { action: "status", order: o.poid });
            if (res.rate) {
                backoff = Math.min(3600, backoff ? backoff * 2 : 60);
                lastPoll = now() + backoff;
                log("поставщик просит не частить, пауза " + backoff + " сек.");
                break;
            }
            backoff = 0;
            if (!res.data) continue;
            var verdict = classify(res.data.status, res.data.remains);
            if (verdict === "in_progress") continue;
            o.status = verdict;
            o.finished = now();
            if (res.data.charge !== undefined && res.data.charge !== null && res.data.charge !== "") o.cost = num(res.data.charge);
            changed = true;
            if (active[o.chatId] && String(active[o.chatId].poid) === String(o.poid)) { delete active[o.chatId]; save("active", active); }
            if (verdict === "success") {
                sendTo(o.chatId, fill(pick(S.messages.success), { provider_order_id: o.poid }));
            } else {
                sendTo(o.chatId, pick(S.messages.failure));
                doRefund(o.orderId, "статус поставщика: " + res.data.status);
            }
        }
        if (changed) save("orders", orders);
    }
    function lotIds() {
        var ids = [];
        S.maps.forEach(function (m) { var v = String(m.match || "").trim(); if (/^\d+$/.test(v) && ids.indexOf(v) < 0) ids.push(v); });
        (S.extraLots || []).forEach(function (v) { v = String(v).trim(); if (/^\d+$/.test(v) && ids.indexOf(v) < 0) ids.push(v); });
        return ids;
    }
    setInterval(function () {
        if (pollBusy || !S.enabled) return;
        pollBusy = true;
        try {
            var t = now(), dirty = false;
            for (var chat in waiting) {
                var w = waiting[chat];
                if (w.retryAt && t >= w.retryAt && w.link) {
                    delete waiting[chat];
                    dirty = true;
                    place(chat, w, w.link);
                } else if (t - w.ts >= clamp(num(S.waitHours) || 24, 1, 168) * 3600) {
                    delete waiting[chat];
                    dirty = true;
                    sendTo(chat, "⌛ Время на отправку ссылки истекло. Средства возвращены.");
                    doRefund(w.orderId, "покупатель не прислал ссылку вовремя");
                }
            }
            if (dirty) save("waiting", waiting);
            if (t - lastPoll >= clamp(int(S.pollSec, 300), 30, 3600)) { lastPoll = t; pollStatuses(); }
            if (S.autoLots && t - lastLots >= clamp(int(S.autoLotsMin, 30), 5, 1440) * 60) {
                lastLots = t;
                lotIds().forEach(function (id) { if (!lotActive(id, true)) log("лот " + id + " не включился" + lastErr()); });
            }
        } catch (e) {
            log("ошибка фоновой проверки: " + e);
        } finally {
            pollBusy = false;
        }
    }, 20000);

    // --- настройки
    var view = "main", draftProvider = 0;
    function stats(since) {
        var a = { n: 0, rev: 0, cost: 0 };
        orders.forEach(function (o) {
            if (o.status !== "success" || o.finished < since) return;
            a.n++; a.rev += num(o.sold); a.cost += num(o.cost);
        });
        return a.n + " шт. · доход " + a.rev.toFixed(2) + " · расход " + a.cost.toFixed(2) + " · прибыль " + (a.rev - a.cost).toFixed(2);
    }
    function render() {
        var kids = [H("AutoSMM")].concat(tabs([["main", "Главная"], ["prov", "Поставщики"], ["maps", "Привязки"], ["msgs", "Сообщения"], ["more", "Ещё"], ["ord", "Заказы"]], view, "window.smmView"));
        if (view === "main") {
            var hints = [];
            var noKey = S.providers.filter(function (p) { return !String(p.key || "").trim(); }).map(function (p) { return p.name; });
            if (!S.providers.length) hints.push("добавьте поставщика");
            else if (noKey.length) hints.push("впишите API-ключ: " + noKey.join(", "));
            if (!S.maps.length) hints.push("привяжите лот к услуге");
            kids.push(Sw("Плагин работает", "m_on", S.enabled, "window.smmMain()"));
            kids.push(Sw("Переспрашивать ссылку перед запуском", "m_confirm", S.confirm, "window.smmMain()"));
            kids.push(Sw("Возвращать деньги при ошибке", "m_refund", S.refund, "window.smmMain()"));
            kids.push(hints.length ? T("Чтобы заработало: " + hints.join("; ") + ".", { color: "#D98A00" }) : T("Всё готово к работе.", { color: "#2E9E5B" }));
            kids.push(Card(
                T("Как настроить", { bold: true }),
                T("1. \"Поставщики\": впишите API-ключ своей SMM-панели, кнопка \"Баланс\" проверит ключ."),
                T("2. \"Привязки\": название лота как на FunPay (или его часть), ID услуги из панели и множитель количества."),
                T("3. Покупатель оплачивает лот, плагин просит ссылку, создаёт заказ у поставщика и сам следит за статусом."),
                T("Покупатель видит прогресс командой !прогресс, ещё есть \"чек ID\" и \"рефилл ID\".")
            ));
            if (DESKTOP && S.refund) kids.push(hint("При первом возврате программа спросит разрешение. Выберите \"Разрешать всегда\", иначе возврат будет ждать вас."));
            kids.push(hint("Ждут ссылку: " + Object.keys(waiting).length + " · в работе: " + Object.keys(active).length));
        } else if (view === "prov") {
            if (!S.providers.length) kids.push(hint("Поставщиков нет. Добавьте панель ниже."));
            S.providers.forEach(function (p, i) {
                kids.push(Card(
                    T(p.name, { bold: true }),
                    In("Название", "p_name_" + i, p.name),
                    In("Адрес API (https://...)", "p_url_" + i, p.url),
                    In("API-ключ", "p_key_" + i, p.key),
                    Row(Btn("Сохранить", "window.smmProvSave(" + i + ")"), Btn("Баланс", "window.smmBalance(" + i + ")", true, "Проверяю..."), Btn("Удалить", "window.smmProvDel(" + i + ")", true))
                ));
            });
            kids.push(Btn("Добавить поставщика", "window.smmProvAdd()", true));
        } else if (view === "maps") {
            kids.push(hint("Привязка срабатывает, если её текст есть в названии купленного лота или равен ID лота."));
            S.maps.forEach(function (m, i) {
                var p = provider(m.provider);
                kids.push(Card(
                    T(m.match, { bold: true }),
                    T("Поставщик: " + (p ? p.name : "удалён") + " · услуга " + m.service + " · множитель " + m.mult),
                    Btn("Удалить", "window.smmMapDel(" + i + ")", true)
                ));
            });
            if (!S.providers.length) {
                kids.push(hint("Сначала добавьте поставщика."));
            } else {
                if (draftProvider >= S.providers.length) draftProvider = 0;
                kids.push(Card(
                    T("Новая привязка", { bold: true }),
                    In("Название лота, его часть или ID лота", "n_match", gs("n_match")),
                    Btn("Поставщик: " + S.providers[draftProvider].name + (S.providers.length > 1 ? " (сменить)" : ""), "window.smmMapProv()", true),
                    In("ID услуги в панели", "n_service", gs("n_service")),
                    In("Множитель количества (1 шт. на FunPay = столько у поставщика)", "n_mult", gs("n_mult") || "1"),
                    Btn("Добавить привязку", "window.smmMapAdd()")
                ));
            }
        } else if (view === "msgs") {
            kids.push(hint("Для каждого случая можно несколько вариантов, плагин берёт случайный. В тексте работает {provider_order_id}. " + NL_HINT));
            SLOTS.forEach(function (slot) {
                var card = [T(SLOT_NAMES[slot], { bold: true })];
                S.messages[slot].forEach(function (text, i) { card.push(In("Вариант " + (i + 1), "t_" + slot + "_" + i, text, true)); });
                card.push(Row(Btn("Сохранить", "window.smmMsgSave('" + slot + "')"), Btn("Ещё вариант", "window.smmMsgAdd('" + slot + "')", true), Btn("Убрать последний", "window.smmMsgDel('" + slot + "')", true)));
                kids.push({ type: "Card", children: card });
            });
        } else if (view === "more") {
            kids.push(Card(
                In("Сколько часов ждать ссылку (1-168)", "x_wait", S.waitHours),
                In("Как часто спрашивать статус, секунд (30-3600)", "x_poll", S.pollSec),
                In("Разрешённые сайты в ссылках, через запятую", "x_domains", S.domains.join(", ")),
                Sw("Уведомлять о каждом новом заказе", "x_new", S.notifyNew, ""),
                Sw("Включать привязанные лоты обратно", "x_lots", S.autoLots, ""),
                In("Как часто включать лоты, минут (5-1440)", "x_lotsmin", S.autoLotsMin),
                In("Ещё ID лотов для включения, через запятую", "x_extra", (S.extraLots || []).join(", ")),
                Btn("Сохранить", "window.smmMore()")
            ));
            kids.push(hint("Лоты включаются по ID: это привязки, где вместо названия указан ID лота, и список выше."));
        } else {
            var t = now();
            kids.push(Card(T("Выполнено", { bold: true }), T("Сутки: " + stats(t - 86400)), T("Неделя: " + stats(t - 7 * 86400)), T("Месяц: " + stats(t - 30 * 86400))));
            var act = Object.keys(active);
            kids.push(T("В работе (" + act.length + ")", { bold: true }));
            act.forEach(function (chat) {
                kids.push(Row(T("#" + active[chat].orderId + " · ID " + active[chat].poid), Btn("Снять", "window.smmActDel('" + chat + "')", true)));
            });
            kids.push(Btn("Проверить статусы сейчас", "window.smmPoll()", true, "Проверяю..."));
            kids.push(T("Последние заказы", { bold: true }));
            orders.slice(-10).reverse().forEach(function (o) {
                kids.push(T("#" + o.orderId + " · " + (o.buyer || "") + " · ID " + o.poid + " · " + o.qty + " шт. · " +
                    (o.status === "success" ? "выполнен" : o.status === "failure" ? "не выполнен" : "в работе")));
            });
            if (!orders.length) kids.push(hint("Заказов пока не было."));
        }
        kids.push(hint("Автор оригинального плагина: @xvimp"));
        show(kids);
    }
    window.smmView = function (v) { view = v; render(); };
    window.smmMain = function () { S.enabled = on("m_on"); S.confirm = on("m_confirm"); S.refund = on("m_refund"); saveS(); };
    window.smmProvSave = function (i) {
        var p = S.providers[i];
        if (!p) return;
        var url = gs("p_url_" + i).trim();
        if (!/^https:\/\//.test(url)) return toast("Адрес API должен начинаться с https://");
        p.name = gs("p_name_" + i).trim() || p.name;
        p.url = url;
        p.key = gs("p_key_" + i).trim();
        saveS();
        toast("Сохранено");
        render();
    };
    window.smmProvAdd = function () {
        S.providers.push({ id: newId("p", S.providers), name: "Новый поставщик", url: "https://", key: "" });
        saveS();
        render();
    };
    window.smmProvDel = function (i) { S.providers.splice(i, 1); saveS(); render(); };
    window.smmBalance = function (i) {
        var p = S.providers[i];
        if (!p) return;
        var r = smm({ url: gs("p_url_" + i).trim() || p.url, key: gs("p_key_" + i).trim() || p.key }, { action: "balance" });
        toast(r.data && r.data.balance !== undefined ? "Баланс " + p.name + ": " + r.data.balance + " " + (r.data.currency || "") :
            "Баланс не получен: " + (r.error || (r.data && r.data.error) || "проверьте адрес и ключ"));
        render();
    };
    window.smmMapProv = function () { draftProvider = (draftProvider + 1) % Math.max(1, S.providers.length); render(); };
    window.smmMapAdd = function () {
        var match = gs("n_match").trim(), service = int(gs("n_service"), 0), mult = num(gs("n_mult")) || 1;
        if (!match) return toast("Укажите название лота или его ID");
        if (!(service > 0)) return toast("Укажите ID услуги числом");
        S.maps.push({ id: newId("m", S.maps), match: match, provider: S.providers[draftProvider].id, service: service, mult: mult });
        saveS();
        fpt.ui.setState("n_match", ""); fpt.ui.setState("n_service", ""); fpt.ui.setState("n_mult", "1");
        toast("Привязка добавлена");
        render();
    };
    window.smmMapDel = function (i) { S.maps.splice(i, 1); saveS(); render(); };
    window.smmMsgSave = function (slot) {
        var list = S.messages[slot].map(function (_, i) { return gm("t_" + slot + "_" + i).trim(); }).filter(Boolean);
        if (!list.length) return toast("Нужен хотя бы один вариант");
        S.messages[slot] = list;
        saveS();
        toast("Сохранено");
        render();
    };
    window.smmMsgAdd = function (slot) {
        S.messages[slot] = S.messages[slot].map(function (old, i) { return gm("t_" + slot + "_" + i) || old; });
        S.messages[slot].push(DEFAULTS.messages[slot][0]);
        saveS();
        render();
    };
    window.smmMsgDel = function (slot) {
        if (S.messages[slot].length < 2) return toast("Один вариант должен остаться");
        S.messages[slot].pop();
        saveS();
        render();
    };
    window.smmMore = function () {
        S.waitHours = clamp(int(gs("x_wait"), 24), 1, 168);
        S.pollSec = clamp(int(gs("x_poll"), 300), 30, 3600);
        S.domains = gs("x_domains").split(",").map(function (d) { return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }).filter(Boolean);
        S.notifyNew = on("x_new");
        S.autoLots = on("x_lots");
        S.autoLotsMin = clamp(int(gs("x_lotsmin"), 30), 5, 1440);
        S.extraLots = gs("x_extra").split(/[,;\s]+/).filter(function (v) { return /^\d+$/.test(v); });
        saveS();
        toast("Сохранено");
        render();
    };
    window.smmActDel = function (chat) { delete active[chat]; save("active", active); render(); };
    window.smmPoll = function () { pollStatuses(); lastPoll = now(); render(); };

    render();
    log("запущен: поставщиков " + S.providers.length + ", привязок " + S.maps.length);
})();
