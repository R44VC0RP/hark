import { type TokenKind, tokenize } from "../lib/highlight";

/**
 * The code surface is a dark panel under the green, so one set of syntax
 * colours tuned for dark backgrounds works everywhere.
 */
const KIND_CLASS: Record<Exclude<TokenKind, "plain">, string> = {
  key: "text-code-key",
  string: "text-code-string",
  number: "text-code-number",
  literal: "text-code-literal",
  punct: "text-code-punct",
  comment: "text-code-comment",
  flag: "text-code-flag",
  command: "text-code-command",
  url: "text-code-url",
};

const BLOCK =
  "overflow-x-auto rounded-2xl bg-code p-4 font-mono text-[13px] leading-relaxed text-code-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]";

export function CodeBlock({
  code,
  language,
  className = BLOCK,
}: {
  code: string;
  language: "json" | "bash";
  /** Replaces the default panel styling. */
  className?: string;
}) {
  const nodes: React.ReactNode[] = [];
  // Byte offset doubles as a stable, unique key without keying on array index.
  let offset = 0;

  for (const token of tokenize(code, language)) {
    if (token.kind === "plain") {
      nodes.push(token.text);
    } else {
      nodes.push(
        <span key={offset} className={KIND_CLASS[token.kind]}>
          {token.text}
        </span>,
      );
    }
    offset += token.text.length;
  }

  return (
    <pre className={className}>
      <code>{nodes}</code>
    </pre>
  );
}
