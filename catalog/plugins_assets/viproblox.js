// @name VipRoblox
// @author @xvimp
// @version 1.0.0
// @description Аренда VIP-серверов Roblox: новая ссылка на каждый заказ, таймеры аренды, очередь, бонус за отзыв. После аренды старая ссылка перестаёт работать.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/viproblox_banner.png

(function () {
    var TAG = "[VipRoblox]", NS_STORE = "vrx_", NS_UI = "vrx_";

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

    // ---------------------------------------------------------------- VipRoblox
    // Аренда приватных VIP-серверов Roblox: на каждый заказ плагин выпускает новую ссылку сервера,
    // а когда аренда кончается, выпускает ещё одну, и ссылка прошлого покупателя перестаёт работать.
    var RU = {
        payment: "🎮 Спасибо за покупку!\n✅ Ваша персональная ссылка на сервер:\n🔗 {link}\n\n🕒 Время аренды: {hours} час(а/ов)\n💰 Заказ: #{order_id}\n\n🎯 Ссылка действует только для тебя. По окончании аренды она будет обновлена.\nКоманды в этом чате:\n  !time: оставшееся время\n  !ссылка: показать ссылку ещё раз\n  !vip: статус аренды\n  !отзыв: продлить аренду за отзыв\n\n🎉 Приятной игры!",
        expiration: "⏰ Время аренды истекло, пожалуйста подтвердите заказ\n🔗 https://funpay.com/orders/{order_id}/",
        queued: "🕒 Все VIP-сервера сейчас заняты. Ты в очереди: позиция #{position}.\nСсылка придёт автоматически, как только освободится слот.",
        queue_advanced: "📈 Очередь продвинулась! Твоя новая позиция: #{position}.",
        served_from_queue: "🎮 Освободился слот! Твоя персональная ссылка:\n🔗 {link}\n\n🕒 Время аренды: {hours} час(а/ов)\n🎉 Приятной игры!",
        expiry_warning: "⏳ До конца аренды осталось ~{minutes} мин.\nЧтобы продлить, оставь отзыв и напиши !отзыв.",
        blocked: "🚫 Извини, выдача для тебя недоступна. Свяжись с продавцом.",
        review_thanks: "⭐ Спасибо за отзыв ({stars}/5)! Аренда продлена на {hours}ч.",
        review_not_found: "⚠️ Отзыв не найден. Оставь отзыв на заказ на FunPay, затем напиши !отзыв ещё раз.",
        review_already: "Бонус за отзыв уже получен по этому заказу.",
        review_low_stars: "⚠️ Бонус даётся только за отзыв с оценкой {threshold}★ и выше.",
        review_off: "Бонус за отзыв сейчас отключён.",
        vip_status_active: "🎟 Твоя аренда активна.\n🆔 Сервер: {server_id}\n⏱ Осталось: {remaining}\n🔗 {link}",
        vip_status_queue: "🕒 Ты в очереди, позиция #{position}. Ссылка придёт автоматически.",
        vip_status_none: "У тебя нет активной аренды или места в очереди.",
        time_left: "⏱ Осталось: {remaining}",
        link_again: "🔗 {link}",
        link_error: "⚠️ Ошибка генерации ссылки. Свяжитесь с продавцом.",
        lang_switched: "🌐 Язык переключён на русский.",
        commands: "Команды:\n!time: оставшееся время\n!ссылка: повторить ссылку\n!vip: статус аренды\n!отзыв: бонус за отзыв\n!engrent: English",
    };
    var EN = {
        payment: "🎮 Thanks for your purchase!\n✅ Your personal server link:\n🔗 {link}\n\n🕒 Rental time: {hours} hour(s)\n💰 Order: #{order_id}\n\n🎯 This link is for you only. It will be regenerated when the rental ends.\nChat commands:\n  !time: remaining time\n  !link: show the link again\n  !vip: rental status\n  !review: extend the rental for a review\n\n🎉 Have fun!",
        expiration: "⏰ Your rental time is over, please confirm the order\n🔗 https://funpay.com/orders/{order_id}/",
        queued: "🕒 All VIP servers are busy right now. You are in the queue: position #{position}.\nThe link will arrive automatically once a slot frees up.",
        queue_advanced: "📈 The queue moved! Your new position: #{position}.",
        served_from_queue: "🎮 A slot opened up! Your personal link:\n🔗 {link}\n\n🕒 Rental time: {hours} hour(s)\n🎉 Have fun!",
        expiry_warning: "⏳ About {minutes} min left until your rental ends.\nTo extend, leave a review and type !review.",
        blocked: "🚫 Sorry, delivery is not available for you. Contact the seller.",
        review_thanks: "⭐ Thanks for the review ({stars}/5)! Rental extended by {hours}h.",
        review_not_found: "⚠️ Review not found. Leave a review for the order on FunPay, then type !review again.",
        review_already: "The review bonus has already been granted for this order.",
        review_low_stars: "⚠️ The bonus is only granted for a review rated {threshold}★ or higher.",
        review_off: "The review bonus is turned off right now.",
        vip_status_active: "🎟 Your rental is active.\n🆔 Server: {server_id}\n⏱ Remaining: {remaining}\n🔗 {link}",
        vip_status_queue: "🕒 You are in the queue, position #{position}. The link will arrive automatically.",
        vip_status_none: "You have no active rental or queue entry.",
        time_left: "⏱ Remaining: {remaining}",
        link_again: "🔗 {link}",
        link_error: "⚠️ Could not generate the link. Please contact the seller.",
        lang_switched: "🌐 Language switched to English.",
        commands: "Commands:\n!time: remaining time\n!link: show the link again\n!vip: rental status\n!review: review bonus\n!rusrent: Русский",
    };
    var TPL_LABELS = {
        payment: "Выдача ссылки", expiration: "Аренда закончилась", queued: "Поставлен в очередь", queue_advanced: "Очередь продвинулась",
        served_from_queue: "Выдача из очереди", expiry_warning: "Скоро конец аренды", blocked: "Покупатель в чёрном списке",
        review_thanks: "Бонус за отзыв начислен", review_not_found: "Отзыв не найден", review_already: "Бонус уже получен", review_low_stars: "Мало звёзд",
        vip_status_active: "Статус: аренда идёт", vip_status_queue: "Статус: в очереди", vip_status_none: "Статус: ничего нет", commands: "Список команд",
    };
    var TPL_KEYS = Object.keys(TPL_LABELS);
    var DEFAULTS = {
        running: false,
        accounts: [],          // {cookie, userId, username}
        lots: [],              // {id, match, lotIds:[], vips:[], account, hours}
        autoRefund: false, autoDeactivate: true, checkSec: 300,
        bonusHours: 1, bonusStars: 5, autoReview: true,
        warnMin: [10], lang: "ru",
        liveness: true, livenessSec: 1800,
        blacklistOn: true, blacklistOnRefund: false, blacklist: [],
        perServer: 0, perServerPeriod: 0, perServerPeriodSec: 86400, perBuyer: 0,
        ru: {}, en: {},
    };
    var S = load("settings", null) || {};
    (function () { for (var k in DEFAULTS) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); })();
    var active = load("active", []);     // идущие аренды
    var queue = load("queue", []);       // заказы, которым не хватило сервера
    var history = load("history", []);
    var stats = load("stats", { hours: 0, earnings: 0, orders: 0 });
    var langs = load("langs", {});
    var live = load("live", { deadAccounts: [], deadServers: [], at: 0 });

    function saveS() { save("settings", S); }
    function saveActive() { save("active", active); }
    function tpl(key, chatId, vars) {
        var lang = (chatId && langs[chatId]) || S.lang || "ru";
        var text = lang === "en" ? (S.en[key] || EN[key] || S.ru[key] || RU[key]) : (S.ru[key] || RU[key]);
        return fill(text || "", vars || {});
    }
    function say(chatId, key, vars) { return sendTo(chatId, tpl(key, chatId, vars)); }
    function remaining(r) {
        var rem = Math.max(0, Math.floor(r.expires - now()));
        return Math.floor(rem / 3600) + "ч " + Math.floor(rem % 3600 / 60) + "мин";
    }

    // --- Roblox
    var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    function rh(cookie, extra) {
        var h = { "User-Agent": UA, "Cookie": ".ROBLOSECURITY=" + String(cookie || "").replace(/^\.ROBLOSECURITY=/, "") };
        for (var k in (extra || {})) h[k] = extra[k];
        return h;
    }
    function robloxWho(cookie) {
        var r = http("GET", "https://users.roblox.com/v1/users/authenticated", null, rh(cookie));
        return r.code === 200 && r.json && r.json.id ? { id: r.json.id, name: r.json.name || r.json.displayName || "" } : null;
    }
    function vipServer(cookie, id) {
        var r = http("GET", "https://games.roblox.com/v1/vip-servers/" + id, null, rh(cookie));
        if (r.code === 200 && r.json) return r.json;
        log("VIP-сервер " + id + ": Roblox ответил " + (r.code || "ничего") + " " + r.body.slice(0, 150));
        return null;
    }
    // Новая ссылка сервера: PATCH /v1/vip-servers/{id} с newJoinCode=true. Если Roblox поменяет адрес, править здесь.
    function regenerate(cookie, id) {
        var info = vipServer(cookie, id);
        if (!info) return null;
        var csrf = header(http("POST", "https://auth.roblox.com/v2/logout", "", rh(cookie)), "x-csrf-token");
        if (!csrf) { log("Roblox не выдал токен запроса" + (DESKTOP ? "" : " (на Android заголовки ответа недоступны)")); return null; }
        var body = JSON.stringify({ active: info.active === undefined ? true : info.active, name: info.name || "", newJoinCode: true });
        for (var attempt = 0; attempt < 2; attempt++) {
            var r = http("PATCH", "https://games.roblox.com/v1/vip-servers/" + id, body, rh(cookie, {
                "X-CSRF-TOKEN": csrf, "Content-Type": "application/json", "Origin": "https://www.roblox.com",
                "Referer": "https://www.roblox.com/private-server/configure/" + id,
            }));
            if (r.code === 200 && r.json) return r.json;
            var fresh = header(r, "x-csrf-token");
            if (attempt === 0 && r.code === 403 && fresh) { csrf = fresh; continue; }
            log("новая ссылка для сервера " + id + " не выпущена: " + (r.code ? "Roblox ответил " + r.code + " " + r.body.slice(0, 150) : r.error));
            return null;
        }
        return null;
    }
    function linkOf(info) {
        if (!info) return "";
        if (typeof info.link === "string" && /^http/.test(info.link)) return info.link;
        if (info.link && typeof info.link === "object") {
            var keys = ["shareLink", "url", "href"];
            for (var i = 0; i < keys.length; i++) if (typeof info.link[keys[i]] === "string") return info.link[keys[i]];
        }
        var code = info.joinCode || info.linkCode;
        return code ? "https://www.roblox.com/share?code=" + code + "&type=Server" : "";
    }

    // --- какой лот куплен и на сколько часов
    function tagHours(text) {
        var m = /#Hours:\s*(\d+)/i.exec(text || "");
        if (m) return int(m[1], 0) > 0 ? int(m[1], 0) : 0;
        m = /#Time:\s*(\d+)\s*([^\s\d]*)/i.exec(text || "");
        if (!m) return 0;
        var v = int(m[1], 0), s = m[2].toLowerCase();
        if (["", "h", "ч", "час", "часа", "часов"].indexOf(s) >= 0) return v;
        if (["d", "д", "дн", "день", "дня", "дней"].indexOf(s) >= 0) return v * 24;
        if (["w", "нед", "неделя", "недель"].indexOf(s) >= 0) return v * 168;
        if (["m", "min", "мин", "минут"].indexOf(s) >= 0) return Math.max(1, Math.floor((v + 59) / 60));
        return 0;
    }
    function matchLot(text, lotId) {
        var desc = String(text || "").toLowerCase();
        for (var i = 0; i < S.lots.length; i++) {
            var lot = S.lots[i];
            if (lotId && (lot.lotIds || []).indexOf(String(lotId)) >= 0) return lot;
            var name = String(lot.match || "").toLowerCase().trim();
            if (name && desc.indexOf(name) >= 0) return lot;
        }
        return null;
    }
    function lotById(id) { for (var i = 0; i < S.lots.length; i++) if (S.lots[i].id === id) return S.lots[i]; return null; }
    function busyVips() { var b = {}; active.forEach(function (r) { b[r.vip] = (b[r.vip] || 0) + 1; }); return b; }
    function selectVip(lot) {
        var busy = busyVips(), dead = live.deadServers || [], t = now();
        var pool = lot.vips || [];
        for (var i = 0; i < pool.length; i++) {
            var v = String(pool[i]);
            if (dead.indexOf(v) >= 0) continue;
            var limit = int(S.perServer, 0);
            if (limit ? busy[v] >= limit : busy[v]) continue;
            if (int(S.perServerPeriod, 0)) {
                var from = t - int(S.perServerPeriodSec, 86400);
                var n = history.filter(function (h) { return String(h.vip) === v && h.ts >= from; }).length;
                if (n >= int(S.perServerPeriod, 0)) continue;
            }
            return v;
        }
        return "";
    }
    function freeVips(lot) { var busy = busyVips(); return (lot.vips || []).filter(function (v) { return !busy[String(v)]; }).length; }
    function buyerActive(buyer) { return active.filter(function (r) { return r.buyer === buyer; }).length; }
    function blacklisted(name, chatId) {
        var n = String(name || "").toLowerCase();
        return S.blacklist.some(function (b) { return (n && String(b.name || "").toLowerCase() === n) || (chatId && b.chatId === chatId); });
    }
    function queuePos(orderId, lotId) {
        var same = queue.filter(function (e) { return e.lot === lotId; }).sort(function (a, b) { return a.at - b.at; });
        for (var i = 0; i < same.length; i++) if (same[i].orderId === orderId) return i + 1;
        return same.length + 1;
    }
    function syncLotActivation() {
        if (!S.autoDeactivate || !S.running) return;
        S.lots.forEach(function (lot) {
            var want = freeVips(lot) > 0;
            (lot.lotIds || []).forEach(function (id) {
                if (lot.shown && lot.shown[id] === want) return;
                if (lotActive(id, want)) {
                    lot.shown = lot.shown || {};
                    lot.shown[id] = want;
                    log("лот " + id + (want ? " включён: есть свободный сервер" : " выключен: свободных серверов нет"));
                }
            });
        });
    }

    function deliver(lot, e, key) {
        var acc = S.accounts[int(lot.account, 0)];
        if (!acc) { log("заказ #" + e.orderId + ": у лота не выбран аккаунт Roblox"); return "error"; }
        var vip = selectVip(lot);
        if (!vip) return "no_server";
        var link = linkOf(regenerate(acc.cookie, vip));
        if (!link) return "error";
        if (!say(e.chatId, key, { buyer_name: e.buyer, server_id: vip, hours: e.hours, order_id: e.orderId, link: link })) return "error";
        var t = now();
        active.push({ orderId: e.orderId, buyer: e.buyer, chatId: e.chatId, vip: vip, account: int(lot.account, 0), lot: lot.id, hours: e.hours, link: link,
            started: t, expires: t + e.hours * 3600, warned: [], bonused: false });
        saveActive();
        stats.hours += e.hours; stats.earnings += num(e.price); stats.orders++;
        save("stats", stats);
        history.push({ orderId: e.orderId, buyer: e.buyer, chatId: e.chatId, lot: lot.id, vip: vip, hours: e.hours, price: e.price, ts: t });
        if (history.length > 300) history = history.slice(history.length - 300);
        save("history", history);
        log("заказ #" + e.orderId + ": выдана ссылка сервера " + vip + ", аренда на " + e.hours + " ч");
        syncLotActivation();
        return "delivered";
    }
    function enqueue(lot, e) {
        if (queue.some(function (x) { return x.orderId === e.orderId; })) return;
        queue.push({ orderId: e.orderId, buyer: e.buyer, chatId: e.chatId, lot: lot.id, hours: e.hours, price: e.price, at: now() });
        save("queue", queue);
        var pos = queuePos(e.orderId, lot.id);
        say(e.chatId, "queued", { position: pos });
        notify("VipRoblox: заказ #" + e.orderId + " в очереди", e.buyer + ", позиция " + pos);
    }
    function processQueue() {
        if (!queue.length) return;
        var before = {}, left = [], moved = false;
        queue.forEach(function (e) { before[e.orderId] = queuePos(e.orderId, e.lot); });
        queue.slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (e) {
            var lot = lotById(e.lot);
            if (!lot || (int(S.perBuyer, 0) && buyerActive(e.buyer) >= int(S.perBuyer, 0))) return left.push(e);
            if (deliver(lot, e, "served_from_queue") !== "delivered") return left.push(e);
            moved = true;
            notify("VipRoblox: заказ #" + e.orderId + " выдан из очереди", e.buyer);
        });
        if (!moved) return;
        queue = left;
        save("queue", queue);
        queue.forEach(function (e) {
            var pos = queuePos(e.orderId, e.lot);
            if (pos < before[e.orderId]) say(e.chatId, "queue_advanced", { position: pos });
        });
    }

    onOrder(function (ev) {
        if (!S.running || !ev || ev.iAmBuyer || !ev.orderId) return;
        var o = orderInfo(ev.orderId, ev.text);
        if (o && o.iAmBuyer) return;
        var text = (o ? o.text : "") + "\n" + String(ev.text || "");
        var lot = matchLot(text, o ? o.lotId : "");
        if (!lot) return;
        if (seenOrder(ev.orderId)) return;
        var buyer = ev.buyerName || (o && o.buyerName) || "buyer", chatId = String(ev.chatId || (o && o.chatId) || "");
        var hours = (tagHours(text) || int(lot.hours, 0)) * Math.max(1, o ? o.amount : 1);
        if (!hours) {
            return notify("VipRoblox: заказ #" + ev.orderId + " не выдан", "У лота \"" + lot.match + "\" не указаны часы аренды. Впишите их в настройках лота или добавьте в описание лота на FunPay #Hours: 3.");
        }
        if (!chatId) return notify("VipRoblox: заказ #" + ev.orderId + " не выдан", "Не найден чат с покупателем " + buyer + ". Выдайте вручную.");
        var e = { orderId: String(ev.orderId), buyer: buyer, chatId: chatId, hours: hours, price: o ? o.price : 0 };
        if (S.blacklistOn && blacklisted(buyer, chatId)) {
            say(chatId, "blocked");
            return notify("VipRoblox: заказ #" + e.orderId + " отклонён", buyer + " в чёрном списке");
        }
        if (int(S.perBuyer, 0) && buyerActive(buyer) >= int(S.perBuyer, 0)) return enqueue(lot, e);
        var status = deliver(lot, e, "payment");
        if (status === "no_server") {
            var alive = (lot.vips || []).filter(function (v) { return (live.deadServers || []).indexOf(String(v)) < 0; });
            if ((lot.vips || []).length && !alive.length) notify("VipRoblox: нет рабочих серверов", "У лота \"" + lot.match + "\" все VIP-серверы недоступны.");
            return enqueue(lot, e);
        }
        if (status === "error") {
            if (S.autoRefund && refundOrder(e.orderId)) log("заказ #" + e.orderId + " возвращён: ссылку выпустить не удалось");
            else say(chatId, "link_error");
            return notify("VipRoblox: заказ #" + e.orderId + " не выдан", "Не удалось выпустить ссылку для " + buyer + ". Подробности в журнале плагина.");
        }
        notify("VipRoblox: новый заказ #" + e.orderId, buyer + ", " + hours + " ч");
    });

    function grantBonus(r, stars, silent) {
        var bonus = int(S.bonusHours, 0);
        r.expires += bonus * 3600;
        r.bonused = true;
        if (!silent) say(r.chatId, "review_thanks", { stars: stars, hours: bonus });
        log("аренда #" + r.orderId + ": +" + bonus + " ч за отзыв " + stars + "/5");
    }
    fpt.on("onNewMessage", function (raw) {
        var m = msgInfo(raw);
        if (!m.chatId) return;
        if (m.system) {
            if (S.blacklistOnRefund && /вернул деньги покупателю|has refunded|повернув гроші/i.test(m.text)) {
                var oid = (/#([A-Z0-9]{6,12})/.exec(m.text) || [])[1];
                var h = history.filter(function (x) { return x.orderId === oid; })[0];
                if (h && !blacklisted(h.buyer, h.chatId)) {
                    S.blacklist.push({ name: h.buyer, chatId: h.chatId, reason: "возврат заказа #" + oid, ts: now() });
                    saveS();
                    notify("VipRoblox: " + h.buyer + " в чёрном списке", "Возврат заказа #" + oid);
                }
            }
            return;
        }
        var text = m.text.trim().toLowerCase();
        if (m.mine || !S.running || text.charAt(0) !== "!") return;
        if (text === "!engrent" || text === "!english") { langs[m.chatId] = "en"; save("langs", langs); return say(m.chatId, "lang_switched"); }
        if (text === "!rusrent" || text === "!russian") { langs[m.chatId] = "ru"; save("langs", langs); return say(m.chatId, "lang_switched"); }
        var rental = active.filter(function (r) { return r.chatId === m.chatId; })[0];
        var q = queue.filter(function (e) { return e.chatId === m.chatId; })[0];
        if (/^!(vip|queue|очередь)/.test(text)) {
            if (rental && !(q && /^!(queue|очередь)/.test(text))) return say(m.chatId, "vip_status_active", { server_id: rental.vip, remaining: remaining(rental), link: rental.link });
            if (q) return say(m.chatId, "vip_status_queue", { position: queuePos(q.orderId, q.lot) });
            return say(m.chatId, "vip_status_none");
        }
        if (/^!(команды|help|commands)/.test(text)) { if (rental || q) say(m.chatId, "commands"); return; }
        if (!rental) return;
        if (/^!(time|время)/.test(text)) return say(m.chatId, "time_left", { remaining: remaining(rental) });
        if (/^!(ссылка|link)/.test(text)) return say(m.chatId, "link_again", { link: rental.link });
        if (/^!(отзыв|review)/.test(text)) {
            if (int(S.bonusHours, 0) <= 0) return say(m.chatId, "review_off");
            if (rental.bonused) return say(m.chatId, "review_already");
            var stars = reviewStars(rental.orderId);
            if (!stars) return say(m.chatId, "review_not_found");
            if (stars < int(S.bonusStars, 5)) return say(m.chatId, "review_low_stars", { threshold: S.bonusStars });
            grantBonus(rental, stars);
            saveActive();
        }
    });

    // --- фон: окончания аренд, предупреждения, проверка серверов, очередь
    function liveness() {
        var prevDead = live.deadServers || [], prevAcc = live.deadAccounts || [];
        var deadAcc = [], dead = [], busy = busyVips(), pool = {};
        S.accounts.forEach(function (a, i) {
            if (!robloxWho(a.cookie)) {
                deadAcc.push(i);
                if (prevAcc.indexOf(i) < 0) notify("VipRoblox: аккаунт не отвечает", (a.username || "Аккаунт " + (i + 1)) + ": cookie устарела или Roblox недоступен.");
            }
        });
        S.lots.forEach(function (lot) { (lot.vips || []).forEach(function (v) { pool[String(v)] = int(lot.account, 0); }); });
        Object.keys(pool).forEach(function (v) {
            if (busy[v]) { if (prevDead.indexOf(v) >= 0) dead.push(v); return; }   // занятый арендой сервер не трогаем
            var acc = S.accounts[pool[v]];
            if (!acc || !vipServer(acc.cookie, v)) {
                dead.push(v);
                if (prevDead.indexOf(v) < 0) notify("VipRoblox: VIP-сервер недоступен", "Сервер " + v);
            }
        });
        live = { deadAccounts: deadAcc, deadServers: dead, at: now() };
        save("live", live);
    }
    var busyLoop = false, lastRun = 0;
    function cycle() {
        var t = now(), changed = false, still = [];
        if (S.liveness && t - num(live.at) >= Math.max(300, int(S.livenessSec, 1800))) liveness();
        active.forEach(function (r) {
            var bonus = int(S.bonusHours, 0);
            if (S.autoReview && bonus > 0 && !r.bonused) {
                var stars = reviewStars(r.orderId);
                if (stars >= int(S.bonusStars, 5)) { grantBonus(r, stars); changed = true; }
            }
            if (r.expires > t) {
                (S.warnMin || []).forEach(function (off) {
                    off = int(off, 0);
                    if (off <= 0 || r.warned.indexOf(off) >= 0 || off * 60 >= r.hours * 3600) return;
                    if (t >= r.expires - off * 60) { say(r.chatId, "expiry_warning", { minutes: off }); r.warned.push(off); changed = true; }
                });
                return still.push(r);
            }
            say(r.chatId, "expiration", { buyer_name: r.buyer, server_id: r.vip, hours: r.hours, order_id: r.orderId, link: r.link });
            var acc = S.accounts[int(r.account, 0)];
            // новая ссылка: старая, которая осталась у покупателя, больше не откроется
            if (acc && regenerate(acc.cookie, r.vip)) log("аренда #" + r.orderId + " закончилась, ссылка сервера " + r.vip + " обновлена");
            else notify("VipRoblox: ссылка не обновилась", "Аренда #" + r.orderId + " закончилась, но новую ссылку сервера " + r.vip + " выпустить не удалось. Старая ссылка покупателя всё ещё работает.");
            changed = true;
        });
        if (changed || still.length !== active.length) { active = still; saveActive(); }
        processQueue();
        syncLotActivation();
    }
    setInterval(function () {
        if (busyLoop || !S.running || now() - lastRun < Math.max(30, int(S.checkSec, 300))) return;
        busyLoop = true;
        lastRun = now();
        try { cycle(); } catch (e) { log("ошибка фоновой проверки: " + e); } finally { busyLoop = false; }
    }, 15000);

    // --- настройки
    var view = "main", tplKey = 0, tplLang = "ru";
    function render() {
        var kids = [H("VipRoblox")].concat(tabs([["main", "Главная"], ["acc", "Аккаунты"], ["lots", "Лоты"], ["rent", "Аренды"], ["set", "Настройки"], ["msgs", "Сообщения"], ["bl", "Чёрный список"]], view, "window.vrxView"));
        if (view === "main") {
            kids.push(Sw("Плагин работает", "m_run", S.running, "window.vrxRun()"));
            if (!CAN_ANY_METHOD) kids.push(T("На телефоне плагин пока не может выпускать новые ссылки: приложение не даёт плагину отправить cookie Roblox. Выдача работает в FunPay Tools для компьютера.", { color: "#D9534F" }));
            var todo = [];
            if (!S.accounts.length) todo.push("добавьте аккаунт Roblox");
            if (!S.lots.length) todo.push("добавьте лот и его VIP-серверы");
            kids.push(todo.length ? T("Чтобы заработало: " + todo.join("; ") + ".", { color: "#D98A00" }) : T("Аренд сейчас: " + active.length + " · в очереди: " + queue.length, { color: "#2E9E5B" }));
            kids.push(T("Всего: " + stats.orders + " заказов · " + stats.hours + " ч · " + num(stats.earnings).toFixed(2)));
            kids.push(Card(
                T("Как это работает", { bold: true }),
                T("1. \"Аккаунты\": cookie .ROBLOSECURITY аккаунта, которому принадлежат VIP-серверы."),
                T("2. \"Лоты\": название лота на FunPay, ID его VIP-серверов и часы аренды за 1 шт. Часы можно задать и в описании лота: #Hours: 3 или #Time: 2д."),
                T("3. После оплаты плагин выпускает новую ссылку свободного сервера и шлёт её покупателю. Когда время выйдет, ссылка меняется ещё раз, и старая перестаёт работать."),
                T("Если свободных серверов нет, покупатель встаёт в очередь и получает ссылку, как только сервер освободится.")
            ));
            kids.push(hint("Команды покупателя: !time, !ссылка, !vip, !отзыв, !команды, !engrent, !rusrent."));
            if ((live.deadServers || []).length) kids.push(T("Недоступные серверы: " + live.deadServers.join(", "), { color: "#D9534F" }));
        } else if (view === "acc") {
            kids.push(hint("Cookie хранится только на этом устройстве и отправляется только на roblox.com."));
            S.accounts.forEach(function (a, i) {
                kids.push(Card(
                    T((a.username || "Аккаунт") + " (номер " + (i + 1) + ")" + ((live.deadAccounts || []).indexOf(i) >= 0 ? " · не отвечает" : ""), { bold: true }),
                    Row(Btn("Проверить", "window.vrxAccTest(" + i + ")", true, "Проверяю..."), Btn("Удалить", "window.vrxAccDel(" + i + ")", true))
                ));
            });
            kids.push(Card(In("Cookie .ROBLOSECURITY", "a_cookie", gs("a_cookie")), Btn("Добавить аккаунт", "window.vrxAccAdd()", false, "Проверяю...")));
        } else if (view === "lots") {
            S.lots.forEach(function (lot, i) {
                var acc = S.accounts[int(lot.account, 0)];
                kids.push(Card(
                    T(lot.match || ("лот " + (lot.lotIds || []).join(", ")), { bold: true }),
                    T("Свободно серверов: " + freeVips(lot) + " из " + (lot.vips || []).length + " · аккаунт: " + (acc ? acc.username || "номер " + (int(lot.account, 0) + 1) : "не выбран")),
                    In("Название лота на FunPay или его часть", "l_match_" + i, lot.match),
                    In("ID лотов FunPay через запятую (для авто-выключения)", "l_ids_" + i, (lot.lotIds || []).join(", ")),
                    In("ID VIP-серверов через запятую", "l_vips_" + i, (lot.vips || []).join(", ")),
                    In("Часов аренды за 1 шт. (0: брать из описания лота)", "l_hours_" + i, lot.hours),
                    Row(Btn("Сохранить", "window.vrxLotSave(" + i + ")"), Btn("Аккаунт: " + (acc ? acc.username || int(lot.account, 0) + 1 : "нет") + " (сменить)", "window.vrxLotAcc(" + i + ")", true)),
                    Row(Btn("Проверить ссылку", "window.vrxLotTest(" + i + ")", true, "Проверяю..."), Btn("Удалить лот", "window.vrxLotDel(" + i + ")", true))
                ));
            });
            kids.push(Btn("Добавить лот", "window.vrxLotAdd()"));
            kids.push(hint("ID VIP-сервера это число из адреса его настроек: roblox.com/private-server/configure/123456. \"Проверить ссылку\" выпускает новую ссылку первого свободного сервера, прежняя при этом перестаёт работать."));
        } else if (view === "rent") {
            if (!active.length) kids.push(hint("Сейчас аренд нет."));
            active.forEach(function (r) {
                kids.push(Card(
                    T(r.buyer + " · заказ #" + r.orderId, { bold: true }),
                    T("Сервер " + r.vip + " · осталось " + remaining(r) + " · до " + when(r.expires)),
                    Btn("Завершить сейчас", "window.vrxEnd('" + r.orderId + "')", true, "Завершаю...")
                ));
            });
            if (queue.length) kids.push(T("Очередь (" + queue.length + ")", { bold: true }));
            queue.forEach(function (e) {
                kids.push(Row(T(e.buyer + " · #" + e.orderId + " · " + e.hours + " ч"), Btn("Убрать", "window.vrxQueueDel('" + e.orderId + "')", true)));
            });
            if (history.length) kids.push(T("Последние выдачи", { bold: true }));
            history.slice(-8).reverse().forEach(function (h) { kids.push(hint(when(h.ts) + " · " + h.buyer + " · #" + h.orderId + " · сервер " + h.vip + " · " + h.hours + " ч")); });
        } else if (view === "set") {
            kids.push(Card(
                Sw("Вернуть деньги, если ссылку выпустить не удалось", "s_refund", S.autoRefund, ""),
                Sw("Выключать лот, когда свободных серверов нет", "s_deact", S.autoDeactivate, ""),
                Sw("Сам проверять отзыв и начислять бонус", "s_autorev", S.autoReview, ""),
                Sw("Проверять, что аккаунты и серверы живы", "s_live", S.liveness, ""),
                In("Как часто проверять аренды, секунд (от 30)", "s_check", S.checkSec),
                In("Бонус за отзыв, часов (0: выключен)", "s_bonus", S.bonusHours),
                In("От скольки звёзд давать бонус", "s_stars", S.bonusStars),
                In("Предупреждать за, минут (несколько через запятую, пусто: не писать)", "s_warn", (S.warnMin || []).join(", ")),
                In("Сколько аренд сразу у одного покупателя (0: без ограничения)", "s_buyer", S.perBuyer),
                In("Сколько покупателей сразу на одном сервере (0: один)", "s_server", S.perServer),
                In("Сколько выдач одного сервера за сутки (0: без ограничения)", "s_period", S.perServerPeriod),
                Btn("Язык сообщений по умолчанию: " + (S.lang === "en" ? "английский" : "русский"), "window.vrxLang()", true),
                Btn("Сохранить", "window.vrxSet()")
            ));
            if (DESKTOP) kids.push(hint("При первом возврате денег программа спросит разрешение. Выберите \"Разрешать всегда\"."));
        } else if (view === "msgs") {
            var key = TPL_KEYS[tplKey];
            var cur = tplLang === "en" ? (S.en[key] || EN[key]) : (S.ru[key] || RU[key]);
            kids.push(Row(Btn("Сообщение: " + TPL_LABELS[key] + " (следующее)", "window.vrxTplNext()", true), Btn("Язык: " + (tplLang === "en" ? "английский" : "русский"), "window.vrxTplLang()", true)));
            kids.push(Card(In("Текст", "t_text", cur, true), Row(Btn("Сохранить", "window.vrxTplSave()"), Btn("Вернуть стандартный", "window.vrxTplReset()", true))));
            kids.push(hint("Переменные: {link}, {hours}, {order_id}, {server_id}, {buyer_name}, {position}, {minutes}, {remaining}, {stars}, {threshold}. " + NL_HINT));
        } else {
            kids.push(Sw("Не выдавать ссылки покупателям из списка", "b_on", S.blacklistOn, "window.vrxBl()"));
            kids.push(Sw("Добавлять в список после возврата денег", "b_ref", S.blacklistOnRefund, "window.vrxBl()"));
            S.blacklist.forEach(function (b, i) { kids.push(Row(T((b.name || b.chatId) + (b.reason ? " · " + b.reason : "")), Btn("Убрать", "window.vrxBlDel(" + i + ")", true))); });
            if (!S.blacklist.length) kids.push(hint("Список пуст."));
            kids.push(Card(In("Ник покупателя на FunPay", "b_name", gs("b_name")), Btn("Добавить", "window.vrxBlAdd()", true)));
        }
        kids.push(hint("Автор оригинального плагина: @xvimp"));
        show(kids);
    }
    function ids(text) { var out = []; String(text || "").split(/[,;\s]+/).forEach(function (v) { if (/^\d+$/.test(v) && out.indexOf(v) < 0) out.push(v); }); return out; }
    window.vrxView = function (v) { view = v; render(); };
    window.vrxRun = function () { S.running = on("m_run"); saveS(); render(); };
    window.vrxAccAdd = function () {
        var cookie = gs("a_cookie").trim().replace(/^\.ROBLOSECURITY=/, "");
        if (cookie.length < 50) { toast("Вставьте cookie .ROBLOSECURITY целиком"); return render(); }
        var who = robloxWho(cookie);
        if (!who) { toast("Roblox не принял cookie. Проверьте, что она скопирована целиком."); return render(); }
        S.accounts.push({ cookie: cookie, userId: who.id, username: who.name });
        saveS();
        fpt.ui.setState("a_cookie", "");
        toast("Добавлен аккаунт " + who.name);
        render();
    };
    window.vrxAccTest = function (i) {
        var a = S.accounts[i], who = a && robloxWho(a.cookie);
        toast(who ? "Аккаунт " + who.name + " работает" : "Войти не удалось. Cookie устарела или Roblox не отвечает.");
        render();
    };
    window.vrxAccDel = function (i) {
        S.accounts.splice(i, 1);
        S.lots.forEach(function (lot) { if (int(lot.account, 0) >= S.accounts.length) lot.account = 0; });
        saveS();
        render();
    };
    window.vrxLotAdd = function () {
        S.lots.push({ id: "l" + Date.now(), match: "", lotIds: [], vips: [], account: 0, hours: 1 });
        saveS();
        render();
    };
    window.vrxLotSave = function (i) {
        var lot = S.lots[i];
        if (!lot) return;
        lot.match = gs("l_match_" + i).trim();
        lot.lotIds = ids(gs("l_ids_" + i));
        lot.vips = ids(gs("l_vips_" + i));
        lot.hours = Math.max(0, int(gs("l_hours_" + i), 0));
        lot.shown = {};
        if (!lot.match && !lot.lotIds.length) return toast("Укажите название лота или его ID");
        saveS();
        toast("Сохранено");
        render();
    };
    window.vrxLotAcc = function (i) {
        var lot = S.lots[i];
        if (!lot || !S.accounts.length) return toast("Сначала добавьте аккаунт Roblox");
        lot.account = (int(lot.account, 0) + 1) % S.accounts.length;
        saveS();
        render();
    };
    window.vrxLotDel = function (i) { S.lots.splice(i, 1); saveS(); render(); };
    window.vrxLotTest = function (i) {
        var lot = S.lots[i], acc = lot && S.accounts[int(lot.account, 0)];
        if (!acc) { toast("У лота не выбран аккаунт Roblox"); return render(); }
        var vip = selectVip(lot);
        if (!vip) { toast("Свободных серверов нет"); return render(); }
        var link = linkOf(regenerate(acc.cookie, vip));
        toast(link ? "Сервер " + vip + ": новая ссылка выпущена. " + link : "Ссылку выпустить не удалось, причина в журнале плагина");
        render();
    };
    window.vrxEnd = function (orderId) {
        active.forEach(function (r) { if (r.orderId === orderId) r.expires = now() - 1; });
        saveActive();
        try { cycle(); } catch (e) { log("ошибка: " + e); }
        render();
    };
    window.vrxQueueDel = function (orderId) { queue = queue.filter(function (e) { return e.orderId !== orderId; }); save("queue", queue); render(); };
    window.vrxLang = function () { S.lang = S.lang === "en" ? "ru" : "en"; saveS(); render(); };
    window.vrxSet = function () {
        S.autoRefund = on("s_refund"); S.autoDeactivate = on("s_deact"); S.autoReview = on("s_autorev"); S.liveness = on("s_live");
        S.checkSec = Math.max(30, int(gs("s_check"), 300));
        S.bonusHours = Math.max(0, int(gs("s_bonus"), 1));
        S.bonusStars = clamp(int(gs("s_stars"), 5), 1, 5);
        S.warnMin = ids(gs("s_warn")).map(function (v) { return int(v, 0); }).filter(function (v) { return v > 0; });
        S.perBuyer = Math.max(0, int(gs("s_buyer"), 0));
        S.perServer = Math.max(0, int(gs("s_server"), 0));
        S.perServerPeriod = Math.max(0, int(gs("s_period"), 0));
        saveS();
        toast("Сохранено");
        render();
    };
    window.vrxTplNext = function () { tplKey = (tplKey + 1) % TPL_KEYS.length; render(); };
    window.vrxTplLang = function () { tplLang = tplLang === "en" ? "ru" : "en"; render(); };
    window.vrxTplSave = function () {
        var text = gm("t_text").trim();
        if (!text) return toast("Текст пустой");
        S[tplLang][TPL_KEYS[tplKey]] = text;
        saveS();
        toast("Сохранено");
    };
    window.vrxTplReset = function () { delete S[tplLang][TPL_KEYS[tplKey]]; saveS(); render(); };
    window.vrxBl = function () { S.blacklistOn = on("b_on"); S.blacklistOnRefund = on("b_ref"); saveS(); };
    window.vrxBlAdd = function () {
        var name = gs("b_name").trim();
        if (!name) return toast("Укажите ник");
        if (!blacklisted(name, "")) S.blacklist.push({ name: name, chatId: "", reason: "добавлен вручную", ts: now() });
        saveS();
        fpt.ui.setState("b_name", "");
        render();
    };
    window.vrxBlDel = function (i) { S.blacklist.splice(i, 1); saveS(); render(); };

    render();
    log("запущен: аккаунтов " + S.accounts.length + ", лотов " + S.lots.length + ", аренд " + active.length);
})();
