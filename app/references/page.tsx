import Link from "next/link";
import LearningLayout from "../components/LearningLayout";
import { libraryBooks, NCTB_PORTAL_URL } from "../library-content";
export const dynamic = "force-dynamic";
export default function References() {
  return <LearningLayout active="references"><section>
    <h1>Sources & references</h1><p>Learning topics include their source books and notes beside the reading. A source citation identifies supporting material; it does not mean an adaptation has passed educational review.</p>
    <div className="teach-panel"><h2>National Curriculum and Textbook Board, Bangladesh</h2><p>Primary source collection for the platform’s culture, history and literature topics. Check the title, class and edition against the original material.</p><a className="outline-button" href={NCTB_PORTAL_URL} target="_blank" rel="noreferrer">Official NCTB website</a><Link className="outline-button" href="/books">Audited textbook source records</Link><Link className="outline-button" href="/library">Browse textbook references</Link></div>
    <div className="portal-topic-grid">{libraryBooks.map((book) => <article className="teach-panel" key={book.id}><h2>{book.titleEn}</h2><p lang="bn">{book.titleBn}</p><p>{book.classes.en}</p><p>{book.covers.en}</p><a href={NCTB_PORTAL_URL} target="_blank" rel="noreferrer">Locate this title in the official collection</a>{book.chapterMaps?.map((map) => <p key={map.volume.en}>{map.volume.en}: {map.note.en} {map.verified ? "(source map checked)" : "(review required)"}</p>)}</article>)}</div>
    <p>Topic readings and quizzes remain drafts for educator review. Language, cultural accuracy, age suitability, rights and accessibility require their existing review evidence. References are not a claim of curriculum approval.</p>
  </section></LearningLayout>;
}
