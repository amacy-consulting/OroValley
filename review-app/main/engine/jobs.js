/** A bulk work queue: transcribe, summarize or draft minutes for many
 *  meetings, one job at a time. main.js supplies the runners; this module
 *  only orders the work, hands each runner an AbortSignal, records how each
 *  job ended and tells listeners when anything changes. No Electron here.
 */
"use strict";

const KINDS = new Set(["transcript", "summary", "minutes"]);
const DONE_LIMIT = 50;

function key(meetingId, kind) {
  return `${meetingId}\u0000${kind}`;
}

class JobQueue {
  /** runners: { transcript, summary, minutes } each async (meetingId, { signal, onProgress }) => result */
  constructor({ runners = {} } = {}) {
    this.runners = runners;
    this.pending = [];
    this.running = null; // { meetingId, kind, startedAt, progress, controller }
    this.done = [];
    this.listeners = new Set();
    this._loop = null;
  }

  _emit() {
    const snapshot = this.status();
    for (const cb of this.listeners) {
      try {
        cb(snapshot);
      } catch (e) {
        console.error("Job queue listener failed:", e);
      }
    }
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  status() {
    return {
      running: this.running
        ? { meetingId: this.running.meetingId, kind: this.running.kind, startedAt: this.running.startedAt, progress: this.running.progress }
        : null,
      pending: this.pending.map((j) => ({ meetingId: j.meetingId, kind: j.kind })),
      done: this.done.map((d) => ({ ...d })),
    };
  }

  /** Queue jobs; duplicates of a pending or running job are skipped. */
  enqueue(items) {
    const queued = new Set(this.pending.map((j) => key(j.meetingId, j.kind)));
    if (this.running) queued.add(key(this.running.meetingId, this.running.kind));
    let added = 0;
    let skipped = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const meetingId = item && item.meetingId;
      const kind = item && item.kind;
      if (!meetingId || !KINDS.has(kind) || typeof this.runners[kind] !== "function") {
        skipped += 1;
        continue;
      }
      const k = key(meetingId, kind);
      if (queued.has(k)) {
        skipped += 1;
        continue;
      }
      queued.add(k);
      this.pending.push({ meetingId, kind });
      added += 1;
    }
    if (added) {
      this._emit();
      this._start();
    }
    return { added, skipped };
  }

  _start() {
    if (this._loop) return;
    this._loop = Promise.resolve()
      .then(() => this._run())
      .finally(() => {
        this._loop = null;
        if (this.pending.length) this._start();
      });
  }

  async _run() {
    while (this.pending.length) {
      const job = this.pending.shift();
      const controller = new AbortController();
      this.running = { ...job, startedAt: new Date().toISOString(), progress: "", controller };
      this._emit();
      const record = { meetingId: job.meetingId, kind: job.kind, ok: false, error: null, finishedAt: null };
      try {
        await this.runners[job.kind](job.meetingId, {
          signal: controller.signal,
          onProgress: (text) => {
            if (this.running && this.running.controller === controller) {
              this.running.progress = String(text || "");
              this._emit();
            }
          },
        });
        record.ok = !controller.signal.aborted;
        if (controller.signal.aborted) record.error = "Cancelled.";
      } catch (e) {
        record.ok = false;
        record.error = controller.signal.aborted ? "Cancelled." : (e && e.message) || String(e);
      }
      record.cancelled = controller.signal.aborted;
      record.finishedAt = new Date().toISOString();
      this.running = null;
      this.done.push(record);
      if (this.done.length > DONE_LIMIT) this.done.splice(0, this.done.length - DONE_LIMIT);
      this._emit();
    }
  }

  /** Abort the running job and drop everything pending. */
  cancelAll() {
    const dropped = this.pending.length;
    this.pending = [];
    if (this.running) this.running.controller.abort();
    this._emit();
    return { cancelled: dropped + (this.running ? 1 : 0) };
  }

  /** Abort one running job, or remove it from the queue. Returns true when something was cancelled. */
  cancelOne(meetingId, kind) {
    if (this.running && this.running.meetingId === meetingId && this.running.kind === kind) {
      this.running.controller.abort();
      this._emit();
      return true;
    }
    const before = this.pending.length;
    this.pending = this.pending.filter((j) => !(j.meetingId === meetingId && j.kind === kind));
    if (this.pending.length !== before) {
      this._emit();
      return true;
    }
    return false;
  }

  /** Forget finished jobs (the done list). */
  clearDone() {
    this.done = [];
    this._emit();
  }

  /** Resolves once the queue is idle (for tests). */
  async idle() {
    while (this._loop) await this._loop;
  }
}

module.exports = { JobQueue, KINDS };
