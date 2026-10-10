// DOM patching: unchanged markup writes nothing and kept nodes stay in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchChildren } from '../../../src/client/app/patch.ts';
import type { PNode } from '../../../src/client/app/patch.ts';

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
  set nodeValue(value: string | null) {
    writes++;
    this.#value = value;
  }
  get childNodes(): FakeNode[] {
    return this.kids;
  }
  get firstChild(): FakeNode | null {
    return this.kids[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const position = this.parent ? this.parent.kids.indexOf(this) : -1;
    return this.parent?.kids[position + 1] ?? null;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    writes++;
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    writes++;
    this.attrs.delete(name);
  }
  attrNames(): string[] {
    return [...this.attrs.keys()];
  }
  insertBefore(node: PNode, ref: PNode | null): void {
    const child = node as FakeNode;
    writes++;
    child.parent?.kids.splice(child.parent.kids.indexOf(child), 1);
    child.parent = this;
    const index = ref ? this.kids.indexOf(ref as FakeNode) : this.kids.length;
    this.kids.splice(index, 0, child);
  }
  removeChild(node: PNode): void {
    writes++;
    const child = node as FakeNode;
    this.kids.splice(this.kids.indexOf(child), 1);
    child.parent = null;
  }
}

const text = (value: string) => new FakeNode(3, '#text', value);
function element(name: string, attrs: Record<string, string>, ...kids: Array<FakeNode | string>): FakeNode {
  const created = new FakeNode(1, name.toUpperCase());
  for (const [attributeName, value] of Object.entries(attrs)) created.attrs.set(attributeName, value);
  for (const kid of kids) {
    const node = typeof kid === 'string' ? text(kid) : kid;
    node.parent = created;
    created.kids.push(node);
  }
  return created;
}
const row = (key: string, label: string, tokens: string) => element('tr', { 'data-key': key }, element('td', {}, label), element('td', { class: 'num' }, tokens));
const table = (...rows: FakeNode[]) => element('div', {}, element('table', {}, element('tbody', {}, ...rows)));
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
  const live = element('div', { class: 'a', title: 'x' }, 'hi');
  const same = live;
  patchChildren(element('section', {}, live), element('section', {}, element('div', { class: 'b', id: 'n' }, 'hi')));
  assert.equal(same.getAttribute('class'), 'b');
  assert.equal(same.getAttribute('title'), null);
  assert.equal(same.getAttribute('id'), 'n');
});

test('keyed rows keep their node when added, removed and reordered', () => {
  const live = table(row('a', 'alpha', '1'), row('b', 'beta', '2'), row('c', 'gamma', '3'));
  const [rowA, rowB, rowC] = rowsOf(live);
  patchChildren(live, table(row('c', 'gamma', '3'), row('d', 'delta', '4'), row('a', 'alpha', '1')));
  const now = rowsOf(live);
  assert.equal(now.length, 3);
  assert.equal(now[0], rowC);
  assert.equal(now[2], rowA);
  assert.equal(now[1]!.getAttribute('data-key'), 'd');
  assert.equal(rowB!.parent, null);
});

test('a new section appears and an old one goes away', () => {
  const live = element('div', {}, element('h2', {}, 'T'), element('div', { class: 'empty' }, 'none'));
  const heading = live.kids[0];
  patchChildren(live, element('div', {}, element('h2', {}, 'T'), element('ul', {}, element('li', { 'data-key': 'x' }, 'one'))));
  assert.equal(live.kids[0], heading);
  assert.equal(live.kids[1]!.nodeName, 'UL');
  assert.equal(live.kids.length, 2);
});

test('an open <details> stays as the reader left it', () => {
  const live = element('div', {}, element('details', { open: '' }, element('summary', {}, 's')));
  const details = live.kids[0]!;
  patchChildren(live, element('div', {}, element('details', {}, element('summary', {}, 's'))));
  assert.equal(live.kids[0], details);
  assert.equal(details.getAttribute('open'), '');
});

test('patchIfChanged: unchanged markup does not call the patcher again', async () => {
  const { patchIfChanged, forgetHtml } = await import('../../../src/client/app/patch.ts');
  const target = {};
  let calls = 0;
  const run = () => calls++;
  assert.equal(patchIfChanged(target, '<p>a</p>', run), true);
  assert.equal(patchIfChanged(target, '<p>a</p>', run), false);
  assert.equal(calls, 1);
  assert.equal(patchIfChanged(target, '<p>b</p>', run), true);
  forgetHtml(target);
  assert.equal(patchIfChanged(target, '<p>b</p>', run), true);
  assert.equal(calls, 3);
});
