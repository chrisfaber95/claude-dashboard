// Strict allowlist check for skin artwork SVGs. Files under public/ are served same-origin, and an SVG opened directly
// is a document that could run script, so every committed SVG must be plain shapes and gradients. Used by the build
// (copy-assets.mjs fails on a bad file) and by tests/root-assets.test.ts.

const ELEMENTS = new Set(['svg', 'g', 'defs', 'linearGradient', 'radialGradient', 'stop', 'path', 'ellipse', 'circle', 'line', 'polygon', 'polyline', 'rect']);

const ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'preserveAspectRatio', 'id', 'transform', 'opacity',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'd', 'points',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin',
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
// Optional XML declaration, nothing else may precede the root element.
const DECL = /^<\?xml version="1\.[0-9]"(?: encoding="[Uu][Tt][Ff]-8")?\s*\?>/;
// One tag: an end tag, or a start tag with double-quoted attributes. Values may not hold < > & \ or quotes,
// which rules out character references, CSS escapes and CSS strings (src('…')).
const TAG = /<\/([A-Za-z]+)\s*>|<([A-Za-z]+)((?:\s+[A-Za-z][A-Za-z0-9-]*="[^"'<>&\\]*")*)\s*(\/?)>/y;
const ATTR = /([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g;

const MAX_BYTES = 1024 * 1024;

/** Returns a list of problems; an empty list means the file is safe to serve. */
export function checkSvg(text) {
  if (text.length > MAX_BYTES) return [`larger than ${MAX_BYTES} bytes`];
  const problems = [];
  // Printable ASCII and ordinary whitespace only: no hidden characters, no non-ASCII look-alikes.
  if (/[^\t\n\r\x20-\x7e]/.test(text)) problems.push('contains characters outside printable ASCII');
  // An XML declaration must be the very first bytes, so match it before trimming.
  const decl = DECL.exec(text);
  let s = (decl ? text.slice(decl[0].length) : text).trim();
  if (!decl && /^\s+<\?xml/.test(text)) problems.push('XML declaration is not at the start of the file');
  if (!s.startsWith('<svg')) problems.push('does not start with <svg>');

  const stack = [];
  let pos = 0;
  let roots = 0;
  while (pos < s.length) {
    // Whitespace between tags is fine; any other text, comment, CDATA, doctype or processing instruction is not.
    const ws = /\s*/y;
    ws.lastIndex = pos;
    ws.exec(s);
    pos = ws.lastIndex;
    if (pos >= s.length) break;
    TAG.lastIndex = pos;
    const m = TAG.exec(s);
    if (!m) {
      problems.push(`unexpected content at offset ${pos}: ${JSON.stringify(s.slice(pos, pos + 30))}`);
      break;
    }
    pos = TAG.lastIndex;
    const [, endName, startName, attrs, selfClose] = m;
    if (endName) {
      if (stack.pop() !== endName) problems.push(`mismatched </${endName}>`);
      continue;
    }
    if (!ELEMENTS.has(startName)) problems.push(`element <${startName}> is not allowed`);
    if (stack.length === 0) {
      roots++;
      if (startName !== 'svg') problems.push('root element is not <svg>');
    }
    let hasNs = false;
    for (const [, name, value] of attrs.matchAll(ATTR)) {
      if (!ATTRIBUTES.has(name)) problems.push(`attribute ${name} on <${startName}> is not allowed`);
      if (name === 'xmlns') {
        hasNs = true;
        if (value !== SVG_NS || startName !== 'svg') problems.push(`xmlns="${value}" on <${startName}> is not allowed`);
        continue; // checked exactly above; the namespace URI itself is not a fetched URL
      }
      // Only local gradient references, never external resources. CSS accepts an unterminated url( too, so drop the
      // well-formed local ones and reject any url( that is left.
      if (/url\(/i.test(value.replace(/url\(#[A-Za-z0-9_-]+\)/g, ''))) problems.push(`attribute ${name} has a non-local url()`);
      if (/(?:javascript|data|vbscript|https?|ftp|file):|\/\//i.test(value)) problems.push(`attribute ${name} contains a URL scheme`);
    }
    if (stack.length === 0 && startName === 'svg' && !hasNs) problems.push(`root <svg> lacks xmlns="${SVG_NS}"`);
    if (!selfClose) stack.push(startName);
  }
  if (stack.length) problems.push(`unclosed <${stack.join('>, <')}>`);
  if (roots > 1) problems.push('more than one root element');
  return problems;
}
