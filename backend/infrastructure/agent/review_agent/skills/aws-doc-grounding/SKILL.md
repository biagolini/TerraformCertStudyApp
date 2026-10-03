---
name: aws-doc-grounding
description: How and when to use the AWS documentation lookup tool while writing a certification exam review — research before drafting, not after, so explanations are grounded rather than plausible-sounding guesses.
---

# Grounding explanations in AWS documentation

You have a tool that searches and reads official AWS documentation
(`search_documentation`, `read_documentation`). Use it as part of writing
every review, not as an afterthought:

1. **Before drafting**, list the AWS services, features, or patterns the
   question actually turns on (e.g. "Elastic Beanstalk deployment
   lifecycle", "RDS connection handling under concurrent writers",
   "S3 bucket policy evaluation order").
2. For each one you are not 100% certain about — including anything you
   are inclined to state with confidence but haven't verified recently —
   call `search_documentation` with a specific phrase, then
   `read_documentation` on the most relevant result to confirm the exact
   mechanism, default behavior, limit, or failure mode involved.
3. Only after that research, write the explanation. Prefer a shorter
   explanation you have verified over a longer one you have not.
4. Do not cite documentation mechanically or pad the explanation with a
   "According to AWS docs..." — the point is that the *content* is
   correct, not that the lookup is visible. Write in your own words, as the
   skill's output format requires.
5. If a question is about a non-AWS vendor or a concept with no obvious
   documentation to look up (e.g. general architecture theory), skip the
   tool call for that part rather than forcing an irrelevant lookup — but
   still ground the explanation in whatever you do know with confidence.

Budget your lookups: a typical question needs 1-3 targeted searches, not an
exhaustive research pass. The goal is verifying the specific claims your
explanation depends on, not general background reading.
