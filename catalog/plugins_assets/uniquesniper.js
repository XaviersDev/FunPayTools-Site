// @name unique's sniper
// @author @AlliSighs
// @version 1.0.6-android
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/unique_sniper_banner.png
// @description Мониторинг рынка FunPay и уведомления о дешёвых лотах (порт под FunPay Tools)

/*
 * Порт плагина "unique's sniper" с FunPay Cardinal (Python) на FunPay Tools (Android, JS).
 *
 * Соответствие API:
 *   Cardinal                              ->  FunPay Tools
 *   -----------------------------------------------------------------
 *   c.account.method("get", "lots/..")    ->  fpt.network.get(url, headers)   (ходит с твоими куками)
 *   c.account.method("get", "chips/..")   ->  fpt.network.get(url, headers)
 *   json config file                      ->  fpt.storage.get/set
 *   seen-cache json file                  ->  fpt.storage.get/set
 *   telegram bot menu / inline keyboard   ->  fpt.ui.setSlot (Column/Row/Text/Button/Input/Switch)
 *   telegram set_state (пошаговый ввод)   ->  состояние формы во fpt.storage + UI Input'ы
 *   telegram send_notification            ->  fpt.app.notify + fpt.app.vibrate
 *   фоновый поток ScannerWorker           ->  setInterval-цикл
 *
 * Логика поиска/матчинга/парсинга воспроизведена один в один с оригиналом.
 */

