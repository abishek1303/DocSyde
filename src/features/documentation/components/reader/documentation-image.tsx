"use client";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import type { DocumentImage } from "../../images/document-image";
export function DocumentationImage({ image, src, actions }: { image: Pick<DocumentImage, "id" | "alt" | "caption" | "width" | "height">; src: string; actions?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return <figure className="my-6 space-y-3" data-document-image={image.id}>
    <div className="relative max-h-[36rem] w-full overflow-hidden rounded-lg border bg-muted/25" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
      {failed ? <div role="img" aria-label={image.alt} className="absolute inset-0 flex items-center justify-center p-5 text-center text-sm text-muted-foreground">Screenshot unavailable. The documentation is still readable.</div>
        : <Image unoptimized fill sizes="(max-width: 768px) 100vw, 768px" src={src} alt={image.alt} className="object-contain" onError={() => setFailed(true)} />}
    </div>
    {(image.caption || actions) && <figcaption className="flex flex-wrap items-center justify-between gap-3 text-sm leading-6 text-muted-foreground">{image.caption && <span className="max-w-xl">{image.caption}</span>}{actions}</figcaption>}
  </figure>;
}
