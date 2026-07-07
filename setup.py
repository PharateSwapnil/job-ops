#!/usr/bin/env python3
"""
Job-Ops Setup Script
====================
One-file installer and launcher for Job-Ops (frontend + backend).

Usage
-----
    python setup.py              # Interactive guided setup
    python setup.py --install    # Install dependencies only
    python setup.py --dev        # Start in development mode (hot-reload)
    python setup.py --prod       # Build client + start production server
    python setup.py --docker     # Build & run via Docker Compose
    python setup.py --reset-db   # Wipe and re-run DB migrations
    python setup.py --check      # Check prerequisites without installing
    python setup.py --update     # Pull latest code + reinstall deps

Requirements: Python 3.8+, Node 20+, npm 9+
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path
from typing import List, Optional, Tuple

# ─── Constants ────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.resolve()
ORCHESTRATOR = REPO_ROOT / "orchestrator"
SHARED = REPO_ROOT / "shared"
DATA_DIR = REPO_ROOT / "data"
ENV_FILE = REPO_ROOT / ".env"
ENV_EXAMPLE = REPO_ROOT / ".env.example"

MIN_NODE_MAJOR = 20
MIN_NPM_MAJOR = 9
DEFAULT_PORT = 3005

BANNER = r"""
     _       _            ___
    | | ___ | |__        / _ \ _ __  ___
 _  | |/ _ \| '_ \ ___ | | | | '_ \/ __|
| |_| | (_) | |_) |___|| |_| | |_) \__ \
 \___/ \___/|_.__/       \___/| .__/|___/
                               |_|
"""

# ─── ANSI colours (disabled on Windows unless in terminal) ───────────────────

_USE_COLOR = sys.stdout.isatty() and platform.system() != "Windows"


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def green(t: str) -> str:   return _c("32", t)
def yellow(t: str) -> str:  return _c("33", t)
def red(t: str) -> str:     return _c("31", t)
def cyan(t: str) -> str:    return _c("36", t)
def bold(t: str) -> str:    return _c("1",  t)
def dim(t: str) -> str:     return _c("2",  t)


# ─── Logging helpers ──────────────────────────────────────────────────────────

def info(msg: str) -> None:
    print(f"  {cyan('→')} {msg}")


def ok(msg: str) -> None:
    print(f"  {green('✓')} {msg}")


def warn(msg: str) -> None:
    print(f"  {yellow('⚠')} {msg}")


def err(msg: str) -> None:
    print(f"  {red('✗')} {msg}", file=sys.stderr)


def step(title: str) -> None:
    print(f"\n{bold(title)}")
    print(dim("─" * 50))


def abort(msg: str, code: int = 1) -> None:
    err(msg)
    sys.exit(code)


# ─── Shell helpers ────────────────────────────────────────────────────────────

def run(
    cmd: List[str],
    cwd: Optional[Path] = None,
    env: Optional[dict] = None,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Run a command, streaming output unless capture=True."""
    merged_env = {**os.environ, **(env or {})}
    kwargs = dict(
        cwd=str(cwd or REPO_ROOT),
        env=merged_env,
        text=True,
    )
    if capture:
        kwargs["stdout"] = subprocess.PIPE
        kwargs["stderr"] = subprocess.PIPE
    try:
        return subprocess.run(cmd, check=check, **kwargs)
    except subprocess.CalledProcessError as exc:
        if check:
            abort(f"Command failed: {' '.join(cmd)}\nExit code: {exc.returncode}")
        return exc
    except FileNotFoundError:
        abort(f"Executable not found: {cmd[0]}")


