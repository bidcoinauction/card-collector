"use client";

import Image from "next/image";
import { useState } from "react";

export default function OptimizedCardImage({
  src,
  alt,
  priority = false,
  className = "",
}: {
  src?: string | null;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div
        className={className}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "2.5 / 3.5",
          borderRadius: 12,
          background: "rgba(0,0,0,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(0,0,0,0.5)",
          fontSize: 12,
          userSelect: "none",
        }}
      >
        No image
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "2.5 / 3.5",
        overflow: "hidden",
        borderRadius: 12,
      }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        style={{ objectFit: "cover" }}
        onError={() => setBroken(true)}
      />
    </div>
  );
}
