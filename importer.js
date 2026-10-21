// 导入引擎 v2：把任意来源（乱排版 TXT、粘贴的表格、带高亮的 PDF）整理成候选搭配。
// 只做纯数据处理，不碰 DOM；界面在 app.js 里。
(function () {
  const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  const LATIN = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ¿¡]/;
  const MAX_PATTERN = 90;
  const GRAMMAR_TAGS = ["虚拟式", "陈述式", "直陈式", "不定式", "命令式", "副动词", "条件式", "完成时", "虚拟", "阴性", "阳性"];
  const EASY = () => (window.RUTA_LEVEL_LISTS && window.RUTA_LEVEL_LISTS.easy) || [];
  const ODD = () => (window.RUTA_LEVEL_LISTS && window.RUTA_LEVEL_LISTS.rare) || [];

  const clean = (value) => String(value || "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[\u00A0\u3000]/g, " ");

  // 只压缩空格，不动制表符（表格判列要用）
  const squash = (value) => clean(value).replace(/[ ]{2,}/g, " ").trim();
  const normalize = squash;

  // 复刻 app.js 的去重键，保证导入判重口径一致
  const key = (value) => normalize(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  function stripLead(line) {
    return String(line == null ? "" : line)
      .replace(/^[\s　]*(?:[0-9]+|[一二三四五六七八九十]+|[a-zA-Z]|[ivxlcdm]{1,7})\s*[.、)）:：\-—–]\s*/, "")
      .replace(/^[\s　]*\d{1,4}\s+/, "")
      .replace(/^[\s　]*[(\[（【]\s*(?:[0-9]+|[a-zA-Z])\s*[)\]）】]\s*/, "")
      .replace(/^[\s　]*[(\[（【]?\s*[0-9]+\s*[.、]?\s*[)\]）】]?[\s　]+/, "")
      .replace(/^[\s　]*[•·*\-—–>◆■□●○◦‣]+[\s　]+/, "")
      .replace(/^[\s　]*[-–—]{2,}[\s　]+/, "");
  }

  function tidyPattern(value) {
    let out = normalize(stripLead(value))
      .replace(/^[*_`"“”'’「」【】《》(\[（【]+/, "")
      .replace(/[*_`"“”'’「」【】《》)\]）】]+$/, "")
      .replace(/[\s]*[/／=＝:：\-—–>+＋]+$/, "")
      .replace(/^[\s]*[/／=＝:：\-—–>+＋]+/, "")
      .replace(/[。；;，,]$/, "");
    out = out.replace(/([a-záéíóúüñ])-\s+([a-záéíóúüñ])/g, (all, a, b) => a + b); // 修复跨行断词
    return normalize(out);
  }

  const latinLetters = (value) => (String(value).match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;

  function tidyMeaning(value) {
    return normalize(stripLead(value))
      .replace(/^[\s]*[:：=＝\-—–>(【[]+/, "")
      .replace(/[*_`]+/g, "")
      .replace(/[\s]*[:：=＝]+$/, "")
      .trim();
  }

  const isFurniture = (line) =>
    /^[\s\d.、·—–\-ivxlcdmIVXLCDM]{1,16}$/.test(line) ||
    /^(p[áa]g\.?|p[áa]gina|page)\s*\d+/i.test(line) ||
    /^\d+\s*[\/／]\s*\d+$/.test(line) ||
    /^https?:\/\//i.test(line) ||
    /^[^\s]+\.(pdf|docx?|txt|csv|md|epub|jpg|png)$/i.test(line);

  // 西语部分与中文部分谁在前都能切开；"que + 虚拟式" 这类语法标注留在西语侧
  function splitLatinCjk(text) {
    const body = squash(text);
    if (!LATIN.test(body) || !CJK.test(body)) return null;
    const first = body.search(CJK);
    let pattern = first > 0 ? body.slice(0, first) : "";
    let meaning = first > 0 ? body.slice(first) : "";
    if (!LATIN.test(pattern)) {
      const m = body.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][^　-鿿]*$/);
      if (!m || !m.index) return null;
      pattern = m[0];
      meaning = body.slice(0, m.index);
    }
    for (const tag of GRAMMAR_TAGS) {
      if (/[+＋]\s*$/.test(pattern) && meaning.startsWith(tag)) {
        pattern = squash(pattern + " " + tag);
        meaning = meaning.slice(tag.length);
        break;
      }
    }
    // "durante + 名词"：后面那点中文其实是搭配的一部分，不是释义
    if (/[+＋]\s*$/.test(pattern) && meaning && meaning.length <= 6 && !/[；;，,、（(）)]/.test(meaning)) {
      return { pattern: tidyPattern(body), meaning: "" };
    }
    return { pattern: tidyPattern(pattern), meaning: tidyMeaning(meaning) };
  }

  const ARTICLES = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas", "aquel", "aquella", "su", "sus"]);
  const PREP_HEADS = new Set(["de", "del", "a", "en", "con", "por", "para", "sin", "sobre", "entre", "hasta", "desde", "según", "bajo", "tras"]);
  const FINITE = /(?:^|\s)(?:es|son|era|eran|fue|fueron|será|sería|está|están|estaba|estaban|tiene|tienen|tenía|tenían|hay|han|ha|había|hace|hacen|hizo|hicieron|puede|pueden|podía|debe|deben|debía|quiere|quieren|va|van|viene|vienen|dice|dicen|fue)\s/;

  // 区分「词组」和「从句子上剪下来的片段」
  function looksLikeClause(pattern) {
    const lower = pattern.toLowerCase();
    if (FRAME_PHRASES.some((f) => lower.startsWith(f))) return false;
    if (/\.\s/.test(pattern)) return true;          // 中间还有句号，就是句子片段
    const words = lower.split(/\s+/).filter(Boolean);
    const first = (words[0] || "").replace(/[.,;:!?¿¡()«””]/g, "");
    const second = (words[1] || "").replace(/[.,;:!?¿¡()]/g, "");
    if (ARTICLES.has(first)) return true;
    if (PREP_HEADS.has(first) && ARTICLES.has(second)) return true;
    if (/\s(?:y|o|u)\s/.test(lower)) return true;
    if (first === "no" || first === "que" || first === "si") return false; // "no hay punto de comparación" 这类固定说法
    if (FINITE.test(`${lower} `)) return true;
    if (/[.,;]$/.test(pattern)) return true;
    return false;
  }

  function grade(pattern, meaning) {
    const k = key(pattern);
    const words = k ? k.split(" ").filter(Boolean).length : 0;
    if (!LATIN.test(pattern) || latinLetters(pattern) < 3) return { level: "skip", why: "没有西语内容" };
    if (words <= 1 && !/[+＋]/.test(pattern)) return { level: "word", why: "单个词，不是词组" };
    if (pattern.length > MAX_PATTERN || words > 7) return { level: "long", why: "太长，像整句" };
    if (looksLikeClause(pattern)) return { level: "long", why: "从句子上剪下来的片段" };
    if (EASY().includes(k)) return { level: "easy", why: "A1/A2 入门搭配" };
    if (ODD().includes(k)) return { level: "odd", why: "生僻或口语色彩重" };
    if (!meaning) return { level: "b2", why: "缺中文释义，可稍后补" };
    return { level: "b2", why: "" };
  }

  // 释义里混进来的例句（"认输；放弃 Tiré la toalla. 我认输了"）拆回例句两栏
  function carveExample(item) {
    if (!item.meaning) return;
    const m = item.meaning.match(/[A-Za-zÁÉÍÓÚÜÑ][^　-鿿]{14,}/);
    if (!m || m.index < 2) return;
    const sentence = squash(m[0]);
    if (!/\s/.test(sentence)) return;
    item.example = item.example || sentence;
    item.exampleZh = item.exampleZh || tidyMeaning(item.meaning.slice(m.index + m[0].length));
    item.meaning = squash(item.meaning.slice(0, m.index));
  }

  function push(list, item) {
    const pattern = tidyPattern(item.pattern);
    if (!pattern) return null;
    const meaning = tidyMeaning(item.meaning);
    const g = grade(pattern, meaning);
    if (g.level === "skip") return null;
    const entry = {
      pattern,
      meaning,
      example: normalize(item.example),
      exampleZh: normalize(item.exampleZh),
      theme: normalize(item.theme),
      level: g.level,
      why: g.why,
      key: key(pattern)
    };
    carveExample(entry);
    entry.level = grade(entry.pattern, entry.meaning).level;
    list.push(entry);
    return entry;
  }

  // 一行里塞了两个搭配："durante + 名词 ／ mientras + 句子"
  function splitTwins(text) {
    const parts = squash(text).split(/\s*[／/]\s*|\s+或\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => LATIN.test(p) && p.length <= MAX_PATTERN)) return parts;
    return [squash(text)];
  }

  function detectDelimiter(lines) {
    if (lines.filter((l) => l.includes("\t")).length >= Math.max(2, lines.length * 0.5)) return "\t";
    if (lines.filter((l) => (l.match(/\|/g) || []).length >= 2).length >= Math.max(2, lines.length * 0.5)) return "|";
    for (const d of ["；", ";"]) {
      const hit = lines.filter((l) => l.includes(d));
      if (hit.length >= Math.max(3, lines.length * 0.7) &&
        hit.every((l) => { const cells = l.split(d); return cells.length >= 2 && LATIN.test(cells[0]) && cells[0].length <= MAX_PATTERN; })) return d;
    }
    return null;
  }

  function rowsFromTable(lines, delim) {
    return lines
      .filter((l) => !/^[\s|:-]+$/.test(l))
      .map((l) => {
        let cells = l.split(delim);
        if (delim === "|") {
          if (!cells[0].trim()) cells = cells.slice(1);
          if (cells.length && !cells[cells.length - 1].trim()) cells = cells.slice(0, -1);
        }
        return cells.map((c) => squash(c));
      });
  }

  const isHeaderRow = (row) => /^(西语|搭配|短语|词条|pattern|expresión|expressi|conector)/i.test(row[0] || "") &&
    (/^(中文|释义|意思|翻译|meaning)/.test(row[1] || "") || !row[1]);

  function parseText(text, theme) {
    const out = [];
    const all = clean(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!all.length) return out;
    const body = all.filter((l) => !/^(#|\/\/)/.test(l));
    if (!body.length) return out;

    const delim = detectDelimiter(body);
    if (delim) {
      const rows = rowsFromTable(body, delim);
      if (rows.length && isHeaderRow(rows[0])) rows.shift();
      rows.forEach((row) => {
        const [pattern = "", meaning = "", example = "", exampleZh = "", themeCell = ""] = row;
        if (!pattern) return;
        const twins = splitTwins(pattern);
        if (twins.length > 1) {
          twins.forEach((p) => push(out, { pattern: p, meaning, theme: themeCell || theme }));
          return;
        }
        if (!LATIN.test(pattern)) {
          const sp = splitLatinCjk(row.filter(Boolean).join(" "));
          if (sp) push(out, { pattern: sp.pattern, meaning: sp.meaning, theme: themeCell || theme });
          return;
        }
        push(out, { pattern, meaning, example, exampleZh, theme: themeCell || theme });
      });
      return dedupe(out);
    }

    // 自由文本：先把被硬换行切断的西语长行拼回去
    const dangling = (l) => /[,;]$/.test(l) || l.length > 40 || /\b(de|a|en|con|por|para|sin|sobre|que|y|o|ni)\s*\.?$/i.test(l);
    const merged = [];
    body.forEach((line) => {
      const prev = merged[merged.length - 1];
      if (prev && !CJK.test(prev) && !CJK.test(line) && LATIN.test(line) && /^[a-záéíóúüñ]/.test(line) &&
        !/^[-–—*·•]/.test(line) && dangling(prev)) {
        merged[merged.length - 1] = squash(prev + " " + line);
        return;
      }
      merged.push(line);
    });

    let last = null;
    merged.forEach((line) => {
      if (isFurniture(line)) return;
      const hasLatin = LATIN.test(line);
      if (!hasLatin) {
        if (last && !last.meaning) last.meaning = tidyMeaning(line);
        else if (last && last.example && !last.exampleZh) last.exampleZh = tidyMeaning(line);
        if (last) {
          const again = grade(last.pattern, last.meaning);
          last.level = again.level;
          last.why = again.level === "b2" ? (last.meaning ? "" : again.why) : again.why;
        }
        return;
      }
      const content = stripLead(line);
      const before = out.length;
      if (CJK.test(line)) {
        // 带中文的行本身就是一条完整笔记，绝不当成上一条的例句
        emitText(out, content, theme);
      } else {
        const looksSentence = /[.!?¡?]$/.test(content) || content.split(" ").length >= 9 || content.length > MAX_PATTERN;
        if (last && !last.example && looksSentence) last.example = squash(content);
        else emitText(out, content, theme);
      }
      if (out.length > before) last = out[out.length - 1];
    });
    return dedupe(out);
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((item) => {
      if (!item.key || seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  }

  // pdf.js 4.x 的 quadPoints 是扁平数字数组（每个四边形 8 个数），老版本是点数组，两种都兼容
  function normalizeQuads(annot) {
    const list = annot.quadPoints ? Array.from(annot.quadPoints) : [];
    if (list.length && typeof list[0] === "number") {
      const boxes = [];
      for (let i = 0; i + 7 < list.length; i += 8) {
        const n = list.slice(i, i + 8);
        const xs = [n[0], n[2], n[4], n[6]];
        const ys = [n[1], n[3], n[5], n[7]];
        boxes.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
      }
      if (boxes.length) return boxes;
    } else if (list.length) {
      return list.map((quad) => {
        const pts = Array.from(quad);
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      });
    }
    if (annot.rect) {
      const r = annot.rect;
      return [{ x0: r[0], x1: r[2], y0: Math.min(r[1], r[3]), y1: Math.max(r[1], r[3]) }];
    }
    return [];
  }

  const PREP = "de|a|en|con|por|para|sin|sobre|entre|hasta|desde|contra|según";
  const PREPS = `(?:${PREP})`;
  // 常见 B2/C1 框架短语（书面语高频，直接从句子里认出）
  const FRAME_PHRASES = [
    "a medida que", "a fin de", "con el fin de", "con la finalidad de", "con tal de", "a pesar de", "pese a",
    "gracias a", "debido a", "de modo que", "de manera que", "en caso de", "en vez de", "en lugar de",
    "aparte de", "además de", "a través de", "por medio de", "en relación con", "con respecto a",
    "respecto a", "acerca de", "hasta el punto de", "en lo que se refiere a", "por lo que", "dado que",
    "puesto que", "si bien", "no obstante", "aun cuando", "siempre y cuando", "con tal de que", "a menos que",
    "salvo que", "entre las que", "entre los que", "se trata de", "hace falta", "hay que", "basta con",
    "tardar en", "poner de manifiesto", "dar cuenta de", "sentar precedente", "sentar las bases de"
  ];
  // 从整句里挖出「动词/名词 + 介词」这类搭配
  const VERB_PREP = new RegExp(`\\b([a-záéíóúüñ]{3,}(?:arse|erse|irse|ar|er|ir|ecer|acer))\\s+(${PREP})\\b`, "gi");
  const NOUN_DE = new RegExp(`\\b([a-záéíóúüñ]{5,}(?:ción|miento|dad|tud|aje|encia|ancia|anza))\\s+(${PREP})`, "gi");
  // 这些词以 -ar/-er/-ir 结尾却不是动词，避免被当成「动词＋介词」
  const FAKE_VERBS = new Set(["lugar", "solar", "popular", "similar", "regular", "particular", "singular", "plural", "vulgar", "altar",
    "poder", "deber", "haber", "mujer", "ayer", "rally", "boom", "golf"]);

  function mineChunks(sentence) {
    const found = [];
    const seen = new Set();
    const add = (text) => {
      const value = tidyPattern(text);
      if (!value) return;
      const k = key(value);
      const words = k.split(" ").filter(Boolean);
      if (seen.has(k) || words.length < 2 || words.length > 6) return;
      if (FAKE_VERBS.has(words[0])) return;
      if (/\d/.test(value)) return;
      seen.add(k);
      found.push(value);
    };
    FRAME_PHRASES.forEach((phrase) => {
      const re = new RegExp(`(^|[\\s,.;:!?])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s+${PREP})?(\\s+[a-záéíóúüñ]{3,})?`, "i");
      const m = sentence.match(re);
      if (m) add(m[0]);
    });
    sentence.replace(VERB_PREP, (all, verb, prep) => { add(`${verb} ${prep}`); return all; });
    sentence.replace(NOUN_DE, (all, noun, prep) => { add(`${noun} ${prep}`); return all; });
    return found.slice(0, 3);
  }

  // 一段文字（可能是一行笔记，也可能是一整句高亮）→ 候选条目
  function emitText(list, text, theme) {
    const merged = squash(String(text == null ? "" : text).replace(/\t/g, " "));
    if (!merged || isFurniture(merged)) return;
    // 一行塞了多个搭配："A ／ B 释义"、"A / B  释义"，拆开各自识别，中文段按顺序补到缺释义的条目上
    const halves = merged.split(/\s*／\s*|\s+\//).map((p) => p.trim()).filter(Boolean);
    if (halves.length >= 2 && halves.length <= 4 && halves.some((p) => LATIN.test(p)) && halves.every((p) => p.length <= MAX_PATTERN)) {
      halves.forEach((part) => {
        if (LATIN.test(part)) {
          emitText(list, part, theme);
        } else {
          const target = [...list].reverse().find((item) => !item.meaning);
          if (target) {
            target.meaning = tidyMeaning(part);
            const again = grade(target.pattern, target.meaning);
            target.level = again.level;
            target.why = again.why;
          }
        }
      });
      return;
    }
    const sp = splitLatinCjk(merged);
    if (sp) {
      push(list, { pattern: sp.pattern, meaning: sp.meaning, theme });
      return;
    }
    if (!LATIN.test(merged)) {
      const target = [...list].reverse().find((item) => !item.meaning);
      if (target) {
        target.meaning = tidyMeaning(merged);
        const again = grade(target.pattern, target.meaning);
        target.level = again.level;
        target.why = again.why;
      }
      return;
    }
    if (merged.length > MAX_PATTERN) {
      const chunks = mineChunks(merged);
      if (chunks.length) {
        const example = merged.length > 240 ? `${merged.slice(0, 240)}…` : merged;
        chunks.forEach((chunk) => {
          const entry = push(list, { pattern: chunk, meaning: "", example, theme });
          if (entry) { entry.mined = true; entry.why = "从句子里挑出的搭配"; }
        });
        return;
      }
    }
    push(list, { pattern: merged, theme });
  }

  // 高亮 PDF：把标注框覆盖的文字还原成候选条目
  async function parsePdf(data, theme, options = {}) {
    const { onProgress, maxPages = 0 } = options;
    const pdf = await import("./vendor/pdf.min.mjs");
    pdf.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", document.baseURI).href;
    const doc = await pdf.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
    const out = [];
    let boxes = 0;
    let empty = 0;
    const limit = maxPages > 0 ? Math.min(maxPages, doc.numPages) : doc.numPages;
    for (let n = 1; n <= limit; n += 1) {
      const page = await doc.getPage(n);
      const [annots, text] = await Promise.all([page.getAnnotations({ intent: "any" }), page.getTextContent()]);
      const view = page.view;
      const pageH = Math.abs(view[3] - view[1]);
      const items = text.items
        .filter((it) => typeof it.str === "string" && it.str.trim())
        .map((it) => ({ str: it.str, x0: it.transform[4], x1: it.transform[4] + (it.width || 0), y: it.transform[5] }));
      const marks = annots.filter((a) => a.subtype === "Highlight" || a.subtype === "Underline");
      marks.forEach((a) => {
        const quads = normalizeQuads(a);
        boxes += quads.length;
        const parts = quads.map((box) => {
          const read = (b) => {
            const hits = items
              .filter((r) => r.y >= b.y0 - 2.5 && r.y <= b.y1 + 2.5 && r.x1 > b.x0 - 1.5 && r.x0 < b.x1 + 1.5)
              .sort((x, z) => z.y - x.y || x.x0 - z.x0);
            return squash(hits.map((r) => r.str).join(""));
          };
          // pdf.js 版本对 y 轴方向的处理不一致，两种都试一次
          const direct = read(box);
          if (direct) return direct;
          return read({ x0: box.x0, x1: box.x1, y0: pageH - box.y1, y1: pageH - box.y0 });
        }).filter(Boolean);
        const merged = squash(parts.join(" "));
        if (!merged) { empty += 1; return; }
        emitText(out, merged, theme);
      });
      if (typeof page.cleanup === "function") page.cleanup();
      if (onProgress) onProgress(n, doc.numPages);
    }
    const stats = { boxes, empty };
    await doc.destroy();
    return { items: dedupe(out), stats };
  }

  window.RutaImport = { normalize, key, parseText, parsePdf, grade, tidyPattern, mineChunks };
})();
