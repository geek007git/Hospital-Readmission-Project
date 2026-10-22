# Implementation Plan: Hospital Readmission Risk Assessment

## Overview

Implement the hospital readmission risk assessment system as a TypeScript REST API service. Tasks are ordered to build incrementally: data models and validation first, then the Risk Engine, then persistence, then the API layer, then auth/audit, and finally integration wiring.

## Tasks

- [ ] 1. Set up project structure, types, and testing framework
  - Initialize a TypeScript Node.js project with `ts-node`, `express`, and `fast-check`
  - Define all core TypeScript interfaces: `PatientRecord`, `RiskResult`, `RiskReport`, `AuditLogEntry`, `ApiError`, `FieldError`, `ContributingFactor`
  - Set up Jest with `ts-jest` for unit and property-based tests
  - _Requirements: 1.2, 2.1, 3.1, 7.1_

- [ ] 2. Implement PatientRecord validation
  - [ ] 2.1 Implement `validatePatientRecord(record: unknown): PatientRecord | ValidationError`
    - Validate presence and types of all required fields (age, gender, primaryDiagnosis, comorbidities, lengthOfStay, priorAdmissions12m, dischargeDisposition, medications, recordedAt)
    - Validate ICD-10 format for `primaryDiagnosis` and each entry in `comorbidities` (regex: `/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/`)
    - Validate numeric ranges: `age >= 0`, `lengthOfStay >= 0`, `priorAdmissions12m >= 0`
    - Return structured `FieldError[]` identifying each invalid field and reason
    - _Requirements: 1.2, 1.3, 1.4, 8.1, 8.3_

  - [ ]* 2.2 Write property test for validation rejects malformed records
    - **Property 10: Validation rejects malformed records**
    - Generate `PatientRecord` objects with at least one invalid field (negative age, bad ICD-10, missing required field); assert a `FieldError` is returned and no score is produced
    - **Validates: Requirements 1.3, 1.4, 8.1, 8.3**

  - [ ]* 2.3 Write unit tests for PatientRecord validation
    - Test boundary values: age=0, lengthOfStay=0, priorAdmissions12m=0
    - Test valid and invalid ICD-10 formats (e.g., "I21.0" valid, "XYZ" invalid)
    - Test missing required fields individually
    - _Requirements: 1.2, 1.3_

