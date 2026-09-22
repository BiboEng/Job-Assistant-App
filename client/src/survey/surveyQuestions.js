/**
 * The onboarding career survey, as data.
 *
 * This module is the single source of truth for the survey: the form renders
 * from it, and `surveyApi.js` maps answers to and from table columns using the
 * same `column` keys. Adding a question means adding it here and adding the
 * column (with its CHECK constraint) to the migration — nothing else needs to
 * know a question exists.
 *
 * Every question is optional. `column` matches `public.user_survey_responses`
 * in `supabase/migrations/20260921120000_user_survey_responses.sql`; option
 * `value`s must stay inside that column's CHECK constraint, or the row is
 * rejected by Postgres rather than by us.
 *
 * NOTE: none of this reaches the AI. The answers are stored in Supabase and
 * read back only by the survey screen. No prompt in server/ references them —
 * see CLAUDE.md → "Career survey".
 */

/** Matches the `char_length(...) <= n` checks in the migration. */
export const TEXT_LIMITS = {
  short: 120,
  long: 600,
};

/**
 * Grouped into steps rather than one question per screen: fifteen separate
 * screens for an optional survey is a form people abandon halfway. Three or
 * four related questions at a time still reads as "short".
 */
export const SURVEY_STEPS = [
  {
    id: "about-you",
    title: "About you",
    blurb: "Where you are in your career right now.",
    questions: [
      {
        id: "career_stage",
        column: "career_stage",
        type: "single",
        label: "What's your current career stage?",
        options: [
          { value: "student", label: "Student" },
          { value: "entry_level", label: "Entry-level" },
          { value: "mid_level", label: "Mid-level" },
          { value: "senior", label: "Senior" },
          { value: "career_changer", label: "Career changer" },
        ],
      },
      {
        id: "employment_status",
        column: "employment_status",
        type: "single",
        label: "What's your current employment status?",
        options: [
          { value: "employed", label: "Employed" },
          { value: "job_hunting", label: "Unemployed and job hunting" },
          { value: "student", label: "Student" },
          { value: "freelance", label: "Freelance / self-employed" },
        ],
      },
      {
        id: "years_experience",
        column: "years_experience",
        type: "single",
        label: "How many years of professional experience do you have?",
        options: [
          { value: "0_1", label: "0–1" },
          { value: "2_4", label: "2–4" },
          { value: "5_9", label: "5–9" },
          { value: "10_plus", label: "10+" },
        ],
      },
      {
        id: "education_level",
        column: "education_level",
        type: "single",
        label: "What's your highest level of education?",
        options: [
          { value: "high_school", label: "High school" },
          { value: "bachelors", label: "Bachelor's" },
          { value: "masters", label: "Master's" },
          { value: "phd", label: "PhD" },
          { value: "other", label: "Other / prefer not to say" },
        ],
      },
    ],
  },

  {
    id: "target",
    title: "What you're after",
    blurb: "The role you're aiming at, and how soon.",
    questions: [
      {
        id: "target_industry",
        column: "target_industry",
        type: "single",
        label: "What industry or field are you primarily targeting?",
        options: [
          { value: "technology", label: "Technology" },
          { value: "finance", label: "Finance" },
          { value: "healthcare", label: "Healthcare" },
          { value: "education", label: "Education" },
          { value: "marketing", label: "Marketing" },
          { value: "design", label: "Design" },
          { value: "sales", label: "Sales" },
          { value: "engineering", label: "Engineering" },
          { value: "government", label: "Government / public sector" },
          { value: "retail", label: "Retail / hospitality" },
          { value: "nonprofit", label: "Nonprofit" },
          { value: "other", label: "Other" },
        ],
        // Shown only when that option is chosen, and stored in its own column,
        // so "other" stays a real enum value rather than free text smuggled
        // into a constrained column.
        followUp: {
          when: "other",
          column: "target_industry_other",
          label: "Which field?",
          placeholder: "e.g. Renewable energy",
          maxLength: TEXT_LIMITS.short,
        },
      },
      {
        id: "target_role",
        column: "target_role",
        type: "text",
        label: "What's your target job title or role?",
        placeholder: "e.g. Senior Frontend Engineer",
        maxLength: TEXT_LIMITS.short,
      },
      {
        id: "timeline",
        column: "timeline",
        type: "single",
        label: "How soon are you hoping to land a new role?",
        options: [
          { value: "asap", label: "ASAP" },
          { value: "1_3_months", label: "1–3 months" },
          { value: "3_6_months", label: "3–6 months" },
          { value: "exploring", label: "Just exploring" },
        ],
      },
    ],
  },

  {
    id: "preferences",
    title: "Preferences",
    blurb: "How and where you would like to work.",
    questions: [
      {
        id: "company_targeting",
        column: "company_targeting",
        type: "single",
        label: "Are you targeting specific companies, or open to any?",
        options: [
          { value: "specific", label: "Specific companies" },
          { value: "open_in_field", label: "Open to any in my field" },
          { value: "open_to_anything", label: "Open to anything" },
        ],
        followUp: {
          when: "specific",
          column: "target_companies",
          label: "Which ones?",
          placeholder: "e.g. Stripe, Figma, Linear",
          maxLength: TEXT_LIMITS.long,
          multiline: true,
        },
      },
      {
        id: "work_arrangement",
        column: "work_arrangement",
        type: "single",
        label: "What's your work arrangement preference?",
        options: [
          { value: "remote", label: "Remote" },
          { value: "hybrid", label: "Hybrid" },
          { value: "in_office", label: "In-office" },
          { value: "no_preference", label: "No preference" },
        ],
      },
      {
        id: "salary_expectation",
        column: "salary_expectation",
        type: "text",
        label: "What's your target salary range, if you're comfortable sharing?",
        placeholder: "e.g. 90,000–120,000",
        maxLength: TEXT_LIMITS.short,
        // A checkbox rather than one more option in a list: declining to say is
        // a different act from leaving the box empty, and the column pair keeps
        // the two apart. Ticking it clears and disables the text field.
        optOut: {
          column: "salary_opt_out",
          label: "Prefer not to say",
        },
      },
    ],
  },

  {
    id: "help",
    title: "Where you'd like help",
    blurb: "Pick as many as apply — or none.",
    questions: [
      {
        id: "job_search_challenges",
        column: "job_search_challenges",
        type: "multi",
        label: "What's your biggest challenge in job searching right now?",
        options: [
          { value: "resume", label: "Resume" },
          { value: "interview_skills", label: "Interview skills" },
          { value: "job_leads", label: "Finding job leads" },
          { value: "networking", label: "Networking" },
          { value: "confidence", label: "Confidence" },
          { value: "other", label: "Other" },
        ],
      },
      {
        id: "interview_nerves",
        column: "interview_nerves",
        type: "multi",
        label: "Which type of interviews make you most nervous?",
        options: [
          { value: "behavioral", label: "Behavioral" },
          { value: "technical", label: "Technical" },
          { value: "case_study", label: "Case study / whiteboard" },
          { value: "panel", label: "Panel interviews" },
          { value: "salary_negotiation", label: "Salary negotiation" },
        ],
      },
      {
        id: "app_goals",
        column: "app_goals",
        type: "multi",
        label: "What's most important to you in using this app?",
        options: [
          { value: "interview_practice", label: "Interview practice" },
          { value: "resume_building", label: "Resume building" },
          { value: "job_discovery", label: "Discovering job openings" },
          { value: "confidence", label: "Overall confidence-building" },
        ],
      },
    ],
  },

  {
    id: "anything-else",
    title: "Anything else",
    blurb: "Two last ones, then you're done.",
    questions: [
      {
        id: "resume_status",
        column: "resume_status",
        type: "single",
        label: "Do you already have a resume, or are you starting from scratch?",
        options: [
          { value: "have_one", label: "Have one — need to update it" },
          { value: "from_scratch", label: "Starting from scratch" },
          { value: "not_sure", label: "Not sure" },
        ],
      },
      {
        id: "coach_wish",
        column: "coach_wish",
        type: "text",
        label: "What's one thing you wish an interview coach could help you with?",
        placeholder: "Anything at all — this one's free-form.",
        maxLength: TEXT_LIMITS.long,
        multiline: true,
      },
    ],
  },
];

/**
 * Every question, flat, in step order — and this, not `SURVEY_STEPS`, is what
 * the screen walks: one question per screen, Next to advance.
 *
 * The step grouping survives as `section`, carried onto each question. It is no
 * longer a unit of navigation, only a label ("About you", "Preferences") shown
 * above the question so someone twelve screens in can still tell roughly where
 * they are. Keeping the groups also keeps related questions adjacent, which is
 * what makes the run of fifteen feel ordered rather than arbitrary.
 */
export const SURVEY_QUESTIONS = SURVEY_STEPS.flatMap((step) =>
  step.questions.map((q) => ({ ...q, section: step.title }))
);

export const TOTAL_QUESTIONS = SURVEY_QUESTIONS.length;
