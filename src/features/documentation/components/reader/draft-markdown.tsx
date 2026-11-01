import Markdown from "react-markdown";
export function DraftMarkdown({ content }: { content: string }) {
  return <Markdown skipHtml allowedElements={["p", "ul", "ol", "li", "strong", "em", "code", "pre", "a", "br"]} urlTransform={url => /^(https?:\/\/|\/(?!\/)|#)/i.test(url) ? url : ""}>{content}</Markdown>;
}
