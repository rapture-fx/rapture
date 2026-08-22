'use strict'

class LRUCache {
  constructor () {
    this.max = 1000
    this.map = new Map()
  }

  get (key) {
    return this.map.get(key)
  }

  delete (key) {
    return this.map.delete(key)
  }

  set (key, value) {
    if (value !== undefined) {
      this.map.set(key, value)
    }

    return this
  }
}

module.exports = LRUCache
