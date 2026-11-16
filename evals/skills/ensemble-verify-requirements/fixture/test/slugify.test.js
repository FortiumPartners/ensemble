'use strict';
const { slugify } = require('../src/slugify');

test('lowercases and dashes', () => expect(slugify('Hello, World!')).toBe('hello-world'));
