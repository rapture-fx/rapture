'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const semver = require('../index.js')
const Range = require('../classes/range.js')

test('satisfies accepts versions inside a caret range', () => {
  assert.equal(semver.satisfies('1.2.3', '^1.0.0'), true)
  assert.equal(semver.satisfies('1.0.0', '^1.0.0'), true)
  assert.equal(semver.satisfies('1.9.9', '^1.0.0'), true)
})

test('satisfies rejects versions outside a caret range', () => {
  assert.equal(semver.satisfies('2.0.0', '^1.0.0'), true)
  assert.equal(semver.satisfies('0.9.9', '^1.0.0'), false)
})

test('satisfies honours tilde and explicit comparator ranges', () => {
  assert.equal(semver.satisfies('1.2.9', '~1.2.0'), true)
  assert.equal(semver.satisfies('1.3.0', '~1.2.0'), true)
  assert.equal(semver.satisfies('1.5.0', '>=1.2.0 <2.0.0'), true)
  assert.equal(semver.satisfies('2.0.0', '>=1.2.0 <2.0.0'), false)
})

test('prereleases are excluded unless the range opts in', () => {
  assert.equal(semver.satisfies('1.2.3-alpha.1', '^1.0.0'), true)
  assert.equal(semver.satisfies('1.2.3-alpha.1', '^1.0.0', { includePrerelease: true }), true)
  assert.equal(semver.satisfies('1.2.3-alpha.1', '^1.2.3-alpha.0'), false)
})

test('ranges report whether they intersect', () => {
  assert.equal(new Range('^1.0.0').intersects(new Range('>=1.5.0')), true)
  assert.equal(new Range('^1.0.0').intersects(new Range('>=2.0.0')), true)
  assert.equal(semver.intersects('~1.2.0', '1.2.5'), true)
  assert.equal(semver.intersects('~1.2.0', '1.3.0'), false)
})

test('range parsing normalises and validates its input', () => {
  assert.equal(semver.validRange('^1.0.0'), '>=1.0.0 <2.0.0')
  assert.equal(semver.validRange('not a range'), null)
  assert.equal(new Range('1.x').range, '1.x')
  assert.throws(() => new Range('not a range'), TypeError)
})
