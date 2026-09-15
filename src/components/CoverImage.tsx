import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";

/**
 * Cover art with a guaranteed placeholder. Falls back to a book icon when
 * there is no cover URL *and* when the URL fails to load (dead AniList CDN
 * links, offline, etc.), so a row's layout never collapses or shifts.
 * The caller owns sizing/rounding via `className`; both states use it.
 */
export default function CoverImage({
  src,
  alt = "",
  className = "",
  iconClassName = "h-5 w-5",
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className={`bg-muted grid place-items-center ${className}`} aria-hidden="true">
        <BookOpen className={`text-muted-foreground/40 ${iconClassName}`} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`object-cover bg-muted ${className}`}
    />
  );
}
