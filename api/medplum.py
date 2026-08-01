from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol
from urllib.parse import quote

import httpx

from api.models import (
    MedplumCaseContext,
    MedplumConditionContext,
    MedplumMedicationContext,
    MedplumObservationContext,
)

SYNTHETIC_TAG_SYSTEM = "https://lamina.health/fhir/tags"
SYNTHETIC_TAG_CODE = "synthetic-demo"
SYNTHETIC_TAG = {
    "system": SYNTHETIC_TAG_SYSTEM,
    "code": SYNTHETIC_TAG_CODE,
    "display": "Lamina synthetic demo data",
}
APPROVED_TAG = {
    "system": SYNTHETIC_TAG_SYSTEM,
    "code": "lamina-approved-discussion",
    "display": "Lamina approved network discussion",
}
DEMO_PATIENT_IDENTIFIER_SYSTEM = "https://lamina.health/fhir/demo-patient"
DEMO_PATIENT_IDENTIFIER_VALUE = "lamina-demo-patient-001"
COMMUNICATION_IDENTIFIER_SYSTEM = "https://lamina.health/fhir/communication"
MAX_FHIR_RESPONSE_BYTES = 2_000_000


class MedplumError(Exception):
    def __init__(self, category: str, *, configuration: bool = False, not_found: bool = False):
        super().__init__(category)
        self.category = category
        self.configuration = configuration
        self.not_found = not_found


@dataclass(frozen=True)
class MedplumSettings:
    base_url: str
    token_url: str
    fhir_base_url: str
    client_id: str
    client_secret: str
    project_id: str
    timeout_seconds: float

    @classmethod
    def from_environment(cls) -> MedplumSettings:
        base_url = os.getenv("MEDPLUM_BASE_URL", "").strip().rstrip("/")
        token_url = os.getenv("MEDPLUM_TOKEN_URL", "").strip()
        client_id = os.getenv("MEDPLUM_CLIENT_ID", "").strip()
        client_secret = os.getenv("MEDPLUM_CLIENT_SECRET", "").strip()
        project_id = os.getenv("MEDPLUM_PROJECT_ID", "").strip()
        if not all((base_url, token_url, client_id, client_secret, project_id)):
            raise MedplumError("medplum_not_configured", configuration=True)
        fhir_base = os.getenv("MEDPLUM_FHIR_BASE_URL", "").strip().rstrip("/")
        if not fhir_base:
            fhir_base = f"{base_url}/fhir/R4"
        try:
            timeout = float(os.getenv("MEDPLUM_REQUEST_TIMEOUT_SECONDS", "30"))
        except ValueError as error:
            raise MedplumError("medplum_configuration_invalid", configuration=True) from error
        if timeout <= 0:
            raise MedplumError("medplum_configuration_invalid", configuration=True)
        return cls(base_url, token_url, fhir_base, client_id, client_secret, project_id, timeout)


class MedplumService(Protocol):
    async def health(self) -> dict[str, bool]: ...

    async def get_case_context(self, patient_id: str) -> MedplumCaseContext: ...

    async def seed_demo_patient(self) -> dict[str, str]: ...

    async def seed_demo_panel(self) -> dict[str, object]: ...

    async def get_authorized_panel_cases(
        self, practitioner_id: str
    ) -> list[MedplumCaseContext]: ...

    async def export_discussion(
        self,
        *,
        post_id: str,
        patient_id: str,
        source_refs: list[str],
        title: str,
        approved_payload: str,
    ) -> dict[str, str]: ...


def has_synthetic_tag(resource: dict[str, object]) -> bool:
    meta = resource.get("meta") or {}
    return any(
        tag.get("system") == SYNTHETIC_TAG_SYSTEM and tag.get("code") == SYNTHETIC_TAG_CODE
        for tag in meta.get("tag", [])
    )


def bounded_text(value: object, limit: int = 300) -> str:
    return " ".join(str(value or "").split())[:limit]


def concept_text(value: object) -> str:
    if not isinstance(value, dict):
        return ""
    if value.get("text"):
        return bounded_text(value["text"])
    coding = value.get("coding") or []
    return bounded_text(coding[0].get("display")) if coding else ""


