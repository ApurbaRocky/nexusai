"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { X, Paperclip, Send, Square, Bot } from "lucide-react";

export interface ComposerAgentOption {
  id: string;
  name: string;
}
export interface ComposerModelOption {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

export interface ComposerAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function Composer({
  streaming,
  agents,
  models,
  defaultAgent,
  defaultModel,
  onSend,
  onStop,
}: {
  streaming: boolean;
  agents: ComposerAgentOption[];
  models: ComposerModelOption[];
  defaultAgent?: string;
  defaultModel?: string;
  onSend: (content: string, opts: { agent?: string; model?: string; attachments: ComposerAttachment[] }) => void;
  onStop: () => void;
}) {
  const [value, setValue] = React.useState("");
  const [agent, setAgent] = React.useState<string>(defaultAgent ?? "assistant");
  const [model, setModel] = React.useState<string>(defaultModel ?? "");
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    if (!initializedRef.current && !model && models.length && models.some((m) => m.available)) {
      const preferred = models.find((m) => m.available && m.id === "openai:gpt-4o-mini") ?? models.find((m) => m.available);
      if (preferred) {
        setModel(preferred.id);
        initializedRef.current = true;
      }
    }
  }, [models, model]);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
         
        window.alert(`"${file.name}" exceeds the 25 MB attachment limit.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve("");
        reader.readAsDataURL(file);
      });
      if (dataUrl) setAttachments((prev) => [...prev, { name: file.name, type: file.type, size: file.size, dataUrl }]);
    }
  };

  const canSend = value.trim().length > 0 || attachments.length > 0;

  const submit = () => {
    if (!canSend || streaming) return;
    onSend(value.trim(), { agent: agent || "assistant", model: model || undefined, attachments });
    setValue("");
    setAttachments([]);
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    });
  };

  return (
    <div className="border-t bg-background/80 backdrop-blur">
      <div className="mx-auto max-w-3xl px-3 pb-3 pt-2">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={i} className="flex items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 text-xs">
                <Paperclip className="size-3" />
                <span className="max-w-[140px] truncate">{a.name}</span>
                <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground" aria-label="Remove attachment">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" onClick={() => fileRef.current?.click()} title="Attach a file">
            <Paperclip className="size-4" />
          </Button>
          <input ref={fileRef} type="file" multiple hidden className="hidden" onChange={(e) => pickFiles(e.target.files)} />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              resize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Message AI Nexus…  (Enter to send, Shift+Enter for a new line)"
            className="max-h-[220px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {streaming ? (
            <Tooltip>
              <TooltipTrigger
                render={<Button type="button" variant="secondary" size="icon" className="size-8 shrink-0" onClick={onStop} />}
              >
                <Square className="size-3.5 fill-current" />
              </TooltipTrigger>
              <TooltipContent>Stop generating</TooltipContent>
            </Tooltip>
          ) : (
            <Button type="button" size="icon" className="size-8 shrink-0" disabled={!canSend} onClick={submit}>
              <Send className="size-4" />
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Select value={agent} onValueChange={(v) => v && setAgent(v)}>
              <SelectTrigger className="h-7 gap-1 text-xs" aria-label="Agent">
                <Bot className="size-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Select value={model} onValueChange={(v) => v && setModel(v)}>
              <SelectTrigger className="h-7 gap-1 text-xs" aria-label="Model">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent align="end">
                {models.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading models…</div>
                ) : (
                  models.map((m) => (
                    <SelectItem key={m.id} value={m.id} disabled={!m.available}>
                      {m.label}
                      {!m.available ? " (not configured)" : ""}
                    </SelectItem>
                  ))
                )}
                {models.length > 0 && models.every((m) => !m.available) && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No AI providers configured — add one in Settings.</div>
                )}
              </SelectContent>
            </Select>
            <p className="hidden text-[11px] text-muted-foreground md:block">AI Nexus may make mistakes. Verify important info.</p>
          </div>
        </div>
      </div>
    </div>
  );
}