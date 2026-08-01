from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PublicationMode(StrEnum):
    REQUIRES_PHYSICIAN_APPROVAL = "requires_physician_approval"


class ReportCadence(StrEnum):
    NONE = "none"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class ReportSourceScope(StrEnum):
    NETWORK = "network"
    MEDPLUM = "medplum"
    NETWORK_AND_MEDPLUM = "network_and_medplum"


class ReportLength(StrEnum):
    BRIEF = "brief"
    DETAILED = "detailed"


class Notification(StrEnum):
    DRAFT_RESPONSE_READY = "draft_response_ready"
    REPLY_TO_MY_QUESTION = "reply_to_my_question"
    CLARIFICATION_REQUESTED = "clarification_requested"
    REPORT_READY = "report_ready"


def normalize_values(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = " ".join(value.split()).strip()
        key = clean.casefold()
        if clean and key not in seen:
            seen.add(key)
            normalized.append(clean)
    return normalized


GENERATED_CONTENT_METADATA_PHRASES = (
    "for physician review",
    "awaiting approval",
    "awaiting physician approval",
    "not physician approved",
    "not a physician opinion until approved",
    "no citations were supplied",
    "no citations supplied",
    "citations were not supplied",
)


def validate_generated_clinical_content(value: str) -> str:
    clean = value.strip()
    if not clean:
        raise ValueError("generated content must not be blank")
    normalized = " ".join(clean.casefold().split())
    if any(phrase in normalized for phrase in GENERATED_CONTENT_METADATA_PHRASES):
        raise ValueError("generated clinical content must not narrate workflow metadata")
    return clean


class AgentConfigurationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    declared_expertise_tags: list[str] = Field(default_factory=list)
    monitoring_topics: list[str] = Field(default_factory=list)
    voice_post_drafting_enabled: bool = False
    response_drafting_enabled: bool = False
    thread_summaries_enabled: bool = False
    citations_required: bool = True
    publication_mode: PublicationMode = PublicationMode.REQUIRES_PHYSICIAN_APPROVAL
    report_cadence: ReportCadence = ReportCadence.NONE
    report_topics: list[str] = Field(default_factory=list)
    report_source_scope: ReportSourceScope = ReportSourceScope.NETWORK
    report_length: ReportLength = ReportLength.BRIEF
    notifications: list[Notification] = Field(default_factory=list)

    @field_validator("declared_expertise_tags", "monitoring_topics", "report_topics")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        return normalize_values(values)

    @field_validator("notifications")
    @classmethod
    def deduplicate_notifications(cls, values: list[Notification]) -> list[Notification]:
        return list(dict.fromkeys(values))


class CaseClassification(StrEnum):
    SYNTHETIC = "synthetic"


class PostDraftOrigin(StrEnum):
    PHYSICIAN_TEXT_REQUEST = "physician_text_request"
    PHYSICIAN_VOICE_REQUEST = "physician_voice_request"
    AGENT_SUGGESTED = "agent_suggested"
    AGENT_GENERATED = "agent_generated"


class ResponseDraftOrigin(StrEnum):
    PHYSICIAN_TEXT_REQUEST = "physician_text_request"
    AGENT_GENERATED = "agent_generated"


class ResponseType(StrEnum):
    CLINICAL_CONSIDERATION = "clinical_consideration"
    CLARIFYING_QUESTION = "clarifying_question"
    RISK = "risk"
    EVIDENCE = "evidence"
    SUGGESTED_NEXT_STEP = "suggested_next_step"


class ForumPostDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str
    title: str = Field(min_length=1, max_length=200)
    clinical_question: str = Field(min_length=1, max_length=5000)
    context_summary: str = Field(min_length=1, max_length=5000)
    specialty_tags: list[str] = Field(default_factory=list)
    case_classification: CaseClassification
    draft_origin: PostDraftOrigin = PostDraftOrigin.PHYSICIAN_TEXT_REQUEST

    @field_validator("specialty_tags")
    @classmethod
    def normalize_specialty_tags(cls, values: list[str]) -> list[str]:
        return normalize_values(values)


class ForumResponseDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str
    response_type: ResponseType
    headline: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5000)
    citations: list[str] = Field(default_factory=list)
    draft_origin: ResponseDraftOrigin = ResponseDraftOrigin.PHYSICIAN_TEXT_REQUEST


class PhysicianApprovalInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    physician_npi: str


class PhysicianRejectionInput(PhysicianApprovalInput):
    reason: str = Field(min_length=1, max_length=500)


class GeneratePostInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str
    raw_request: str = Field(min_length=1, max_length=10_000)

    @field_validator("raw_request")
    @classmethod
    def reject_blank_request(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("raw_request must not be blank")
        return value.strip()


class GenerateResponseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str
    physician_guidance: str | None = Field(default=None, max_length=5_000)

    @field_validator("physician_guidance")
    @classmethod
    def normalize_guidance(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class GeneratedPostDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    clinical_question: str = Field(min_length=1, max_length=5_000)
    context_summary: str = Field(min_length=1, max_length=5_000)
    specialty_tags: list[str]
    uncertainties: list[str] = Field(default_factory=list)

    @field_validator("title", "clinical_question", "context_summary")
    @classmethod
    def reject_blank_content(cls, value: str) -> str:
        return validate_generated_clinical_content(value)

    @field_validator("specialty_tags", "uncertainties")
    @classmethod
    def normalize_generated_lists(cls, values: list[str]) -> list[str]:
        return normalize_values(values)


class GeneratedResponseDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    response_type: ResponseType
    headline: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5_000)
    citations: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)

    @field_validator("headline", "content")
    @classmethod
    def reject_blank_content(cls, value: str) -> str:
        return validate_generated_clinical_content(value)

    @field_validator("citations", "uncertainties")
    @classmethod
    def normalize_generated_lists(cls, values: list[str]) -> list[str]:
        return normalize_values(values)


class MedplumConditionContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display: str
    clinical_status: str


class MedplumMedicationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display: str
    status: str
    timing_summary: str


class MedplumObservationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display: str
    value_summary: str
    effective_date: str


class MedplumCaseContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: str
    synthetic: bool
    age_band: str
    conditions: list[MedplumConditionContext]
    medications: list[MedplumMedicationContext]
    observations: list[MedplumObservationContext]
    source_resource_refs: list[str]


class GenerateMedplumPostInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str
    physician_guidance: str = Field(min_length=1, max_length=5_000)

    @field_validator("physician_guidance")
    @classmethod
    def reject_blank_guidance(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("physician_guidance must not be blank")
        return value.strip()


class MonitoringConfidence(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class MonitoringAction(StrEnum):
    NO_RESPONSE = "no_response"
    DRAFT_RESPONSE = "draft_response"


class MonitoringRelevance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_relevant: bool
    confidence: MonitoringConfidence
    concise_reason: str = Field(min_length=1, max_length=500)


class MonitoringResponseDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    response_type: ResponseType
    headline: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5_000)

    @field_validator("headline", "content")
    @classmethod
    def reject_workflow_metadata(cls, value: str) -> str:
        return validate_generated_clinical_content(value)


class MonitoringGroundingSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    matched_case_count: int = Field(ge=0, le=3)


class GroundedMonitoringResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relevance: MonitoringRelevance
    matching_case_refs: list[str] = Field(max_length=3)
    similarities: list[str] = Field(max_length=10)
    differences: list[str] = Field(max_length=10)
    unknowns: list[str] = Field(max_length=10)
    action: MonitoringAction
    response_draft: MonitoringResponseDraft | None
    grounding_summary: MonitoringGroundingSummary

    @field_validator("matching_case_refs", "similarities", "differences", "unknowns")
    @classmethod
    def normalize_monitoring_lists(cls, values: list[str]) -> list[str]:
        return normalize_values(values)


class AgentMonitoringRunInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    post_id: str
