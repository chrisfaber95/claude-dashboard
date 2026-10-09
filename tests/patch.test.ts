import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchChildren } from '../src/client/patch.ts';
import type { PNode } from '../src/client/patch.ts';

// A tiny fake DOM that counts every mutation, so tests can assert "nothing was written".
let writes = 0;

class FakeNode implements PNode {
  parent: FakeNode | null = null;
  kids: FakeNode[] = [];
  attrs = new Map<string, string>();
  nodeType: number;
  nodeName: string;
  #value: string | null;
  constructor(nodeType: number, nodeName: string, value: string | null = null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.#value = value;
  }
  get nodeValue(): string | null {
    return this.#value;
  }
  set nodeValue(v: string | null) {
    writes++;
    this.#value = v;
  }
  get childNodes(): FakeNode[] {
    return this.kids;
  }
  get firstChild(): FakeNode | null {
    return this.kids[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const i = this.parent ? this.parent.kids.indexOf(this) : -1;
    return this.parent?.kids[i + 1] ?? null;
  }
  getAttribute(n: string): string | null {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string): void {
    writes++;
    this.attrs.set(n, v);
  }
  removeAttribute(n: string): void {
    writes++;
    this.attrs.delete(n);
  }
  attrNames(): string[] {
    return [...this.attrs.keys()];
  }
  insertBefore(node: PNode, ref: PNode | null): void {
    const n = node as FakeNode;
    writes++;
    n.parent?.kids.splice(n.parent.kids.indexOf(n), 1);
    n.parent = this;
    const i = ref ? this.kids.indexOf(ref as FakeNode) : this.kids.length;
    this.kids.splice(i, 0, n);
  }
  removeChild(node: PNode): void {
    writes++;
    const n = node as FakeNode;
    this.kids.splice(this.kids.indexOf(n), 1);
    n.parent = null;
  }
}

const text = (v: string) => new FakeNode(3, '#text', v);
function el(name: string, attrs: Record<string, string>, ...kids: Array<FakeNode | string>): FakeNode {
  const e = new FakeNode(1, name.toUpperCase());
  for (const [k, v] of Object.entries(attrs)) e.attrs.set(k, v);
  for (const k of kids) {
    const n = typeof k === 'string' ? text(k) : k;
    n.parent = e;
    e.kids.push(n);
  }
  return e;
}
const row = (key: string, label: string, tokens: string) => el('tr', { 'data-key': key }, el('td', {}, label), el('td', { class: 'num' }, tokens));
const table = (...rows: FakeNode[]) => el('div', {}, el('table', {}, el('tbody', {}, ...rows)));
const rowsOf = (root: FakeNode) => root.kids[0]!.kids[0]!.kids;

test('an identical render writes nothing and keeps every node', () => {
  const live = table(row('a', 'alpha', '1k'), row('b', 'beta', '2k'));
  const before = [...rowsOf(live)];
  writes = 0;
  patchChildren(live, table(row('a', 'alpha', '1k'), row('b', 'beta', '2k')));
  assert.equal(writes, 0);
  assert.deepEqual(rowsOf(live), before);
});

test('only the changed text is written; unchanged rows keep their node', () => {
  const live = table(row('a', 'alpha', '1k'), row('b', 'beta', '2k'));
  const [a, b] = rowsOf(live);
  writes = 0;
  patchChildren(live, table(row('a', 'alpha', '1k'), row('b', 'beta', '3k')));
  assert.equal(writes, 1);
  assert.equal(rowsOf(live)[0], a);
  assert.equal(rowsOf(live)[1], b);
  assert.equal(b!.kids[1]!.kids[0]!.nodeValue, '3k');
});

test('attributes are added, changed and removed on the kept element', () => {
  const live = el('div', { class: 'a', title: 'x' }, 'hi');
  const same = live;
  patchChildren(el('section', {}, live), el('section', {}, el('div', { class: 'b', id: 'n' }, 'hi')));
  assert.equal(same.getAttribute('class'), 'b');
  assert.equal(same.getAttribute('title'), null);
  assert.equal(same.getAttribute('id'), 'n');
});

test('keyed rows keep their node when added, removed and reordered', () => {
  const live = table(row('a', 'alpha', '1'), row('b', 'beta', '2'), row('c', 'gamma', '3'));
  const [a, b, c] = rowsOf(live);
  patchChildren(live, table(row('c', 'gamma', '3'), row('d', 'delta', '4'), row('a', 'alpha', '1')));
  const now = rowsOf(live);
  assert.equal(now.length, 3);
  assert.equal(now[0], c);
  assert.equal(now[2], a);
  assert.equal(now[1]!.getAttribute('data-key'), 'd');
  assert.equal(b!.parent, null);
});

test('a new section appears and an old one goes away', () => {
  const live = el('div', {}, el('h2', {}, 'T'), el('div', { class: 'empty' }, 'none'));
  const h = live.kids[0];
  patchChildren(live, el('div', {}, el('h2', {}, 'T'), el('ul', {}, el('li', { 'data-key': 'x' }, 'one'))));
  assert.equal(live.kids[0], h);
  assert.equal(live.kids[1]!.nodeName, 'UL');
  assert.equal(live.kids.length, 2);
});

test('an open <details> stays as the reader left it', () => {
  const live = el('div', {}, el('details', { open: '' }, el('summary', {}, 's')));
  const d = live.kids[0]!;
  patchChildren(live, el('div', {}, el('details', {}, el('summary', {}, 's'))));
  assert.equal(live.kids[0], d);
  assert.equal(d.getAttribute('open'), '');
});

test('patchIfChanged: unchanged markup does not call the patcher again', async () => {
  const { patchIfChanged, forgetHtml } = await import('../src/client/patch.ts');
  const el = {};
  let calls = 0;
  const run = () => calls++;
  assert.equal(patchIfChanged(el, '<p>a</p>', run), true);
  assert.equal(patchIfChanged(el, '<p>a</p>', run), false);
  assert.equal(calls, 1);
  assert.equal(patchIfChanged(el, '<p>b</p>', run), true);
  forgetHtml(el);
  assert.equal(patchIfChanged(el, '<p>b</p>', run), true);
  assert.equal(calls, 3);
});
