PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS physicians (
  npi TEXT PRIMARY KEY,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  suffix TEXT,
  credential TEXT,
  display_name TEXT NOT NULL,
  primary_taxonomy_code TEXT,
  primary_specialty TEXT,
  organization_name TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country_code TEXT,
  phone TEXT,
  enumeration_date TEXT,
  last_updated TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'NPPES',
  profile_status TEXT NOT NULL DEFAULT 'unclaimed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  physician_npi TEXT NOT NULL UNIQUE REFERENCES physicians(npi),
  status TEXT NOT NULL DEFAULT 'reserved',
  claimed INTEGER NOT NULL DEFAULT 0,
  public_posting_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profile_claims (
  id TEXT PRIMARY KEY,
  physician_npi TEXT NOT NULL REFERENCES physicians(npi),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified')),
  verification_method TEXT,
  requested_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_configurations (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  verified_specialties_json TEXT NOT NULL,
  declared_expertise_tags_json TEXT NOT NULL,
  monitoring_topics_json TEXT NOT NULL,
  voice_post_drafting_enabled INTEGER NOT NULL,
  response_drafting_enabled INTEGER NOT NULL,
  thread_summaries_enabled INTEGER NOT NULL,
  citations_required INTEGER NOT NULL,
  publication_mode TEXT NOT NULL CHECK (publication_mode = 'requires_physician_approval'),
  report_cadence TEXT NOT NULL CHECK (report_cadence IN ('none', 'weekly', 'monthly')),
  report_topics_json TEXT NOT NULL,
  report_source_scope TEXT NOT NULL CHECK (
    report_source_scope IN ('network', 'medplum', 'network_and_medplum')
  ),
  report_length TEXT NOT NULL CHECK (report_length IN ('brief', 'detailed')),
  notifications_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_audit_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  physician_npi TEXT NOT NULL REFERENCES physicians(npi),
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_posts (
  id TEXT PRIMARY KEY,
  author_agent_id TEXT NOT NULL REFERENCES agents(id),
  author_physician_npi TEXT NOT NULL REFERENCES physicians(npi),
  title TEXT NOT NULL,
  clinical_question TEXT NOT NULL,
  context_summary TEXT NOT NULL,
  specialty_tags_json TEXT NOT NULL,
  case_classification TEXT NOT NULL CHECK (case_classification = 'synthetic'),
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'awaiting_physician_approval', 'published', 'closed', 'rejected')
  ),
  draft_origin TEXT NOT NULL CHECK (
    draft_origin IN (
      'physician_text_request', 'physician_voice_request', 'agent_suggested', 'agent_generated'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  published_at TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS forum_responses (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES forum_posts(id),
  author_agent_id TEXT NOT NULL REFERENCES agents(id),
  author_physician_npi TEXT NOT NULL REFERENCES physicians(npi),
  response_type TEXT NOT NULL CHECK (
    response_type IN (
      'clinical_consideration', 'clarifying_question', 'risk', 'evidence',
      'suggested_next_step'
    )
  ),
  headline TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'awaiting_physician_approval', 'published', 'rejected')
  ),
  draft_origin TEXT NOT NULL CHECK (
    draft_origin IN ('physician_text_request', 'agent_generated')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  published_at TEXT,
  rejected_at TEXT
);

CREATE TABLE IF NOT EXISTS generation_metadata (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('post', 'response')),
  content_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  physician_npi TEXT NOT NULL REFERENCES physicians(npi),
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_response_id TEXT,
  generated_at TEXT NOT NULL,
  UNIQUE(content_type, content_id)
);

CREATE TABLE IF NOT EXISTS integration_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_medplum_links (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL UNIQUE REFERENCES forum_posts(id),
  medplum_patient_id TEXT NOT NULL,
  medplum_condition_ids_json TEXT NOT NULL,
  medplum_medication_request_ids_json TEXT NOT NULL,
  medplum_observation_ids_json TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type = 'medplum_synthetic_patient'),
  created_by_agent_id TEXT NOT NULL REFERENCES agents(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  export_communication_id TEXT,
  exported_at TEXT
);

CREATE TABLE IF NOT EXISTS medplum_practitioner_links (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  physician_npi TEXT NOT NULL UNIQUE REFERENCES physicians(npi),
  medplum_practitioner_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitoring_runs (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES forum_posts(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  routing_candidate INTEGER NOT NULL,
  matched_topics_json TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('skipped', 'no_relevant_case', 'draft_created', 'failed')),
  matched_case_count INTEGER NOT NULL DEFAULT 0,
  response_id TEXT REFERENCES forum_responses(id),
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  safe_trace_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  safe_error_category TEXT,
  UNIQUE(post_id, agent_id)
);

CREATE TABLE IF NOT EXISTS response_grounding (
  response_id TEXT PRIMARY KEY REFERENCES forum_responses(id),
  grounding_mode TEXT NOT NULL CHECK (grounding_mode = 'medplum_case_match'),
  source_system TEXT NOT NULL CHECK (source_system = 'medplum'),
  matched_case_count INTEGER NOT NULL,
  supporting_case_refs_json TEXT NOT NULL,
  monitoring_run_id TEXT NOT NULL REFERENCES monitoring_runs(id),
  relevance_reason TEXT NOT NULL,
  similarities_json TEXT NOT NULL,
  differences_json TEXT NOT NULL,
  unknowns_json TEXT NOT NULL,
  supporting_case_summaries_json TEXT NOT NULL,
  execution_trace_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_claims_agent
  ON profile_claims(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_claims_physician
  ON profile_claims(physician_npi, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_events_agent
  ON agent_audit_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_feed
  ON forum_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author
  ON forum_posts(author_physician_npi, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_responses_post
  ON forum_responses(post_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_forum_responses_author
  ON forum_responses(author_physician_npi, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_metadata_agent
  ON generation_metadata(agent_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_audit_events_action
  ON integration_audit_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_medplum_links_patient
  ON forum_medplum_links(medplum_patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitoring_runs_post
  ON monitoring_runs(post_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitoring_runs_agent
  ON monitoring_runs(agent_id, started_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS physician_fts USING fts5(
  npi UNINDEXED,
  display_name,
  primary_specialty,
  city,
  state,
  tokenize = 'unicode61 remove_diacritics 2'
);
