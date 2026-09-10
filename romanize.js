// 台語羅馬字工具：教育部台羅（Tâi-lô）／白話字（POJ）互轉，
// 以及「調號變音標」⇄「調號數字」互轉。
//
// 內部一律以「台羅骨架」為中介格式：純 ASCII 字母（ts/tsh/oo/nn/ua/ue/ing/ik…），
// 不含調號、不含白話字的頂標點與鼻化符號 ⁿ。要輸出哪種書寫系統，
// 最後一步才把骨架轉成台羅或白話字拼法，並套上調號。
const Romanize = (() => {
  const TONE_MARK = { 1: '', 2: '́', 3: '̀', 4: '', 5: '̂', 6: '́', 7: '̄', 8: '̍', 9: '̆' };
  const MARK_TONE = { '́': 2, '̀': 3, '̂': 5, '̄': 7, '̍': 8, '̆': 9 };
  const CHECKED_FINALS = ['p', 't', 'k', 'h'];
  const DOT = '͘';   // 白話字 o· 的頂標點（combining dot above right）
  const NASAL = 'ⁿ'; // 白話字鼻化符號 ⁿ（superscript n）

  // 把任何書寫方式的單一音節，拆成「調號數字」+「台羅骨架」。
  function parseSyllable(raw) {
    let s = raw.trim();
    if (!s) return null;

    // 數字調：結尾是 1-9 的音節，直接取出數字。
    const numMatch = s.match(/^([A-Za-z·͘ⁿ]+)([1-9])$/);
    let tone, plain;
    if (numMatch) {
      plain = numMatch[1];
      tone = parseInt(numMatch[2], 10);
    } else {
      // 變音符號調：NFD 分解後找出調號符號，其餘字母保留。
      const nfd = s.normalize('NFD');
      let foundTone = null;
      let letters = '';
      for (const ch of nfd) {
        if (MARK_TONE[ch]) foundTone = MARK_TONE[ch];
        else letters += ch;
      }
      plain = letters.normalize('NFC');
      if (foundTone === null) {
        const last = plain.slice(-1).toLowerCase();
        foundTone = CHECKED_FINALS.includes(last) ? 4 : 1;
      }
      tone = foundTone;
    }

    // 白話字的 o·／中點／ⁿ 正規化成台羅骨架的 oo／nn。
    plain = plain
      .replace(new RegExp('o' + DOT, 'g'), 'oo')
      .replace(/o·/g, 'oo')
      .replace(new RegExp(NASAL, 'g'), 'nn');

    // 白話字聲母／韻母轉台羅骨架（對已經是台羅的字串是安全的 no-op）。
    plain = plain
      .replace(/chh/gi, m => matchCase(m, 'tsh'))
      .replace(/ch/gi, m => matchCase(m, 'ts'))
      .replace(/oa/gi, m => matchCase(m, 'ua'))
      .replace(/oe/gi, m => matchCase(m, 'ue'))
      .replace(/eng$/i, m => matchCase(m, 'ing'))
      .replace(/ek$/i, m => matchCase(m, 'ik'));

    // 正規化後應只剩下純字母；若還有其他符號（標點、數字殘留等），
    // 代表這不是合法音節，回傳 null 讓呼叫端當作字面文字處理。
    if (!/^[a-z]+$/i.test(plain)) return null;

    return { skeleton: plain.toLowerCase(), tone };
  }

  function matchCase(orig, repl) {
    return orig[0] === orig[0].toUpperCase() ? repl[0].toUpperCase() + repl.slice(1) : repl;
  }

  // 台羅骨架 -> 白話字骨架（保留 oo/nn，供最後一步轉換成 o·/ⁿ 前使用）。
  function skeletonToPoj(skeleton) {
    let s = skeleton
      .replace(/tsh/g, 'chh')
      .replace(/ts/g, 'ch')
      .replace(/ua/g, 'oa')
      .replace(/ue/g, 'oe')
      .replace(/ing$/, 'eng')
      .replace(/ik$/, 'ek');
    s = s.replace(/oo/g, 'o' + DOT);
    s = s.replace(/nn$/, NASAL);
    return s;
  }

  // 教育部台羅調號變音標的標示規則（a > oo/o· > e > o > iu/ui > i > u > m > ng）。
  function placeTone(letters, tone) {
    const mark = TONE_MARK[tone] || '';
    if (!mark) return letters;
    let idx = -1, insertAfter = 0;

    const findFirst = ch => letters.toLowerCase().indexOf(ch);
    if (findFirst('a') >= 0) { idx = findFirst('a'); insertAfter = idx + 1; }
    else if (letters.indexOf('oo') >= 0) { idx = letters.indexOf('oo'); insertAfter = idx + 1; }
    else if (new RegExp('o' + DOT).test(letters)) { idx = letters.search(new RegExp('o' + DOT)); insertAfter = idx + 1; }
    else if (findFirst('e') >= 0) { idx = findFirst('e'); insertAfter = idx + 1; }
    else if (findFirst('o') >= 0) { idx = findFirst('o'); insertAfter = idx + 1; }
    else if (/iu/i.test(letters)) { idx = letters.toLowerCase().indexOf('iu'); insertAfter = idx + 2; }
    else if (/ui/i.test(letters)) { idx = letters.toLowerCase().indexOf('ui'); insertAfter = idx + 2; }
    else if (findFirst('i') >= 0) { idx = findFirst('i'); insertAfter = idx + 1; }
    else if (findFirst('u') >= 0) { idx = findFirst('u'); insertAfter = idx + 1; }
    else if (findFirst('m') >= 0) { idx = findFirst('m'); insertAfter = idx + 1; }
    else if (letters.toLowerCase().indexOf('ng') >= 0) { idx = letters.toLowerCase().indexOf('ng'); insertAfter = idx + 1; }

    if (idx < 0) return letters; // 找不到核心母音，原樣傳回
    return (letters.slice(0, insertAfter) + mark + letters.slice(insertAfter)).normalize('NFC');
  }

  // ---- 對外 API ----

  // 任意來源音節字串 -> { skeleton, tone }
  function parse(raw) { return parseSyllable(raw); }

  // { skeleton, tone } -> 台羅變音標
  function toTailoMark(skeleton, tone) { return placeTone(skeleton, tone); }

  // { skeleton, tone } -> 白話字變音標
  function toPojMark(skeleton, tone) { return placeTone(skeletonToPoj(skeleton), tone); }

  // { skeleton, tone } -> 台羅數字調（羅馬字加音調數字欄位固定用台羅骨架）
  function toNumeric(skeleton, tone) { return skeleton + tone; }

  // 把一個「詞」（音節間用 - 連接）的原始字串，解析成 [{skeleton,tone}, ...]；
  // 若任何一個音節解析失敗回傳 null。
  function parseWord(word) {
    // 用一個以上的連字號切分音節，讓「--」輕聲標記寫法也能正常斷開
    // （輕聲本身的變調不會被保留，只當作一般音節處理）。
    const sylls = word.split(/-+/).filter(Boolean);
    if (!sylls.length) return null;
    const parsed = sylls.map(parseSyllable);
    if (parsed.some(p => !p)) return null;
    return parsed;
  }

  function wordToTailoMark(parsedSylls) { return parsedSylls.map(p => toTailoMark(p.skeleton, p.tone)).join('-'); }
  function wordToPojMark(parsedSylls) { return parsedSylls.map(p => toPojMark(p.skeleton, p.tone)).join('-'); }
  function wordToNumeric(parsedSylls) { return parsedSylls.map(p => toNumeric(p.skeleton, p.tone)).join('-'); }

  // 台羅骨架調號 key，供辭典反查索引使用：例如 "tsiah8-png7"
  function wordToKey(parsedSylls) { return parsedSylls.map(p => p.skeleton + p.tone).join('-'); }

  return { parse, parseWord, toTailoMark, toPojMark, toNumeric, wordToTailoMark, wordToPojMark, wordToNumeric, wordToKey };
})();
