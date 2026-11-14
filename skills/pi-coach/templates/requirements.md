# Requirements — one line per acceptance criterion

Written once, by the orchestrator, after it has read the whole task. Every lane brief quotes the ids it
owns; the gate refuses to record a check while a declared id appears in no test.

Shape, one line per criterion, ids never reused:

    AC1  WHEN <the trigger>  THE SYSTEM SHALL <an observable result, a command's output or a state>.
    AC2  WHEN a track already exists in the index  THE SYSTEM SHALL NOT download it again.
    AC3  WHILE the resolver fails  THE SYSTEM SHALL record the reason and continue the batch.

Rules:

1. An observation, not a wish. "The system shall be robust" cannot be tested; "WHEN ffmpeg is missing THE
   SYSTEM SHALL exit 2 with a message naming ffmpeg" can.
2. One criterion, one behaviour. Two clauses joined by "and" become two ids.
3. Every MUST of the task becomes one id. A MUST with no id is a requirement nobody will check.
4. The id lives in the test that proves it — `def test_ac3_resolver_failure_is_recorded` — so the traceability
   check is a grep, not a judgement.

Example, from the music pipeline task:

    AC1  WHEN `music sync --dry-run` runs on a fixture tree THE SYSTEM SHALL print `added N, missing N, failed N`
         and change neither the library nor state/library.db.
    AC2  WHEN a track is already in the index THE SYSTEM SHALL NOT call the resolver for it.
    AC3  WHEN a track fails three times THE SYSTEM SHALL mark it parked with the reason and finish the batch.
    AC4  WHEN `music report` runs THE SYSTEM SHALL print one row per album with artist, album, tracks, seconds.
    AC5  WHEN `docker compose config` runs without any .env file THE SYSTEM SHALL exit 0.
