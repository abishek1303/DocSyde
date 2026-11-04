"use client";
import Image from "next/image";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState, type ReactNode } from "react";
import type { DocumentImage } from "../../images/document-image";
export function DocumentationImage({ image, src, actions }: { image: Pick<DocumentImage, "id" | "alt" | "caption" | "width" | "height">; src: string; actions?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return <Dialog><figure className="my-6 space-y-3" data-document-image={image.id}>
    <div className="relative max-h-[36rem] w-full overflow-hidden rounded-lg border bg-muted/25" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
      {failed ? <div role="img" aria-label={image.alt} className="absolute inset-0 flex items-center justify-center p-5 text-center text-sm text-muted-foreground">Screenshot unavailable. The documentation is still readable.</div>
        : <DialogTrigger aria-label={`Preview image: ${image.alt}`} className="absolute inset-0 cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Image unoptimized fill sizes="(max-width: 768px) 100vw, 768px" src={src} alt={image.alt} className="object-contain" onError={() => setFailed(true)} /></DialogTrigger>}
    </div>
    {(image.caption || actions) && <figcaption className="flex flex-wrap items-center justify-between gap-3 text-sm leading-6 text-muted-foreground">{image.caption && <span className="max-w-xl">{image.caption}</span>}{actions}</figcaption>}
  </figure>
    <DialogContent className="w-[calc(100vw-2rem)] max-w-6xl sm:max-w-6xl">
      <DialogTitle className="sr-only">{image.alt}</DialogTitle>
      <DialogDescription className={image.caption ? "pr-10" : "sr-only"}>{image.caption || "Documentation image preview"}</DialogDescription>
      <div className="relative h-[75dvh] min-h-0"><Image unoptimized fill sizes="100vw" src={src} alt={image.alt} className="object-contain" /></div>
    </DialogContent>
  </Dialog>;
}
