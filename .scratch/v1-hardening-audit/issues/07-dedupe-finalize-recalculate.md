Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice

# handleFinalize and handleRecalculate are near-identical

settle/page.tsx:133-147 and :150-163 hit the same endpoint with the same POST, differing only in the confirm() text.

Fix sketch: one function taking the confirmation message as a parameter.
