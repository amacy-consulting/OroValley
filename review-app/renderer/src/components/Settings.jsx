import { useState } from "react";
import { api } from "../api.js";
import { Modal } from "./ui.jsx";

export function Settings({ settings, onClose, onSaved }) {
  const [form, setForm] = useState({ anthropicApiKey: "", deepgramApiKey: "" });
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function save() {
    const update = {};
    for (const key of ["anthropicApiKey", "deepgramApiKey"]) {
      if (form[key].trim()) update[key] = form[key];
    }
    const result = await api.saveSettings(update);
    if (!result.ok) return setError(result.error);
    onSaved(result.state);
  }

  async function remove(key) {
    const result = await api.saveSettings({ [key]: "" });
    if (result.ok) onSaved(result.state, true);
  }

  const secret = (label, key, saved, placeholder) => (
    <label className="ov-field">
      <span className="ov-label">
        {label} {saved && <span className="saved">saved</span>}
      </span>
      <input
        className="ov-input"
        type="password"
        value={form[key]}
        onChange={set(key)}
        placeholder={saved ? "Leave blank to keep the saved one" : placeholder}
      />
    </label>
  );
  const removeButton = (key, saved, text) =>
    saved && (
      <>
        {" "}
        <button className="link-button" onClick={() => remove(key)}>
          {text}
        </button>
      </>
    );

  return (
    <Modal title="Settings" titleId="settings-title" onClose={onClose}>
      <h3>Writing summaries, minutes and answers</h3>
      {secret("Anthropic API key", "anthropicApiKey", settings.hasAnthropicApiKey, "sk-ant-…")}
      <p className="hint">
        The AI model writes each summary, drafts the minutes, and answers questions from the saved transcripts. Use the
        Town's dedicated Console workspace with a monthly spend limit.
        {removeButton("anthropicApiKey", settings.hasAnthropicApiKey, "Remove saved key")}
      </p>
      {secret("Deepgram API key", "deepgramApiKey", settings.hasDeepgramApiKey, "Deepgram key")}
      <p className="hint">
        Deepgram turns the Swagit video into a transcript, about $0.40 for a 90-minute meeting. Each meeting's
        transcript is saved in Documents\Oro Valley Minutes and reused.
        {removeButton("deepgramApiKey", settings.hasDeepgramApiKey, "Remove saved key")}
      </p>
      <p className="hint">The Town's keys are encrypted for your Windows account and stay on this computer.</p>

      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="link-button" onClick={onClose}>
          Cancel
        </button>
        <button className="ov-btn" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
