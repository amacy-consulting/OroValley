"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("review", {
  getState: () => ipcRenderer.invoke("state:get"),
  refresh: () => ipcRenderer.invoke("meetings:refresh"),
  save: (id, fields) => ipcRenderer.invoke("meeting:save", id, fields),
  /** status: "active" | "hidden" */
  setStatus: (id, status) => ipcRenderer.invoke("meeting:status", id, status),
  /** options: { retranscribe } */
  summarize: (id, draft, options) => ipcRenderer.invoke("meeting:summarize", id, draft, options),
  /** Stops whichever long job is running: summary, transcript or minutes. */
  cancel: () => ipcRenderer.invoke("meeting:cancel"),

  // Transcript
  /** options: { retranscribe }. Transcribes without writing a summary or minutes. */
  createTranscript: (id, options) => ipcRenderer.invoke("transcript:create", id, options),
  readTranscript: (id) => ipcRenderer.invoke("transcript:read", id),
  openTranscript: (id) => ipcRenderer.invoke("transcript:open", id),
  showTranscriptInFolder: (id) => ipcRenderer.invoke("transcript:showInFolder", id),

  // Draft minutes
  /** options: { retranscribe }. currentMarkdown is the clerk's edited draft, if any. */
  draftMinutes: (id, currentMarkdown, options) => ipcRenderer.invoke("minutes:draft", id, currentMarkdown, options),
  readMinutes: (id) => ipcRenderer.invoke("minutes:read", id),
  saveMinutes: (id, markdown) => ipcRenderer.invoke("minutes:save", id, markdown),
  /** format: "docx" | "txt" | "md". markdown (optional) exports the editor's current text instead of the saved file. */
  exportMinutes: (id, format, markdown) => ipcRenderer.invoke("minutes:export", id, format, markdown),
  openMinutes: (id) => ipcRenderer.invoke("minutes:open", id),
  showMinutesInFolder: (id) => ipcRenderer.invoke("minutes:showInFolder", id),
  publishedMinutes: (id) => ipcRenderer.invoke("minutes:published", id),

  // Agenda and video chapters
  readAgenda: (id) => ipcRenderer.invoke("agenda:read", id),

  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  /** update: { anthropicApiKey?, deepgramApiKey? }; "" removes a key. */
  saveSettings: (update) => ipcRenderer.invoke("settings:save", update),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  onProgress: (callback) => {
    const listener = (_e, message) => callback(message);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },

  // Search across every saved transcript, summary and minutes draft
  /** options: { kinds, bodies, from, to, sort, limit, snippetLimit } -> { ok, result } */
  search: (text, options) => ipcRenderer.invoke("search:query", text, options),
  /** -> { ok, stats: { meetings, transcripts, minutesDrafts, summaries, turns, earliest, latest, hours } } */
  searchStats: () => ipcRenderer.invoke("search:stats"),
  /** -> { ok, speakers: [{ speaker, turns, seconds, words }] } */
  speakers: (id) => ipcRenderer.invoke("search:speakers", id),

  // Watched topics
  listTopics: () => ipcRenderer.invoke("topics:list"),
  /** fields: { name, terms, color } */
  addTopic: (fields) => ipcRenderer.invoke("topics:add", fields),
  updateTopic: (id, fields) => ipcRenderer.invoke("topics:update", id, fields),
  removeTopic: (id) => ipcRenderer.invoke("topics:remove", id),
  topicsOverview: () => ipcRenderer.invoke("topics:overview"),
  /** range: { from, to } */
  topicStats: (id, range) => ipcRenderer.invoke("topics:stats", id, range),
  topicsForMeeting: (id) => ipcRenderer.invoke("topics:forMeeting", id),

  // Ask
  /** scope: { meetingIds, bodies, from, to } -> { ok, id, askedAt, answer, citations, passagesCount } */
  ask: (question, scope) => ipcRenderer.invoke("ask:question", question, scope),
  askHistory: () => ipcRenderer.invoke("ask:history"),
  removeAsk: (id) => ipcRenderer.invoke("ask:remove", id),

  // Bulk work
  /** items: [{ meetingId, kind: "transcript" | "summary" | "minutes" }] -> { ok, added, skipped, status } */
  enqueueJobs: (items) => ipcRenderer.invoke("jobs:enqueue", items),
  jobsStatus: () => ipcRenderer.invoke("jobs:status"),
  cancelAllJobs: () => ipcRenderer.invoke("jobs:cancelAll"),
  cancelJob: (meetingId, kind) => ipcRenderer.invoke("jobs:cancelOne", meetingId, kind),
  /** options: { kinds, monthsBack, needs } -> { ok, candidates, rate, assumedMinutes } */
  candidates: (options) => ipcRenderer.invoke("meetings:candidates", options),
  /** Called with the queue status ({ running, pending, done }) on every change. */
  onJobs: (callback) => {
    const listener = (_e, status) => callback(status);
    ipcRenderer.on("jobs", listener);
    return () => ipcRenderer.removeListener("jobs", listener);
  },
});
