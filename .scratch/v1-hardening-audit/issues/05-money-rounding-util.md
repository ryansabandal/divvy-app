Status: backlog (not blocking V1 close)
Severity: Medium
Category: Best-practice

# Repeated money-rounding logic and magic epsilon, no money util

Math.round(x * 100) / 100 and the 0.01 tolerance appear repeatedly: settle.ts:33,41,42, sessions.ts:210,215,217,227,253,258,260, and both frontend forms. The remainder-distribution block is copy-pasted almost identically between the EVEN branch (sessions.ts:213-218) and QUANTITY branch (sessions.ts:256-261).

Fix sketch: a roundToCents() helper + named CENT_EPSILON constant, and factor remainder-distribution into one function. (Money-as-Float vs centavos/Decimal stays a separate, already-documented V2 decision — see README Roadmap "Considered but intentionally not scheduled.")
