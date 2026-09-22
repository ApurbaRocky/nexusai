"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./code-block";

const components: Components = {
  pre: (props) => <CodeBlock>{props.children}</CodeBlock>,
  a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  table: (props) => <table {...props} className="border-collapse" />,
};

export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`markdown-body ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});