- [ ] 3. Implement the Risk Engine
  - [ ] 3.1 Implement `computeRisk(record: PatientRecord): RiskResult`
    - Define fixed versioned coefficients for all 7 features
    - Normalize each feature value, apply logistic regression, map output to [0, 100]
    - Derive `level` from score using thresholds: Low [0–39], Medium [40–69], High [70–100]
    - Compute per-feature contribution as `normalizedValue * coefficient`; sort factors by descending absolute contribution
    - Return `RiskResult` with `score`, `level`, `contributingFactors`, `computedAt`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.2_

  - [ ]* 3.2 Write property test: Risk Score is always in range
    - **Property 1: Risk Score is always in range**
    - Generate random valid `PatientRecord` objects; assert `score` ∈ [0, 100] for all
    - **Validates: Requirements 2.1**

  - [ ]* 3.3 Write property test: Risk Level is consistent with Risk Score
    - **Property 2: Risk Level is consistent with Risk Score**
    - Generate random scores in [0, 100]; assert `level` matches threshold rules exactly
    - **Validates: Requirements 2.2**

  - [ ]* 3.4 Write property test: Determinism
    - **Property 3: Determinism — same input yields same output**
    - Generate random valid `PatientRecord` objects; call `computeRisk` twice; assert `score`, `level`, and `contributingFactors` are identical
    - **Validates: Requirements 2.5**

  - [ ]* 3.5 Write property test: Contributing factors sorted by descending contribution magnitude
    - **Property 4: Contributing factors are sorted by descending contribution magnitude**
    - Generate random `PatientRecord` objects; assert that for all adjacent factor pairs, `|contribution[i]| >= |contribution[i+1]|`
    - **Validates: Requirements 2.3, 3.2**

  - [ ]* 3.6 Write unit tests for Risk Engine boundary values
    - Test score=39 → Low, score=40 → Medium, score=69 → Medium, score=70 → High
    - Test `dischargeDisposition: "ama"` and `"expired"` edge cases
    - Test empty `comorbidities` and `medications` arrays
    - _Requirements: 2.2_

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement the Data Store layer
  - [ ] 5.1 Implement `RiskReportRepository` with methods: `save(report: RiskReport): Promise<void>`, `findLatest(patientId: string): Promise<RiskReport | null>`, `findAll(patientId: string): Promise<{ reports: RiskReport[]; count: number }>`
    - `findAll` must return reports sorted by `assessedAt` descending
    - `save` must append without overwriting existing records
    - Use an in-memory store initially (swap for a real DB without changing the interface)
    - _Requirements: 3.3, 5.1, 5.2, 5.3_

  - [ ]* 5.2 Write property test: Risk Report round-trip persistence
    - **Property 5: Risk Report round-trip persistence**
    - Generate random `RiskReport` objects; save then retrieve via `findLatest`; assert `score`, `level`, `patientId`, and `assessedAt` are identical
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 5.3 Write property test: Historical reports ordered by descending timestamp
    - **Property 6: Historical reports are ordered by descending timestamp**
    - Generate random sets of `RiskReport` objects for a patient; save all; call `findAll`; assert `assessedAt[i] >= assessedAt[i+1]` for all adjacent pairs
    - **Validates: Requirements 5.2**

  - [ ]* 5.4 Write property test: Historical report count is accurate
    - **Property 7: Historical report count is accurate**
    - Generate random numbers of reports for a patient; save all; call `findAll`; assert `count == reports.length`
    - **Validates: Requirements 5.3**

  - [ ]* 5.5 Write unit tests for Data Store edge cases
    - Test `findLatest` returns `null` for unknown patientId
    - Test `findAll` returns `{ reports: [], count: 0 }` for unknown patientId
    - _Requirements: 3.5, 5.4_

- [ ] 6. Implement the Audit Logger
  - [ ] 6.1 Implement `AuditLogger` with method `append(entry: Omit<AuditLogEntry, 'logId'>): Promise<void>` and `query(filters: AuditQueryFilters): Promise<AuditLogEntry[]>`
    - `append` generates a UUID for `logId` and writes to the append-only log store
    - `query` supports filtering by `patientId`, `userId`, and date range
    - The log store must never expose a delete or update interface
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 6.2 Write property test: Audit log is append-only
    - **Property 9: Audit log is append-only**
    - Generate random sequences of append operations; assert total log entry count is monotonically non-decreasing after each append; assert no existing entry is modified
    - **Validates: Requirements 7.3**

  - [ ]* 6.3 Write unit tests for Audit Logger
    - Test that an ASSESSMENT event log entry contains patientId, userId, timestamp, and riskLevel
    - Test that a DATA_ACCESS event log entry contains patientId, userId, endpoint, and timestamp
    - _Requirements: 7.1, 7.2_

- [ ] 7. Implement the Discharge Workflow Service
  - [ ] 7.1 Implement `DischargeWorkflowService.assess(patientId: string, userId: string): Promise<RiskReport | WorkflowError>`
    - Retrieve `PatientRecord` from repository; validate using `validatePatientRecord`
    - Call `computeRisk` with a 10-second timeout guard; on timeout return `WorkflowError` with code `RISK_ENGINE_TIMEOUT`
    - On success: construct `RiskReport`, persist via `RiskReportRepository`, append ASSESSMENT event to `AuditLogger`
    - Return `RiskReport` including `highRiskPrompt: true` when `level === "High"`
    - _Requirements: 1.1, 4.1, 4.2, 4.4, 4.5_

  - [ ]* 7.2 Write unit tests for Discharge Workflow Service
    - Test that a High-risk result includes `highRiskPrompt: true`
    - Test that a timeout returns `WorkflowError` with code `RISK_ENGINE_TIMEOUT` and does not persist a report
    - Test that a validation failure returns a structured error without calling the Risk Engine
    - _Requirements: 4.4, 4.5, 1.3_

