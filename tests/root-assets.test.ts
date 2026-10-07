import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Security guard for the Root skin artwork. The SVGs come from an untrusted design file and everything in public/
// is served same-origin, so a scripted SVG opened directly would run. The checker is the same one the build uses
// (scripts/svg-guard.mjs), so test and build cannot drift.

const ROOT_DIR = fileURLToPath(new URL('../src/client/root/', import.meta.url));
const guardUrl = pathToFileURL(join(import.meta.dirname, '..', 'scripts', 'svg-guard.mjs')).href;
const { checkSvg } = (await import(guardUrl)) as { checkSvg: (text: string) => string[] };

const NS = 'xmlns="http://www.w3.org/2000/svg"';

function listRootFiles(): string[] {
  assert.ok(existsSync(ROOT_DIR), `Root skin artwork folder is missing: ${ROOT_DIR}`);
  return readdirSync(ROOT_DIR);
}

test('Root artwork folder holds at least one .svg and nothing else', () => {
  const files = listRootFiles();
  assert.ok(files.some((f) => extname(f).toLowerCase() === '.svg'), 'no .svg files in src/client/root');
  const others = files.filter((f) => extname(f).toLowerCase() !== '.svg');
  assert.deepEqual(others, [], `unexpected non-svg entries in src/client/root: ${others.join(', ')}`);
});

test('every Root SVG passes the build checker', () => {
  const files = listRootFiles().filter((f) => extname(f).toLowerCase() === '.svg');
  assert.ok(files.length > 0, 'no .svg files in src/client/root');
  for (const f of files) {
    const src = readFileSync(join(ROOT_DIR, f), 'utf8');
    assert.deepEqual(checkSvg(src), [], `${f}: unsafe content`);
  }
});

test('checkSvg accepts a minimal svg, an XML declaration and gradients', () => {
  assert.deepEqual(checkSvg(`<svg ${NS}/>`), []);
  assert.deepEqual(checkSvg(`<svg ${NS} viewBox="0 0 1 1"></svg>`), []);
  assert.deepEqual(checkSvg(`<?xml version="1.0" encoding="UTF-8"?>\n<svg ${NS}/>`), []);
  assert.deepEqual(
    checkSvg(`<svg ${NS}><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)"/></svg>`),
    [],
  );
});

const NONLOCAL = (name: string) => new RegExp(`attribute ${name} has a non-local url\\(\\)`);
const UNEXPECTED = /unexpected content at offset/;

// Each case names the problem the guard must report, not just "something". Where the only problem raised is a generic
// one (unexpected content, does not start with <svg>), that generic message is asserted on purpose.
const REJECTED: Array<[string, string, RegExp[]]> = [
  // Generic: a prefixed or underscore element name does not match the tag grammar, so the scanner stops there.
  ['namespaced script via custom prefix', `<svg ${NS}><_:script xmlns:_="http://www.w3.org/2000/svg">x</_:script></svg>`, [UNEXPECTED]],
  ['svg:script', `<svg ${NS}><svg:script>x</svg:script></svg>`, [UNEXPECTED]],
  ['style attribute with url()', `<svg ${NS}><rect style="fill:url(http://e/x)"/></svg>`, [/attribute style on <rect> is not allowed/, NONLOCAL('style')]],
  // Generic: & in a value does not match the tag grammar.
  ['character reference hiding url(', `<svg ${NS}><rect fill="u&#x72;l(http://e)"/></svg>`, [UNEXPECTED]],
  // Generic: a backslash in a value does not match the tag grammar.
  ['CSS escape hiding url(', String.raw`<svg ${NS}><rect fill="\75 rl(x)"/></svg>`, [UNEXPECTED]],
  // Generic: a leading processing instruction is caught only by "does not start with <svg>".
  ['xml-stylesheet before svg', `<?xml-stylesheet type="text/xsl" href="#x"?><svg ${NS}/>`, [/does not start with <svg>/]],
  ['processing instruction inside svg', `<svg ${NS}><?pi x?></svg>`, [UNEXPECTED]],
  ['onload', `<svg ${NS} onload="alert(1)"/>`, [/attribute onload on <svg> is not allowed/]],
  // Generic: text between tags is not a tag.
  ['text content', `<svg ${NS}>hello</svg>`, [UNEXPECTED]],
  ['url() to another file', `<svg ${NS}><rect fill="url(other.svg#a)"/></svg>`, [NONLOCAL('fill')]],
  // Generic: comments are not a tag.
  ['comment', `<svg ${NS}><!-- hi --></svg>`, [UNEXPECTED]],
  ['non-ASCII look-alike', `<svg ${NS}><rect fill="url(#а)"/></svg>`, [/outside printable ASCII/, NONLOCAL('fill')]],
  // Generic: an unquoted value does not match the tag grammar.
  ['unquoted attribute', `<svg ${NS}><rect width=5/></svg>`, [UNEXPECTED]],
  ['missing xmlns', '<svg><rect/></svg>', [/root <svg> lacks xmlns/]],
  ['foreignObject', `<svg ${NS}><foreignObject/></svg>`, [/element <foreignObject> is not allowed/]],
  // Generic: a colon in an attribute name does not match the tag grammar.
  ['xmlns:xlink declaration', `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"/>`, [UNEXPECTED]],
  ['unclosed tag', `<svg ${NS}><g><rect/></svg>`, [/mismatched <\/svg>/, /unclosed <svg>/]],
  // url( bypasses: anything left after removing well-formed url(#id) is rejected.
  ['protocol-relative url( without closing paren', `<svg ${NS}><rect fill="url(//evil.example/p.svg#g"/></svg>`, [NONLOCAL('fill')]],
  ['ftp url( without closing paren', `<svg ${NS}><rect fill="url(ftp://evil/p.svg#g"/></svg>`, [NONLOCAL('fill')]],
  ['relative file url( without closing paren on stroke', `<svg ${NS}><rect stroke="url(other.svg#g"/></svg>`, [NONLOCAL('stroke')]],
  ['local url followed by an unterminated external url(', `<svg ${NS}><rect fill="url(#a) url(//evil/x#b"/></svg>`, [NONLOCAL('fill')]],
  ['whitespace before the XML declaration', `\n<?xml version="1.0"?>\n<svg ${NS}/>`, [/XML declaration is not at the start of the file/]],
  ['space before the XML declaration', ` <?xml version="1.0"?><svg ${NS}/>`, [/XML declaration is not at the start of the file/]],
];

for (const [label, svg, expected] of REJECTED) {
  test(`checkSvg rejects: ${label}`, () => {
    const problems = checkSvg(svg);
    for (const re of expected) {
      assert.ok(problems.some((p) => re.test(p)), `expected ${re} in ${JSON.stringify(problems)} for ${svg}`);
    }
  });
}

test('checkSvg accepts a local url(#id) fill on a rect', () => {
  assert.deepEqual(checkSvg(`<svg ${NS}><rect fill="url(#a)"/></svg>`), []);
});
