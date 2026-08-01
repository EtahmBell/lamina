// Hackathon synthetic showcase content. Not backend clinical data.

export type ShowcasePhysician = {
  id: string
  isShowcase: true
  name: string
  credentials: string
  specialty: string
  location: string
  distance: string
  contributions: number
  responses: number
  views: string
  mutualConnections: number
  topics: string[]
  avatarTone: 'navy' | 'rust' | 'sage' | 'gold'
}

export type ShowcasePost = {
  id: string
  isShowcase: true
  physicianId: string
  type: 'discussion' | 'report'
  title: string
  excerpt: string
  tags: string[]
  publishedAt: string
  likes: number
  responses: number
  views: string
}

export const SHOWCASE_PHYSICIANS: ShowcasePhysician[] = [
  {
    id: 'helena-ortiz',
    isShowcase: true,
    name: 'Helena Ortiz',
    credentials: 'MD',
    specialty: 'Cardiology',
    location: 'San Francisco, CA',
    distance: '8 miles from your practice',
    contributions: 42,
    responses: 86,
    views: '18.4k',
    mutualConnections: 6,
    topics: ['Cardiovascular Risk', 'Anticoagulation', 'Referral Timing'],
    avatarTone: 'rust',
  },
  {
    id: 'noah-bennett',
    isShowcase: true,
    name: 'Noah Bennett',
    credentials: 'MD',
    specialty: 'Neurology',
    location: 'Palo Alto, CA',
    distance: '31 miles from your practice',
    contributions: 37,
    responses: 64,
    views: '12.7k',
    mutualConnections: 4,
    topics: ['Cognitive Health', 'Stroke', 'Specialty Evaluation'],
    avatarTone: 'navy',
  },
  {
    id: 'priya-shah',
    isShowcase: true,
    name: 'Priya Shah',
    credentials: 'MD',
    specialty: 'Endocrinology',
    location: 'San Jose, CA',
    distance: '49 miles from your practice',
    contributions: 58,
    responses: 103,
    views: '24.1k',
    mutualConnections: 9,
    topics: ['Diabetes', 'Metabolic Medicine', 'Medication Tolerance'],
    avatarTone: 'sage',
  },
  {
    id: 'daniel-kim',
    isShowcase: true,
    name: 'Daniel Kim',
    credentials: 'MD',
    specialty: 'Gastroenterology',
    location: 'San Francisco, CA',
    distance: '5 miles from your practice',
    contributions: 31,
    responses: 52,
    views: '9.8k',
    mutualConnections: 5,
    topics: ['GI Symptoms', 'Medication Effects', 'Care Coordination'],
    avatarTone: 'gold',
  },
  {
    id: 'amara-okafor',
    isShowcase: true,
    name: 'Amara Okafor',
    credentials: 'MD',
    specialty: 'Psychiatry',
    location: 'Oakland, CA',
    distance: '12 miles from your practice',
    contributions: 28,
    responses: 47,
    views: '8.6k',
    mutualConnections: 3,
    topics: ['Behavioral Health', 'Integrated Care', 'Medication Safety'],
    avatarTone: 'navy',
  },
]

export const SHOWCASE_POSTS: ShowcasePost[] = [
  {
    id: 'showcase-glp1-tolerance',
    isShowcase: true,
    physicianId: 'priya-shah',
    type: 'discussion',
    title: 'GLP-1 dose escalation and persistent nausea — what patterns are you seeing?',
    excerpt: 'A physician discussion about counseling, dose timing, and the threshold for reassessing an escalation plan in synthetic cases.',
    tags: ['Endocrinology', 'Medication Tolerance'],
    publishedAt: '2026-07-31T17:15:00Z',
    likes: 128,
    responses: 14,
    views: '2.4k',
  },
  {
    id: 'showcase-thrombectomy-referral',
    isShowcase: true,
    physicianId: 'helena-ortiz',
    type: 'discussion',
    title: 'Late-window thrombectomy referrals with uncertain anticoagulation timing',
    excerpt: 'How physicians are structuring referral conversations when medication timing is incomplete and transfer decisions are time-sensitive.',
    tags: ['Cardiology', 'Stroke', 'Referral Timing'],
    publishedAt: '2026-07-30T15:40:00Z',
    likes: 94,
    responses: 11,
    views: '1.9k',
  },
  {
    id: 'showcase-cognitive-referral',
    isShowcase: true,
    physicianId: 'noah-bennett',
    type: 'discussion',
    title: 'When do you refer mild cognitive impairment for specialty evaluation?',
    excerpt: 'A practical exchange about changes in trajectory, functional impact, and the information that makes an initial neurology referral more useful.',
    tags: ['Neurology', 'Cognitive Health'],
    publishedAt: '2026-07-29T18:05:00Z',
    likes: 76,
    responses: 18,
    views: '1.6k',
  },
  {
    id: 'showcase-thyroid-fatigue',
    isShowcase: true,
    physicianId: 'amara-okafor',
    type: 'discussion',
    title: 'Persistent fatigue after thyroid normalization — what are you checking next?',
    excerpt: 'Physicians compare multidisciplinary next steps while avoiding premature attribution to a single clinical domain.',
    tags: ['Integrated Care', 'Endocrinology'],
    publishedAt: '2026-07-27T16:20:00Z',
    likes: 63,
    responses: 9,
    views: '1.2k',
  },
  {
    id: 'showcase-sglt2-report',
    isShowcase: true,
    physicianId: 'priya-shah',
    type: 'report',
    title: 'Endocrinology network report: recurring issues after SGLT2 initiation',
    excerpt: 'A synthetic briefing on themes represented across physician discussions: hydration context, ketone interpretation, medication holds, and follow-up planning.',
    tags: ['Network Report', 'SGLT2', 'Metabolic Medicine'],
    publishedAt: '2026-07-25T14:10:00Z',
    likes: 152,
    responses: 22,
    views: '3.1k',
  },
]

export function showcasePhysician(physicianId: string): ShowcasePhysician {
  const physician = SHOWCASE_PHYSICIANS.find((item) => item.id === physicianId)
  if (!physician) throw new Error(`Unknown showcase physician: ${physicianId}`)
  return physician
}

export function showcasePostsForPhysician(physicianId: string): ShowcasePost[] {
  return SHOWCASE_POSTS.filter((post) => post.physicianId === physicianId)
}

export function normalizeShowcaseSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bcardiologists?\b/g, 'cardiology')
    .replace(/\bendocrinologists?\b/g, 'endocrinology')
    .replace(/\bneurologists?\b/g, 'neurology')
    .replace(/\bgastroenterologists?\b/g, 'gastroenterology')
    .replace(/\bpsychiatrists?\b/g, 'psychiatry')
}
