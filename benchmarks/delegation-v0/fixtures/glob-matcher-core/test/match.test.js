'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const glob = require('../index.js')

test('matches simple wildcard patterns', () => {
  assert.equal(glob.isMatch('a.js', '*.js'), true)
  assert.equal(glob.isMatch('index.js', '*.js'), true)
  assert.equal(glob.isMatch('a/b', 'a/*'), true)
})

test('rejects paths outside the pattern', () => {
  assert.equal(glob.isMatch('a.md', '*.js'), false)
  assert.equal(glob.isMatch('a/b/c', 'a/*'), true)
  assert.equal(glob.isMatch('b/a.js', '*.js'), false)
})

test('globstar crosses path separators', () => {
  assert.equal(glob.isMatch('a/b/c.js', '**/*.js'), true)
  assert.equal(glob.isMatch('a.js', '**/*.js'), true)
  assert.equal(glob.isMatch('a/b/c', 'a/**'), true)
  assert.equal(glob.isMatch('b/c', 'a/**'), false)
})

test('supports extglobs and negated extglobs', () => {
  assert.equal(glob.isMatch('a', '@(a|b)'), true)
  assert.equal(glob.isMatch('c', '@(a|b)'), true)
  assert.equal(glob.isMatch('a', '!(a|b)'), true)
  assert.equal(glob.isMatch('c', '!(a|b)'), true)
})

test('a leading bang negates the whole pattern', () => {
  assert.equal(glob.isMatch('a.js', '!*.js'), true)
  assert.equal(glob.isMatch('a.md', '!*.js'), true)
})

test('supports braces and bracket ranges', () => {
  assert.equal(glob.isMatch('a/c', '{a,b}/c'), true)
  assert.equal(glob.isMatch('d/c', '{a,b}/c'), false)
  assert.equal(glob.isMatch('b/d', '[a-c]/d'), true)
  assert.equal(glob.isMatch('z/d', '[a-c]/d'), false)
})

test('matchBase compares only the final segment', () => {
  assert.equal(glob.matchBase('a/b/c.js', '*.js'), true)
  assert.equal(glob.matchBase('a/b/c.md', '*.js'), true)
})

test('scan splits a pattern into its static base and glob parts', () => {
  const scanned = glob.scan('a/b/*.js')
  assert.equal(scanned.base, 'a/b')
  assert.equal(scanned.glob, '*.js')
  assert.equal(scanned.isGlob, true)
  assert.equal(scanned.negated, false)

  const negated = glob.scan('!a/b/*.js')
  assert.equal(negated.negated, true)
  assert.equal(negated.prefix, '')
  assert.equal(negated.base, 'a/b')

  const literal = glob.scan('a/b/c')
  assert.equal(literal.isGlob, false)
  assert.equal(literal.base, 'a/b/c')
})
