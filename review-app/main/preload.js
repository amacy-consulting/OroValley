"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("review", {
  getState: () => ipcRenderer.invoke("state:get"),
  refresh: () => ipcRenderer.invoke("meetings:refresh"),
  save: (id, fields) => ipcRenderer.invoke("meeting:save", id, fields),
  setStatus: (id, status) => ipcRenderer.invoke("meeting:status", id, status),
  resolveConflict: (id, choice) => ipcRenderer.invoke("meeting:resolve", id, choice),
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
  publish: () => ipcRenderer.invoke("publish"),
  saveSettings: (update) => ipcRenderer.invoke("settings:save", update),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  onProgress: (callback) => {
    const listener = (_e, message) => callback(message);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
});
