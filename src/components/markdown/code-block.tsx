"use client";

import * as React from "react";
import { Check, Copy, FileCode2 } from "lucide-react";

function extractLang(code: React.ReactNode): string | null {
  if (React.isValidElement(code)) {
    const className = (code.props as { className?: string })?.className ?? "";
    const match = className.match(/language-([\w-]+)/);
    return match ? match[1] : null;
  }
  return null;
}

export function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLPreElement>(null);
  const [copied, setCopied] = React.useState(false);
  const lang = React.useMemo(() => extractLang(children), [children]);

  const copy = async () => {
    const text = ref.current?.textContent ?? "";
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border bg-[#0d0f17]">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#11131d] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileCode2 className="size-3.5" />
          {lang ? lang : "code"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref} className="overflow-x-auto !my-0 !rounded-none">
        {children}
      </pre>
    </div>
  );
}