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

  // 台羅骨架 -> 白話字聲母／韻母拼法，但 oo/nn 保持純 ASCII（不套用 o·／ⁿ）。
  // 供數字調輸出使用：數字調欄位本來就是給人／程式方便輸入比對的格式，混入
  // o͘／ⁿ 這種組合字元會有兩個實際問題——U+0358（combining dot above right）
  // 很多字型根本沒有對應字形，畫面上會直接看不見，讓「hō͘」轉出來的數字調
  // 看起來像缺一個 o 的「ho7」（其實骨架沒錯，只是那個點沒被畫出來）；
  // ⁿ（U+207F）雖然顯示正常，但作為非 ASCII 字元會讓依賴數字調字串做音檔
  // 檔名比對／外部工具比對的地方比對不到——這是使用者實測回報的兩個症狀，
  // 不要再讓數字調欄位重新套用這兩個 unicode 符號。
  function skeletonToPojLetters(skeleton) {
    return skeleton
      .replace(/tsh/g, 'chh')
      .replace(/ts/g, 'ch')
      .replace(/ua/g, 'oa')
      .replace(/ue/g, 'oe')
      .replace(/ing$/, 'eng')
      .replace(/ik$/, 'ek');
  }

  // 台羅骨架 -> 白話字骨架，套上 o·／ⁿ（供變音標拼法 toPojMark 使用，那裡
  // 顯示的是真正的白話字正字法，o͘／ⁿ 是必要、正確的符號，不受上面那條規則影響）。
  function skeletonToPoj(skeleton) {
    let s = skeletonToPojLetters(skeleton);
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

  // 連讀變調（本調 -> 變調）規則表。標準循環 1→7→3→2→1，第5聲另外分支到7；
  // 入聲（韻尾 p/t/k）4↔8 對調；喉塞韻尾 -h 的入聲則去掉 h 變成舒聲：4h→2、8h→3。
  // 參考自使用者提供的台語羅馬字變調練習工具（教育部辭典錄音規則同源）。
  // 只在「一個變調組裡、不是最後一個音節」時套用，呼叫端負責判斷分組與是否為組末。
  const SANDHI_CYCLE = { 1: 7, 2: 1, 3: 2, 5: 7, 7: 3 };
  function sandhiTone(skeleton, tone) {
    if (tone === 4 || tone === 8) {
      const last = skeleton.slice(-1).toLowerCase();
      if (last === 'h') {
        return { skeleton: skeleton.slice(0, -1), tone: tone === 4 ? 2 : 3 };
      }
      return { skeleton, tone: tone === 4 ? 8 : 4 };
    }
    const next = SANDHI_CYCLE[tone];
    return { skeleton, tone: next !== undefined ? next : tone };
  }

  // 三疊字（AAA，例如「紅紅紅」加強語氣）第一字的特殊變調。本調 2/3/4 照一般
  // 變調規則走；本調 1/5/7/8 變成「中升調」——教育部辭典沒有單獨錄這個調值
  // 的音檔，慣例上用第5聲（本身也是升調，聽感最接近）的寫法代替，入聲8如果
  // 是喉塞 -h 韻尾要一併去掉 h。呼叫端負責先偵測「連續三個本調完全相同」才用
  // 這個函式，這裡本身不做偵測；第二、第三字分別用一般變調／維持本調即可，
  // 不需要專門的函式。
  function sandhiTripleFirst(skeleton, tone) {
    if (tone === 2 || tone === 3 || tone === 4) return sandhiTone(skeleton, tone);
    if (tone === 8 && skeleton.slice(-1).toLowerCase() === 'h') {
      return { skeleton: skeleton.slice(0, -1), tone: 5 };
    }
    return { skeleton, tone: 5 };
  }

  // ---- 對外 API ----

  // 任意來源音節字串 -> { skeleton, tone }
  function parse(raw) { return parseSyllable(raw); }

  // { skeleton, tone } -> 台羅變音標
  function toTailoMark(skeleton, tone) { return placeTone(skeleton, tone); }

  // { skeleton, tone } -> 白話字變音標
  function toPojMark(skeleton, tone) { return placeTone(skeletonToPoj(skeleton), tone); }

  // { skeleton, tone } -> 台羅數字調
  function toNumeric(skeleton, tone) { return skeleton + tone; }

  // { skeleton, tone } -> 白話字數字調。刻意用 skeletonToPojLetters（純 ASCII，
  // oo/nn 保留原樣）而不是 skeletonToPoj——數字調欄位不套用 o͘／ⁿ 這兩個
  // unicode 符號，原因見 skeletonToPojLetters 的註解。
  function toPojNumeric(skeleton, tone) { return skeletonToPojLetters(skeleton) + tone; }

  // 把一個「詞」（音節間用 - 連接）的原始字串，解析成 [{skeleton,tone,neutral}, ...]；
  // 若任何一個音節解析失敗回傳 null。保留「--」跟一般「-」的差異：「--」表示
  // 緊接在後面那個音節是輕聲（例如「食--的」「我--的」），輸出時要能原樣寫回去，
  // 連讀變調時前一個音節也要因此維持本調，不能只當成普通的音節分隔符號吃掉。
  function parseWord(word) {
    const parts = word.split(/(-+)/).filter(p => p !== '');
    const raw = [];
    let pendingNeutral = false;
    for (const part of parts) {
      if (/^-+$/.test(part)) { pendingNeutral = part.length >= 2; continue; }
      raw.push({ text: part, neutral: pendingNeutral });
      pendingNeutral = false;
    }
    if (!raw.length) return null;
    const parsed = raw.map(r => {
      const p = parseSyllable(r.text);
      if (!p) return null;
      p.neutral = r.neutral;
      return p;
    });
    if (parsed.some(p => !p)) return null;
    return parsed;
  }

  // 依序組合音節成一個詞，音節前若標了 neutral 就用「--」連接，否則用一般「-」。
  function joinSylls(parsedSylls, toForm) {
    let out = toForm(parsedSylls[0]);
    for (let i = 1; i < parsedSylls.length; i++) {
      out += (parsedSylls[i].neutral ? '--' : '-') + toForm(parsedSylls[i]);
    }
    return out;
  }

  function wordToTailoMark(parsedSylls) { return joinSylls(parsedSylls, p => toTailoMark(p.skeleton, p.tone)); }
  function wordToPojMark(parsedSylls) { return joinSylls(parsedSylls, p => toPojMark(p.skeleton, p.tone)); }
  function wordToNumeric(parsedSylls) { return joinSylls(parsedSylls, p => toNumeric(p.skeleton, p.tone)); }
  function wordToPojNumeric(parsedSylls) { return joinSylls(parsedSylls, p => toPojNumeric(p.skeleton, p.tone)); }

  // 台羅骨架調號 key，供辭典反查索引使用：例如 "tsiah8-png7"
  function wordToKey(parsedSylls) { return parsedSylls.map(p => p.skeleton + p.tone).join('-'); }

  return {
    parse, parseWord, toTailoMark, toPojMark, toNumeric, toPojNumeric,
    sandhiTone, sandhiTripleFirst, joinSylls,
    wordToTailoMark, wordToPojMark, wordToNumeric, wordToPojNumeric, wordToKey
  };
})();
