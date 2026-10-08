# EchelonFoundry.Vitium.Contracts

Versioned F#/.NET DTOs for automated Echelon defect observations and verification attempts.

This is a **preview package**. A machine observation is not an accepted defect; a
verification result is not an instruction to close one. The server owns legal
transitions under qualified Ordo governance.

- `Observation` is the versioned producer evidence envelope.
- `VerificationResult` references a defect, work attempt, candidate revision and
  qualifying evidence.
- `Receipt` represents ingestion acknowledgement only.

Payload schemas and semantics: [Vitium's machine reporting specification](https://github.com/kemiller2002/vitium/blob/main/docs/requirements/VITIUM-BUILD-SYSTEM-REPORTING.md).

Target framework: .NET 10. Public shape is preliminary and may change before 1.0.
