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

const ELEMENT_NODE = 1;

const keyOf = (node: PNode): string | null => (node.nodeType === ELEMENT_NODE ? (node.getAttribute?.('data-key') ?? null) : null);

const sameKind = (a: PNode, b: PNode): boolean => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

function attrNames(node: PNode): string[] {
  if (node.attrNames) return node.attrNames();
  const attributes = (node as unknown as { attributes?: ArrayLike<{ name: string }> }).attributes;
  return attributes ? Array.from(attributes, (attribute) => attribute.name) : [];
}

function patchAttrs(oldElement: PNode, newElement: PNode): void {
  // The reader opens/closes <details> themselves; the markup never says which state they left it in.
  const skippedName = oldElement.nodeName === 'DETAILS' ? 'open' : '';
  const nextNames = new Set(attrNames(newElement));
  for (const name of attrNames(oldElement)) {
    if (name !== skippedName && !nextNames.has(name)) oldElement.removeAttribute!(name);
  }
  for (const name of nextNames) {
    if (name === skippedName) continue;
    const value = newElement.getAttribute!(name) ?? '';
    if (oldElement.getAttribute!(name) !== value) oldElement.setAttribute!(name, value);
  }
}

function patchNode(oldNode: PNode, newNode: PNode): void {
  if (oldNode.nodeType !== ELEMENT_NODE) {
    if (oldNode.nodeValue !== newNode.nodeValue) oldNode.nodeValue = newNode.nodeValue;
    return;
  }
  patchAttrs(oldNode, newNode);
  patchChildren(oldNode, newNode);
}

/** Make the children of `oldParent` equal to those of `newParent`, touching only what differs. `newParent`'s nodes may be moved. */
export function patchChildren(oldParent: PNode, newParent: PNode): void {
  const oldChildren = Array.from(oldParent.childNodes);
  const keyedChildren = new Map<string, PNode>();
  for (const child of oldChildren) {
    const key = keyOf(child);
    if (key !== null && !keyedChildren.has(key)) keyedChildren.set(key, child);
  }
  const usedNodes = new Set<PNode>();
  let reference: PNode | null = oldParent.firstChild;
  for (const newChild of Array.from(newParent.childNodes)) {
    const key = keyOf(newChild);
    let match: PNode | null = null;
    if (key !== null) {
      const candidate = keyedChildren.get(key);
      if (candidate && !usedNodes.has(candidate) && sameKind(candidate, newChild)) match = candidate;
    } else {
      while (reference && usedNodes.has(reference)) reference = reference.nextSibling;
      if (reference && keyOf(reference) === null && sameKind(reference, newChild)) match = reference;
    }
    if (match) {
      usedNodes.add(match);
      if (match === reference) reference = reference.nextSibling;
      else oldParent.insertBefore(match, reference);
      patchNode(match, newChild);
    } else {
      while (reference && usedNodes.has(reference)) reference = reference.nextSibling;
      usedNodes.add(newChild);
      oldParent.insertBefore(newChild, reference);
    }
  }
  for (const child of oldChildren) if (!usedNodes.has(child)) oldParent.removeChild(child);
}

const lastHtml = new WeakMap<object, string>();

/** Forget the remembered markup of `element`; call it when something other than `patchHtml` rewrites the element. */
export function forgetHtml(element: object): void {
  lastHtml.delete(element);
}

/** Run `patch` unless `html` equals what was last patched into `element`; returns whether it ran. */
export function patchIfChanged(element: object, html: string, patch: () => void): boolean {
  if (lastHtml.get(element) === html) return false;
  patch();
  lastHtml.set(element, html);
  return true;
}

/** Patch `element` to show `html`. Markup identical to the last call skips the DOM walk; an identical render writes nothing. */
export function patchHtml(element: HTMLElement, html: string): void {
  patchIfChanged(element, html, () => {
    const template = document.createElement('template');
    template.innerHTML = html;
    patchChildren(element, template.content);
  });
}