(function () {
    "use strict";

    // ----- Константы (аналог PluginConstants) -----
    var CFG_KEY = "sniper_config_v1";      // правила + delay + enabled
    var CACHE_KEY = "sniper_seen_v1";      // список виденных id лотов
    var FORM_KEY = "sniper_form_v1";       // черновик добавляемого правила
    var SLOT = "settings_" + (typeof PLUGIN_ID !== "undefined" ? PLUGIN_ID : "unique_sniper");

    var DEFAULT_SCAN_DELAY = 10;           // секунд между категориями
    var MAX_CACHE_ENTRIES = 2500;
    var POLL_TICK_MS = 1000;               // как часто пробуждается воркер

    function log(m) { try { fpt.app.log("[sniper] " + m); } catch (e) {} }

    // =========================================================================
    //  ConfigurationManager  (аналог ConfigurationManager из Python)
    // =========================================================================
    var Config = {
        _data: null,

        _defaults: function () {
            return { rules: [], delay: DEFAULT_SCAN_DELAY, enabled: true };
        },

        load: function () {
            try {
                var raw = fpt.storage.get(CFG_KEY);
                this._data = raw ? JSON.parse(raw) : this._defaults();
            } catch (e) {
                this._data = this._defaults();
            }
            if (!this._data || typeof this._data !== "object") this._data = this._defaults();
            if (!Array.isArray(this._data.rules)) this._data.rules = [];
            if (typeof this._data.delay !== "number") this._data.delay = DEFAULT_SCAN_DELAY;
            if (typeof this._data.enabled !== "boolean") this._data.enabled = true;
        },

        save: function () {
            try { fpt.storage.set(CFG_KEY, JSON.stringify(this._data)); } catch (e) { log("save cfg err: " + e); }
        },

        getRules: function () { return this._data.rules; },

        addRule: function (rule) { this._data.rules.push(rule); this.save(); },

        removeRuleByIndex: function (i) {
            if (i >= 0 && i < this._data.rules.length) {
                this._data.rules.splice(i, 1);
                this.save();
                return true;
            }
            return false;
        },

        isEnabled: function () { return this._data.enabled === true; },
        setEnabled: function (v) { this._data.enabled = !!v; this.save(); },

        getDelay: function () { return this._data.delay; },
        setDelay: function (v) { this._data.delay = v; this.save(); }
    };

    // Правило: { subcategory_id, category_type(0 лот / 1 вирты), keywords, max_price, min_amount }
    function keywordsList(kw) {
        if (!kw || kw === "-") return [];
        return kw.split(",").map(function (k) { return k.trim().toLowerCase(); }).filter(function (k) { return k.length > 0; });
    }

    // =========================================================================
    //  CacheManager  (аналог CacheManager)
    // =========================================================================
    var Cache = {
        _seen: [],

        load: function () {
            try {
                var raw = fpt.storage.get(CACHE_KEY);
                this._seen = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(this._seen)) this._seen = [];
                this._trim();
            } catch (e) { this._seen = []; }
        },

        _trim: function () {
            if (this._seen.length > MAX_CACHE_ENTRIES) {
                this._seen = this._seen.slice(this._seen.length - MAX_CACHE_ENTRIES);
            }
        },

        save: function () {
            try { fpt.storage.set(CACHE_KEY, JSON.stringify(this._seen)); } catch (e) {}
        },

        isSeen: function (id) { return this._seen.indexOf(String(id)) !== -1; },

        markSeen: function (id) {
            this._seen.push(String(id));
            this._trim();
            this.save();
        }
    };

    // =========================================================================
    //  LotAnalyzer  (аналог LotAnalyzer.is_match)
    // =========================================================================
    function isMatch(lot, rule) {
        if (lot.price > rule.max_price) return false;

        if (rule.min_amount > 0) {
            var amt = (lot.amount !== null && lot.amount !== undefined) ? lot.amount : 1;
            if (amt < rule.min_amount) return false;
        }

        var targets = keywordsList(rule.keywords);
        if (targets.length === 0) return true;

        var parts = [];
        if (lot.description) parts.push(lot.description);
        if (lot.server) parts.push(lot.server);
        if (lot.side) parts.push(lot.side);
        var hay = parts.join(" ").toLowerCase();

        for (var i = 0; i < targets.length; i++) {
            if (hay.indexOf(targets[i]) !== -1) return true;
        }
        return false;
    }

    // =========================================================================
    //  HTML парсинг  (замена BeautifulSoup на DOMParser)
    //  В WebView DOMParser доступен.
    // =========================================================================
    function parseHtml(html) {
        try {
            return new DOMParser().parseFromString(html, "text/html");
        } catch (e) {
            return null;
        }
    }

    function httpGetFunpay(path) {
        // path может быть полным url или относительным от funpay.com
        var url = path.indexOf("http") === 0 ? path : ("https://funpay.com/" + path.replace(/^\/+/, ""));
        var res = fpt.network.get(url, { "accept": "*/*", "User-Agent": "Mozilla/5.0" });
        if (!res || res.error) { log("net err " + (res && res.error)); return null; }
        if (res.code && res.code !== 200) { log("http " + res.code + " for " + url); return null; }
        return res.body || "";
    }

    // Парсинг обычной категории лотов: lots/<id>/
    function fetchCommonLots(subId) {
        var html = httpGetFunpay("lots/" + subId + "/");
        if (!html) return [];
        var doc = parseHtml(html);
        if (!doc) return [];

        var out = [];
        var items = doc.querySelectorAll("a.tc-item");
        for (var i = 0; i < items.length; i++) {
            try {
                var el = items[i];
                var href = el.getAttribute("href") || "";
                if (!href) continue;

                var id = el.getAttribute("data-offer") || href; // у обычных лотов есть data-offer

                var descEl = el.querySelector(".tc-desc-text");
                var description = descEl ? descEl.textContent.trim() : null;

                var serverEl = el.querySelector(".tc-server");
                var server = serverEl ? serverEl.textContent.trim() : null;

                var amount = parseAmount(el.querySelector(".tc-amount"));
                var priceData = parsePrice(el.querySelector(".tc-price"));

                var sellerEl = el.querySelector(".media-user-name");
                var seller = sellerEl ? sellerEl.textContent.trim() : "Неизвестно";

                out.push({
                    id: id,
                    server: server,
                    side: null,
                    description: description || "Без описания",
                    amount: amount,
                    price: priceData.price,
                    currency: priceData.currency,
                    seller: seller,
                    public_link: href
                });
            } catch (e) { continue; }
        }
        return out;
    }

    // Парсинг валюты/виртов: chips/<id>/  (один в один с DummyLot из Python)
    function fetchCurrencyLots(subId) {
        var html = httpGetFunpay("chips/" + subId + "/");
        if (!html) return [];
        var doc = parseHtml(html);
        if (!doc) return [];

        var out = [];
        var items = doc.querySelectorAll("a.tc-item");
        for (var i = 0; i < items.length; i++) {
            try {
                var el = items[i];
                var href = el.getAttribute("href") || "";
                if (!href) continue;
                var pseudoId = href; // у виртов нет id -> ссылка как уникальный ключ

                var serverEl = el.querySelector(".tc-server");
                var server = serverEl ? serverEl.textContent.trim() : null;

                var sideEl = el.querySelector(".tc-side");
                var side = sideEl ? sideEl.textContent.trim() : null;

                var amount = parseAmount(el.querySelector(".tc-amount"));
                var priceData = parsePrice(el.querySelector(".tc-price"));

                var sellerEl = el.querySelector(".media-user-name");
                var seller = sellerEl ? sellerEl.textContent.trim() : "Неизвестно";

                var desc = [server, side].filter(Boolean).join(" | ") || "Валюта";

                out.push({
                    id: pseudoId,
                    server: server,
                    side: side,
                    description: desc,
                    amount: amount,
                    price: priceData.price,
                    currency: priceData.currency,
                    seller: seller,
                    public_link: href
                });
            } catch (e) { continue; }
        }
        return out;
    }

    function parseAmount(amountEl) {
        if (!amountEl) return null;
        var digits = (amountEl.textContent || "").replace(/[^0-9]/g, "");
        return digits ? parseInt(digits, 10) : null;
    }

    function parsePrice(priceEl) {
        var result = { price: 0.0, currency: "₽" };
        if (!priceEl) return result;
        var inner = priceEl.querySelector("div") || priceEl;
        var txt = (inner.textContent || "").trim();
        // последний токен — валюта, остальное число
        var unitSpan = inner.querySelector("span.unit");
        if (unitSpan) result.currency = unitSpan.textContent.trim();
        // вырезаем валюту и пробелы, оставляем число
        var numStr = txt.replace(/[^0-9.,]/g, "").replace(/\s/g, "").replace(",", ".");
        // если несколько точек (тысячи) — берём как есть после нормализации funpay (обычно одна)
        var val = parseFloat(numStr);
        if (!isNaN(val)) result.price = val;
        return result;
    }

    // =========================================================================
    //  NotificationService  (аналог NotificationService)
    // =========================================================================
    function notify(lot, rule) {
        var amountStr = (lot.amount !== null && lot.amount !== undefined) ? String(lot.amount) : "Не указано";
        var title = "🎯 Найдено предложение";
        var body =
            "📦 " + lot.description + "\n" +
            "💰 " + lot.price + " " + lot.currency + "\n" +
            "📊 Кол-во: " + amountStr + "\n" +
            "👤 " + lot.seller + "\n" +
            "🔑 " + (rule.keywords || "Любые") + "\n" +
            "🔗 " + lot.public_link;
        try { fpt.app.notify(title, body); } catch (e) {}
        try { fpt.app.vibrate(300); } catch (e) {}
        try { fpt.app.log("🎯 " + lot.description + " | " + lot.price + " " + lot.currency + " | " + lot.public_link); } catch (e) {}
    }

    // =========================================================================
    //  ScannerWorker  (аналог ScannerWorker._run_loop)
    //  Реализован как асинхронный self-rescheduling цикл, чтобы не блокировать UI.
    // =========================================================================
    var Worker = {
        _running: false,
        _busy: false,
        _queue: [],          // [{subId, rules}]
        _nextScanAt: 0,      // timestamp когда можно сканить следующую категорию

        start: function () {
            if (this._running) return;
            this._running = true;
            var self = this;
            setInterval(function () { self._tick(); }, POLL_TICK_MS);
        },

        _readyToScan: function () {
            if (!Config.isEnabled()) return false;
            if (Config.getRules().length === 0) return false;
            return true;
        },

        _groupRules: function () {
            var groups = {};
            var rules = Config.getRules();
            for (var i = 0; i < rules.length; i++) {
                var r = rules[i];
                if (!groups[r.subcategory_id]) groups[r.subcategory_id] = [];
                groups[r.subcategory_id].push(r);
            }
            return groups;
        },

        _tick: function () {
            if (this._busy) return;
            if (!this._readyToScan()) return;
            if (Date.now() < this._nextScanAt) return;

            // если очередь пуста — формируем новую итерацию сканирования
            if (this._queue.length === 0) {
                var groups = this._groupRules();
                for (var subId in groups) {
                    if (groups.hasOwnProperty(subId)) this._queue.push({ subId: subId, rules: groups[subId] });
                }
                if (this._queue.length === 0) return;
            }

            var job = this._queue.shift();
            this._busy = true;
            var self = this;
            // network вызовы синхронны в bridge, но оборачиваем, чтобы tick не зависал надолго подряд
            try {
                self._scanSubcategory(job.subId, job.rules);
            } catch (e) {
                log("scan err: " + e);
            } finally {
                self._busy = false;
                self._nextScanAt = Date.now() + Config.getDelay() * 1000;
            }
        },

        _scanSubcategory: function (subId, rules) {
            var catType = rules[0].category_type;
            var lots = (catType === 0) ? fetchCommonLots(subId) : fetchCurrencyLots(subId);

            for (var i = 0; i < lots.length; i++) {
                var lot = lots[i];
                if (Cache.isSeen(lot.id)) continue;
                this._processLot(lot, rules);
            }
        },

        _processLot: function (lot, rules) {
            for (var i = 0; i < rules.length; i++) {
                if (isMatch(lot, rules[i])) {
                    notify(lot, rules[i]);
                    Cache.markSeen(lot.id);
                    break;
                }
            }
        }
    };

    // =========================================================================
    //  Форма добавления правила (замена пошаговому telegram set_state)
    //  Храним черновик в storage, поля — UI Input'ы со stateKey.
    // =========================================================================
    var Form = {
        _read: function () {
            try { return JSON.parse(fpt.storage.get(FORM_KEY) || "{}"); } catch (e) { return {}; }
        },
        _write: function (o) {
            try { fpt.storage.set(FORM_KEY, JSON.stringify(o)); } catch (e) {}
        },
        reset: function () {
            this._write({ cat_type: 0, cat_id: "", keywords: "", max_price: "", min_amount: "1" });
            // также очищаем UI-стейт полей
            fpt.ui.setState("snp_cat", "");
            fpt.ui.setState("snp_kw", "");
            fpt.ui.setState("snp_price", "");
            fpt.ui.setState("snp_amount", "1");
        },
        get: function () { return this._read(); },
        set: function (patch) {
            var o = this._read();
            for (var k in patch) if (patch.hasOwnProperty(k)) o[k] = patch[k];
            this._write(o);
        }
    };

    // Извлечение id категории из ссылки или числа (как _process_category_input)
    function extractCatId(text) {
        text = (text || "").trim();
        if (text.indexOf("funpay.com/lots/") !== -1) {
            try { return text.split("/lots/")[1].split("/")[0]; } catch (e) {}
        }
        if (text.indexOf("funpay.com/chips/") !== -1) {
            try { return text.split("/chips/")[1].split("/")[0]; } catch (e) {}
        }
        if (/^\d+$/.test(text)) return text;
        return "";
    }

    // =========================================================================
    //  UI  (аналог UserInterfaceProvider + telegram-меню)
    //  Рисуем через fpt.ui.setSlot деревом нод.
    // =========================================================================

    // глобальные колбэки, которые дёргают кнопки/инпуты UI
    var G = (typeof window !== "undefined") ? window : this;
    G.__snp = {
        toggleEnabled: function () {
            Config.setEnabled(!Config.isEnabled());
            UI.render();
        },
        addDelay: function (delta) {
            var d = Config.getDelay() + delta;
            if (d < 1) d = 1;
            Config.setDelay(d);
            UI.render();
        },
        openAdd: function (catType) {
            Form.reset();
            Form.set({ cat_type: catType });
            UI.view = "add";
            UI.render();
        },
        openList: function () { UI.view = "list"; UI.render(); },
        openMain: function () { UI.view = "main"; UI.render(); },
        delRule: function (idx) { Config.removeRuleByIndex(idx); UI.render(); },
        saveRule: function () {
            // читаем значения из UI-стейта
            var catRaw = fpt.ui.getState("snp_cat");
            var kw = fpt.ui.getState("snp_kw");
            var priceRaw = fpt.ui.getState("snp_price");
            var amountRaw = fpt.ui.getState("snp_amount");

            var f = Form.get();
            var catId = extractCatId(catRaw);
            if (!/^\d+$/.test(catId)) { fpt.app.toast("❌ Неверный ID категории (нужны цифры)"); return; }

            var price = parseFloat(String(priceRaw).replace(",", "."));
            if (isNaN(price)) { fpt.app.toast("❌ Неверная макс. цена"); return; }

            var amount = parseInt(String(amountRaw).trim(), 10);
            if (isNaN(amount) || amount < 0) amount = 0;

            if (kw === "-") kw = "";

            Config.addRule({
                subcategory_id: catId,
                category_type: f.cat_type || 0,
                keywords: kw || "",
                max_price: price,
                min_amount: amount
            });
            fpt.app.toast("✅ Правило добавлено");
            Form.reset();
            UI.view = "main";
            UI.render();
        }
    };

    var UI = {
        view: "main",

        render: function () {
            var node;
            if (this.view === "add") node = this._addView();
            else if (this.view === "list") node = this._listView();
            else node = this._mainView();
            try { fpt.ui.setSlot(SLOT, node); } catch (e) { log("ui err: " + e); }
        },

        _mainView: function () {
            var status = Config.isEnabled() ? "✅ ВКЛ" : "🔴 ВЫКЛ";
            return {
                type: "Column", children: [
                    { type: "Text", text: "🔫 unique's sniper", bold: true, fontSize: 18 },
                    { type: "Text", text: "Поиск дешёвых лотов на рынке.", fontSize: 12, color: "#999999" },
                    { type: "Spacer", size: 10 },
                    { type: "Row", children: [
                        { type: "Text", text: "Статус: " + status, bold: true },
                        { type: "Button", text: "Переключить", onClick: "window.__snp.toggleEnabled()" }
                    ]},
                    { type: "Row", children: [
                        { type: "Text", text: "Задержка: " + Config.getDelay() + " сек" },
                        { type: "Button", text: "-5", onClick: "window.__snp.addDelay(-5)" },
                        { type: "Button", text: "+5", onClick: "window.__snp.addDelay(5)" }
                    ]},
                    { type: "Divider" },
                    { type: "Button", text: "🛍 + правило (Лоты)", onClick: "window.__snp.openAdd(0)" },
                    { type: "Button", text: "💰 + правило (Вирты/валюта)", onClick: "window.__snp.openAdd(1)" },
                    { type: "Spacer", size: 6 },
                    { type: "Button", text: "📋 Список правил (" + Config.getRules().length + ")", onClick: "window.__snp.openList()" }
                ]
            };
        },

        _addView: function () {
            var f = Form.get();
            var isCur = (f.cat_type === 1);
            var kwLabel = isCur ? "Сервер/сторона/платформа (через запятую, или -)"
                                : "Ключевые слова (через запятую, или -)";
            var example = isCur ? "Пример ссылки: funpay.com/chips/123/"
                                : "Пример ссылки: funpay.com/lots/123/";
            return {
                type: "Column", children: [
                    { type: "Text", text: isCur ? "💰 Новое правило (Вирты)" : "🛍 Новое правило (Лоты)", bold: true, fontSize: 16 },
                    { type: "Text", text: example, fontSize: 11, color: "#999999" },
                    { type: "Spacer", size: 8 },
                    { type: "Input", label: "ID категории или ссылка", stateKey: "snp_cat", singleLine: true },
                    { type: "Input", label: kwLabel, stateKey: "snp_kw", singleLine: true },
                    { type: "Input", label: "Макс. цена за 1 шт", stateKey: "snp_price", singleLine: true },
                    { type: "Input", label: "Мин. количество в лоте (0 = любое)", stateKey: "snp_amount", singleLine: true },
                    { type: "Spacer", size: 8 },
                    { type: "Row", children: [
                        { type: "Button", text: "💾 Сохранить", onClick: "window.__snp.saveRule()" },
                        { type: "Button", text: "🔙 Назад", onClick: "window.__snp.openMain()" }
                    ]}
                ]
            };
        },

        _listView: function () {
            var rules = Config.getRules();
            var children = [{ type: "Text", text: "📋 Правила поиска", bold: true, fontSize: 16 }];
            if (rules.length === 0) {
                children.push({ type: "Text", text: "Список пуст.", color: "#999999" });
            } else {
                for (var i = 0; i < rules.length; i++) {
                    var r = rules[i];
                    var kw = r.keywords && r.keywords !== "-" ? r.keywords : "Любые";
                    if (kw.length > 18) kw = kw.slice(0, 18) + "..";
                    var typeStr = r.category_type === 0 ? "ЛОТЫ" : "ВИРТЫ";
                    var label = "[" + typeStr + "] кат." + r.subcategory_id + " | " + kw + " | до " + r.max_price;
                    children.push({ type: "Row", children: [
                        { type: "Text", text: label, fontSize: 12 },
                        { type: "Button", text: "🗑", onClick: "window.__snp.delRule(" + i + ")" }
                    ]});
                }
            }
            children.push({ type: "Spacer", size: 8 });
            children.push({ type: "Button", text: "🔙 Назад", onClick: "window.__snp.openMain()" });
            return { type: "Column", children: children };
        }
    };

    // =========================================================================
    //  init  (аналог MarketSniperSystem.initialize + init_plugin)
    // =========================================================================
    function init() {
        Config.load();
        Cache.load();
        UI.view = "main";
        UI.render();
        Worker.start();
        log("инициализирован, правил: " + Config.getRules().length);
    }

    init();
})();
