"use client";

import { useEffect } from "react";

export type KidReward = {
  id: string;
  amount: number;
  title: string;
  message: string;
  badge: string;
};

type Props = {
  reward: KidReward | null;
  onRewardDone: () => void;
  language: "en" | "bn";
};

const confetti = Array.from({ length: 34 }, (_, index) => ({
  id: index,
  x: ((index * 37) % 92) + 4,
  delay: (index % 8) * 0.055,
  duration: 1.35 + (index % 5) * 0.14,
  rotate: (index * 53) % 360,
  glyph: ["★", "✦", "●", "◆", "✿"][index % 5],
}));

const particles = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  left: ((index * 43) % 96) + 2,
  top: ((index * 29) % 88) + 5,
  delay: (index % 7) * -0.8,
  duration: 5 + (index % 6) * 0.65,
  glyph: ["✦", "•", "★", "◌"][index % 4],
}));

export default function KidExperienceEffects({
  reward,
  onRewardDone,
  language,
}: Props) {

  useEffect(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".quest-bar, .curriculum-heading, .level-guide, .level-tab, .lesson-card, .word-card, .story-section, .culture-layout, .place-card, .game-section, .safety-section"
      )
    );

    targets.forEach((element, index) => {
      element.classList.add("kid-reveal");
      element.style.setProperty("--kid-reveal-delay", `${Math.min(index % 6, 5) * 55}ms`);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("kid-reveal-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -35px 0px" }
    );

    targets.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const clickSpark = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("button, .primary-button, .outline-button, .word-card, .lesson-card, .place-card")) {
        return;
      }

      const burst = document.createElement("span");
      burst.className = "kid-click-burst";
      burst.style.left = `${event.clientX}px`;
      burst.style.top = `${event.clientY}px`;
      burst.innerHTML = "<i>✦</i><i>★</i><i>✦</i><i>•</i><i>★</i>";
      document.body.appendChild(burst);
      window.setTimeout(() => burst.remove(), 720);
    };

    document.addEventListener("pointerdown", clickSpark);
    return () => document.removeEventListener("pointerdown", clickSpark);
  }, []);

  useEffect(() => {
    if (!reward) return;
    const timer = window.setTimeout(onRewardDone, 2600);
    return () => window.clearTimeout(timer);
  }, [reward, onRewardDone]);

  return (
    <>
      <div className="kid-particle-layer" aria-hidden="true">
        {particles.map((particle) => (
          <span
            key={particle.id}
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animationDelay: `${particle.delay}s`,
              animationDuration: `${particle.duration}s`,
            }}
          >
            {particle.glyph}
          </span>
        ))}
      </div>

      {reward && (
        <div className="kid-reward-overlay" aria-live="polite" role="status">
          <div className="kid-confetti" aria-hidden="true">
            {confetti.map((piece) => (
              <span
                key={`${reward.id}-${piece.id}`}
                style={{
                  left: `${piece.x}%`,
                  animationDelay: `${piece.delay}s`,
                  animationDuration: `${piece.duration}s`,
                  rotate: `${piece.rotate}deg`,
                }}
              >
                {piece.glyph}
              </span>
            ))}
          </div>

          <div className="kid-reward-card">
            <button
              type="button"
              className="kid-reward-close"
              onClick={onRewardDone}
              aria-label={language === "bn" ? "পুরস্কার বন্ধ করি" : "Close reward"}
            >
              ×
            </button>

            <div className="kid-reward-star" aria-hidden="true">
              ★
            </div>

            <p className="kid-reward-kicker">
              {language === "bn" ? "পুরস্কার পেয়েছ!" : "Reward unlocked!"}
            </p>

            <h2>{reward.title}</h2>
            <p>{reward.message}</p>

            <div className="kid-reward-points">
              <strong>+{reward.amount}</strong>
              <span>{language === "bn" ? "তারা" : reward.amount === 1 ? "star" : "stars"}</span>
            </div>

            <div className="kid-achievement-chip">{reward.badge}</div>

            <div className="kid-bagh-celebrate">
              <span aria-hidden="true">🐯</span>
              <p>
                <strong>{language === "bn" ? "বাঘ বলছে:" : "Bagh says:"}</strong>
                {language === "bn"
                  ? " চমৎকার! পরের অভিযানের জন্য প্রস্তুত?"
                  : " Brilliant! Ready for the next adventure?"}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
