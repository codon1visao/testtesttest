/** The nearest element that contains both: the row or group two controls share. */
export function commonAncestor(a: Element, b: Element): Element {
  let node: Element | null = a;
  while (node !== null && !node.contains(b)) node = node.parentElement;
  if (node === null) throw new Error("the elements share no ancestor");
  return node;
}
