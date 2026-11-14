#!/usr/bin/env python3
"""pi-lane — run one headless pi lane, answer its questions, record what it says.

    pi-lane <lane> <repo> "<task>" [--provider P] [--model M] [--thinking L]
            [--question-timeout SECONDS]

A lane is a worktree plus one `pi --mode rpc` run:

    <repo>/.worktrees/<lane>                  branch lane/<lane>
    $HERMES_HOME/lanes/<lane>/lane.json       record: task, state, pid, session
    $HERMES_HOME/lanes/<lane>/events.jsonl    raw pi event stream
    $HERMES_HOME/lanes/<lane>/question.json   the question pi waits on
    $HERMES_HOME/lanes/<lane>/answer.json     the answer, written by the panel
    $HERMES_HOME/lanes/<lane>/stderr.txt      stderr

RPC mode is what makes questions work: an extension dialog arrives as an
`extension_ui_request`, the runner parks it in question.json, and the panel
writes answer.json. No tmux, no pty.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import select
import subprocess
import sys
import time
from pathlib import Path
from typing import NoReturn

DIALOG_METHODS = {"select", "confirm", "input", "editor"}
# A confirmation that names one of these is refused without a person, even in autonomous mode.
DESTRUCTIVE_WORDS = (
    "rm -rf", "rm ", "delete", "drop table", "drop ", "force", "--hard", "push",
    "truncate", "credential", "secret", "token", "password", "chmod 777", "sudo ",
)
POLL_SECONDS = 0.3
ENV_KEYS = (
    "NVIDIA_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
    "OPENCODE_GO_API_KEY",
    "ANTHROPIC_API_KEY",
)
# pi names the opencode credential OPENCODE_API_KEY; Hermes stores the same value as
# OPENCODE_GO_API_KEY. Hand pi the name it reads, or the provider looks unconfigured.
ALIASES = {"OPENCODE_GO_API_KEY": "OPENCODE_API_KEY"}
DEFAULT_PROVIDER = "nvidia"
DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b"
DEFAULT_THINKING = "medium"
# The critic reads what the lane wrote and reports only what breaks. A different vendor on purpose:
# a reviewer on the author's own model shares its blind spots.
DEFAULT_REVIEW_PROVIDER = os.environ.get("PI_TEAM_REVIEW_PROVIDER") or "opencode-go"
DEFAULT_REVIEW_MODEL = os.environ.get("PI_TEAM_REVIEW_MODEL") or "glm-5.3-flash"
# `auto`: the lane answers its own dialogs and never parks for a person. `ask`: a dialog parks the lane
# in `waiting` until an answer lands. Safe by construction, because `auto` refuses a destructive
# confirmation and the critic and the gate still stand between the work and the main branch.
DEFAULT_AUTONOMY = os.environ.get("PI_TEAM_AUTONOMY") or "auto"
REVIEW_TIMEOUT = 300
REVIEW_MARKER = "REVIEW:"
REVIEW_PROMPT = """You review one slice of a coding task. You cannot change anything: judge what you read.

BRIEF THE LANE WAS GIVEN:
{brief}

FILES THE LANE DECLARED:
{touches}

WHAT THE LANE CLAIMS (its RESULT line):
{result}

HOW THE GATE CHECKED THAT CLAIM:
{claim}

GIT STATUS IN THE LANE'S WORKTREE:
{status}

CRITERIA THIS LANE ANSWERED, AND WHERE EACH ONE IS PROVEN:
{acs}

THE HIDDEN ACCEPTANCE (holdout), IF IT RAN:
{holdout}

DIFF AGAINST THE BRANCH IT WAS CUT FROM:
{diff}

Report only defects that matter:
P0 — the diff does not do what the brief says, a documented path is broken, work or data is lost,
     a test it claims green cannot pass, a secret is written, or a file it was told not to touch is edited.
P1 — the RESULT claims what the diff does not show, or a declared file is missing or empty.
     Also P1: a declared criterion whose test does not assert it — open the test named above and read the
     body, because a test that carries the id in its name and asserts something else is the defect this
     review exists for — and a criterion with no proof at all.
     Also P1: the diff documents a command, a flag, an environment key or an image option that nothing in
     it establishes — you cannot reach the vendor, so say you cannot confirm it instead of assuming it.
Never report style, naming, formatting or taste. Empty lists mean the work is clean.

Answer with one line as the last line of your answer:
REVIEW: {{"p0": ["..."], "p1": ["..."], "notes": ["..."]}}
"""
# A lane that loops on a failing test must not run all night: the idle cap catches the stuck case
# without a word from anybody, and the money and turn caps are opt-in because a big slice is allowed.
DEFAULT_MAX_USD = 0.0
DEFAULT_MAX_TURNS = 0
DEFAULT_IDLE_TIMEOUT = 1800
LANE_RE = re.compile(r"^[A-Za-z0-9._-]+$")
