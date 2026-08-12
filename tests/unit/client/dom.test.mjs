import assert from 'node:assert/strict';
import test from 'node:test';

import { createDomHelpers } from '../../../src/app/client/dom.mjs';

class FakeNode {
  constructor(tagName = '#text', text = '') {
    this.tagName = tagName;
    this.textContent = text;
    this.attributes = new Map();
    this.children = [];
  }

  append(child) {
    this.children.push(child);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
}

const fakeDocument = {
  defaultView: { Node: FakeNode },
  createElement: tagName => new FakeNode(tagName),
  createTextNode: value => new FakeNode('#text', value),
};

test('DOM helper serializes ARIA booleans explicitly while rendering user text as a text node', () => {
  const { el } = createDomHelpers(fakeDocument);
  const node = el('button', { 'aria-selected': false, 'aria-pressed': true }, '<img src=x onerror=alert(1)>');
  assert.equal(node.getAttribute('aria-selected'), 'false');
  assert.equal(node.getAttribute('aria-pressed'), 'true');
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].tagName, '#text');
  assert.equal(node.children[0].textContent, '<img src=x onerror=alert(1)>');
});
