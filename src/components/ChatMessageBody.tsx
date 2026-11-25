import { Fragment } from 'react';
import {
  parseChatBlocks,
  parseInlineSegments,
  type TableAlign,
} from '../utils/chatMarkdown';

interface ChatMessageBodyProps {
  content: string;
}

function InlineText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, lineIdx) => {
        const segments = parseInlineSegments(line);
        return (
          <Fragment key={lineIdx}>
            {lineIdx > 0 && <br />}
            {segments.map((seg, idx) => {
              if (seg.type === 'bold') {
                return (
                  <strong key={idx} className="font-semibold text-slate-950">
                    {seg.text}
                  </strong>
                );
              }
              if (seg.type === 'italic') {
                return (
                  <em key={idx} className="italic text-slate-700">
                    {seg.text}
                  </em>
                );
              }
              if (seg.type === 'code') {
                return (
                  <code
                    key={idx}
                    className="px-1.5 py-0.5 rounded-md bg-slate-200/75 font-mono text-xs text-slate-900"
                  >
                    {seg.text}
                  </code>
                );
              }
              return <Fragment key={idx}>{seg.text}</Fragment>;
            })}
          </Fragment>
        );
      })}
    </>
  );
}

function alignClass(align: TableAlign | undefined): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

export function ChatMessageBody({ content }: ChatMessageBodyProps) {
  const blocks = parseChatBlocks(content);
  if (blocks.length === 0) {
    return <span>{content}</span>;
  }

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-slate-800">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          return (
            <div key={idx} className="font-display font-bold text-slate-900 pt-1">
              <InlineText text={block.text} />
            </div>
          );
        }

        if (block.type === 'paragraph') {
          return (
            <p key={idx} className="leading-relaxed">
              <InlineText text={block.text} />
            </p>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="leading-relaxed">
                  <InlineText text={item} />
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={idx} className="list-decimal pl-5 space-y-1">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="leading-relaxed">
                  <InlineText text={item} />
                </li>
              ))}
            </ol>
          );
        }

        return (
          <div
            key={idx}
            className="my-1.5 overflow-x-auto rounded-xl border border-slate-300/80 bg-white shadow-xs"
          >
            <table className="w-full border-collapse text-xs sm:text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-300/80">
                  {block.headers.map((header, colIdx) => (
                    <th
                      key={colIdx}
                      className={`px-3 py-2 font-semibold text-slate-900 whitespace-nowrap border-r last:border-r-0 border-slate-200 ${alignClass(
                        block.alignments[colIdx],
                      )}`}
                    >
                      <InlineText text={header} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {block.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-slate-50/70">
                    {row.map((cell, colIdx) => (
                      <td
                        key={colIdx}
                        className={`px-3 py-2 text-slate-800 border-r last:border-r-0 border-slate-200 align-top tabular-nums ${alignClass(
                          block.alignments[colIdx],
                        )}`}
                      >
                        <InlineText text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
