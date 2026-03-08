'use strict';

class TraceStorage {
  constructor(options = {}) {
    this.maxTraces = options.maxTraces || 1000;
    this.retentionSeconds = options.retentionSeconds || 300;
    this.traces = new Map();
    this.order = [];
    this._cleanupInterval = null;
  }

  startCleanup(intervalMs) {
    if (this._cleanupInterval) return;
    this._cleanupInterval = setInterval(() => this._evictExpired(), intervalMs || 10000);
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  store(trace) {
    if (this.traces.size >= this.maxTraces) {
      this._evictOldest();
    }
    this.traces.set(trace.requestId, trace);
    this.order.push(trace.requestId);
  }

  get(requestId) {
    return this.traces.get(requestId) || null;
  }

  getRecent(limit = 50) {
    const ids = this.order.slice(-limit).reverse();
    const results = [];
    for (const id of ids) {
      const t = this.traces.get(id);
      if (t) results.push(t);
    }
    return results;
  }

  getSlow(threshold, limit = 50) {
    const results = [];
    const ids = this.order.slice().reverse();
    for (const id of ids) {
      if (results.length >= limit) break;
      const t = this.traces.get(id);
      if (t && t.duration >= threshold) {
        results.push(t);
      }
    }
    return results;
  }

  getAll() {
    return Array.from(this.traces.values());
  }

  clear() {
    this.traces.clear();
    this.order = [];
  }

  get size() {
    return this.traces.size;
  }

  _evictOldest() {
    while (this.order.length > 0 && this.traces.size >= this.maxTraces) {
      const oldId = this.order.shift();
      this.traces.delete(oldId);
    }
  }

  _evictExpired() {
    const cutoff = Date.now() - this.retentionSeconds * 1000;
    const newOrder = [];
    for (const id of this.order) {
      const t = this.traces.get(id);
      if (!t || t.startTime < cutoff) {
        this.traces.delete(id);
      } else {
        newOrder.push(id);
      }
    }
    this.order = newOrder;
  }
}

module.exports = TraceStorage;
