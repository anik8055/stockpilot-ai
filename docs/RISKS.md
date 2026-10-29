# Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| R1 | Cross-tenant data leak | Low | Critical | RLS with non-bypass app role + server-side membership checks + integration tests that try ID tampering | Mitigated, tested |
| R2 | Double-counting stock on re-import | Medium | High | Snapshot = reconciling delta; sales never post movements; file hash warning; dedupe keys on sales lines | Mitigated, tested |
| R3 | Wrong reorder advice from thin/stockout-distorted history | High | High | Exclude stockout days from demand denominator; provisional label; data-quality indicator; human review only | Mitigated, tested |
| R4 | Messy customer spreadsheets (merged headers, totals rows, Indian number formats) | High | Medium | Header-row detection, "Total" row skipping, `1,23,456.50` parsing, explicit mapping confirmation, row-level error report | Mitigated, tested |
| R5 | Invoice extraction unreliable on scans | High | Medium | Conservative pipeline, arithmetic checks, editable review, nothing posts to stock without receipt confirmation; images need OCR provider | Partially mitigated — accuracy depends on invoice layout |
| R6 | LLM hallucinated numbers | Medium | High | LLM never computes; facts table rendered from tool output; Zod-validated output; SKU references checked against tool data | Mitigated, tested |
| R7 | AI cost overrun | Medium | Medium | Per-plan monthly quotas, per-minute rate limits, small context, timeouts | Mitigated |
| R8 | Hosting free tier forbids commercial use | Medium | Medium | Deployment doc compares options; recommends a commercial-use-permitted plan | Documented |
| R9 | Model deprecation at provider | Medium | Low | Model ID only from env; health check endpoint; graceful fallback | Mitigated |
| R10 | Malicious uploads (zip bombs, macros, formula injection) | Medium | High | Size limits, magic-byte checks, no macro execution, cell values treated as data, CSV export escapes leading `= + - @` | Mitigated |
| R11 | Payment provider not configured | Certain (MVP) | Medium | Entitlements work without payments; plan changes are manual/admin; Razorpay integration documented as next step | Open — needs credentials |
| R12 | Android build not verifiable here (no Android SDK) | Certain | Low | Capacitor project generated and documented; device testing is a launch-checklist item | Open |
