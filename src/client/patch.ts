// In-place DOM patcher for the section renders. A push builds the new markup off-screen and this walks it against the
// live tree: equal nodes are left alone, changed text/attributes are written, and elements with a `data-key` are
// matched by key (so rows keep their node when the list reorders). Focus, selection, scroll, CSS animations and
// transitions on kept nodes survive because the nodes themselves are never replaced.

/** The slice of the DOM the patcher touches; real nodes satisfy it, tests use a small fake. */
export interface PNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  firstChild: PNode | null;
  nextSibling: PNode | null;
  childNodes: ArrayLike<PNode>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  attrNames?(): string[];
  insertBefore(node: PNode, ref: PNode | null): unknown;
  removeChild(node: PNode): unknown;
}

const ELEMENT = 1;

const keyOf = (n: PNode): string | null => (n.nodeType === ELEMENT ? (n.getAttribute?.('data-key') ?? null) : null);

const sameKind = (a: PNode, b: PNode): boolean => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

function attrNames(n: PNode): string[] {
  if (n.attrNames) return n.attrNames();
  const attrs = (n as unknown as { attributes?: ArrayLike<{ name: string }> }).attributes;
  return attrs ? Array.from(attrs, (a) => a.name) : [];
}

function patchAttrs(oldEl: PNode, newEl: PNode): void {
  // The reader opens/closes <details> themselves; the markup never says which state they left it in.
  const skip = oldEl.nodeName === 'DETAILS' ? 'open' : '';
  const next = new Set(attrNames(newEl));
  for (const name of attrNames(oldEl)) if (name !== skip && !next.has(name)) oldEl.removeAttribute!(name);
  for (const name of next) {
    if (name === skip) continue;
    const v = newEl.getAttribute!(name) ?? '';
    if (oldEl.getAttribute!(name) !== v) oldEl.setAttribute!(name, v);
  }
}

function patchNode(oldN: PNode, newN: PNode): void {
  if (oldN.nodeType !== ELEMENT) {
    if (oldN.nodeValue !== newN.nodeValue) oldN.nodeValue = newN.nodeValue;
    return;
  }
  patchAttrs(oldN, newN);
  patchChildren(oldN, newN);
}

/** Make the children of `oldParent` equal to those of `newParent`, touching only what differs. `newParent`'s nodes may be moved. */
export function patchChildren(oldParent: PNode, newParent: PNode): void {
  const oldKids = Array.from(oldParent.childNodes);
  const keyed = new Map<string, PNode>();
  for (const k of oldKids) {
    const key = keyOf(k);
    if (key !== null && !keyed.has(key)) keyed.set(key, k);
  }
  const used = new Set<PNode>();
  let ref: PNode | null = oldParent.firstChild;
  for (const n of Array.from(newParent.childNodes)) {
    const key = keyOf(n);
    let match: PNode | null = null;
    if (key !== null) {
      const m = keyed.get(key);
      if (m && !used.has(m) && sameKind(m, n)) match = m;
    } else {
      while (ref && used.has(ref)) ref = ref.nextSibling;
      if (ref && keyOf(ref) === null && sameKind(ref, n)) match = ref;
    }
    if (match) {
      used.add(match);
      if (match === ref) ref = ref.nextSibling;
      else oldParent.insertBefore(match, ref);
      patchNode(match, n);
    } else {
      while (ref && used.has(ref)) ref = ref.nextSibling;
      used.add(n);
      oldParent.insertBefore(n, ref);
    }
  }
  for (const k of oldKids) if (!used.has(k)) oldParent.removeChild(k);
}

const lastHtml = new WeakMap<object, string>();

/** Forget the remembered markup of `el`; call it when something other than `patchHtml` rewrites the element. */
export function forgetHtml(el: object): void {
  lastHtml.delete(el);
}

/** Run `patch` unless `html` equals what was last patched into `el`; returns whether it ran. */
export function patchIfChanged(el: object, html: string, patch: () => void): boolean {
  if (lastHtml.get(el) === html) return false;
  patch();
  lastHtml.set(el, html);
  return true;
}

/** Patch `el` to show `html`. Markup identical to the last call skips the DOM walk; an identical render writes nothing. */
export function patchHtml(el: HTMLElement, html: string): void {
  patchIfChanged(el, html, () => {
    const t = document.createElement('template');
    t.innerHTML = html;
    patchChildren(el, t.content);
  });
}