def run_shell(
    cmd: str,
    cwd: Optional[Path] = None,
    env: Optional[dict] = None,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Run a shell string command."""
    merged_env = {**os.environ, **(env or {})}
    kwargs = dict(
        cwd=str(cwd or REPO_ROOT),
        env=merged_env,
        shell=True,
        text=True,
    )
    if capture:
        kwargs["stdout"] = subprocess.PIPE
        kwargs["stderr"] = subprocess.PIPE
    try:
        return subprocess.run(cmd, check=check, **kwargs)
    except subprocess.CalledProcessError as exc:
        if check:
            abort(f"Command failed: {cmd}\nExit code: {exc.returncode}")
        return exc


def get_output(cmd: List[str], cwd: Optional[Path] = None) -> str:
    """Return stdout of a command, stripped. Returns '' on any error."""
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd or REPO_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=10,
        )
        return result.stdout.strip()
    except Exception:
        return ""


# ─── Prerequisite checks ──────────────────────────────────────────────────────

def parse_semver(version_str: str) -> Tuple[int, int, int]:
    """Parse 'v18.19.0' or '18.19.0' → (18, 19, 0)."""
    clean = version_str.lstrip("v").strip()
    parts = re.findall(r"\d+", clean)
    major = int(parts[0]) if len(parts) > 0 else 0
    minor = int(parts[1]) if len(parts) > 1 else 0
    patch = int(parts[2]) if len(parts) > 2 else 0
    return major, minor, patch


def check_node() -> bool:
    ver = get_output(["node", "--version"])
    if not ver:
        err("Node.js not found. Install from https://nodejs.org (v20+)")
        return False
    major, _, _ = parse_semver(ver)
    if major < MIN_NODE_MAJOR:
        err(f"Node.js {ver} found — need v{MIN_NODE_MAJOR}+. "
            f"Install from https://nodejs.org")
        return False
    ok(f"Node.js {ver}")
    return True


def check_npm() -> bool:
    ver = get_output(["npm", "--version"])
    if not ver:
        err("npm not found. It ships with Node.js.")
        return False
    major, _, _ = parse_semver(ver)
    if major < MIN_NPM_MAJOR:
        err(f"npm v{ver} found — need v{MIN_NPM_MAJOR}+. Run: npm install -g npm")
        return False
    ok(f"npm v{ver}")
    return True


def check_git() -> bool:
    ver = get_output(["git", "--version"])
    if not ver:
        warn("git not found — update feature won't work")
        return False
    ok(f"{ver}")
    return True


def check_docker() -> bool:
    ver = get_output(["docker", "--version"])
    if not ver:
        warn("Docker not found — docker mode unavailable")
        return False
    compose = get_output(["docker", "compose", "version"])
    if not compose:
        compose = get_output(["docker-compose", "--version"])
    if not compose:
        warn("Docker Compose not found — docker mode unavailable")
        return False
    ok(f"Docker: {ver.split(',')[0]}  Compose: {compose.split(',')[0]}")
    return True


def check_playwright() -> bool:
    """Check if Playwright Chromium is installed for browser automation."""
    result = run_shell(
        "node -e \"require('playwright')\" 2>/dev/null",
        cwd=ORCHESTRATOR,
        capture=True,
        check=False,
    )
    return result.returncode == 0


def run_checks(verbose: bool = True) -> dict:
    if verbose:
        step("Checking prerequisites")
    results = {
        "node": check_node(),
        "npm": check_npm(),
        "git": check_git(),
        "docker": check_docker(),
    }
    return results


# ─── .env scaffolding ─────────────────────────────────────────────────────────

ENV_TEMPLATE = """\
# ──────────────────────────────────────────────────────────────────────────────
# Job-Ops Environment Configuration
# Generated by setup.py — edit as needed.
# ──────────────────────────────────────────────────────────────────────────────

# Server
PORT=3005
NODE_ENV=development
DATA_DIR=./data

# LLM provider (required for ATS scoring, tailoring, AI Q&A)
# Supported: openrouter | anthropic | openai | ollama | lmstudio | gemini
LLM_PROVIDER=openrouter
LLM_API_KEY=your_api_key_here
LLM_MODEL=google/gemini-flash-1.5

# Authentication — change these in production
JOBOPS_AUTH_SECRET=change_me_super_secret_jwt_key

# Browser automation
# Secret for AES-256-GCM credential encryption (min 32 chars)
AUTOMATION_SECRET=change_me_automation_secret_32chars_min
# Set to "false" to show the browser window during automation (debugging)
AUTOMATION_HEADLESS=true

# Optional: Webhook URL for job application events
# WEBHOOK_URL=https://your-webhook-endpoint.com/hook
"""

def scaffold_env() -> None:
    step("Environment configuration (.env)")
    if ENV_FILE.exists():
        ok(f".env already exists at {ENV_FILE}")
        return

    # Try to copy .env.example if present
    if ENV_EXAMPLE.exists():
        shutil.copy(ENV_EXAMPLE, ENV_FILE)
        ok(f"Copied .env.example → .env")
    else:
        ENV_FILE.write_text(ENV_TEMPLATE)
        ok(f"Created .env from template")

    warn("Edit .env and set LLM_API_KEY before starting the server.")
    warn("Also change JOBOPS_AUTH_SECRET and AUTOMATION_SECRET for production.")


# ─── Data directory ───────────────────────────────────────────────────────────

def ensure_data_dir() -> None:
    for sub in ["pdfs", "resumes", "automation/profiles", "automation/screenshots"]:
        d = DATA_DIR / sub
        d.mkdir(parents=True, exist_ok=True)
    ok(f"Data directory ready: {DATA_DIR}")


# ─── npm install ──────────────────────────────────────────────────────────────

def npm_install() -> None:
    step("Installing Node.js dependencies")
    lock = REPO_ROOT / "package-lock.json"
    if lock.exists():
        info("Running npm ci (clean install from lockfile) …")
        run(["npm", "ci", "--prefer-offline"], cwd=REPO_ROOT)
    else:
        info("Running npm install …")
        run(["npm", "install"], cwd=REPO_ROOT)
    ok("Node.js dependencies installed")


# ─── Playwright browser ───────────────────────────────────────────────────────

def install_playwright() -> None:
    step("Installing Playwright browser (Chromium)")
    info("This downloads ~150 MB of browser binaries …")
    run(
        ["npx", "playwright", "install", "chromium", "--with-deps"],
        cwd=ORCHESTRATOR,
    )
    ok("Playwright Chromium installed")


# ─── DB migration ─────────────────────────────────────────────────────────────

def run_migrations(reset: bool = False) -> None:
    step("Database migrations")
    db_path = DATA_DIR / "jobs.db"

    if reset and db_path.exists():
        warn(f"Deleting existing database: {db_path}")
        confirm = input("  Type 'yes' to confirm reset: ").strip().lower()
        if confirm != "yes":
            info("Reset cancelled")
            return
        db_path.unlink()
        ok("Database deleted")

    ensure_data_dir()
    info("Running migrations …")
    run(
        ["npx", "tsx", "src/server/db/migrate.ts"],
        cwd=ORCHESTRATOR,
        env={"DATA_DIR": str(DATA_DIR)},
    )
    ok("Database migrated successfully")


# ─── Client build ─────────────────────────────────────────────────────────────

def build_client() -> None:
    step("Building frontend (Vite)")
    info("Compiling React client …")
    run(["npm", "run", "build:client"], cwd=ORCHESTRATOR)
    ok("Frontend built → orchestrator/dist/")


# ─── Dev mode ─────────────────────────────────────────────────────────────────

def start_dev() -> None:
    step("Starting development server")
    port = _get_port()
    info(f"Frontend + backend with hot-reload on http://localhost:{port}")
    info("Press Ctrl+C to stop")
    print()

    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(ORCHESTRATOR),
        env={**os.environ, "DATA_DIR": str(DATA_DIR)},
        text=True,
    )

    def _shutdown(sig, frame):
        info("Shutting down …")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    proc.wait()


# ─── Production mode ──────────────────────────────────────────────────────────

def start_prod() -> None:
    step("Starting production server")
    port = _get_port()

    # Build client if dist/ doesn't exist
    dist = ORCHESTRATOR / "dist"
    if not dist.exists() or not any(dist.iterdir()):
        build_client()

    info(f"Server starting on http://localhost:{port}")
    info("Press Ctrl+C to stop")
    print()

    proc = subprocess.Popen(
        ["npm", "run", "start"],
        cwd=str(ORCHESTRATOR),
        env={
            **os.environ,
            "NODE_ENV": "production",
            "DATA_DIR": str(DATA_DIR),
        },
        text=True,
    )

    def _shutdown(sig, frame):
        info("Shutting down …")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    proc.wait()


# ─── Docker mode ──────────────────────────────────────────────────────────────

def start_docker() -> None:
    step("Docker Compose")

    if not shutil.which("docker"):
        abort("Docker not found. Install from https://docs.docker.com/get-docker/")

    compose_file = REPO_ROOT / "docker-compose.yml"
    if not compose_file.exists():
        abort(f"docker-compose.yml not found at {REPO_ROOT}")

    scaffold_env()
    ensure_data_dir()

    # Prefer `docker compose` (v2) over `docker-compose` (v1)
    compose_cmd = (
        ["docker", "compose"]
        if get_output(["docker", "compose", "version"])
        else ["docker-compose"]
    )

    info("Building and starting containers (first run may take several minutes) …")
    run(compose_cmd + ["up", "--build", "-d"], cwd=REPO_ROOT)

    port = _get_port()
    ok(f"Job-Ops running at http://localhost:{port}")
    info("View logs: docker compose logs -f job-ops")
    info("Stop:      docker compose down")


# ─── Update ───────────────────────────────────────────────────────────────────

def update() -> None:
    step("Updating Job-Ops")

    if not shutil.which("git"):
        abort("git not found — cannot update")

    info("Pulling latest changes …")
    run(["git", "pull", "--ff-only"], cwd=REPO_ROOT)
    ok("Code updated")

    npm_install()
    run_migrations()
    ok("Update complete — restart the server to apply changes")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_port() -> int:
    """Read PORT from .env or return default."""
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line.startswith("PORT="):
                try:
                    return int(line.split("=", 1)[1].strip())
                except ValueError:
                    pass
    return DEFAULT_PORT


def _env_value(key: str) -> Optional[str]:
    """Read a key from .env file."""
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


def _has_real_api_key() -> bool:
    val = _env_value("LLM_API_KEY") or ""
    return bool(val) and val != "your_api_key_here"


# ─── Interactive guided setup ─────────────────────────────────────────────────

def interactive_setup() -> None:
    print(green(BANNER))
    print(bold("Welcome to the Job-Ops setup wizard"))
    print(dim("This will install all dependencies and configure your environment.\n"))

    # 1. Checks
    results = run_checks()
    if not results["node"] or not results["npm"]:
        abort("\nNode.js 20+ and npm 9+ are required. Please install them first.")

    # 2. Scaffold .env
    scaffold_env()

    # 3. Ask about LLM key
    if not _has_real_api_key():
        print()
        warn("No LLM API key is set — ATS scoring and AI features won't work.")
        api_key = input(
            f"  Enter your LLM API key (or press Enter to skip): "
        ).strip()
        if api_key:
            _update_env("LLM_API_KEY", api_key)
            ok("API key saved to .env")

    # 4. npm install
    npm_install()

    # 5. Playwright
    print()
    want_playwright = (
        input("  Install Playwright for browser automation? [Y/n] ").strip().lower()
        or "y"
    )
    if want_playwright == "y":
        install_playwright()

    # 6. Data dir + DB
    ensure_data_dir()
    run_migrations()

    # 7. Launch mode
    print()
    print(bold("Setup complete! How would you like to start?"))
    print("  1) Development mode (hot-reload, instant feedback)")
    print("  2) Production mode (optimised build)")
    print("  3) Docker (containerised, closest to real deployment)")
    print("  4) Exit (start manually later)")
    print()

    choice = input("  Enter 1-4 [1]: ").strip() or "1"

    if choice == "1":
        start_dev()
    elif choice == "2":
        start_prod()
    elif choice == "3":
        start_docker()
    else:
        port = _get_port()
        print()
        print(bold("To start manually:"))
        print(f"  Development:  cd orchestrator && npm run dev")
        print(f"  Production:   cd orchestrator && npm run start")
        print(f"  Docker:       docker compose up --build -d")
        print(f"  URL:          http://localhost:{port}")


def _update_env(key: str, value: str) -> None:
    """Set/replace a KEY=value pair in .env."""
    if not ENV_FILE.exists():
        ENV_FILE.write_text(f"{key}={value}\n")
        return

    lines = ENV_FILE.read_text().splitlines()
    found = False
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(f"{key}=") or stripped.startswith(f"# {key}="):
            new_lines.append(f"{key}={value}")
            found = True
        else:
            new_lines.append(line)

    if not found:
        new_lines.append(f"{key}={value}")

    ENV_FILE.write_text("\n".join(new_lines) + "\n")


# ─── Status display ───────────────────────────────────────────────────────────

def show_status() -> None:
    step("Job-Ops installation status")

    node_ver = get_output(["node", "--version"])
    npm_ver = get_output(["npm", "--version"])
    node_modules = (ORCHESTRATOR / "node_modules").exists()
    db_exists = (DATA_DIR / "jobs.db").exists()
    env_exists = ENV_FILE.exists()
    has_key = _has_real_api_key()
    playwright_ok = check_playwright()
    dist_exists = (ORCHESTRATOR / "dist").exists()

    rows = [
        ("Node.js",         node_ver or red("not found")),
        ("npm",             f"v{npm_ver}" if npm_ver else red("not found")),
        ("node_modules",    green("installed") if node_modules else yellow("missing — run setup")),
        ("Database",        green("exists") if db_exists else yellow("not created yet")),
        (".env",            green("found") if env_exists else yellow("missing")),
        ("LLM API key",     green("set") if has_key else yellow("not set")),
        ("Playwright",      green("installed") if playwright_ok else yellow("not installed")),
        ("Client build",    green("built") if dist_exists else dim("not built (ok for dev mode)")),
    ]

    col_w = max(len(r[0]) for r in rows) + 2
    for label, value in rows:
        print(f"  {label:<{col_w}}{value}")

    print()
    port = _get_port()
    info(f"App URL will be: http://localhost:{port}")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="setup.py",
        description="Job-Ops setup and launcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              python setup.py              # Interactive guided setup (recommended first run)
              python setup.py --install    # Install deps only, don't start
              python setup.py --dev        # Dev mode with hot-reload
              python setup.py --prod       # Build + run production server
              python setup.py --docker     # Run via Docker Compose
              python setup.py --reset-db   # Wipe DB and re-migrate
              python setup.py --check      # Check prerequisites
              python setup.py --update     # Pull latest + reinstall + migrate
              python setup.py --status     # Show what's installed
        """),
    )
    g = p.add_mutually_exclusive_group()
    g.add_argument("--install",   action="store_true", help="Install dependencies only")
    g.add_argument("--dev",       action="store_true", help="Start development server")
    g.add_argument("--prod",      action="store_true", help="Build client + start production server")
    g.add_argument("--docker",    action="store_true", help="Build & run via Docker Compose")
    g.add_argument("--reset-db",  action="store_true", help="Wipe database and re-run migrations")
    g.add_argument("--check",     action="store_true", help="Check prerequisites only")
    g.add_argument("--update",    action="store_true", help="Pull latest code + reinstall + migrate")
    g.add_argument("--status",    action="store_true", help="Show installation status")

    p.add_argument(
        "--skip-playwright",
        action="store_true",
        help="Skip Playwright browser installation",
    )
    p.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"Override port (default: {DEFAULT_PORT})",
    )
    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Port override
    if args.port:
        _update_env("PORT", str(args.port))

    if args.check:
        run_checks()
        return

    if args.status:
        show_status()
        return

    if args.reset_db:
        ensure_data_dir()
        run_migrations(reset=True)
        return

    if args.update:
        update()
        return

    if args.install:
        results = run_checks()
        if not results["node"] or not results["npm"]:
            abort("Node.js 20+ and npm 9+ are required.")
        scaffold_env()
        ensure_data_dir()
        npm_install()
        if not args.skip_playwright:
            install_playwright()
        run_migrations()
        ok("Installation complete")
        port = _get_port()
        print()
        print(bold("Start commands:"))
        print(f"  Development:  python setup.py --dev")
        print(f"  Production:   python setup.py --prod")
        print(f"  Docker:       python setup.py --docker")
        return

    if args.dev:
        results = run_checks()
        if not results["node"] or not results["npm"]:
            abort("Node.js 20+ and npm 9+ are required.")
        # Auto-install if node_modules missing
        if not (ORCHESTRATOR / "node_modules").exists():
            info("node_modules not found — running npm install first")
            npm_install()
        scaffold_env()
        ensure_data_dir()
        run_migrations()
        start_dev()
        return

    if args.prod:
        results = run_checks()
        if not results["node"] or not results["npm"]:
            abort("Node.js 20+ and npm 9+ are required.")
        if not (ORCHESTRATOR / "node_modules").exists():
            npm_install()
        scaffold_env()
        ensure_data_dir()
        run_migrations()
        start_prod()
        return

    if args.docker:
        scaffold_env()
        start_docker()
        return

    # No flag → interactive
    interactive_setup()


if __name__ == "__main__":
    main()
