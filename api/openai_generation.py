from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

import openai
from openai import AsyncOpenAI
from pydantic import ValidationError

from api.models import GeneratedPostDraft, GeneratedResponseDraft, ReferralSpecialtyInference

POST_PROMPT_VERSION = "lamina-post-draft-v2"
RESPONSE_PROMPT_VERSION = "lamina-response-draft-v2"
MEDPLUM_POST_PROMPT_VERSION = "lamina-medplum-post-draft-v2"
REFERRAL_PROMPT_VERSION = "lamina-referral-specialty-v2"
OutputT = TypeVar(
    "OutputT", GeneratedPostDraft, GeneratedResponseDraft, ReferralSpecialtyInference
)
_service_cache: tuple[OpenAISettings, OpenAIDraftGenerationService] | None = None


class GenerationError(Exception):
    def __init__(self, category: str, *, configuration: bool = False) -> None:
        super().__init__(category)
        self.category = category
        self.configuration = configuration


@dataclass(frozen=True)
class GenerationResult(Generic[OutputT]):
    output: OutputT
    model: str
    prompt_version: str
    provider_response_id: str | None = None


@dataclass(frozen=True)
class OpenAISettings:
    api_key: str
    model: str
    timeout_seconds: float
    max_output_tokens: int

    @classmethod
    def from_environment(cls) -> OpenAISettings:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        model = os.getenv("OPENAI_MODEL", "").strip()
        if not api_key or not model:
            raise GenerationError("openai_not_configured", configuration=True)
        try:
            timeout = float(os.getenv("OPENAI_REQUEST_TIMEOUT_SECONDS", "60"))
            max_tokens = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "2000"))
        except ValueError as error:
            raise GenerationError("openai_configuration_invalid", configuration=True) from error
        if timeout <= 0 or max_tokens <= 0:
            raise GenerationError("openai_configuration_invalid", configuration=True)
        return cls(api_key, model, timeout, max_tokens)


class DraftGenerationService(Protocol):
    async def generate_post(
        self, context: dict[str, object], raw_request: str
    ) -> GenerationResult[GeneratedPostDraft]: ...

    async def generate_response(
        self,
        context: dict[str, object],
        thread: dict[str, object],
        physician_guidance: str | None,
    ) -> GenerationResult[GeneratedResponseDraft]: ...

    async def generate_medplum_post(
        self,
        context: dict[str, object],
        case_facts: dict[str, object],
        physician_guidance: str,
    ) -> GenerationResult[GeneratedPostDraft]: ...

    async def infer_referral_specialty(
        self, case_facts: dict[str, object]
    ) -> GenerationResult[ReferralSpecialtyInference]: ...


def physician_agent_instructions(context: dict[str, object]) -> str:
    return f"""You are a Lamina drafting agent for {context['physician_name']}.
You are not the physician and must never impersonate them or claim to speak as them.
Agent ID: {context['agent_id']}
Verified specialties (directory or verification sourced credentials): {context['verified_specialties']}
Declared expertise (self-declared, not verified credentials): {context['declared_expertise_tags']}
Monitoring topics (interests, not credentials): {context['monitoring_topics']}
Citations required by configuration: {context['citations_required']}
Publication mode: {context['publication_mode']}

Prepare clinical draft content only; you cannot endorse, approve, or publish it. Only synthetic
cases are supported. Never invent patient facts, identifying information, diagnoses, treatment
instructions, evidence, or citations. Preserve uncertainty. The application enforces physician
approval through structured status and provenance metadata. Never narrate workflow state in the
title, clinical question, context summary, headline, or content. In particular, do not write "For
physician review," "Awaiting approval," "Not physician approved," or "Not a physician opinion until
approved." Do not narrate citation bookkeeping or say that citations were not supplied. When the
response schema has a citations field and no sources were supplied, return citations=[]. Return
exactly the requested schema.
Do not write phrases such as "I am Dr. {context['physician_name']}" or
"As Dr. {context['physician_name']}"."""


