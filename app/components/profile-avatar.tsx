'use client';
import { useState } from 'react';
export function ProfileAvatar({ name, url }: { name: string; url?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return (
    <div className="avatar">
      {url && failed !== url ? (
        // Native image: already cropped and optimized by the browser at upload time.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`${name}'s profile picture`}
          width={512}
          height={512}
          onError={() => setFailed(url)}
        />
      ) : (
        initials
      )}
    </div>
  );
}
