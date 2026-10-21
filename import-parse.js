'use strict';

// IMPORT: a manuscript's bytes (.docx, .txt, .md, .fountain, .fdx) into
// NEO's chapters. Plain JavaScript that runs in main.js (desktop import)
// and in the browser (NEO on the web, window.NeoImport). It never touches
// the filesystem: the caller reads the file and hands over its bytes.
//
//   parseManuscript({ name, ext, bytes }, JSZip)
//     → { name, title, author, chapters } or, for a script,
//       { name, script: 'fountain' | 'fdx', source }

(function (root) {
  // numeric references too, and &amp; last, so a literal "&lt;" in the text
  // stays "&lt;" instead of turning into "<"
  const decodeEntities = (s) => s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return m; } })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  // a document's own * _ and \ are text, not emphasis: they travel escaped,
  // the way Markdown writes them, and the window turns them back into letters
  const escapeMarks = (s) => s.replace(/[\\*_]/g, '\\$&');

  // Is a formatting tag (<w:b>, <w:i>) present, and is it on? Returns true,
  // false (present but switched off — Word writes <w:i w:val="0"/> to cancel
  // a style's italics), or undefined when the run says nothing about it.
  function docxFormatOn(rpr, tag) {
    const hit = rpr.match(new RegExp('<' + tag + '(?:\\s[^>]*)?/?>'));
    if (!hit) return undefined;
    const val = (hit[0].match(/w:val="([^"]*)"/) || [])[1];
    return val === undefined || /^(true|1|on)$/i.test(val);
  }

  // Italics and bold don't always sit on the run: a manuscript may carry them
  // in a character style ("Emphasis", Scrivener's "Italic") or a paragraph
  // style. Read word/styles.xml once into { styleId: { bold, italic } },
  // following basedOn so a style built on an italic one stays italic.
  function docxStyleFormats(stylesXml) {
    const out = {};
    if (!stylesXml) return out;
    const raw = {};
    for (const m of stylesXml.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
      const body = m[2];
      const basedOn = (body.match(/<w:basedOn\s+w:val="([^"]+)"/) || [])[1];
      // only the style's own run properties, not the paragraph-mark ones
      const rpr = (body.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      // the style's name: always English in the file ("heading 1", "Title"),
      // while its id follows Word's language ("berschrift1", "Titre1")
      const name = (body.match(/<w:name\s+w:val="([^"]*)"/) || [])[1] || '';
      raw[m[1]] = { basedOn, name, bold: docxFormatOn(rpr, 'w:b'), italic: docxFormatOn(rpr, 'w:i') };
    }
    const resolve = (id, depth) => {
      if (out[id]) return out[id];
      const st = raw[id];
      if (!st || depth > 8) return { bold: false, italic: false };
      const base = st.basedOn ? resolve(st.basedOn, depth + 1) : { bold: false, italic: false };
      out[id] = {
        name: st.name,
        bold: st.bold === undefined ? base.bold : st.bold,
        italic: st.italic === undefined ? base.italic : st.italic
      };
      return out[id];
    };
    for (const id of Object.keys(raw)) resolve(id, 0);
    return out;
  }

  // Convert one Word paragraph's bold/italic XML into markdown text with bold/italic
  function docxParagraphToMarkdown(p, styles = {}) {
    const pageBreak = /<w:br [^>]*w:type="page"/.test(p) || /<w:pageBreakBefore/.test(p);
    // Word marks headings with a paragraph style such as <w:pStyle w:val="Heading1"/>.
    // Any heading style (Heading1..9, Heading 1..9, or bare "Heading") starts a new chapter and
    // gives it its title — regardless of locale, the underlying style id is
    // always "Heading*".
    const pStyle = (p.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
    const sName = (styles[pStyle] && styles[pStyle].name) || '';
    const heading = /^heading\s*\d*$/i.test(pStyle) || /^heading\s*\d*$/i.test(sName);
    // Google Docs exports each of a document's tabs under a "Title"-styled
    // line, and the book's own title page uses the same style: the first one
    // names the book, later ones start chapters (see chapterize)
    const title = /^title$/i.test(pStyle) || /^title$/i.test(sName);
    // what the paragraph's style says, before any run has its say
    const pBase = styles[pStyle] || { bold: false, italic: false };
    const runs = [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((rm) => {
      const r = rm[0];
      const rpr = (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      // the run's text in order: its words, and the tabs, line breaks and
      // no-break hyphens between them (only <w:t> used to count, which ran
      // "red,⏎violets" together into "red,violets")
      const text = [...r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(\s[^>]*)?\/>|<w:cr\/>|<w:noBreakHyphen\/>/g)]
        .map((t) => {
          if (t[1] !== undefined) return escapeMarks(decodeEntities(t[1]));
          if (t[0].startsWith('<w:tab')) return ' ';
          if (t[0].startsWith('<w:noBreakHyphen')) return '\u2011';
          if (/w:type="(page|column)"/.test(t[0])) return '';
          return '\n';
        }).join('');
      const rStyle = (rpr.match(/<w:rStyle\s+w:val="([^"]*)"/) || [])[1];
      const rBase = rStyle && styles[rStyle] ? styles[rStyle] : pBase;
      const b = docxFormatOn(rpr, 'w:b');
      const i = docxFormatOn(rpr, 'w:i');
      return { text, bold: b === undefined ? !!rBase.bold : b, italic: i === undefined ? !!rBase.italic : i };
    });
    // make sure **one**"+"**two**" becomes one "**onetwo**", not "**one****two**"
    const merged = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text;
      else merged.push({ ...run });
    }
    // markers hug the words: "** bold **" isn't emphasis to a reader of
    // Markdown, and a run with no words (a tab, a break) gets none at all
    // (each line of a run on its own: the paragraph is cut at its line
    // breaks later, and an italic poem keeps its italics on every line)
    const wrap = (run, piece) => {
      const m = piece.match(/^(\s*)([\s\S]*?)(\s*)$/);
      let t = m[2];
      if (!t) return piece;
      if (run.bold) t = '**' + t + '**';
      if (run.italic) t = '*' + t + '*';
      return m[1] + t + m[3];
    };
    const text = merged.map((run) => run.text.split('\n').map((piece) => wrap(run, piece)).join('\n'))
      .join('').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
    return { text, pageBreak, heading, title };
  }

  // Headings that are only NEO's own numbering, in the languages NEO speaks
  const CHAPTER_WORDS = new RegExp('^(' + [
    'chapter', 'prologue', 'epilogue', 'part',                       // en
    'chapitre', 'épilogue', 'partie',                                // fr
    'capítulo', 'capitulo', 'prólogo', 'prologo', 'epílogo', 'epilogo', 'parte', // es, pt, it
    'capitolo',                                                      // it
    'kapitel', 'prolog', 'epilog', 'teil',                           // de
    'hoofdstuk', 'proloog', 'epiloog', 'deel',                       // nl
    'rozdział', 'rozdzial', 'część', 'czesc',                         // pl
    // ro (prolog, epilog above). A bare "Capitol" only before a number:
    // on its own it is an English word, and "Capitol Hill was quiet." is prose
    'capitol(?=\\s+\\d)', 'capitolul', 'partea',
    'глава', 'пролог', 'эпилог', 'часть',                            // ru
    'κεφάλαιο', 'κεφαλαιο', 'πρόλογος', 'προλογος',
    'επίλογος', 'επιλογος', 'μέρος', 'μερος',
    'ραψωδία', 'ραψωδια',                                             // el
    // hu: the number comes first ("3. fejezet", "II. rész")
    'prológus', 'prologus', 'epilógus', 'epilogus',
    '(?:\\d{1,3}|[ivxlc]{1,7})\\.\\s*(?:fejezet|rész|resz)',
    // ko: the number sits inside ("제3장", "제2부", a serial's "제12화"). A bare
    // "3장" only as the whole line: "3장 남았다." is prose
    '프롤로그', '에필로그', '서장', '종장',
    '제\\s*(?:\\d{1,3}|[일이삼사오육칠팔구십백]{1,4})\\s*[장부화]', '\\d{1,3}\\s*[장화]\\s*$'
  ].join('|') + ')(?![\\p{L}\\d])', 'iu');

  // A manuscript's own Prologue / Epilogue headings give those chapters their role
  const PROLOGUE_WORDS = /^(prologue|prólogo|prologo|prolog|proloog|prológus|prologus|프롤로그|서장)(?![\p{L}\d])/iu;
  const EPILOGUE_WORDS = /^(epilogue|épilogue|epílogo|epilogo|epilog|epiloog|epilógus|epilogus|에필로그|종장)(?![\p{L}\d])/iu;

  // A text file in whatever it was saved as: UTF-8 (with or without its
  // mark), UTF-16 (Notepad's "Unicode"), or, when it isn't valid UTF-8, the
  // Windows code page Word's plain-text export uses
  function decodeText(bytes) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
    } catch {
      // Latin-1 plus the code page's own 0x80–0x9F (curly quotes, dashes, €)
      const cp = '\u20AC\uFFFD\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\uFFFD\u017D\uFFFD' +
        '\uFFFD\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\uFFFD\u017E\u0178';
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return s.replace(/[\u0080-\u009F]/g, (c) => cp[c.charCodeAt(0) - 0x80]);
    }
  }

  // ext is the file's extension with its dot, in lower case (".docx")
  async function parseManuscript({ name, ext, bytes }, JSZip) {
    let paras = [];
    // a script (Fountain, or Final Draft's XML) is read as it stands; the
    // window sorts it into its elements (spFromFountain, spFromFdx in app.js)
    if (ext === '.fountain' || ext === '.fdx') {
      return { name, script: ext.slice(1), source: new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '') };
    }

    if (ext === '.docx') {
      const zip = await JSZip.loadAsync(bytes);
      const docFile = zip.file('word/document.xml');
      if (!docFile) throw new Error('Not a valid .docx: ' + name + ext);
      const xml = await docFile.async('string');
      const stylesFile = zip.file('word/styles.xml');
      const styles = docxStyleFormats(stylesFile ? await stylesFile.async('string') : '');
      paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
        .map((m) => docxParagraphToMarkdown(m[0], styles))
        // a line break inside a Word paragraph (a poem, an address) becomes
        // a paragraph of its own: NEO's lines are paragraphs
        .flatMap((p) => !p.text.includes('\n') ? [p]
          : p.text.split('\n').map((text, i) => ({ ...p, text: text.trim(), pageBreak: p.pageBreak && i === 0, heading: p.heading && i === 0, title: p.title && i === 0 })));
    } else {
      const raw = decodeText(bytes);
      // Paragraphs are split on blank lines, unless the file barely has any
      // and puts each paragraph on a line of its own (Word's "Plain Text",
      // Notepad, Scrivener): then every line is a paragraph
      const lines = raw.split(/\r\n|\r|\n/);
      const blanks = lines.filter((l) => !l.trim()).length;
      const filled = lines.length - blanks;
      // (a file hard-wrapped at ~70 columns, Project Gutenberg style, has a
      // blank line between paragraphs: it keeps the blank-line rule)
      const perLine = ext === '.txt' && filled > 3 && blanks <= Math.max(1, filled / 20);
      paras = (perLine ? lines : raw.split(/(?:\r\n|\r|\n)\s*(?:\r\n|\r|\n)/))
        .map((b) => ({ text: (perLine ? b : b.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ')).trim(), pageBreak: false }))
        .filter((p) => p.text);
    }

    // Chapterize: page breaks and heading lines start new chapters. Headings
    // include "Chapter N" styles plus bare chapter numbers — "7", "VII",
    // "Seven" — which get stripped so NEO's own numbering doesn't duplicate them.
    const SPELLED = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\.?$/i;
    const isNumeralish = (t) => /^\d{1,3}\.?$/.test(t) || /^[IVXLC]{1,7}\.?$/.test(t) || SPELLED.test(t);
    // Bare numbers only count as chapter markers when there's a ladder of them —
    // a story that merely OPENS with "Seven." keeps its seven.
    // a heading set in bold ("**Chapter 1**") is still a heading
    const bare = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\\([\\*_])/g, '$1').trim();
    const numeralMode = paras.filter((p) => p.text && isNumeralish(bare(p.text))).length >= 2;
    // A markdown heading: one or more "#" then text — any "size" (depth) counts.
    const isMdHeading = (t) => /^#{1,6}\s+\S/.test(t);
    const mdTitleOf = (t) => t.replace(/^#{1,6}\s*/, '').trim();
    // A heading that is purely NEO's own numbering ("Chapter 2", "Prologue",
    // bare "7") carries no title — NEO numbers chapters itself. A line that
    // only opens with one of those words and reads as a sentence ("Part of me
    // wanted to run.", "Часть денег пропала.") is prose: it stays in the text.
    const readsAsSentence = (t) => /[.!?…][”’"'»)]*$/.test(t) && t.trim().split(/\s+/).length > 2;
    const isNumberedHeading = (t) => (
      (CHAPTER_WORDS.test(t) && t.length < 60 && !readsAsSentence(t)) ||
      (numeralMode && isNumeralish(t))
    );
    const isHeading = (t) => t && (isMdHeading(t) || isNumberedHeading(bare(t)));
    // The chapter title that a heading contributes. Markdown hashes and any
    // emphasis markers are stripped, and pure numbering yields no title.
    const titleOf = (t) => {
      if (isMdHeading(t)) t = mdTitleOf(t);
      t = bare(t).replace(/(^|[^\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu, '$1$2');
      return isNumberedHeading(t) ? '' : t;
    };
    const isBreak = (t) => /^\s*([*#•~⁂—–-]\s*){1,7}$/.test(t || '');

    let styledTitle = null; // a Title-styled first line: the book's name
    const chapterize = (usePageBreaks) => {
      const chapters = [];
      let cur = [];
      let curTitle = '';
      let curRole = null;
      let seenProse = false;
      let lastWasHeading = false;
      styledTitle = null;
      const close = () => {
        if (cur.length) chapters.push({ title: curTitle, paras: cur, role: curRole });
        cur = [];
        curTitle = '';
        curRole = null;
      };
      for (const p of paras) {
        const brk = usePageBreaks && p.pageBreak;
        if (!p.text && !brk && !p.heading && !p.title) continue;
        // a Title line before any prose is the book's title, not a chapter's
        if (p.title && !seenProse && styledTitle === null && p.text) { styledTitle = titleOf(p.text); continue; }
        const isH = p.heading || p.title || isHeading(p.text);
        if (brk || isH) {
          // a heading that follows another with no prose between (a Google
          // Docs tab named "Chapter 2" holding a "The Long Way Home" heading)
          // refines the chapter's title instead of opening an empty chapter
          if (isH && lastWasHeading && !cur.length && !brk) {
            const t = titleOf(p.text || '');
            if (t) curTitle = curTitle ? `${curTitle} — ${t}` : t;
            continue;
          }
          close();
        }
        if (isH) {
          const h = (p.text || '').replace(/^#{1,6}\s*/, '').trim();
          curRole = PROLOGUE_WORDS.test(h) ? 'prologue' : EPILOGUE_WORDS.test(h) ? 'epilogue' : null;
          curTitle = titleOf(p.text || ''); lastWasHeading = true; continue;
        } // the heading line is replaced by NEO's numbering
        lastWasHeading = false;
        if (isBreak(p.text)) { cur.push({ scene: true }); continue; }
        if (p.text) { cur.push({ text: p.text }); seenProse = true; }
      }
      close();
      return chapters;
    };

    const countAllWords = (list) =>
      list.reduce((n, ch) => n + ch.paras.reduce((m, p) => m + (p.text ? p.text.trim().split(/\s+/).length : 0), 0), 0);

    // First pass trusts page breaks. Some word processors sprinkle page-break
    // formatting on every paragraph, exploding a story into confetti — if the
    // result is absurd (lots of tiny "chapters"), re-run trusting headings only.
    let chapters = chapterize(true);
    if (chapters.length > 6 && countAllWords(chapters) / chapters.length < 250) {
      chapters = chapterize(false);
    }
    if (!chapters.length) chapters.push({ title: '', paras: [{ text: '' }] });

    // Front matter: a short title line and a "by Author" line belong on the
    // title page, not in the body. Detect, harvest, and remove them.
    let title = styledTitle || null;
    let author = null;
    // letters of any script; NFC because a Mac may hand over the file name
    // decomposed while the text inside is composed
    const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    // "by Jane Doe" — or its equivalent in another language. Those words also
    // open ordinary sentences ("Par une nuit…", "Von Anfang an"), so outside
    // English the rest must look like a name: capitalized words (name
    // particles aside), no sentence punctuation.
    const bylineOf = (s) => {
      const en = s.match(/^by\s+(.{2,60})$/i);
      if (en) return en[1];
      // Romanian "de Ion Creangă" is lowercase on a title page; a capital "De"
      // opens titles ("De Profundis", Dutch "De Eerste Dag") and stays text
      const m = s.match(/^(?:par|por|von|di|door|autor:?|автор:?)\s+(.{2,60})$/iu) || s.match(/^de\s+(.{2,60})$/u);
      if (!m || /[.!?,;…]/.test(m[1])) return null;
      const words = m[1].trim().split(/\s+/);
      const particle = /^(de|da|di|do|dos|das|du|des|del|della|la|le|van|von|der|den|ten|ter|y|e)$/;
      return words.length <= 5 && words.every((w) => /^\p{Lu}/u.test(w) || particle.test(w)) ? m[1] : null;
    };
    const first = chapters[0];
    if (first && first.paras.length) {
      const t0 = (first.paras[0].text || '').trim();
      const t1 = first.paras.length > 1 ? (first.paras[1].text || '').trim() : '';
      const titleish = t0 && t0.length < 90 && !/[.!?]$/.test(t0) && (
        (norm(t0).length > 3 && norm(name).includes(norm(t0))) ||
        !!bylineOf(t1) ||
        (t0 === t0.toUpperCase() && /\p{Lu}.*\p{Lu}/u.test(t0) && t0.length < 60)
      );
      if (titleish) {
        title = bare(t0);
        first.paras.shift();
      }
      const bl = first.paras.length ? bylineOf((first.paras[0].text || '').trim()) : null;
      if (bl) {
        author = bare(bl);
        first.paras.shift();
      }
      if (!first.paras.length) chapters.shift();
      if (!chapters.length) chapters.push({ title: '', paras: [{ text: '' }] });
    }

    // a role only holds in its place: the prologue first, the epilogue last
    chapters.forEach((ch, i) => {
      if ((ch.role === 'prologue' && i !== 0) || (ch.role === 'epilogue' && i !== chapters.length - 1) || chapters.length < 2) ch.role = null;
    });
    if (styledTitle && title === styledTitle) title = bare(title);
    return { name, title, author, chapters };
  }

  const api = { parseManuscript, decodeText, CHAPTER_WORDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
