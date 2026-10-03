#!/usr/bin/env python3
"""Builds frontend/public/examples/index.json, the certification catalog the
Home page and the certification editor read.

Each `*-pack.json` file is a full certification template (name, description,
domains, export intros). The catalog fields that drive Home (code, provider,
level, timing, pass mark, official link) are kept in CATALOG below, keyed by
file stem, and are merged into the index together with a domain count so Home
can render every card without downloading every template. Templates are only
fetched in full when the user actually adds one.

Run after adding or editing a template:

    python3 frontend/scripts/build_catalog_index.py
"""

import json
import pathlib

EXAMPLES = pathlib.Path(__file__).resolve().parent.parent / "public" / "examples"

AWS = "https://aws.amazon.com/certification/"

# stem: (code, provider, level, durationMin, questions, passingPercent, accommodationMin, officialUrl)
# None = not published or not confirmed; the UI shows it as unknown and the user can fill it in.
CATALOG = {
    "aws-clf-c02-pack": ("CLF-C02", "aws", "foundational", 90, 65, 70, 30, AWS + "certified-cloud-practitioner/"),
    "aws-aif-c01-pack": ("AIF-C01", "aws", "foundational", 120, 85, 70, 30, AWS + "certified-ai-practitioner/"),
    "aws-aib-c01-pack": ("AIB-C01", "aws", "foundational", 130, 85, 70, 30, AWS),
    "aws-saa-c03-pack": ("SAA-C03", "aws", "associate", 130, 65, 72, 30, AWS + "certified-solutions-architect-associate/"),
    "aws-dva-c02-pack": ("DVA-C02", "aws", "associate", 130, 65, 72, 30, AWS + "certified-developer-associate/"),
    "aws-soa-c03-pack": ("SOA-C03", "aws", "associate", 130, 65, 72, 30, AWS),
    "aws-dea-c01-pack": ("DEA-C01", "aws", "associate", 130, 65, 72, 30, AWS + "certified-data-engineer-associate/"),
    "aws-mla-c01-pack": ("MLA-C01", "aws", "associate", 170, 85, 72, 30, AWS + "certified-machine-learning-engineer-associate/"),
    "aws-sap-c02-pack": ("SAP-C02", "aws", "professional", 180, 75, 75, 30, AWS + "certified-solutions-architect-professional/"),
    "aws-dop-c02-pack": ("DOP-C02", "aws", "professional", 180, 75, 75, 30, AWS + "certified-devops-engineer-professional/"),
    "aws-aip-c01-pack": ("AIP-C01", "aws", "professional", 170, 65, 75, 30, AWS),
    "aws-scs-c03-pack": ("SCS-C03", "aws", "specialty", 170, 65, 75, 30, AWS + "certified-security-specialty/"),
    "aws-ans-c01-pack": ("ANS-C01", "aws", "specialty", 170, 65, 75, 30, AWS + "certified-advanced-networking-specialty/"),
    "ccaf-pack": ("CCAF", "anthropic", "foundational", None, None, 72, None, None),
    "claude-ccao-f-pack": ("CCAO-F", "anthropic", "foundational", 120, 60, 72, None, None),
    "claude-ccdv-f-pack": ("CCDV-F", "anthropic", "foundational", 120, 53, 72, None, None),
    "claude-ccar-p-pack": ("CCAR-P", "anthropic", "professional", 120, 63, 72, None, None),
    "hashicorp-terraform-associate-004-pack": (
        "TA-004", "terraform", "associate", 60, 57, 70, None,
        "https://developer.hashicorp.com/certifications/infrastructure-automation",
    ),
    "hashicorp-terraform-advanced-pack": (
        "TF-ADV", "terraform", "professional", None, None, None, None,
        "https://developer.hashicorp.com/certifications/infrastructure-automation",
    ),
    "mongodb-associate-developer-pack": (
        "MDB-DEV", "mongodb", "associate", 90, None, 70, None, "https://learn.mongodb.com/pages/certification-program",
    ),
    "mongodb-associate-dba-pack": (
        "MDB-DBA", "mongodb", "associate", None, None, 70, None, "https://learn.mongodb.com/pages/certification-program",
    ),
    "mongodb-associate-atlas-admin-pack": (
        "MDB-ATLAS", "mongodb", "associate", None, 81, 70, None, "https://learn.mongodb.com/pages/certification-program",
    ),
    "mongodb-associate-data-modeler-pack": (
        "MDB-DM", "mongodb", "associate", 105, None, 70, None, "https://learn.mongodb.com/pages/certification-program",
    ),
    "cncf-cka-pack": (
        "CKA", "kubernetes", "associate", 120, 17, 66, None,
        "https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/",
    ),
    "gcp-pca-pack": (
        "PCA", "gcp", "professional", 120, 50, None, None, "https://cloud.google.com/learn/certification/cloud-architect",
    ),
    "azure-az-305-pack": (
        "AZ-305", "azure", "professional", 120, 55, 70, None,
        "https://learn.microsoft.com/en-us/credentials/certifications/azure-solutions-architect/",
    ),
    "comptia-security-plus-sy0-701-pack": (
        "SY0-701", "other", "associate", 90, 90, 83, None, "https://www.comptia.org/certifications/security",
    ),
    "lpi-lpic-1-101-pack": (
        "101-500", "linux", "associate", 90, 60, 63, None, "https://www.lpi.org/our-certifications/lpic-1-overview/",
    ),
}


def main():
    entries = []
    stems = sorted(p.stem for p in EXAMPLES.glob("*-pack.json"))
    missing = [s for s in stems if s not in CATALOG]
    if missing:
        raise SystemExit(f"No CATALOG metadata for: {', '.join(missing)}")
    for stem in stems:
        data = json.loads((EXAMPLES / f"{stem}.json").read_text())
        code, provider, level, duration, questions, passing, accommodation, url = CATALOG[stem]
        entries.append({
            "id": stem,
            "file": f"{stem}.json",
            "name": data["name"],
            "code": code,
            "provider": provider,
            "level": level,
            "color": data.get("color") or "#6c5ce7",
            "description": data.get("description", ""),
            "domainCount": len(data.get("domains", [])),
            "examDurationMinutes": duration,
            "examTotalQuestions": questions,
            "passingScorePercent": passing,
            "accommodationMinutes": accommodation,
            "officialUrl": url,
        })
    (EXAMPLES / "index.json").write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n")
    print(f"index.json: {len(entries)} certifications")


if __name__ == "__main__":
    main()
