import Link from "next/link";
import LearningLayout from "../components/LearningLayout";
import { libraryBooks, NCTB_PORTAL_URL } from "../library-content";
import ReferenceNote from "./ReferenceNote";
export const dynamic = "force-dynamic";
export default function References() {
  return <LearningLayout active="references"><section>
    <h1>Sources & references</h1><ReferenceNote note="intro" />
    <div className="teach-panel"><h2>National Curriculum and Textbook Board, Bangladesh</h2><p>Primary source collection for the platform’s culture, history and literature topics. Check the title, class and edition against the original material.</p><a className="outline-button" href={NCTB_PORTAL_URL} target="_blank" rel="noreferrer">Official NCTB website</a><Link className="outline-button" href="/books">Audited textbook source records</Link><Link className="outline-button" href="/library">Browse textbook references</Link></div>
    <div className="portal-topic-grid">{libraryBooks.map((book) => <article className="teach-panel" key={book.id}><h2>{book.titleEn}</h2><p lang="bn">{book.titleBn}</p><p>{book.classes.en}</p><p>{book.covers.en}</p><a href={NCTB_PORTAL_URL} target="_blank" rel="noreferrer">Locate this title in the official collection</a>{book.chapterMaps?.map((map) => <p key={map.volume.en}>{map.volume.en}: {map.note.en} {map.verified ? "(source map checked)" : "(review required)"}</p>)}</article>)}</div>
    <ReferenceNote note="approval" />
  </section></LearningLayout>;
}
