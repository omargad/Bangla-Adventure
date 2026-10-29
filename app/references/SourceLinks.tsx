import type { Language } from "@/lib/use-language";
import type { LinkKind, SourceLink } from "@/lib/library-links";

const kindText: Record<LinkKind, { en: string; bn: string }> = {
  override: { en: "This year's edition", bn: "এ বছরের সংস্করণ" },
  official: { en: "Official NCTB page", bn: "এনসিটিবির সরকারি পাতা" },
  portal: { en: "Find it on the NCTB website", bn: "এনসিটিবির ওয়েবসাইটে খুঁজুন" },
};

/** What a textbook link says: where it goes, and for which class when the book covers several. */
export function sourceLinkText(link: SourceLink, language: Language): string {
  const what = kindText[link.kind][language];
  return link.label ? `${link.label[language]}: ${what}` : what;
}

/**
 * A textbook's links, opening the NCTB page (or the administrator's link for this
 * year) in a new tab. bookTitle names the book for screen readers when a page
 * lists many books.
 */
export default function SourceLinks({ links, language, bookTitle }: { links: SourceLink[]; language: Language; bookTitle?: string }) {
  const anchor = (link: SourceLink) => {
    const label = sourceLinkText(link, language);
    return (
      <a href={link.url} target="_blank" rel="noreferrer" aria-label={bookTitle ? `${bookTitle} — ${label}` : undefined}>
        {label}<span aria-hidden="true"> ↗</span>
      </a>
    );
  };
  if (links.length === 1) return <p className="source-links">{anchor(links[0])}</p>;
  return <ul className="source-links">{links.map((link) => <li key={link.label?.en ?? link.url}>{anchor(link)}</li>)}</ul>;
}
