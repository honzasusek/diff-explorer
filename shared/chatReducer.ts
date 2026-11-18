import type { ChatEvent, ChatMessage } from "./types";

/**
 * Applies a streamed chat event to an in-progress assistant message.
 * Used identically by the server (to persist transcripts) and the client (to render).
 */
export function applyChatEvent(msg: ChatMessage, ev: ChatEvent): ChatMessage {
  const blocks = msg.blocks ? [...msg.blocks] : [];
  const last = blocks[blocks.length - 1];
  switch (ev.type) {
    case "text_start":
      blocks.push({ kind: "text", text: "" });
      return { ...msg, blocks };
    case "text_delta": {
      if (last && last.kind === "text") {
        blocks[blocks.length - 1] = { ...last, text: last.text + ev.text };
      } else {
        blocks.push({ kind: "text", text: ev.text });
      }
      return { ...msg, blocks };
    }
    case "text_final": {
      if (last && last.kind === "text") {
        blocks[blocks.length - 1] = { ...last, text: ev.text };
      } else {
        blocks.push({ kind: "text", text: ev.text });
      }
      return { ...msg, blocks };
    }
    case "tool_use":
      blocks.push({ kind: "tool", id: ev.id, name: ev.name, input: ev.input, status: "running" });
      return { ...msg, blocks };
    case "tool_result": {
      const idx = blocks.findIndex((b) => b.kind === "tool" && b.id === ev.id);
      if (idx >= 0) {
        const b = blocks[idx];
        if (b.kind === "tool") {
          blocks[idx] = { ...b, status: ev.isError ? "error" : "done", result: ev.summary };
        }
      }
      return { ...msg, blocks };
    }
    case "permission_request":
      blocks.push({ kind: "permission", requestId: ev.requestId, toolName: ev.toolName, input: ev.input });
      return { ...msg, blocks };
    case "permission_resolved": {
      const idx = blocks.findIndex((b) => b.kind === "permission" && b.requestId === ev.requestId);
      if (idx >= 0) {
        const b = blocks[idx];
        if (b.kind === "permission") {
          blocks[idx] = { ...b, decision: ev.allowed ? "allowed" : "denied" };
        }
      }
      return { ...msg, blocks };
    }
    case "done":
      return {
        ...msg,
        blocks,
        status: ev.error ? "error" : "done",
        error: ev.error,
        costUsd: ev.costUsd,
        durationMs: ev.durationMs,
        filesChanged: ev.filesChanged,
      };
    case "error":
      return { ...msg, blocks, status: "error", error: ev.message };
    default:
      return msg;
  }
}
