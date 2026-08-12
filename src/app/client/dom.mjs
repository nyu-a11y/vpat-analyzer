export function createDomHelpers(documentRef) {
  function append(parent, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      for (const item of child) append(parent, item);
      return;
    }
    parent.append(child instanceof documentRef.defaultView.Node ? child : documentRef.createTextNode(String(child)));
  }

  function setAttribute(node, name, value) {
    if (value == null || (value === false && !name.startsWith('aria-'))) return;
    if (name === 'className') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'hidden') node.hidden = Boolean(value);
    else if (name === 'disabled') node.disabled = Boolean(value);
    else if (name === 'open') node.open = Boolean(value);
    else if (name === 'tabIndex') node.tabIndex = Number(value);
    else if (name === 'colSpan') node.colSpan = Number(value);
    else if (name === 'scope') node.scope = String(value);
    else if (name.startsWith('data-') || name.startsWith('aria-')) node.setAttribute(name, String(value));
    else node.setAttribute(name, value === true ? '' : String(value));
  }

  function el(tagName, attributes = {}, ...children) {
    const node = documentRef.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) setAttribute(node, name, value);
    for (const child of children) append(node, child);
    return node;
  }

  function textList(items) {
    return items.filter(value => value != null && String(value).trim()).join(' · ');
  }

  return { el, textList };
}
