import { Image } from "antd";
import ReactMarkdown from "react-markdown";
import { resolveAssetUrl } from "../api";

export default function QuestionPrompt({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words [&_p]:mb-3 [&_p]:whitespace-pre-wrap [&_p:last-child]:mb-0">
      <ReactMarkdown
        components={{
          img: ({ src, alt }) => (
            <Image
              src={src ? resolveAssetUrl(src) : undefined}
              alt={alt || "题目配图"}
              className="!max-h-[560px] !w-auto !max-w-full rounded-lg border border-stone-200 bg-white object-contain"
            />
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
