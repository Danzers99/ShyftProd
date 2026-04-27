// Required Litmos compliance courses (14 total).
// Used to compute "Litmos 14/14" and per-course completion.
export const REQUIRED_LITMOS = [
  "Anti-money Laundering Awareness 4.0 (US)",
  "Cyber Security Overview 2.0",
  "HIPAA Privacy and Security Basics 5.0 (US)",
  "Health Risk Assessments (HRAs)",
  "Identity Theft Training 2026",
  "Information Security Basics 3.0",
  "Leading Learning - Payment Card Industry Data Security Standards (PCI-DSS) 2.0",
  "Medicare Parts C & D - Combating Fraud, Waste & Abuse 2026",
  "Medicare Parts C & D - Cultural Competency 2026",
  "Medicare Parts C & D - General Compliance 2026",
  "Nations of the Stars - Journey into 2026",
  "Sexual Harassment Prevention 3.0 (US)",
  "Triple-S Introduction",
  "UDAAP Training 2026",
];

// Compact labels for the wide table view (one per REQUIRED_LITMOS entry).
export const SHORT_LITMOS = [
  "AML 4.0", "Cyber Sec", "HIPAA", "HRAs", "ID Theft", "Info Sec", "PCI-DSS",
  "FWA", "Cultural", "Compliance", "Stars", "Sexual Harass", "Triple-S", "UDAAP",
];

// ShyftOff courses by workflow phase.
// Phase 1 (Roster): only NB Certification Course is required for credentials.
// Phase 2 (Nesting): Pre-Production now includes FL Blue 2026 content (folded in).
export const ROSTER_COURSES = [
  "NationsBenefits Certification Course",
];
export const NESTING_COURSES = [
  "NationsBenefits Pre-Production",
  "Nations Benefits Navigation Meeting",
];

// FL Blue 2026 was merged into Pre-Production but still appears as a separate
// course code in legacy cert_progress data. We track it separately to detect
// agents who completed the OLD Pre-Production (without FL Blue content).
export const FL_BLUE_LEGACY = "NationsBenefits - Florida Blue 2026 Uptraining";

// SHYFTOFF_COURSES still includes FL Blue (4 entries) because the legacy integer
// cert_progress data was generated when FL Blue was a separate course.
export const SHYFTOFF_COURSES = [ROSTER_COURSES[0], FL_BLUE_LEGACY, ...NESTING_COURSES];