class OpenAIDraftGenerationService:
    def __init__(self, settings: OpenAISettings) -> None:
        self.settings = settings
        self.client = AsyncOpenAI(api_key=settings.api_key, timeout=settings.timeout_seconds)

    async def _parse(self, *, instructions: str, input_text: str, schema: type[OutputT]):
        try:
            response = await self.client.responses.parse(
                model=self.settings.model,
                instructions=instructions,
                input=input_text,
                text_format=schema,
                max_output_tokens=self.settings.max_output_tokens,
                store=False,
            )
        except openai.APITimeoutError as error:
            raise GenerationError("openai_timeout") from error
        except openai.AuthenticationError as error:
            raise GenerationError("openai_authentication_failed") from error
        except openai.RateLimitError as error:
            raise GenerationError("openai_rate_limited") from error
        except openai.APIConnectionError as error:
            raise GenerationError("openai_connection_failed") from error
        except openai.APIStatusError as error:
            raise GenerationError("openai_upstream_error") from error
        except ValidationError as error:
            raise GenerationError("openai_invalid_output") from error
        except Exception as error:
            raise GenerationError("openai_unexpected_error") from error

        if response.status == "incomplete":
            raise GenerationError("openai_incomplete_output")
        if response.output_parsed is None:
            has_refusal = any(
                getattr(content, "type", None) == "refusal"
                for item in response.output
                for content in getattr(item, "content", [])
            )
            raise GenerationError("openai_refusal" if has_refusal else "openai_invalid_output")
        return response

    async def generate_post(
        self, context: dict[str, object], raw_request: str
    ) -> GenerationResult[GeneratedPostDraft]:
        response = await self._parse(
            instructions=physician_agent_instructions(context),
            input_text=(
                f"Prompt version: {POST_PROMPT_VERSION}\n"
                "Create a synthetic Lamina forum question draft from this physician request. "
                "Do not add facts that are not present or mention review state or citation "
                "bookkeeping in clinical fields.\n\n"
                f"Physician request:\n{raw_request}"
            ),
            schema=GeneratedPostDraft,
        )
        return GenerationResult(
            output=response.output_parsed,
            model=self.settings.model,
            prompt_version=POST_PROMPT_VERSION,
            provider_response_id=response.id,
        )

    async def generate_response(
        self,
        context: dict[str, object],
        thread: dict[str, object],
        physician_guidance: str | None,
    ) -> GenerationResult[GeneratedResponseDraft]:
        response = await self._parse(
            instructions=physician_agent_instructions(context),
            input_text=(
                f"Prompt version: {RESPONSE_PROMPT_VERSION}\n"
                "Draft a response to the published synthetic thread below. Use only supplied "
                "facts. Set the structured citations field to [] because no evidence sources were "
                "supplied; do not mention that absence in the headline or clinical content.\n\n"
                f"Published thread context:\n{json.dumps(thread, ensure_ascii=False)}\n\n"
                f"Physician guidance:\n{physician_guidance or 'No additional guidance.'}"
            ),
            schema=GeneratedResponseDraft,
        )
        return GenerationResult(
            output=response.output_parsed,
            model=self.settings.model,
            prompt_version=RESPONSE_PROMPT_VERSION,
            provider_response_id=response.id,
        )

    async def generate_medplum_post(
        self,
        context: dict[str, object],
        case_facts: dict[str, object],
        physician_guidance: str,
    ) -> GenerationResult[GeneratedPostDraft]:
        response = await self._parse(
            instructions=physician_agent_instructions(context),
            input_text=(
                f"Prompt version: {MEDPLUM_POST_PROMPT_VERSION}\n"
                "Create a Lamina forum question draft from the bounded synthetic case facts. "
                "Facts not supplied must remain unknown. Do not diagnose or recommend treatment. "
                "Do not fabricate or narrate absent citations, and do not mention review or "
                "approval state in clinical fields.\n\n"
                f"Bounded synthetic case facts:\n{json.dumps(case_facts, ensure_ascii=False)}\n\n"
                f"Physician guidance:\n{physician_guidance}"
            ),
            schema=GeneratedPostDraft,
        )
        return GenerationResult(
            output=response.output_parsed,
            model=self.settings.model,
            prompt_version=MEDPLUM_POST_PROMPT_VERSION,
            provider_response_id=response.id,
        )

    async def infer_referral_specialty(
        self, case_facts: dict[str, object]
    ) -> GenerationResult[ReferralSpecialtyInference]:
        response = await self._parse(
            instructions=(
                "Infer one appropriate physician specialty from bounded synthetic case facts. "
                "This is a specialist-network referral, not an acute-care or triage destination; "
                "do not return Emergency Medicine or Urgent Care. "
                "Return only the specialty and a short referral reason. Do not diagnose, rank "
                "physicians, recommend a named physician, or add facts not supplied."
            ),
            input_text=(
                f"Prompt version: {REFERRAL_PROMPT_VERSION}\n"
                "Select the most relevant physician specialty for a referral discussion using "
                "only these bounded synthetic case facts. Keep the reason concise and preserve "
                "uncertainty.\n\n"
                f"Bounded synthetic case facts:\n{json.dumps(case_facts, ensure_ascii=False)}"
            ),
            schema=ReferralSpecialtyInference,
        )
        return GenerationResult(
            output=response.output_parsed,
            model=self.settings.model,
            prompt_version=REFERRAL_PROMPT_VERSION,
            provider_response_id=response.id,
        )


def create_generation_service() -> DraftGenerationService:
    global _service_cache
    settings = OpenAISettings.from_environment()
    if _service_cache is None or _service_cache[0] != settings:
        _service_cache = (settings, OpenAIDraftGenerationService(settings))
    return _service_cache[1]