def age_band(birth_date: str | None) -> str:
    if not birth_date:
        return "unknown adult"
    try:
        born = date.fromisoformat(birth_date)
    except ValueError:
        return "unknown adult"
    today = datetime.now(UTC).date()
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    if age < 18:
        return "under 18"
    lower = (age // 10) * 10
    return f"{lower}–{lower + 9}"


def normalized_fact_key(*values: str) -> tuple[str, ...]:
    return tuple(" ".join(value.split()).casefold() for value in values)


def deduplicate_conditions(
    conditions: list[MedplumConditionContext],
) -> list[MedplumConditionContext]:
    unique: dict[tuple[str, str], MedplumConditionContext] = {}
    for condition in conditions:
        key = normalized_fact_key(condition.display, condition.clinical_status)
        unique.setdefault(key, condition)
    return sorted(unique.values(), key=lambda item: item.display.casefold())


def normalize_medications(
    medications: list[MedplumMedicationContext],
) -> list[MedplumMedicationContext]:
    groups: dict[str, dict[str, object]] = {}
    for medication in medications:
        display_key = normalized_fact_key(medication.display)[0]
        group = groups.setdefault(
            display_key,
            {
                "display": medication.display,
                "statuses": {},
                "timing_summaries": {},
            },
        )
        statuses = group["statuses"]
        timing_summaries = group["timing_summaries"]
        status_key = normalized_fact_key(medication.status)[0]
        timing_key = normalized_fact_key(medication.timing_summary)[0]
        if status_key:
            statuses.setdefault(status_key, medication.status)
        if timing_key:
            timing_summaries.setdefault(timing_key, medication.timing_summary)

    return sorted(
        [
            MedplumMedicationContext(
                display=str(group["display"]),
                status="; ".join(group["statuses"].values()) or "unknown",
                timing_summary="; ".join(group["timing_summaries"].values()),
            )
            for group in groups.values()
        ],
        key=lambda item: item.display.casefold(),
    )


def deduplicate_observations(
    observations: list[MedplumObservationContext],
) -> list[MedplumObservationContext]:
    unique: dict[tuple[str, str, str], MedplumObservationContext] = {}
    for observation in observations:
        key = normalized_fact_key(
            observation.display,
            observation.value_summary,
            observation.effective_date,
        )
        unique.setdefault(key, observation)
    return sorted(
        unique.values(),
        key=lambda item: (item.effective_date, item.display.casefold()),
    )


class MedplumClientService:
    def __init__(
        self, settings: MedplumSettings, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=settings.timeout_seconds, transport=transport)
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    async def _access_token(
        self, *, force_refresh: bool = False, previous_token: str | None = None
    ) -> str:
        if not force_refresh and self._token and time.monotonic() < self._token_expires_at:
            return self._token
        async with self._token_lock:
            if (
                force_refresh
                and previous_token
                and self._token != previous_token
                and time.monotonic() < self._token_expires_at
            ):
                return self._token
            if not force_refresh and self._token and time.monotonic() < self._token_expires_at:
                return self._token
            try:
                response = await self.client.post(
                    self.settings.token_url,
                    auth=(self.settings.client_id, self.settings.client_secret),
                    data={"grant_type": "client_credentials", "scope": "openid"},
                    headers={"Accept": "application/json"},
                )
            except httpx.TimeoutException as error:
                raise MedplumError("medplum_token_timeout") from error
            except httpx.HTTPError as error:
                raise MedplumError("medplum_token_unreachable") from error
            if response.status_code in {400, 401, 403}:
                raise MedplumError("medplum_authentication_failed")
            if response.status_code >= 400:
                raise MedplumError("medplum_token_upstream_error")
            try:
                payload = response.json()
                token = payload["access_token"]
                expires_in = max(int(payload.get("expires_in", 300)), 30)
            except (KeyError, TypeError, ValueError) as error:
                raise MedplumError("medplum_invalid_token_response") from error
            self._token = token
            self._token_expires_at = time.monotonic() + max(expires_in - 30, 1)
            return token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: dict[str, object] | None = None,
    ) -> dict[str, object]:
        token = await self._access_token()
        url = f"{self.settings.fhir_base_url}/{path.lstrip('/')}"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/fhir+json"}
        if json_body is not None:
            headers["Content-Type"] = "application/fhir+json"
        try:
            response = await self.client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers=headers,
            )
            if response.status_code == 401 and method.upper() == "GET":
                token = await self._access_token(force_refresh=True, previous_token=token)
                response = await self.client.request(
                    method,
                    url,
                    params=params,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/fhir+json",
                    },
                )
        except httpx.TimeoutException as error:
            raise MedplumError("medplum_fhir_timeout") from error
        except httpx.HTTPError as error:
            raise MedplumError("medplum_fhir_unreachable") from error
        if response.status_code == 404:
            raise MedplumError("medplum_resource_not_found", not_found=True)
        if response.status_code in {401, 403}:
            raise MedplumError("medplum_access_denied")
        if response.status_code >= 400:
            raise MedplumError("medplum_fhir_operation_failed")
        if len(response.content) > MAX_FHIR_RESPONSE_BYTES:
            raise MedplumError("medplum_fhir_response_too_large")
        try:
            payload = response.json()
        except ValueError as error:
            raise MedplumError("medplum_invalid_fhir_json") from error
        if payload.get("resourceType") == "OperationOutcome":
            raise MedplumError("medplum_operation_outcome")
        return payload

    async def health(self) -> dict[str, bool]:
        await self._request("GET", "metadata")
        return {
            "configured": True,
            "authenticated": True,
            "fhir_reachable": True,
            "project_id_configured": bool(self.settings.project_id),
        }

    async def _search(
        self, resource_type: str, params: dict[str, str]
    ) -> list[dict[str, object]]:
        bounded = {**params, "_count": "20"}
        bundle = await self._request("GET", resource_type, params=bounded)
        return [
            entry["resource"]
            for entry in bundle.get("entry", [])[:20]
            if isinstance(entry.get("resource"), dict)
        ]

    async def get_case_context(self, patient_id: str) -> MedplumCaseContext:
        patient = await self._request("GET", f"Patient/{quote(patient_id, safe='')}")
        if not has_synthetic_tag(patient):
            raise MedplumError("medplum_patient_not_synthetic")
        subject = f"Patient/{patient_id}"
        resources: dict[str, list[dict[str, object]]] = {}
        for resource_type in ("Condition", "MedicationRequest", "Observation"):
            found = await self._search(resource_type, {"subject": subject})
            resources[resource_type] = [
                item
                for item in found
                if item.get("subject", {}).get("reference") == subject and has_synthetic_tag(item)
            ][:10]

        conditions = deduplicate_conditions(
            [
                MedplumConditionContext(
                    display=concept_text(item.get("code")) or "Unspecified condition",
                    clinical_status=concept_text(item.get("clinicalStatus")) or "unknown",
                )
                for item in resources["Condition"]
            ]
        )
        medications = normalize_medications(
            [
                MedplumMedicationContext(
                    display=concept_text(item.get("medicationCodeableConcept"))
                    or "Unspecified medication",
                    status=bounded_text(item.get("status"), 40) or "unknown",
                    timing_summary=bounded_text(
                        ((item.get("dosageInstruction") or [{}])[0]).get("text"), 300
                    ),
                )
                for item in resources["MedicationRequest"]
            ]
        )
        observations = deduplicate_observations(
            [
                MedplumObservationContext(
                    display=concept_text(item.get("code")) or "Unspecified observation",
                    value_summary=bounded_text(
                        " ".join(
                            value
                            for value in (
                                bounded_text(item.get("valueString"))
                                or concept_text(item.get("valueCodeableConcept")),
                                bounded_text(((item.get("note") or [{}])[0]).get("text")),
                            )
                            if value
                        )
                    ),
                    effective_date=bounded_text(
                        item.get("effectiveDateTime") or item.get("effectiveDate"), 10
                    ),
                )
                for item in resources["Observation"]
            ]
        )
        refs = sorted(
            {
                f"{resource_type}/{item['id']}"
                for resource_type, items in resources.items()
                for item in items
                if item.get("id")
            }
        )
        return MedplumCaseContext(
            patient_id=patient_id,
            synthetic=True,
            age_band=age_band(patient.get("birthDate")),
            conditions=conditions,
            medications=medications,
            observations=observations,
            source_resource_refs=refs,
        )

    async def get_authorized_panel_cases(
        self, practitioner_id: str
    ) -> list[MedplumCaseContext]:
        practitioner_ref = f"Practitioner/{practitioner_id}"
        practitioner = await self._request(
            "GET", f"Practitioner/{quote(practitioner_id, safe='')}"
        )
        if not has_synthetic_tag(practitioner):
            raise MedplumError("medplum_panel_not_synthetic")
        patients = await self._search(
            "Patient", {"general-practitioner": practitioner_ref}
        )
        authorized = [
            patient
            for patient in patients
            if has_synthetic_tag(patient)
            and any(
                reference.get("reference") == practitioner_ref
                for reference in patient.get("generalPractitioner", [])
            )
            and patient.get("id")
        ][:10]
        contexts = [await self.get_case_context(str(patient["id"])) for patient in authorized]
        return sorted(contexts, key=lambda context: context.patient_id)

    async def _upsert_identifier(
        self, resource_type: str, system: str, value: str, resource: dict[str, object]
    ) -> dict[str, object]:
        existing = await self._search(resource_type, {"identifier": f"{system}|{value}"})
        if existing:
            if not has_synthetic_tag(existing[0]):
                raise MedplumError("medplum_stable_identifier_conflict")
            resource_id = existing[0]["id"]
            resource["id"] = resource_id
            if existing[0].get("meta", {}).get("versionId"):
                resource.setdefault("meta", {})["versionId"] = existing[0]["meta"]["versionId"]
            return await self._request(
                "PUT", f"{resource_type}/{resource_id}", json_body=resource
            )
        return await self._request("POST", resource_type, json_body=resource)

    async def _seed_case(
        self,
        *,
        key: str,
        given: str,
        family: str,
        birth_date: str,
        practitioner_id: str,
        conditions: list[str],
        medications: list[tuple[str, str]],
        observations: list[tuple[str, str, str]],
    ) -> dict[str, object]:
        patient = await self._upsert_identifier(
            "Patient",
            DEMO_PATIENT_IDENTIFIER_SYSTEM,
            key,
            {
                "resourceType": "Patient",
                "meta": {"tag": [SYNTHETIC_TAG]},
                "identifier": [
                    {
                        "system": DEMO_PATIENT_IDENTIFIER_SYSTEM,
                        "value": key,
                    }
                ],
                "active": True,
                "name": [{"family": family, "given": [given]}],
                "gender": "other",
                "birthDate": birth_date,
                "generalPractitioner": [
                    {"reference": f"Practitioner/{practitioner_id}"}
                ],
            },
        )
        patient_ref = f"Patient/{patient['id']}"
        saved_by_type: dict[str, list[str]] = {
            "Condition": [],
            "MedicationRequest": [],
            "Observation": [],
        }
        for index, display in enumerate(conditions, 1):
            system = "https://lamina.health/fhir/demo-condition"
            saved = await self._upsert_identifier(
                "Condition",
                system,
                f"{key}-condition-{index}",
                {
                    "resourceType": "Condition",
                    "meta": {"tag": [SYNTHETIC_TAG]},
                    "identifier": [{"system": system, "value": f"{key}-condition-{index}"}],
                    "subject": {"reference": patient_ref},
                    "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active", "display": "Active"}]},
                    "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "confirmed", "display": "Confirmed"}]},
                    "code": {"text": display},
                },
            )
            saved_by_type["Condition"].append(str(saved["id"]))
        for index, (display, timing) in enumerate(medications, 1):
            system = "https://lamina.health/fhir/demo-medication-request"
            saved = await self._upsert_identifier(
                "MedicationRequest",
                system,
                f"{key}-medication-{index}",
                {
                    "resourceType": "MedicationRequest",
                    "meta": {"tag": [SYNTHETIC_TAG]},
                    "identifier": [{"system": system, "value": f"{key}-medication-{index}"}],
                    "subject": {"reference": patient_ref},
                    "status": "active",
                    "intent": "order",
                    "medicationCodeableConcept": {"text": display},
                    "dosageInstruction": [{"text": timing}],
                },
            )
            saved_by_type["MedicationRequest"].append(str(saved["id"]))
        for index, (display, value, note) in enumerate(observations, 1):
            system = "https://lamina.health/fhir/demo-observation"
            saved = await self._upsert_identifier(
                "Observation",
                system,
                f"{key}-observation-{index}",
                {
                    "resourceType": "Observation",
                    "meta": {"tag": [SYNTHETIC_TAG]},
                    "identifier": [{"system": system, "value": f"{key}-observation-{index}"}],
                    "subject": {"reference": patient_ref},
                    "status": "final",
                    "code": {"text": display},
                    "valueString": value,
                    "effectiveDateTime": "2026-07-15T12:00:00Z",
                    "note": [{"text": note}],
                },
            )
            saved_by_type["Observation"].append(str(saved["id"]))
        return {"Patient": str(patient["id"]), **saved_by_type}

    async def seed_demo_panel(self) -> dict[str, object]:
        practitioners: dict[str, str] = {}
        for key, given, family in (
            ("ethan", "Ethan", "Bell"),
            ("lianne", "Lianne", "Cha"),
        ):
            system = "https://lamina.health/fhir/demo-practitioner"
            saved = await self._upsert_identifier(
                "Practitioner",
                system,
                f"lamina-demo-practitioner-{key}",
                {
                    "resourceType": "Practitioner",
                    "meta": {"tag": [SYNTHETIC_TAG]},
                    "identifier": [
                        {"system": system, "value": f"lamina-demo-practitioner-{key}"}
                    ],
                    "active": True,
                    "name": [{"family": family, "given": [given]}],
                },
            )
            practitioners[key] = str(saved["id"])

        cases = {
            "ethan_index": await self._seed_case(
                key=DEMO_PATIENT_IDENTIFIER_VALUE,
                given="Alex",
                family="Lamina-Demo",
                birth_date="1985-06-15",
                practitioner_id=practitioners["ethan"],
                conditions=["Type 2 diabetes mellitus"],
                medications=[
                    ("Metformin extended-release", "Stable background medication."),
                    ("Empagliflozin (SGLT2 inhibitor)", "Started recently before symptoms."),
                ],
                observations=[
                    ("Nausea symptom", "Persistent nausea", "Began three days after medication change."),
                    ("Abdominal pain symptom", "New abdominal discomfort", "Synthetic patient report."),
                    ("Fatigue symptom", "Marked fatigue", "Synthetic patient report."),
                    ("Serum glucose", "168 mg/dL; not dramatically elevated", "Fixed synthetic laboratory value."),
                    ("Serum bicarbonate", "14 mmol/L; low", "Fixed synthetic laboratory value."),
                    ("Anion gap", "22 mmol/L; elevated", "Fixed synthetic laboratory value."),
                    ("Beta-hydroxybutyrate", "Elevated", "Fixed synthetic laboratory pattern."),
                ],
            ),
            "lianne_strong": await self._seed_case(
                key="lamina-demo-lianne-case-a",
                given="Morgan",
                family="Lamina-Demo-A",
                birth_date="1979-03-10",
                practitioner_id=practitioners["lianne"],
                conditions=["Type 2 diabetes mellitus"],
                medications=[("Empagliflozin (SGLT2 inhibitor)", "Started before symptom onset.")],
                observations=[
                    ("Nausea symptom", "Persistent nausea", "Occurred after SGLT2 inhibitor exposure."),
                    ("Abdominal pain symptom", "Abdominal pain", "Synthetic patient report."),
                    ("Fatigue symptom", "Fatigue", "Synthetic patient report."),
                    ("Serum glucose", "172 mg/dL; not dramatically elevated", "Fixed synthetic laboratory value."),
                    ("Serum bicarbonate", "15 mmol/L; low", "Fixed synthetic laboratory value."),
                    ("Anion gap", "21 mmol/L; elevated", "Fixed synthetic laboratory value."),
                    ("Beta-hydroxybutyrate", "Elevated", "Fixed synthetic laboratory pattern."),
                    ("Physician-recorded outcome", "Euglycemic diabetic ketoacidosis documented", "SGLT2 inhibitor was discontinued and the synthetic patient recovered after hospital treatment."),
                ],
            ),
            "lianne_partial": await self._seed_case(
                key="lamina-demo-lianne-case-b",
                given="Riley",
                family="Lamina-Demo-B",
                birth_date="1968-11-02",
                practitioner_id=practitioners["lianne"],
                conditions=["Type 2 diabetes mellitus"],
                medications=[("Empagliflozin (SGLT2 inhibitor)", "Ongoing medication exposure.")],
                observations=[
                    ("Nausea symptom", "Nausea and fatigue", "Synthetic patient report."),
                    ("Serum glucose", "210 mg/dL", "Fixed synthetic laboratory value."),
                    ("Serum bicarbonate", "23 mmol/L; normal", "Fixed synthetic laboratory value."),
                    ("Anion gap", "12 mmol/L; normal", "Fixed synthetic laboratory value."),
                    ("Physician-recorded outcome", "Dehydration documented; ketoacidosis not documented", "Symptoms resolved after hydration in this synthetic record."),
                ],
            ),
            "lianne_near_miss": await self._seed_case(
                key="lamina-demo-lianne-case-c",
                given="Taylor",
                family="Lamina-Demo-C",
                birth_date="1988-01-24",
                practitioner_id=practitioners["lianne"],
                conditions=["Type 2 diabetes mellitus"],
                medications=[("Metformin extended-release", "Dose increased before nausea.")],
                observations=[
                    ("Nausea symptom", "Nausea", "Occurred after metformin dose increase."),
                    ("Serum glucose", "160 mg/dL", "Fixed synthetic laboratory value."),
                    ("Serum bicarbonate", "24 mmol/L; normal", "Fixed synthetic laboratory value."),
                    ("Anion gap", "11 mmol/L; normal", "Fixed synthetic laboratory value."),
                ],
            ),
        }
        return {"practitioners": practitioners, "cases": cases}

    async def seed_demo_patient(self) -> dict[str, str]:
        panel = await self.seed_demo_panel()
        index = panel["cases"]["ethan_index"]
        return {
            "Patient": index["Patient"],
            "Condition": index["Condition"][0],
            "MedicationRequest": index["MedicationRequest"][0],
            "Observation": index["Observation"][0],
        }

    async def export_discussion(
        self,
        *,
        post_id: str,
        patient_id: str,
        source_refs: list[str],
        title: str,
        approved_payload: str,
    ) -> dict[str, str]:
        patient = await self._request("GET", f"Patient/{quote(patient_id, safe='')}")
        if not has_synthetic_tag(patient):
            raise MedplumError("medplum_patient_not_synthetic")
        valid_refs: list[str] = []
        allowed = {"Condition", "MedicationRequest", "Observation"}
        for reference in source_refs[:30]:
            parts = reference.split("/", 1)
            if len(parts) != 2 or parts[0] not in allowed:
                continue
            resource = await self._request("GET", reference)
            if (
                has_synthetic_tag(resource)
                and resource.get("subject", {}).get("reference") == f"Patient/{patient_id}"
            ):
                valid_refs.append(reference)
        identifier_value = f"lamina-forum-post-{post_id}"
        communication = {
            "resourceType": "Communication",
            "meta": {"tag": [SYNTHETIC_TAG, APPROVED_TAG]},
            "identifier": [
                {"system": COMMUNICATION_IDENTIFIER_SYSTEM, "value": identifier_value}
            ],
            "status": "completed",
            "category": [{"text": "Approved Lamina physician-network discussion"}],
            "priority": "routine",
            "subject": {"reference": f"Patient/{patient_id}"},
            "topic": {"text": bounded_text(title, 200)},
            "about": [{"reference": reference} for reference in valid_refs],
            "sent": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "payload": [{"contentString": approved_payload[:20_000]}],
        }
        saved = await self._upsert_identifier(
            "Communication", COMMUNICATION_IDENTIFIER_SYSTEM, identifier_value, communication
        )
        return {"communication_id": str(saved["id"]), "status": str(saved["status"])}


_service_cache: tuple[MedplumSettings, MedplumClientService] | None = None


def create_medplum_service() -> MedplumService:
    global _service_cache
    settings = MedplumSettings.from_environment()
    if _service_cache is None or _service_cache[0] != settings:
        _service_cache = (settings, MedplumClientService(settings))
    return _service_cache[1]
