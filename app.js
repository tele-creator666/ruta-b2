(() => {
  if (navigator.userAgent.includes("RutaB2Mac")) document.documentElement.classList.add("is-macos-app");
  const BASE_GROUPS = window.CARD_GROUPS || [];
  const START_DATE = "2026-10-20";
  const INTERVALS = [1, 2, 4, 7, 15, 30, 60];
  const STORAGE_KEY = "ruta-b2-progress-v1";
  const DEFAULT_THEME = "我的搭配";
  const PREPOSITION_SOURCE = "\\b(contra|sobre|para|por|con|entre|desde|hasta|hacia|sin|de|del|en|a|al)\\b";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const ICON_EDIT = '<svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg>';
  const ICON_TRASH = '<svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg>';

  const BASE_CARDS = (() => {
    const raw = BASE_GROUPS.flatMap((group) => group.cards.map((card, index) => ({
      ...card,
      theme: group.theme,
      sourceDay: group.day,
      sourceOrder: (group.day - 1) * 10 + index,
      builtin: true
    })));
    return seededShuffle(raw, hashString("ruta-b2-curriculum-v3")).map((card, index) => ({
      ...card,
      day: Math.floor(index / 10) + 1,
      order: index
    }));
  })();
  const BASE_IDS = new Set(BASE_CARDS.map((card) => card.id));

  const defaultState = () => ({
    version: 3,
    settings: { dailyLimit: 10, sound: true },
    cards: {},
    activity: {},
    rounds: {},
    customCards: [],
    edits: {},
    hiddenCards: []
  });

  let state = loadState();
  let allCards = [];
  let cardById = new Map();
  let TOTAL_CARDS = 0;
  let selectedDate = localDate();
  let session = [];
  let sessionIndex = 0;
  let sessionEndPlayed = false;
  let waitingForContinue = false;
  let editingCardId = null;
  let toastTimer = null;

  buildCatalog();

  /* ---------- persistence ---------- */

  function loadState() {
    try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); }
    catch { return defaultState(); }
  }

  function normalizeState(raw) {
    const base = defaultState();
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const merged = { ...base, ...source };
    merged.version = 3;
    merged.settings = { ...base.settings, ...(source.settings && typeof source.settings === "object" ? source.settings : {}) };
    merged.settings.dailyLimit = clampLimit(merged.settings.dailyLimit);
    merged.settings.sound = merged.settings.sound !== false;
    merged.cards = source.cards && typeof source.cards === "object" && !Array.isArray(source.cards) ? source.cards : {};
    merged.activity = source.activity && typeof source.activity === "object" && !Array.isArray(source.activity) ? source.activity : {};
    merged.rounds = source.rounds && typeof source.rounds === "object" && !Array.isArray(source.rounds) ? source.rounds : {};
    merged.edits = source.edits && typeof source.edits === "object" && !Array.isArray(source.edits) ? source.edits : {};
    merged.hiddenCards = Array.isArray(source.hiddenCards)
      ? [...new Set(source.hiddenCards.filter((id) => typeof id === "string"))]
      : [];
    const seenIds = new Set();
    merged.customCards = (Array.isArray(source.customCards) ? source.customCards : [])
      .map(normalizeCustomCard)
      .filter((card) => {
        if (!card || seenIds.has(card.id)) return false;
        seenIds.add(card.id);
        return true;
      });
    return merged;
  }

  function normalizeCustomCard(card) {
    if (!card || typeof card !== "object" || !card.pattern || !card.meaning) return null;
    return {
      id: typeof card.id === "string" && card.id ? card.id : newCardId(),
      pattern: String(card.pattern).trim(),
      meaning: String(card.meaning).trim(),
      example: String(card.example || "").trim(),
      exampleZh: String(card.exampleZh || "").trim(),
      theme: String(card.theme || DEFAULT_THEME).trim() || DEFAULT_THEME,
      createdAt: card.createdAt || new Date().toISOString()
    };
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { console.warn("无法保存学习进度", error); }
  }

  function buildCatalog() {
    const hidden = new Set(state.hiddenCards);
    const base = BASE_CARDS
      .filter((card) => !hidden.has(card.id))
      .map((card) => {
        const edit = state.edits[card.id];
        if (!edit) return { ...card };
        return {
          ...card,
          pattern: edit.pattern ?? card.pattern,
          meaning: edit.meaning ?? card.meaning,
          example: edit.example ?? card.example,
          exampleZh: edit.exampleZh ?? card.exampleZh,
          theme: edit.theme || card.theme
        };
      });
    const custom = state.customCards
      .filter((card) => !hidden.has(card.id))
      .map((card, index) => ({
        ...card,
        builtin: false,
        custom: true,
        theme: card.theme || DEFAULT_THEME,
        sourceDay: null,
        day: null,
        order: 1_000_000 + index
      }));
    allCards = [...custom, ...base];
    cardById = new Map(allCards.map((card) => [card.id, card]));
    TOTAL_CARDS = allCards.length;
  }

  function clampLimit(value) {
    return Math.max(1, Math.min(100, Math.round(Number(value) || 10)));
  }

  function newCardId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return `custom-${window.crypto.randomUUID()}`;
    return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /* ---------- utilities ---------- */

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }

  function seededShuffle(items, seed) {
    const result = [...items]; let value = seed >>> 0;
    const random = () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = result.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }

  function localDate(date = new Date()) {
    const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, "0"); const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDays(dateString, amount) {
    const date = new Date(`${dateString}T12:00:00`); date.setDate(date.getDate() + amount); return localDate(date);
  }

  function daysBetween(a, b) { return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000); }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toast(message, tone = "default") {
    const el = $("#toast");
    el.textContent = message;
    el.className = `toast show ${tone}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, 2800);
  }

  function downloadBlob(filename, content, type = "application/json") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- cards & scheduling ---------- */

  function record(card) { return state.cards[card.id]; }
  function releaseDate(card) {
    if (card.custom) return START_DATE;
    const limit = clampLimit(state.settings.dailyLimit);
    return addDays(START_DATE, Math.floor(card.order / limit));
  }
  function isAvailable(card) { return card.custom || releaseDate(card) <= selectedDate; }
  function statusOf(card) { const entry = record(card); if (!entry) return "new"; return entry.stage >= 4 ? "mastered" : "learning"; }
  function dueCards() {
    const due = allCards.filter((card) => { const entry = record(card); return entry && entry.due <= selectedDate; });
    return seededShuffle(due, hashString(`reviews-${selectedDate}`));
  }
  function newCards() {
    const learnedToday = Number(state.activity[selectedDate]?.new) || 0;
    const remaining = Math.max(0, clampLimit(state.settings.dailyLimit) - learnedToday);
    if (!remaining) return [];
    return allCards.filter((card) => !record(card) && isAvailable(card)).slice(0, remaining);
  }

  function patternExists(pattern, excludeId = null) {
    const key = normalizePhrase(pattern);
    if (!key) return false;
    return [...allCards, ...BASE_CARDS, ...state.customCards]
      .some((card) => card.id !== excludeId && normalizePhrase(card.pattern) === key);
  }

  function buildSession() {
    const savedRounds = state.rounds[selectedDate] || {};
    const reviews = dueCards().map((card) => ({ card, type: "review", round: savedRounds[card.id]?.round || 1 }));
    const fresh = newCards().map((card) => ({ card, type: "new", round: savedRounds[card.id]?.round || 1 }));
    const included = new Set([...reviews, ...fresh].map((item) => item.card.id));
    Object.entries(savedRounds).forEach(([id, saved]) => {
      if (included.has(id)) return;
      const card = cardById.get(id);
      if (card) fresh.push({ card, type: saved.type || "new", round: saved.round || 1 });
    });
    const mixed = []; let r = 0; let n = 0;
    while (r < reviews.length || n < fresh.length) {
      if (r < reviews.length) mixed.push(reviews[r++]);
      if (r < reviews.length) mixed.push(reviews[r++]);
      if (n < fresh.length) mixed.push(fresh[n++]);
    }
    return seededShuffle(mixed, hashString(`session-${selectedDate}`));
  }

  function prepositionRegex() { return new RegExp(PREPOSITION_SOURCE, "gi"); }

  function cloze(pattern) {
    return pattern.replace(prepositionRegex(), "___");
  }

  function expectedPrepositions(pattern) {
    return (pattern.match(prepositionRegex()) || []).map((x) => x.toLowerCase()).join(" ");
  }

  function roundTwoChallenge(card) {
    const prepositions = expectedPrepositions(card.pattern);
    if (prepositions) return { prompt: cloze(card.pattern), expected: prepositions, prepositions: true };
    const stopWords = new Set(["algo", "alguien", "alguna", "alguno", "mismo", "misma", "sea", "como", "para", "que", "una", "uno", "las", "los", "del", "con", "por", "sin", "más"]);
    const words = card.pattern.match(/[a-záéíóúüñ]+/gi) || [];
    const keyword = [...words].reverse().find((word) => word.length > 2 && !stopWords.has(word.toLowerCase())) || words.at(-1) || card.pattern;
    return { prompt: card.pattern.replace(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "___"), expected: normalizePhrase(keyword), prepositions: false };
  }

  function normalizePrepositions(value) {
    const found = String(value).toLowerCase().match(/\b(contra|sobre|para|por|con|entre|desde|hasta|hacia|sin|de|del|en|a|al)\b/g);
    return found ? found.join(" ") : String(value).toLowerCase().trim().replace(/[,/、·…]+/g, " ").replace(/\s+/g, " ");
  }

  function normalizePhrase(value) {
    return String(value).normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  /* ---------- sound ---------- */

  const sfx = {
    ctx: null,
    enabled() { return state.settings.sound !== false; },
    ensure() {
      if (!this.enabled()) return null;
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return null;
        if (!this.ctx) this.ctx = new Context();
        if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
        return this.ctx;
      } catch { return null; }
    },
    tone(freq, offset, duration, options = {}) {
      const ctx = this.ctx;
      if (!ctx) return;
      const type = options.type || "sine";
      const gainValue = options.gain ?? 0.045;
      const when = ctx.currentTime + offset;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(freq, when);
      if (options.slideTo) oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, when + duration);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(when);
      oscillator.stop(when + duration + 0.03);
    },
    advance() {
      if (!this.ensure()) return;
      this.tone(880, 0.01, 0.09, { type: "sine", gain: 0.022 });
    },
    correct() {
      if (!this.ensure()) return;
      this.tone(293.66, 0.01, 0.24, { type: "sine", gain: 0.022 });
      this.tone(587.33, 0.01, 0.2, { type: "triangle", gain: 0.04 });
      this.tone(880, 0.1, 0.32, { type: "sine", gain: 0.038 });
    },
    wrong() {
      if (!this.ensure()) return;
      this.tone(196, 0.01, 0.22, { type: "triangle", gain: 0.032, slideTo: 174.61 });
      this.tone(146.83, 0.13, 0.3, { type: "sine", gain: 0.026 });
    },
    complete() {
      if (!this.ensure()) return;
      this.tone(261.63, 0.01, 0.5, { type: "sine", gain: 0.02 });
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        this.tone(freq, 0.02 + index * 0.1, index === 3 ? 0.5 : 0.22, { type: index === 3 ? "sine" : "triangle", gain: index === 3 ? 0.04 : 0.032 });
      });
    }
  };

  function playFeedback(kind) {
    if (!sfx.enabled() || !sfx.ensure()) return;
    if (kind === "correct") sfx.correct();
    else if (kind === "wrong") sfx.wrong();
    else if (kind === "complete") sfx.complete();
    else if (kind === "advance") sfx.advance();
    if (navigator.vibrate) navigator.vibrate(kind === "wrong" ? [12, 40, 12] : 8);
  }

  function syncSoundUI() {
    const enabled = state.settings.sound !== false;
    const toggle = $("#soundToggle");
    toggle.classList.toggle("is-muted", !enabled);
    toggle.setAttribute("aria-pressed", String(enabled));
    const label = enabled ? "提示音：开" : "提示音：关";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    $("#soundSetting").checked = enabled;
  }

  function setSoundEnabled(enabled, options = {}) {
    const next = Boolean(enabled);
    const changed = state.settings.sound !== next;
    state.settings.sound = next;
    saveState();
    syncSoundUI();
    if (next && changed) {
      sfx.ensure();
      sfx.correct();
    }
    if (!options.silent && changed) toast(next ? "提示音已开启" : "提示音已关闭", next ? "success" : "default");
  }

  /* ---------- dashboard ---------- */

  function renderDashboard() {
    const due = dueCards(); const fresh = newCards();
    const seen = allCards.filter((card) => record(card)).length;
    const dailyLimit = clampLimit(state.settings.dailyLimit);
    const planDays = Math.max(1, Math.ceil(TOTAL_CARDS / dailyLimit));
    const mastered = allCards.filter((card) => statusOf(card) === "mastered").length;
    const percent = TOTAL_CARDS ? Math.round((seen / TOTAL_CARDS) * 100) : 0;

    $("#dueCount").textContent = due.length;
    $("#newCount").textContent = fresh.length;
    $("#seenCount").textContent = seen;
    $("#masteredCount").textContent = mastered;
    $("#heroDaily").textContent = dailyLimit;
    $("#heroTotal").textContent = TOTAL_CARDS;
    $("#dailyLimitSummary").textContent = `每天最多 ${dailyLimit} 个`;
    $("#totalCount").textContent = `共 ${TOTAL_CARDS} 个`;
    $("#planLength").textContent = `${planDays}-DAY PLAN`;
    $("#progressText").textContent = `${percent}%`;
    $("#progressFraction").textContent = `${seen} / ${TOTAL_CARDS}`;
    $("#progressBar").style.width = `${percent}%`;
    $("#progressTrack").setAttribute("aria-valuenow", String(percent));
    $("#milestones").innerHTML = [0, 0.2, 0.4, 0.6, 0.8, 1]
      .map((ratio) => { const value = Math.round(TOTAL_CARDS * ratio); return `<span title="${value} 个">${value}</span>`; })
      .join("");

    const total = due.length + fresh.length;
    $("#sessionTotal").textContent = `${total} 张`;
    $("#sessionSummary").textContent = total
      ? `系统已混合 ${due.length} 个到期复习词和 ${fresh.length} 个新词；每个词需通过三轮。`
      : "今天没有到期任务，可以查看词库或选择其他日期。";
    $("#mixPreview").innerHTML = `${due.length ? `<span class="review">复习 ${due.length}</span>` : ""}${fresh.length ? `<span class="new">新学 ${fresh.length}</span>` : ""}` || `<span class="done-chip">任务已完成</span>`;
    $("#sessionEta").textContent = total ? `约 ${Math.max(1, Math.round(total * 0.35))} 分钟` : "";
    $("#startSession").disabled = total === 0;
    $("#startSession span").textContent = total ? "开始今日学习" : "今日任务已完成";

    const day = daysBetween(START_DATE, selectedDate) + 1;
    if (TOTAL_CARDS === 0) {
      $("#heroCopy").textContent = "词库还是空的，先去词库页添加几个搭配吧。";
    } else if (day < 1) {
      $("#heroCopy").textContent = "计划尚未开始，你可以先浏览完整词库。";
    } else if (day <= planDays) {
      $("#heroCopy").textContent = `计划第 ${day} 天：先复习到期卡片，再加入今天的新搭配。`;
    } else {
      $("#heroCopy").textContent = "新卡计划已完成，继续按记忆间隔复习。";
    }
    $("#dateHint").textContent = `${selectedDate === localDate() ? "今天 · " : ""}${day >= 1 ? `计划第 ${day} 天` : "计划开始前"}`;
    $("#goToday").hidden = selectedDate === localDate();

    $("#libraryTotal").textContent = `${TOTAL_CARDS} EXPRESIONES`;
    renderSettingsMeta();
  }

  function renderSettingsMeta() {
    $("#dailyLimit").value = clampLimit(state.settings.dailyLimit);
    $("#vocabBuiltin").textContent = BASE_CARDS.length;
    $("#vocabCustom").textContent = state.customCards.length;
    $("#vocabHidden").textContent = state.hiddenCards.length;
    $("#clearCustom").disabled = state.customCards.length === 0;
    $("#restoreVocabulary").disabled = state.hiddenCards.length === 0 && Object.keys(state.edits).length === 0;
    syncSoundUI();
  }

  /* ---------- library ---------- */

  function renderThemeOptions() {
    const themes = [...new Set(allCards.map((card) => card.theme).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"));
    const filter = $("#themeFilter");
    const current = filter.value || "all";
    filter.innerHTML = `<option value="all">全部主题</option>${themes.map((theme) => `<option value="${escapeHtml(theme)}">${escapeHtml(theme)}</option>`).join("")}`;
    filter.value = current === "all" || themes.includes(current) ? current : "all";
    $("#themeOptions").innerHTML = themes.map((theme) => `<option value="${escapeHtml(theme)}"></option>`).join("");
  }

  function renderLibrary() {
    const query = $("#searchInput").value.trim().toLowerCase();
    const filter = $("#statusFilter").value;
    const theme = $("#themeFilter").value;
    const matches = allCards.filter((card) => {
      const status = statusOf(card);
      const text = `${card.pattern} ${card.meaning} ${card.example} ${card.exampleZh || ""} ${card.theme}`.toLowerCase();
      return (!query || text.includes(query)) && (filter === "all" || filter === status) && (theme === "all" || card.theme === theme);
    });

    $("#libraryGrid").innerHTML = matches.map((card) => {
      const status = statusOf(card);
      const label = status === "new" ? "未学习" : status === "mastered" ? "已掌握" : "学习中";
      return `<article class="library-card${card.custom ? " custom" : ""}">
        <div class="library-card-head">
          <div class="library-card-main"><h3>${escapeHtml(card.pattern)}</h3><p class="meaning">${escapeHtml(card.meaning)}</p></div>
          <span class="tag ${status}">${label}</span>
        </div>
        ${card.example ? `<p class="example">${escapeHtml(card.example)}</p>` : ""}
        ${card.exampleZh ? `<p class="example-translation">${escapeHtml(card.exampleZh)}</p>` : ""}
        <div class="library-card-foot">
          <span class="theme-tag" title="${escapeHtml(card.theme)}">${escapeHtml(card.theme)}</span>
          ${card.custom ? '<span class="custom-badge">自定义</span>' : ""}
          <div class="card-actions">
            <button type="button" class="icon-action" data-edit="${escapeHtml(card.id)}" aria-label="编辑 ${escapeHtml(card.pattern)}" title="编辑">${ICON_EDIT}</button>
            <button type="button" class="icon-action danger" data-delete="${escapeHtml(card.id)}" aria-label="删除 ${escapeHtml(card.pattern)}" title="删除">${ICON_TRASH}</button>
          </div>
        </div>
      </article>`;
    }).join("");

    const hiddenCount = state.hiddenCards.length;
    const customCount = state.customCards.length;
    $("#librarySummary").textContent = `共 ${TOTAL_CARDS} 个搭配 · ${customCount} 个自定义${hiddenCount ? ` · ${hiddenCount} 个已隐藏` : ""}`;
    $("#libraryMatches").textContent = `显示 ${matches.length} / ${TOTAL_CARDS} 个搭配`;
    $("#clearFilters").hidden = !(query || filter !== "all" || theme !== "all");
    const restore = $("#restoreHidden");
    restore.hidden = hiddenCount === 0;
    restore.textContent = `恢复已隐藏的 ${hiddenCount} 个搭配`;

    const empty = matches.length === 0;
    $("#libraryGrid").hidden = empty;
    $("#emptyLibrary").hidden = !empty;
    if (empty) {
      $("#emptyTitle").textContent = TOTAL_CARDS ? "没有找到符合条件的搭配" : "词库还是空的";
      $("#emptyCopy").textContent = TOTAL_CARDS ? "换一个关键词，或清除当前的筛选条件。" : "添加第一个搭配，开始建立自己的西语词库。";
      $("#emptyClear").hidden = !TOTAL_CARDS;
      $("#emptyClear").textContent = query || filter !== "all" || theme !== "all" ? "清除筛选" : "查看全部";
    }
  }

  function clearFilters() {
    $("#searchInput").value = "";
    $("#statusFilter").value = "all";
    $("#themeFilter").value = "all";
    renderLibrary();
  }

  /* ---------- view / cards ---------- */

  function showView(name) {
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === name));
    $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    if (name === "library") renderLibrary();
    if (name === "settings") renderSettingsMeta();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openCardForm(cardId = null) {
    editingCardId = cardId || null;
    const card = cardId ? cardById.get(cardId) : null;
    $("#cardForm").reset();
    $("#formError").hidden = true;
    $("#formError").textContent = "";
    renderThemeOptions();
    if (card) {
      $("#cardDialogEyebrow").textContent = card.custom ? "EXPRESIÓN PROPIA" : "EDITAR EXPRESIÓN";
      $("#cardDialogTitle").textContent = "编辑搭配";
      $("#fieldPattern").value = card.pattern;
      $("#fieldMeaning").value = card.meaning;
      $("#fieldExample").value = card.example || "";
      $("#fieldExampleZh").value = card.exampleZh || "";
      $("#fieldTheme").value = card.theme || "";
      $("#deleteCardButton").textContent = card.custom ? "删除搭配" : "隐藏搭配";
      $("#deleteCardButton").hidden = false;
    } else {
      $("#cardDialogEyebrow").textContent = "NUEVA EXPRESIÓN";
      $("#cardDialogTitle").textContent = "添加搭配";
      $("#fieldTheme").value = $("#themeFilter").value !== "all" ? $("#themeFilter").value : "";
      $("#deleteCardButton").hidden = true;
    }
    const dialog = $("#cardDialog");
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => { $("#fieldPattern").focus(); $("#fieldPattern").select(); });
  }

  function closeCardForm() {
    const dialog = $("#cardDialog");
    if (dialog.open) dialog.close();
    editingCardId = null;
  }

  function showFormError(message) {
    const error = $("#formError");
    error.textContent = message;
    error.hidden = false;
  }

  function submitCardForm(event) {
    event.preventDefault();
    const pattern = $("#fieldPattern").value.trim().replace(/\s+/g, " ");
    const meaning = $("#fieldMeaning").value.trim();
    const example = $("#fieldExample").value.trim();
    const exampleZh = $("#fieldExampleZh").value.trim();
    const theme = $("#fieldTheme").value.trim() || DEFAULT_THEME;

    if (!pattern || !meaning) {
      showFormError("请填写西语固定搭配和中文释义。");
      (!pattern ? $("#fieldPattern") : $("#fieldMeaning")).focus();
      return;
    }
    const duplicate = patternExists(pattern, editingCardId);
    if (duplicate) {
      showFormError(`词库中已经有「${pattern}」了，换一个写法吧。`);
      $("#fieldPattern").focus();
      return;
    }

    const values = { pattern, meaning, example, exampleZh, theme };
    if (editingCardId) {
      if (BASE_IDS.has(editingCardId)) {
        state.edits[editingCardId] = { ...(state.edits[editingCardId] || {}), ...values };
      } else {
        const index = state.customCards.findIndex((card) => card.id === editingCardId);
        if (index === -1) return;
        state.customCards[index] = { ...state.customCards[index], ...values };
      }
      toast("搭配已更新", "success");
    } else {
      state.customCards.push({ id: newCardId(), ...values, createdAt: new Date().toISOString() });
      const remainingToday = clampLimit(state.settings.dailyLimit) - (Number(state.activity[selectedDate]?.new) || 0);
      toast(remainingToday > 0 ? "已添加搭配，会优先进入新卡队列" : "已添加搭配，会在下一个学习日优先出现", "success");
    }
    saveState();
    buildCatalog();
    renderThemeOptions();
    renderLibrary();
    renderDashboard();
    $("#cardDialog").close();
    editingCardId = null;
  }

  async function requestDeleteCard(cardId) {
    const card = cardById.get(cardId);
    if (!card) return;
    const isCustom = Boolean(card.custom);
    const ok = await askConfirm({
      title: isCustom ? "删除这个自定义搭配？" : "隐藏这个内置搭配？",
      message: isCustom
        ? `「${card.pattern}」将从词库和今日队列中删除，学习记录也会一并移除。此操作无法撤销。`
        : `「${card.pattern}」将从词库和今日队列中隐藏，学习进度会保留。之后可以在设置中恢复内置词库。`,
      confirmLabel: isCustom ? "删除搭配" : "隐藏搭配",
      danger: true
    });
    if (!ok) return;
    if (isCustom) {
      state.customCards = state.customCards.filter((item) => item.id !== cardId);
      delete state.cards[cardId];
    } else if (!state.hiddenCards.includes(cardId)) {
      state.hiddenCards.push(cardId);
    }
    Object.keys(state.rounds).forEach((date) => { if (state.rounds[date]) delete state.rounds[date][cardId]; });
    saveState();
    buildCatalog();
    renderThemeOptions();
    renderLibrary();
    renderDashboard();
    toast(isCustom ? "自定义搭配已删除" : "搭配已隐藏", "success");
  }

  async function restoreHiddenCards() {
    const count = state.hiddenCards.length;
    if (!count) return;
    const ok = await askConfirm({
      title: "恢复已隐藏的搭配？",
      message: `将恢复 ${count} 个被隐藏的内置搭配，它们会重新回到词库和新卡队列。`,
      confirmLabel: "恢复搭配"
    });
    if (!ok) return;
    state.hiddenCards = [];
    saveState();
    buildCatalog();
    renderThemeOptions();
    renderLibrary();
    renderDashboard();
    toast(`已恢复 ${count} 个搭配`, "success");
  }

  async function restoreBuiltinVocabulary() {
    const changed = state.hiddenCards.length + Object.keys(state.edits).length;
    if (!changed) { toast("内置词库已经是默认状态"); return; }
    const ok = await askConfirm({
      title: "恢复内置词库？",
      message: "将取消对内置搭配的所有修改，并恢复被隐藏的搭配。自定义搭配和学习进度不受影响。",
      confirmLabel: "恢复默认"
    });
    if (!ok) return;
    state.edits = {};
    state.hiddenCards = [];
    saveState();
    buildCatalog();
    renderThemeOptions();
    renderLibrary();
    renderDashboard();
    toast("内置词库已恢复", "success");
  }

  async function clearCustomCards() {
    if (!state.customCards.length) { toast("还没有自定义搭配"); return; }
    const count = state.customCards.length;
    const ok = await askConfirm({
      title: "清空全部自定义搭配？",
      message: `将删除全部 ${count} 个自定义搭配及对应的学习记录。内置词库和内置搭配的进度不会受影响。此操作无法撤销。`,
      confirmLabel: "清空自定义",
      danger: true
    });
    if (!ok) return;
    const ids = new Set(state.customCards.map((card) => card.id));
    state.customCards = [];
    state.hiddenCards = state.hiddenCards.filter((id) => !ids.has(id));
    ids.forEach((id) => { delete state.cards[id]; });
    Object.keys(state.rounds).forEach((date) => {
      if (!state.rounds[date]) return;
      ids.forEach((id) => { delete state.rounds[date][id]; });
    });
    saveState();
    buildCatalog();
    renderThemeOptions();
    renderLibrary();
    renderDashboard();
    toast(`已清空 ${count} 个自定义搭配`, "success");
  }

  /* ---------- confirm ---------- */

  function askConfirm({ title, message, confirmLabel = "确认", danger = false }) {
    const dialog = $("#confirmDialog");
    if (!dialog) return Promise.resolve(window.confirm(message));
    return new Promise((resolve) => {
      if (dialog.open) { resolve(false); return; }
      const okButton = $("#confirmOk");
      const cancelButton = $("#confirmCancel");
      $("#confirmTitle").textContent = title;
      $("#confirmMessage").textContent = message;
      okButton.textContent = confirmLabel;
      okButton.className = danger ? "danger-btn" : "primary-btn";
      const mark = $("#confirmMark");
      mark.className = `confirm-mark${danger ? " danger" : ""}`;
      mark.textContent = danger ? "!" : "?";

      const cleanup = () => {
        okButton.removeEventListener("click", onOk);
        cancelButton.removeEventListener("click", onCancel);
        dialog.removeEventListener("close", onClose);
      };
      const finish = (value) => {
        cleanup();
        if (dialog.open) dialog.close();
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onClose = () => finish(false);
      okButton.addEventListener("click", onOk);
      cancelButton.addEventListener("click", onCancel);
      dialog.addEventListener("close", onClose);
      dialog.showModal();
      setTimeout(() => okButton.focus(), 0);
    });
  }

  /* ---------- study session ---------- */

  function startSession() {
    session = buildSession();
    sessionIndex = 0;
    sessionEndPlayed = false;
    if (!session.length) { toast("今天没有待学习的卡片"); return; }
    $("#sessionDone").hidden = true;
    $("#studyDialog").showModal();
    renderSessionCard();
  }

  function renderSessionCard() {
    if (sessionIndex >= session.length) {
      $("#flashcard").hidden = true;
      $("#sessionDone").hidden = false;
      $("#dialogProgress").style.width = "100%";
      $("#sessionLabel").textContent = "今日学习完成";
      renderDoneSummary();
      if (!sessionEndPlayed) { sessionEndPlayed = true; playFeedback("complete"); }
      renderDashboard();
      return;
    }

    $("#flashcard").hidden = false;
    $("#sessionDone").hidden = true;
    $("#recognitionActions").hidden = true;
    $("#typingForm").hidden = true;
    $("#feedbackArea").hidden = true;
    $("#feedbackArea").classList.remove("correct", "wrong");
    $("#firstRoundExample").hidden = true;
    $("#roundContext").hidden = true;
    waitingForContinue = false;

    const item = session[sessionIndex];
    const card = item.card;
    $("#sessionLabel").textContent = `队列 ${sessionIndex + 1} / ${session.length}`;
    $("#dialogProgress").style.width = `${(sessionIndex / session.length) * 100}%`;
    $("#cardType").textContent = item.type === "new" ? "新搭配" : "到期复习";
    $("#cardType").className = item.type === "new" ? "meta-new" : "meta-review";
    $("#cardTheme").textContent = card.theme;

    const flashcard = $("#flashcard");
    flashcard.className = `flashcard three-round-card round-${item.round}`;
    void flashcard.offsetWidth;
    flashcard.classList.add("card-enter");
    const roundChallenge = roundTwoChallenge(card);
    $('[data-round-step="2"] em').textContent = roundChallenge.prepositions ? "介词" : "关键词";
    $$("[data-round-step]").forEach((step) => {
      const number = Number(step.dataset.roundStep);
      step.classList.toggle("active", number === item.round);
      step.classList.toggle("done", number < item.round);
    });

    $("#cardPattern").textContent = card.pattern;
    $("#cardMeaning").textContent = card.meaning;
    $("#cardExample").textContent = card.example;
    $("#cardExampleZh").textContent = card.exampleZh || card.meaning;

    if (item.round === 1) {
      $("#roundInstruction").textContent = "第一轮 · 结合例句，你认识这个固定搭配吗？";
      $("#cardPrompt").textContent = card.pattern;
      $("#roundHint").textContent = "先结合语境判断，不确定就选「不认识」。";
      $("#firstRoundExampleText").textContent = card.example || card.pattern;
      $("#firstRoundExampleZh").textContent = card.exampleZh || card.meaning;
      $("#firstRoundExample").hidden = !card.example;
      $("#recognitionActions").hidden = false;
    } else if (item.round === 2) {
      const challenge = roundChallenge;
      $("#roundInstruction").textContent = challenge.prepositions ? "第二轮 · 填写缺少的固定介词" : "第二轮 · 填写缺少的关键词";
      $("#cardPrompt").textContent = challenge.prompt;
      $("#roundHint").textContent = challenge.prepositions ? "只需填写介词；有多个介词时用空格分开。" : "补全这个固定表达中缺少的关键词。";
      $("#roundContext").textContent = card.meaning;
      $("#roundContext").hidden = false;
      $("#answerLabel").textContent = challenge.prepositions ? "介词答案" : "关键词答案";
      $("#answerInput").placeholder = challenge.prepositions ? "例如：a  或  a de" : "输入缺少的词";
      $("#typingForm").hidden = false;
    } else {
      $("#roundInstruction").textContent = "第三轮 · 根据中文完整拼写";
      $("#cardPrompt").textContent = card.meaning;
      $("#roundContext").hidden = true;
      $("#roundHint").textContent = "只检查单词拼写、顺序和重音；标点符号可以省略。";
      $("#answerLabel").textContent = "完整搭配";
      $("#answerInput").placeholder = "输入完整西语固定搭配";
      $("#typingForm").hidden = false;
    }
    $("#answerInput").value = "";
    if (!$("#typingForm").hidden) setTimeout(() => $("#answerInput").focus(), 0);
  }

  function renderDoneSummary() {
    const activity = state.activity[selectedDate] || { reviews: 0, new: 0 };
    const parts = [];
    if (activity.new) parts.push(`<span><strong>${activity.new}</strong> 个新学</span>`);
    if (activity.reviews) parts.push(`<span><strong>${activity.reviews}</strong> 个复习</span>`);
    $("#doneSummary").innerHTML = parts.join("") || "<span>保持这个节奏，明天见。</span>";
  }

  function roundState(item) {
    state.rounds[selectedDate] ||= {};
    state.rounds[selectedDate][item.card.id] ||= { round: item.round, type: item.type, failures: 0 };
    return state.rounds[selectedDate][item.card.id];
  }

  function commitRound(passed) {
    const item = session[sessionIndex];
    const saved = roundState(item);
    if (!passed) saved.failures = (saved.failures || 0) + 1;
    if (passed && item.round === 3) {
      const previous = record(item.card) || { stage: 0, reps: 0, lapses: 0 };
      const stage = Math.min((previous.stage || 0) + 1, INTERVALS.length);
      state.cards[item.card.id] = {
        stage,
        due: addDays(selectedDate, INTERVALS[Math.min(stage - 1, INTERVALS.length - 1)]),
        last: selectedDate,
        reps: (previous.reps || 0) + 1,
        lapses: (previous.lapses || 0) + (saved.failures || 0)
      };
      delete state.rounds[selectedDate][item.card.id];
      const activity = state.activity[selectedDate] || { reviews: 0, new: 0 };
      activity[item.type === "new" ? "new" : "reviews"] += 1;
      state.activity[selectedDate] = activity;
    } else {
      const nextRound = passed ? item.round + 1 : item.round;
      saved.round = nextRound;
      saved.type = item.type;
      const insertAt = Math.min(session.length, sessionIndex + 4);
      session.splice(insertAt, 0, { card: item.card, type: item.type, round: nextRound });
    }
    saveState();
  }

  function showFeedback(correct, note) {
    const area = $("#feedbackArea");
    area.hidden = false;
    area.classList.toggle("wrong", !correct);
    area.classList.toggle("correct", correct);
    $("#recognitionActions").hidden = true;
    $("#typingForm").hidden = true;
    const item = session[sessionIndex];
    $("#feedbackMark").textContent = correct ? "✓" : "×";
    $("#feedbackTitle").textContent = correct ? (item && item.round === 3 ? "三轮通过" : "答对了") : "再记一次";
    $("#feedbackNote").textContent = note;
    waitingForContinue = true;
    requestAnimationFrame(() => area.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function continueQueue() {
    if (!waitingForContinue) return;
    sessionIndex += 1;
    renderSessionCard();
  }

  function chooseRecognition(known) {
    if (waitingForContinue) return;
    if (known) {
      playFeedback("advance");
      commitRound(true);
      sessionIndex += 1;
      renderSessionCard();
    } else {
      playFeedback("wrong");
      commitRound(false);
      showFeedback(false, "这个词会隔 3 个词后再次出现，仍从认识判断开始。");
    }
  }

  function checkTypedAnswer(event) {
    event.preventDefault();
    if (waitingForContinue) return;
    const item = session[sessionIndex];
    const raw = $("#answerInput").value;
    if (!raw.trim()) { $("#answerInput").focus(); return; }
    const challenge = item.round === 2 ? roundTwoChallenge(item.card) : null;
    const expected = item.round === 2 ? challenge.expected : normalizePhrase(item.card.pattern);
    const actual = item.round === 2 ? (challenge.prepositions ? normalizePrepositions(raw) : normalizePhrase(raw)) : normalizePhrase(raw);
    const correct = actual === expected;
    playFeedback(correct ? "correct" : "wrong");
    commitRound(correct);
    const next = correct
      ? (item.round === 2 ? "隔 3 个词后进入整体拼写。" : "三轮通过，已安排下一次遗忘曲线复习。")
      : `正确答案是「${item.card.pattern}」。隔 3 个词后重复本轮。`;
    showFeedback(correct, next);
  }

  /* ---------- import / export ---------- */

  function exportProgress() {
    downloadBlob(`ruta-b2-progress-${localDate()}.json`, JSON.stringify(state, null, 2));
    toast("进度已导出", "success");
  }

  async function importProgress(file) {
    try {
      const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.cards || typeof parsed.cards !== "object" || Array.isArray(parsed.cards)) throw new Error("格式不正确");
      state = normalizeState(parsed);
      saveState();
      buildCatalog();
      renderThemeOptions();
      renderLibrary();
      renderDashboard();
      toast("进度已导入", "success");
    } catch {
      toast("无法读取这个进度文件", "error");
    } finally {
      $("#importProgress").value = "";
    }
  }

  function exportVocabulary() {
    const payload = {
      app: "Ruta B2",
      type: "ruta-b2-vocabulary",
      version: 1,
      exportedAt: new Date().toISOString(),
      cards: allCards.map((card) => ({ pattern: card.pattern, meaning: card.meaning, example: card.example, exampleZh: card.exampleZh, theme: card.theme }))
    };
    downloadBlob(`ruta-b2-vocabulario-${localDate()}.json`, JSON.stringify(payload, null, 2));
    toast("词库已导出", "success");
  }

  /* ---------- 导入预览 ---------- */

  let importDraft = { source: "", items: [] };

  const LEVEL_LABEL = { b2: "B2", easy: "入门", odd: "生僻", word: "单词", long: "整句", dup: "已收录" };

  function existingPatternKeys() {
    return new Set([...allCards, ...BASE_CARDS, ...state.customCards].map((card) => normalizePhrase(card.pattern)));
  }

  function setImportStatus(message) {
    const box = $("#importStatus");
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
  }

  function prepareDraft(items, source) {
    const known = existingPatternKeys();
    const seen = new Set();
    const merged = items.map((item) => {
      const dup = item.dup === true || known.has(item.key) || seen.has(item.key);
      seen.add(item.key);
      return { ...item, dup, checked: item.level === "b2" && !dup };
    });
    importDraft = { source, items: merged };
    renderImportList();
    $("#importDialog").showModal();
  }

  function draftVisible(item) {
    if (item.dup && !$("#importShowDup").checked) return false;
    if ($("#importOnlyB2").checked && item.level !== "b2") return false;
    return true;
  }

  function updateImportFooter() {
    const chosen = importDraft.items.filter((item) => item.checked && !item.dup).length;
    const b2 = importDraft.items.filter((item) => item.level === "b2" && !item.dup).length;
    const dup = importDraft.items.filter((item) => item.dup).length;
    $("#importSummary").textContent = `${importDraft.source}：认出 ${importDraft.items.length} 条，常见 B2 词组 ${b2} 条，词库里已有 ${dup} 条，当前勾选 ${chosen} 条。`;
    $("#importConfirm").textContent = `导入 ${chosen} 条`;
    $("#importConfirm").disabled = chosen === 0;
  }

  function renderImportList() {
    const rows = importDraft.items.filter(draftVisible);
    const list = $("#importList");
    list.innerHTML = rows.length
      ? rows.map((item) => {
          const index = importDraft.items.indexOf(item);
          const tag = item.dup ? "dup" : item.level;
          const tip = item.dup ? "词库里已经有这个搭配" : (item.why || "常见 B2 固定搭配");
          return `<label class="import-row${item.checked ? "" : " is-off"}" data-index="${index}">
            <input type="checkbox" ${item.checked ? "checked" : ""} aria-label="是否导入 ${escapeHtml(item.pattern)}">
            <span class="ir-pattern">${escapeHtml(item.pattern)}</span>
            <input class="ir-meaning" value="${escapeHtml(item.meaning)}" placeholder="补一个中文释义" aria-label="${escapeHtml(item.pattern)} 的释义">
            <span class="ir-tag ${tag}" title="${escapeHtml(tip)}">${LEVEL_LABEL[tag] || tag}</span>
          </label>`;
        }).join("")
      : '<p class="muted">这一批里没有符合条件的内容，换个筛选条件试试。</p>';
    updateImportFooter();
  }

  function downloadVocabTemplate() {
    const template = [
      "# Ruta B2 词库导入模板",
      "# 每行：西语搭配 [Tab] 中文释义，可再填写 [Tab] 西语例句 [Tab] 例句翻译 [Tab] 主题",
      "# 以 # 或 // 开头的行会被忽略；重复搭配会自动跳过。",
      "# 不按模板也行：直接粘贴乱排版笔记、表格整块复制的内容，或选择带高亮的 PDF。",
      "dar con la tecla\t找到窍门；摸清门路\tAl final di con la tecla para resolverlo.\t最后我找到了解决它的窍门。\t我的搭配",
      "ser pan comido\t小事一桩；轻而易举"
    ].join("\r\n");
    downloadBlob("ruta-b2-import-template.txt", template, "text/plain;charset=utf-8");
    toast("TXT 模板已下载", "success");
  }

  function addCustomCard(item) {
    state.customCards.push({
      id: newCardId(),
      pattern: item.pattern,
      meaning: item.meaning || "（待补充释义）",
      example: String(item.example || "").trim(),
      exampleZh: String(item.exampleZh || "").trim(),
      theme: String(item.theme || "").trim() || DEFAULT_THEME,
      createdAt: new Date().toISOString()
    });
  }

  function refreshAfterImport(count) {
    saveState();
    buildCatalog();
    renderThemeOptions();
    renderLibrary();
    renderDashboard();
    toast(`导入完成：新增 ${count} 个搭配`, "success");
  }

  function importJsonVocabulary(text) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cards) ? parsed.cards : null;
    if (!list) throw new Error("格式不正确");
    const existing = existingPatternKeys();
    let added = 0;
    list.forEach((item) => {
      if (!item || typeof item !== "object" || typeof item.pattern !== "string" || typeof item.meaning !== "string") return;
      const pattern = item.pattern.trim().replace(/\s+/g, " ");
      const meaning = item.meaning.trim();
      if (!pattern || !meaning || existing.has(normalizePhrase(pattern))) return;
      addCustomCard({ pattern, meaning, example: item.example, exampleZh: item.exampleZh, theme: item.theme });
      existing.add(normalizePhrase(pattern));
      added += 1;
    });
    if (!added) { toast("这个 JSON 里没有新搭配", "error"); return; }
    refreshAfterImport(added);
  }

  const draftTheme = () => ($("#importTheme").value || "").trim();

  function fromText(text, source) {
    const items = window.RutaImport.parseText(text, draftTheme());
    if (!items.length) {
      setImportStatus(`${source}：没认出西语搭配。可以换一种格式，或直接把内容粘到上面的框里。`);
      toast("没认出搭配内容", "error");
      return;
    }
    setImportStatus("");
    prepareDraft(items, source);
  }

  async function importVocabulary(file) {
    const name = file.name || "所选文件";
    const isPdf = /\.pdf$/i.test(name) || file.type === "application/pdf";
    try {
      if (isPdf) {
        setImportStatus(`正在读取 ${name} 的高亮标注，文件较大时请稍等…`);
        const buffer = new Uint8Array(await file.arrayBuffer());
        const result = await window.RutaImport.parsePdf(buffer, draftTheme(), {
          onProgress: (page, total) => {
            if (page % 25 !== 0 && page !== total) return;
            setImportStatus(`正在读取 ${name} 的高亮标注：第 ${page} / ${total} 页…`);
          }
        });
        if (!result.items.length) {
          setImportStatus(`${name}：${result.stats.boxes} 处标注里有 ${result.stats.empty} 处取不到文字，没有可用内容。请确认用的是高亮或下划线标注。`);
          toast("这份 PDF 里没有可提取的高亮", "error");
          return;
        }
        setImportStatus("");
        prepareDraft(result.items, `${name}（${result.stats.boxes} 处标注）`);
        return;
      }
      const raw = (await file.text()).replace(/^\uFEFF/, "");
      const trimmed = raw.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        importJsonVocabulary(trimmed);
        return;
      }
      fromText(raw, name);
    } catch (error) {
      setImportStatus(`解析失败：${error && error.message ? error.message : "文件读不了"}`);
      toast("解析失败，可以试试直接粘贴文本", "error");
    } finally {
      $("#importVocabulary").value = "";
    }
  }

  function parsePastedText() {
    const text = $("#importPaste").value;
    if (!text.trim()) { toast("先粘一些内容进来", "error"); return; }
    fromText(text, "粘贴的内容");
  }

  function commitImportSelection() {
    const chosen = importDraft.items.filter((item) => item.checked && !item.dup);
    if (!chosen.length) return;
    chosen.forEach(addCustomCard);
    $("#importDialog").close();
    importDraft = { source: "", items: [] };
    $("#importPaste").value = "";
    setImportStatus("");
    refreshAfterImport(chosen.length);
  }

  function toggleAllImportRows() {
    const rows = importDraft.items.filter((item) => draftVisible(item) && !item.dup);
    const turnOn = rows.some((item) => !item.checked);
    rows.forEach((item) => { item.checked = turnOn; });
    renderImportList();
  }

  /* ---------- events ---------- */

  function bindEvents() {
    $$("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));

    $("#studyDate").addEventListener("change", (event) => {
      selectedDate = event.target.value || localDate();
      renderDashboard();
    });
    $("#goToday").addEventListener("click", () => {
      selectedDate = localDate();
      $("#studyDate").value = selectedDate;
      renderDashboard();
    });

    $("#startSession").addEventListener("click", startSession);
    $("#knownButton").addEventListener("click", () => chooseRecognition(true));
    $("#unknownButton").addEventListener("click", () => chooseRecognition(false));
    $("#typingForm").addEventListener("submit", checkTypedAnswer);
    $("#continueButton").addEventListener("click", continueQueue);
    $("#finishSession").addEventListener("click", () => $("#studyDialog").close());
    $("#studyDialog").addEventListener("close", () => { waitingForContinue = false; renderDashboard(); });
    $$(".accent-keys button").forEach((button) => button.addEventListener("click", () => {
      const input = $("#answerInput");
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value = input.value.slice(0, start) + button.textContent + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + button.textContent.length;
      input.focus();
    }));

    $("#searchInput").addEventListener("input", renderLibrary);
    $("#statusFilter").addEventListener("change", renderLibrary);
    $("#themeFilter").addEventListener("change", renderLibrary);
    $("#clearFilters").addEventListener("click", clearFilters);
    $("#emptyClear").addEventListener("click", clearFilters);
    $("#emptyAdd").addEventListener("click", () => openCardForm());
    $("#addCardButton").addEventListener("click", () => openCardForm());
    $("#libraryGrid").addEventListener("click", (event) => {
      const editButton = event.target.closest("[data-edit]");
      if (editButton) { openCardForm(editButton.dataset.edit); return; }
      const deleteButton = event.target.closest("[data-delete]");
      if (deleteButton) requestDeleteCard(deleteButton.dataset.delete);
    });
    $("#restoreHidden").addEventListener("click", restoreHiddenCards);

    $("#cardForm").addEventListener("submit", submitCardForm);
    $("#closeCardDialog").addEventListener("click", closeCardForm);
    $("#cancelCardDialog").addEventListener("click", closeCardForm);
    $("#deleteCardButton").addEventListener("click", () => {
      const id = editingCardId;
      if (!id) return;
      closeCardForm();
      requestDeleteCard(id);
    });
    $("#cardDialog").addEventListener("close", () => { editingCardId = null; });

    $("#dailyLimit").addEventListener("change", (event) => {
      const value = clampLimit(event.target.value);
      event.target.value = value;
      if (state.settings.dailyLimit === value) return;
      state.settings.dailyLimit = value;
      saveState();
      renderDashboard();
      toast(`每日新卡已设为 ${value} 个`, "success");
    });

    $("#soundToggle").addEventListener("click", () => setSoundEnabled(!state.settings.sound));
    $("#soundSetting").addEventListener("change", (event) => setSoundEnabled(event.target.checked));
    $("#previewSound").addEventListener("click", () => {
      if (!state.settings.sound) { toast("请先开启提示音", "error"); return; }
      sfx.ensure();
      sfx.complete();
    });

    $("#exportProgress").addEventListener("click", exportProgress);
    $("#importProgress").addEventListener("change", (event) => { if (event.target.files[0]) importProgress(event.target.files[0]); });
    $("#exportVocabulary").addEventListener("click", exportVocabulary);
    $("#importVocabulary").addEventListener("change", (event) => { if (event.target.files[0]) importVocabulary(event.target.files[0]); });
    $("#downloadVocabTemplate").addEventListener("click", downloadVocabTemplate);
    $("#parsePaste").addEventListener("click", parsePastedText);
    $("#importToggleAll").addEventListener("click", toggleAllImportRows);
    $("#importCancel").addEventListener("click", () => $("#importDialog").close());
    $("#importConfirm").addEventListener("click", commitImportSelection);
    $("#importOnlyB2").addEventListener("change", renderImportList);
    $("#importShowDup").addEventListener("change", renderImportList);
    $("#importList").addEventListener("change", (event) => {
      const row = event.target.closest(".import-row");
      if (!row) return;
      const item = importDraft.items[Number(row.dataset.index)];
      if (!item) return;
      if (event.target.classList.contains("ir-meaning")) {
        item.meaning = event.target.value.trim();
        if (item.meaning && item.level === "b2") item.why = "";
        updateImportFooter();
      } else {
        item.checked = event.target.checked;
        row.classList.toggle("is-off", !item.checked);
        updateImportFooter();
      }
    });
    $("#restoreVocabulary").addEventListener("click", restoreBuiltinVocabulary);
    $("#clearCustom").addEventListener("click", clearCustomCards);
    $("#resetProgress").addEventListener("click", async () => {
      const ok = await askConfirm({
        title: "清除学习进度？",
        message: "所有卡片的学习记录与复习安排都会被清空，词库、自定义搭配和设置会保留。此操作无法撤销。",
        confirmLabel: "清除进度",
        danger: true
      });
      if (!ok) return;
      state.cards = {};
      state.activity = {};
      state.rounds = {};
      saveState();
      renderDashboard();
      toast("学习进度已清除", "success");
    });

    document.addEventListener("keydown", handleGlobalKeydown);
    document.addEventListener("pointerdown", () => sfx.ensure(), { once: true, capture: true });
  }

  function handleGlobalKeydown(event) {
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    const isTyping = tag === "input" || tag === "textarea" || tag === "select";
    const cardDialogOpen = $("#cardDialog").open;
    const studyOpen = $("#studyDialog").open;
    const confirmOpen = $("#confirmDialog").open;

    if (event.key === "/" && !isTyping && !cardDialogOpen && !studyOpen && !confirmOpen) {
      event.preventDefault();
      showView("library");
      $("#searchInput").focus();
      return;
    }

    if (!studyOpen || cardDialogOpen || confirmOpen) return;
    if (event.key === "Escape") return;
    if (!isTyping) sfx.ensure();

    if (waitingForContinue) {
      if ((event.key === "Enter" || event.key === " ") && !(target instanceof Element && target.closest("button"))) {
        event.preventDefault();
        continueQueue();
      }
      return;
    }

    if (isTyping) return;
    if (!$("#recognitionActions").hidden) {
      if (event.key === "1") { event.preventDefault(); chooseRecognition(false); }
      else if (event.key === "2") { event.preventDefault(); chooseRecognition(true); }
    }
  }

  /* ---------- boot ---------- */

  $("#studyDate").value = selectedDate;
  bindEvents();
  renderThemeOptions();
  renderDashboard();
  renderLibrary();
  saveState();
})();
