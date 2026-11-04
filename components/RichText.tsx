import Link from "next/link";
import { mentionedSet, parseRich } from "@/lib/richText";

// Corpo de post e de comentário com @, # e link (spec 046, onda 2,
// mencoes-e-tags). Recebe o texto cru e o conjunto de @ que existem (vem de
// hydratePosts/listComments): menção de quem não existe fica texto, não vira
// link quebrado. Tag vira /tag/[tag], url externa abre em outra aba com
// rel="nofollow ugc noopener". Sem HTML cru em nenhum caminho.
//
// data-post-body fica no container pra o card e os testes continuarem
// achando o corpo do post.

export function RichText({
  body,
  mentioned = [],
  className = "",
}: {
  body: string;
  /** usernames mencionados que existem de verdade */
  mentioned?: string[] | null;
  className?: string;
}) {
  const people = mentionedSet(mentioned);
  return (
    <div
      data-post-body
      className={`text-[15px] leading-relaxed break-words whitespace-pre-wrap ${className}`}
    >
      {parseRich(body).map((s, i) => {
        if (s.t === "mention") {
          // @ de quem existe vira link; o resto continua texto (com o @)
          return people.has(s.v) ? (
            <Link
              key={i}
              href={`/u/${s.v}`}
              className="font-semibold text-accent hover:underline"
              data-mention={s.v}
            >
              @{s.v}
            </Link>
          ) : (
            <span key={i}>@{s.v}</span>
          );
        }
        if (s.t === "tag") {
          return (
            <Link
              key={i}
              href={`/tag/${s.v}`}
              className="text-accent hover:underline"
              data-tag={s.v}
            >
              #{s.v}
            </Link>
          );
        }
        if (s.t === "url") {
          return (
            <a
              key={i}
              href={s.v}
              target="_blank"
              rel="nofollow ugc noopener"
              className="break-all text-accent underline-offset-4 hover:underline"
            >
              {s.v}
            </a>
          );
        }
        return <span key={i}>{s.v}</span>;
      })}
    </div>
  );
}
