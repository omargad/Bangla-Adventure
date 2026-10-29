import { voiceStatusText, type Language, type VoiceStatus } from "@/lib/voice-playback";

/**
 * A small note at the bottom of the screen saying what is playing ("Recorded
 * voice", "Device voice", "Computer voice: may mispronounce names") or that
 * this device has no Bangla voice. It stays in the page while empty so screen
 * readers announce changes; `announce={false}` leaves that to a page's own
 * status region.
 */
export default function VoiceNote({ status, language, announce = true }: { status: VoiceStatus | null; language: Language; announce?: boolean }) {
  const text = voiceStatusText(status, language);
  const tone = status?.state === "playing" ? "playing" : status ? "warning" : "idle";
  return (
    <p className={`voice-note voice-note-${tone}`} role={announce ? "status" : undefined} aria-hidden={announce ? undefined : true} lang={language} data-voice-source={status?.state === "playing" ? status.source : status?.state ?? ""}>
      {text ? <><span aria-hidden="true">{status?.state === "playing" ? "♪ " : "ⓘ "}</span>{text}</> : null}
    </p>
  );
}
