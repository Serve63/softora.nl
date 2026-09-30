#!/usr/bin/env python3
"""Run the unchanged validate and apply gates in one Python process.

The draft must be the hash-bound artifact created by contact_agent_precheck.py.
This removes duplicate draft construction and interpreter/database startup, not
identity, evidence, planning, validation, locking, or apply checks.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path

import contact_agent_precheck as precheck
import contact_research as research
from kvk_api_attribution import copy_execution_metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--review-unusable", action="store_true")
    parser.add_argument("--review-approved", action="store_true")
    parser.add_argument("--review-grade", type=int, choices=(1,), default=1)
    parser.add_argument("--producer-thread-id", default="")
    parser.add_argument("--cleanup-source", action="append", default=[])
    parser.add_argument("--timings", action="store_true")
    args = parser.parse_args()

    started = time.monotonic()
    draft = precheck.validated_draft_path(args.source)
    if draft is None:
        print("GATE_FAIL stage=precheck reason=hash-bound_draft_missing")
        return 2

    lane_flags: list[str] = []
    if args.review_unusable:
        lane_flags = ["--review-unusable", "--review-grade", str(args.review_grade)]
    elif args.review_approved:
        lane_flags = ["--review-approved"]

    try:
        contact_parser = research.build_parser()
        validate_args = contact_parser.parse_args(
            ["validate", str(draft), "--require-active-location", *lane_flags]
        )
        research.command_validate(validate_args)
        if args.timings:
            print(f"PIPELINE_TIMING validated={time.monotonic() - started:.3f}s", flush=True)

        copy_execution_metadata(args.source, draft)
        apply_command = [
            "apply",
            str(draft),
            "--require-active-location",
            "--wait-for-lock",
            "--skip-stats",
            "--timings",
            "--cleanup-applied-file",
            *lane_flags,
        ]
        if args.producer_thread_id:
            apply_command.extend(["--producer-thread-id", args.producer_thread_id])
        cleanup_sources = [args.source, *(Path(value) for value in args.cleanup_source)]
        for source in cleanup_sources:
            apply_command.extend(["--cleanup-source", str(source)])
        apply_args = contact_parser.parse_args(apply_command)
        result = research.command_apply(apply_args)
        if result == 0:
            draft.unlink(missing_ok=True)
        if args.timings:
            print(f"PIPELINE_TIMING total={time.monotonic() - started:.3f}s", flush=True)
        return int(result or 0)
    except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as error:
        print(f"GATE_FAIL stage=validate_or_apply reason={error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
