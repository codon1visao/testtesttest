/** The nearest element that contains both: the row or group two controls share. */
export function commonAncestor(a: Element, b: Element): HTMLElement {
  let node: HTMLElement | null = a instanceof HTMLElement ? a : a.parentElement;
  while (node !== null && !node.contains(b)) node = node.parentElement;
  if (node === null) throw new Error("the elements share no ancestor");
  return node;
}