- [ ] 8. Implement Auth & RBAC Middleware
  - [ ] 8.1 Implement JWT validation middleware `authenticate` and role-check middleware `requireRole(role: Role)`
    - `authenticate` extracts and verifies the JWT bearer token; attaches `{ userId, role }` to request context; returns 401 on missing or invalid token
    - `requireRole` checks the attached role against the required role; returns 403 on mismatch
    - Define `Role` as `"Clinical_Staff" | "Administrator"`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 8.2 Write property test: Unauthenticated requests are always rejected
    - **Property 8: Unauthenticated requests are always rejected**
    - Generate random requests to all protected endpoints without a valid JWT; assert all return HTTP 401
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 8.3 Write property test: Insufficient role returns 403
    - **Property (auth): Insufficient role is always rejected**
    - Generate random requests to role-restricted endpoints with a valid token of the wrong role; assert all return HTTP 403
    - **Validates: Requirements 6.3**

  - [ ]* 8.4 Write unit tests for Auth Middleware
    - Test Administrator role can access `/audit-logs`; Clinical_Staff receives 403
    - Test expired JWT returns 401
    - _Requirements: 6.5, 7.4_

- [ ] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement REST API endpoints and wire all components
  - [ ] 10.1 Implement `POST /discharge/:patientId/assess`
    - Apply `authenticate` and `requireRole("Clinical_Staff")` middleware
    - Delegate to `DischargeWorkflowService.assess`; append DATA_ACCESS audit event
    - Return 200 with `RiskReport` on success; 400 on validation error; 500 with `referenceId` on unexpected error
    - _Requirements: 3.1, 4.1, 4.2, 8.1, 8.2_

  - [ ] 10.2 Implement `GET /patients/:patientId/risk-report`
    - Apply `authenticate` and `requireRole("Clinical_Staff")` middleware
    - Call `RiskReportRepository.findLatest`; append DATA_ACCESS audit event
    - Return 200 with `RiskReport`; 404 with `ApiError` (errorCode: "NOT_FOUND") if no report exists
    - _Requirements: 3.4, 3.5_

  - [ ] 10.3 Implement `GET /patients/:patientId/risk-history`
    - Apply `authenticate` and `requireRole("Clinical_Staff")` middleware
    - Call `RiskReportRepository.findAll`; append DATA_ACCESS audit event
    - Return 200 with `{ reports, count }`; return `{ reports: [], count: 0 }` for unknown patients
    - _Requirements: 5.2, 5.3, 5.4_

  - [ ] 10.4 Implement `GET /audit-logs`
    - Apply `authenticate` and `requireRole("Administrator")` middleware
    - Call `AuditLogger.query` with filters from query params (`patientId`, `userId`, `from`, `to`)
    - Return 200 with filtered `AuditLogEntry[]`
    - _Requirements: 7.4_

  - [ ] 10.5 Implement global error handler middleware
    - Catch unhandled errors; generate a UUID `referenceId`; return 500 with structured `ApiError`
    - _Requirements: 8.2_

  - [ ]* 10.6 Write integration tests for API endpoints
    - Test full assessment flow: POST assess → GET risk-report → GET risk-history
    - Test 404 for unknown patient on GET risk-report
    - Test 401 and 403 for all protected endpoints
    - Test Administrator can query audit logs; Clinical_Staff receives 403
    - _Requirements: 3.4, 3.5, 5.2, 6.2, 6.3, 7.4_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with a minimum of 100 iterations each
- Each property test must be tagged: `Feature: hospital-readmission-risk, Property {N}: {property_text}`
- The in-memory Data Store in task 5 can be swapped for a real database (PostgreSQL, MongoDB) without changing the repository interface
