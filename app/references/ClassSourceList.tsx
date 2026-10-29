import type { Language } from "@/lib/use-language";
import type { ClassSource } from "@/lib/class-sources";

/** A class source's title in the reader's language, or in the other one when only that was given. */
export const classSourceTitle = (source: Pick<ClassSource, "titleEn" | "titleBn">, language: Language) =>
  language === "bn" ? source.titleBn || source.titleEn : source.titleEn || source.titleBn;

/** The links a teacher added for one class, with the website each one opens. */
export default function ClassSourceList({ sources, language }: { sources: ClassSource[]; language: Language }) {
  return (
    <ul className="class-source-list">
      {sources.map((source) => (
        <li key={source.id}>
          <a href={source.url} target="_blank" rel="noreferrer">{classSourceTitle(source, language)}<span aria-hidden="true"> ↗</span></a>
          {source.host && <small>{source.host}</small>}
          {source.note && <p>{source.note}</p>}
        </li>
      ))}
    </ul>
  );
}
