import { ProviderCategory } from './pack.model';

/** Where a certification sits in the student's journey. */
export type CertTrackStatus = 'backlog' | 'in-progress' | 'earned';

export const CERT_TRACK_STATUSES: CertTrackStatus[] = ['backlog', 'in-progress', 'earned'];

export interface CertTrackEntry {
  status: CertTrackStatus;
  /** ISO date (yyyy-mm-dd), only meaningful when earned. */
  earnedDate?: string;
  /** ISO date (yyyy-mm-dd) the student is aiming for. */
  targetDate?: string;
  updatedAt: number;
}

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'lead';

export const EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'lead'];

/**
 * Student profile, persisted as `PROFILE` in the general table. Feeds the
 * Home suggestions (interests, earned/in-progress certifications are hidden
 * from suggestions) and the default accommodation for mock exams.
 */
export interface StudentProfile {
  name: string;
  headline: string;
  bio: string;
  experienceLevel: ExperienceLevel;
  linkedinUrl: string;
  githubUrl: string;
  interests: ProviderCategory[];
  /** Free text for ecosystems outside the fixed list (shown when "other" is selected). */
  otherInterests: string;
  /** Keyed by catalog id (template file stem) or, for a hand-made certification, `pack:{packId}`. */
  tracks: Record<string, CertTrackEntry>;
  /** Default for the mock-exam "use accommodation" toggle (e.g. ESL +30 min). */
  useAccommodationByDefault: boolean;
  updatedAt: number;
}

export const EMPTY_PROFILE: StudentProfile = {
  name: '',
  headline: '',
  bio: '',
  experienceLevel: 'intermediate',
  linkedinUrl: '',
  githubUrl: '',
  interests: [],
  otherInterests: '',
  tracks: {},
  useAccommodationByDefault: false,
  updatedAt: 0,
};
