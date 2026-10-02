// The consent wording a guardian agrees to. Bump the version whenever the text changes; each
// consent record stores the version it was given against.
export const CONSENT_TEXT_VERSION = "2026-10-v1";

export const CONSENT_POINTS = [
  "KinPrep may send my child daily practice questions (on WhatsApp if they are 13 or over; never on WhatsApp if they are under 13).",
  "KinPrep keeps only my child's first name, surname initial, class, birth year, exam, subjects and, if 13 or over, their WhatsApp number, plus their answers.",
  "Progress is shared with the person who signed my child up and anyone they invite as a co-sponsor.",
  "I can withdraw consent, download or delete my child's data at any time.",
];

/** How long a consent link sent to a guardian stays valid. */
export const CONSENT_LINK_DAYS = 14;
