import { parseBio } from '@/lib/bio';

export function BioText({text}:{text:string}) {
  return <>{parseBio(text).map((part,index)=>part.href
    ? <a key={index} className="bio-link" href={part.href} target="_blank" rel="noopener noreferrer ugc">{part.text}</a>
    : part.text)}</>;
}
