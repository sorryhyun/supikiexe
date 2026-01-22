interface SpeechBubbleProps {
  message: string;
  isTyping?: boolean;
  isStreaming?: boolean;
  sender: "user" | "mascot";
}

/**
 * Parse inline markdown (bold, italic, inline code, links)
 */
function parseInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      result.push(<strong key={`${keyPrefix}-${keyIndex++}`}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text* (but not **)
    const italicMatch = remaining.match(/^\*([^*]+?)\*/);
    if (italicMatch) {
      result.push(<em key={`${keyPrefix}-${keyIndex++}`}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+?)`/);
    if (codeMatch) {
      result.push(<code key={`${keyPrefix}-${keyIndex++}`} className="inline-code">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+?)\]\(([^)]+?)\)/);
    if (linkMatch) {
      result.push(
        <a key={`${keyPrefix}-${keyIndex++}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="markdown-link">
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Regular character
    const nextSpecial = remaining.slice(1).search(/\*|`|\[/);
    if (nextSpecial === -1) {
      result.push(remaining);
      break;
    } else {
      result.push(remaining.slice(0, nextSpecial + 1));
      remaining = remaining.slice(nextSpecial + 1);
    }
  }

  return result;
}

/**
 * Render a single line with markdown (lists, headers, etc.)
 */
function renderLine(line: string, keyPrefix: string): React.ReactNode {
  // Unordered list: - item or * item
  const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
  if (ulMatch) {
    const indent = ulMatch[1].length;
    return (
      <div key={keyPrefix} className="markdown-list-item" style={{ paddingLeft: `${indent * 8 + 12}px` }}>
        <span className="markdown-bullet">•</span>
        {parseInlineMarkdown(ulMatch[2], keyPrefix)}
      </div>
    );
  }

  // Ordered list: 1. item
  const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
  if (olMatch) {
    const indent = olMatch[1].length;
    return (
      <div key={keyPrefix} className="markdown-list-item" style={{ paddingLeft: `${indent * 8 + 12}px` }}>
        <span className="markdown-number">{olMatch[2]}.</span>
        {parseInlineMarkdown(olMatch[3], keyPrefix)}
      </div>
    );
  }

  // Headers: # ## ###
  const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
  if (headerMatch) {
    const level = headerMatch[1].length;
    const className = `markdown-h${level}`;
    return (
      <div key={keyPrefix} className={className}>
        {parseInlineMarkdown(headerMatch[2], keyPrefix)}
      </div>
    );
  }

  // Regular line with inline markdown
  return <span key={keyPrefix}>{parseInlineMarkdown(line, keyPrefix)}</span>;
}

/**
 * Render message content with markdown support
 */
function renderContent(message: string) {
  // Split by code blocks (```...```)
  const parts = message.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      // Extract language and code
      const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
      if (match) {
        const [, lang, code] = match;
        return (
          <pre key={i} className="code-block" data-lang={lang || undefined}>
            <code>{code.trim()}</code>
          </pre>
        );
      }
    }
    // Regular text with markdown - preserve line breaks
    return (
      <span key={i}>
        {part.split("\n").map((line, j, arr) => (
          <span key={j}>
            {renderLine(line, `${i}-${j}`)}
            {j < arr.length - 1 && <br />}
          </span>
        ))}
      </span>
    );
  });
}

function SpeechBubble({
  message,
  isTyping,
  isStreaming,
  sender,
}: SpeechBubbleProps) {
  return (
    <div
      className={`speech-bubble speech-bubble-${sender} ${isStreaming ? "streaming" : ""}`}
    >
      <div className="speech-bubble-content">
        {isTyping ? (
          <span className="typing-indicator">
            <span className="typing-dot"></span>
            <span className="typing-dot"></span>
            <span className="typing-dot"></span>
          </span>
        ) : (
          <>
            {renderContent(message)}
            {isStreaming && <span className="cursor-blink">|</span>}
          </>
        )}
      </div>
    </div>
  );
}

export default SpeechBubble;
