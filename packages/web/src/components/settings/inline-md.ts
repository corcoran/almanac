export type InlineSeg =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "code"; v: string };

// Tokenize a changelog item's inline markdown. Supported grammar is ours and
// tiny: **bold** and `code`. Everything else is literal text — including any
// HTML, which is returned as text segments (the Vue template renders these via
// {{ }} interpolation, so it's escaped; there is no v-html and no XSS surface).
// An unterminated ** or ` is emitted as literal text.
export function parseInline(s: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let i = 0;
  let plainStart = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) segs.push({ t: "text", v: s.slice(plainStart, end) });
  };

  while (i < s.length) {
    if (s.startsWith("**", i)) {
      const close = s.indexOf("**", i + 2);
      if (close !== -1) {
        flushPlain(i);
        segs.push({ t: "strong", v: s.slice(i + 2, close) });
        i = close + 2;
        plainStart = i;
        continue;
      }
    } else if (s[i] === "`") {
      const close = s.indexOf("`", i + 1);
      if (close !== -1) {
        flushPlain(i);
        segs.push({ t: "code", v: s.slice(i + 1, close) });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }
    i += 1;
  }
  flushPlain(s.length);
  return segs;
}
