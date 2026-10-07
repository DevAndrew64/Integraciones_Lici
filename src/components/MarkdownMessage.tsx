'use client';
import React from 'react';

function renderInline(text: string, key: string | number): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g);
  return (
    <React.Fragment key={key}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**'))
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`'))
          return (
            <code key={i} style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em', fontFamily: 'monospace', color: '#0d2d5e' }}>
              {p.slice(1, -1)}
            </code>
          );
        if (p.startsWith('*') && p.endsWith('*'))
          return <em key={i}>{p.slice(1, -1)}</em>;
        return p;
      })}
    </React.Fragment>
  );
}

export function MarkdownMessage({ text, font }: { text: string; font: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      elements.push(
        <pre key={`pre${i}`} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px', overflowX: 'auto', fontFamily: 'monospace', fontSize: 12, margin: '8px 0', lineHeight: 1.6 }}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++; continue;
    }

    // Headings
    if (line.startsWith('### ')) { elements.push(<p key={i} style={{ fontWeight: 600, fontSize: 13, margin: '10px 0 2px', fontFamily: font, color: '#1e293b' }}>{renderInline(line.slice(4), i)}</p>); i++; continue; }
    if (line.startsWith('## '))  { elements.push(<p key={i} style={{ fontWeight: 700, fontSize: 14, margin: '12px 0 3px', fontFamily: font, color: '#1e293b' }}>{renderInline(line.slice(3), i)}</p>); i++; continue; }
    if (line.startsWith('# '))   { elements.push(<p key={i} style={{ fontWeight: 700, fontSize: 15, margin: '14px 0 4px', fontFamily: font, color: '#0d2d5e' }}>{renderInline(line.slice(2), i)}</p>); i++; continue; }

    // Unordered list
    if (/^[-*•]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        items.push(<li key={i} style={{ margin: '2px 0', lineHeight: 1.65 }}>{renderInline(lines[i].slice(2), i)}</li>);
        i++;
      }
      elements.push(<ul key={`ul${i}`} style={{ paddingLeft: 18, margin: '4px 0' }}>{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i} style={{ margin: '2px 0', lineHeight: 1.65 }}>{renderInline(lines[i].replace(/^\d+\.\s/, ''), i)}</li>);
        i++;
      }
      elements.push(<ol key={`ol${i}`} style={{ paddingLeft: 18, margin: '4px 0' }}>{items}</ol>);
      continue;
    }

    // Blank line → small gap
    if (line.trim() === '') {
      if (elements.length > 0) elements.push(<div key={`sp${i}`} style={{ height: 6 }} />);
      i++; continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />);
      i++; continue;
    }

    // Regular line
    elements.push(<p key={i} style={{ margin: '1px 0', lineHeight: 1.7, fontFamily: font, textAlign: 'justify' as const }}>{renderInline(line, i)}</p>);
    i++;
  }

  return <>{elements}</>;
}