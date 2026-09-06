"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import LoginModal from "./components/LoginModal";

const roles = [
  {
    title: "Students",
    image: "/landing-assets/student-card.png",
    className: "polished-role-student",
    description:
      "A focused learning space for lessons, stories, games, progress and rewards.",
    points: ["Learn", "Play", "Grow"],
  },
  {
    title: "Parents",
    image: "/landing-assets/parent-card.png",
    className: "polished-role-parent",
    description:
      "A simple way to follow your child’s learning journey and celebrate progress.",
    points: ["Support", "Track", "Celebrate"],
  },
  {
    title: "Teachers",
    image: "/landing-assets/teacher-card.png",
    className: "polished-role-teacher",
    description:
      "Tools for managing learners, classroom activities, quizzes and progress.",
    points: ["Create", "Guide", "Inspire"],
  },
];

const benefits = [
  {
    title: "Learn",
    text: "Bangla together",
    image: "/landing-assets/learn-icon.png",
  },
  {
    title: "Play",
    text: "and explore",
    image: "/landing-assets/play-icon.png",
  },
  {
    title: "Grow",
    text: "with confidence",
    image: "/landing-assets/grow-icon.png",
  },
];

export default function HomePage() {
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]")
    );

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14 }
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header className="polished-header">
        <a className="polished-brand" href="#home" aria-label="Bangla Adventures home">
          <span className="polished-brand-mark">বা</span>
          <span>
            <strong>Bangla</strong>
            <small>Adventures</small>
          </span>
        </a>

        <nav className="polished-nav" aria-label="Main navigation">
          <a href="#about">About</a>
          <a href="#roles">Who it’s for</a>
          <a href="#safety">Safety</a>
        </nav>

        <button
          className="polished-header-button"
          type="button"
          onClick={() => setLoginOpen(true)}
        >
          Sign in <span aria-hidden="true">→</span>
        </button>
      </header>

      <main className="polished-landing" id="home">
        <section className="polished-hero">
          <div className="polished-hero-copy">
            <p className="polished-eyebrow">
              One platform · different journeys
            </p>

            <h1>
              The right space
              <br />
              for every user.
            </h1>

            <p className="polished-hero-description">
              Bangla Adventures gives students, families and teachers their own
              clear space while keeping everyone connected through learning,
              culture and progress.
            </p>

            <div className="polished-benefits">
              {benefits.map((benefit) => (
                <div className="polished-benefit" key={benefit.title}>
                  <span className="polished-benefit-art">
                    <Image
                      src={benefit.image}
                      alt=""
                      width={72}
                      height={72}
                    />
                  </span>

                  <p>
                    <strong>{benefit.title}</strong>
                    <small>{benefit.text}</small>
                  </p>
                </div>
              ))}
            </div>

            <div className="polished-hero-actions">
              <button
                type="button"
                className="polished-primary"
                onClick={() => setLoginOpen(true)}
              >
                Sign in now <span aria-hidden="true">→</span>
              </button>

              <a className="polished-secondary" href="#roles">
                See who it’s for <span aria-hidden="true">↓</span>
              </a>
            </div>

            <p className="polished-hand-note">
              Small steps. Brighter tomorrows.
            </p>
          </div>

          <div className="polished-hero-visual" aria-label="Bangla Adventures illustration">
            <div className="polished-hero-frame">
              <Image
                src="/landing-assets/hero-river.png"
                alt="A child and Bagh the tiger exploring Bangladesh by boat"
                width={1536}
                height={1024}
                priority
              />
            </div>

            <div className="polished-note polished-note-top">
              A brighter Bangladesh through learning
            </div>

            <div className="polished-note polished-note-bottom">
              Same roots. Bigger dreams.
            </div>

            <div className="polished-signpost" aria-hidden="true">
              <span>Explore</span>
              <span>Learn</span>
              <span>Belong</span>
            </div>
          </div>
        </section>

        <section className="polished-role-section" id="roles" data-reveal>
          <div className="polished-section-heading">
            <p className="polished-eyebrow">Who it’s for</p>
            <h2>One platform, three connected spaces.</h2>
            <p>
              Each space is designed around what that person actually needs to
              do — without unnecessary clutter.
            </p>
          </div>

          <div className="polished-role-grid">
            {roles.map((role) => (
              <article
                className={`polished-role-card ${role.className}`}
                key={role.title}
              >
                <div className="polished-role-image-wrap">
                  <Image
                    src={role.image}
                    alt=""
                    width={720}
                    height={720}
                  />
                </div>

                <div className="polished-role-content">
                  <div className="polished-role-heading">
                    <h3>{role.title}</h3>
                    <button
                      type="button"
                      aria-label={`Open sign in for ${role.title}`}
                      onClick={() => setLoginOpen(true)}
                    >
                      →
                    </button>
                  </div>

                  <p>{role.description}</p>

                  <div className="polished-role-points">
                    {role.points.map((point) => (
                      <span key={point}>{point}</span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="polished-safety" id="safety" data-reveal>
          <div className="polished-safety-art">
            <Image
              src="/landing-assets/security.png"
              alt=""
              width={620}
              height={620}
            />
          </div>

          <div className="polished-safety-copy">
            <p className="polished-eyebrow">
              A safer, brighter learning space
            </p>

            <h2>Learning comes first.</h2>

            <p>
              The learner experience is built around clear navigation,
              age-appropriate interactions and focused educational activities.
              Public visitors, students, parents and teachers each have a
              separate experience.
            </p>
          </div>

          <div className="polished-safety-list">
            <div>
              <span>✓</span>
              <p>
                <strong>Safe & secure access</strong>
                <small>Account areas stay separated.</small>
              </p>
            </div>

            <div>
              <span>✓</span>
              <p>
                <strong>Child-friendly by design</strong>
                <small>Simple, focused and easy to understand.</small>
              </p>
            </div>

            <div>
              <span>✓</span>
              <p>
                <strong>Positive learning environment</strong>
                <small>Designed to encourage curiosity.</small>
              </p>
            </div>
          </div>

          <button
            className="polished-secure-button"
            type="button"
            onClick={() => setLoginOpen(true)}
          >
            Sign in securely <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="polished-story-strip" id="about" data-reveal>
          <div className="polished-story-bagh">
            <Image
              src="/landing-assets/bagh-wave.png"
              alt=""
              width={360}
              height={360}
            />
            <span>Let’s learn!</span>
          </div>

          <div className="polished-story-copy">
            <p className="polished-eyebrow">Ready when you are</p>

            <h2>
              Your Bangla adventure
              <br />
              starts after sign in.
            </h2>

            <p>
              Continue into your own learning space and discover lessons,
              stories, culture and activities designed for your role.
            </p>

            <button
              type="button"
              onClick={() => setLoginOpen(true)}
            >
              Sign in to continue <span aria-hidden="true">→</span>
            </button>
          </div>

          <div className="polished-story-signs" aria-hidden="true">
            <span>Learn</span>
            <span>Play</span>
            <span>Grow</span>
          </div>
        </section>
      </main>

      <footer className="polished-footer">
        <a className="polished-brand" href="#home">
          <span className="polished-brand-mark">বা</span>
          <span>
            <strong>Bangla</strong>
            <small>Adventures</small>
          </span>
        </a>

        <nav>
          <a href="#about">About</a>
          <a href="#roles">Who it’s for</a>
          <a href="#safety">Safety</a>
        </nav>

        <p>
          © 2026 Bangla Adventures
          <br />
          Learning · Culture · Community
        </p>
      </footer>

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
      />
    </>
  );
}
