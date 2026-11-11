import argparse
import json
import re
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter
from urllib.parse import urlsplit

from job_database import jobdb


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://waterlooworks.uwaterloo.ca"
JOBS_PATH = "/myAccount/co-op/full/jobs.htm"
JOBS_URL = ORIGIN + JOBS_PATH
EXIT_CODES = {"complete": 0, "failed": 1, "partial": 2}


class CollectionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def is_jobs_page(page):
    url = urlsplit(page.url)
    return (url.scheme, url.netloc, url.path) == ("https", "waterlooworks.uwaterloo.ca", JOBS_PATH)


def require_jobs_page(page, response=None):
    if urlsplit(page.url).path.lower() == "/notloggedin.htm" or (response and response.status == 401):
        raise CollectionError("login_required", "Sign in with `python -m wwjobs login` and try again.")
    if not is_jobs_page(page) or (response and not response.ok):
        raise CollectionError("jobs_page_unavailable", "Could not open the Full-Cycle jobs page.")


def select_jobs_page(context, message):
    input(message)
    for page in context.pages:
        if is_jobs_page(page):
            return page
    raise CollectionError("jobs_page_unavailable", "Open the Full-Cycle jobs page before continuing.")


def open_jobs_list(page):
    from playwright.sync_api import TimeoutError

    response = page.goto(JOBS_URL, wait_until="domcontentloaded")
    require_jobs_page(page, response)
    rows = page.locator("table.data-viewer-table tbody tr").filter(visible=True)
    all_jobs = page.get_by_text(re.compile(r"^all\s*jobs(?:\s*\([0-9,]+\))?$", re.I)).filter(visible=True)
    try:
        rows.or_(all_jobs).first.wait_for(timeout=15000)
        if not rows.count():
            all_jobs.click()
            rows.first.wait_for(timeout=15000)
    except TimeoutError as error:
        require_jobs_page(page)
        raise CollectionError("jobs_list_unavailable", "The Full-Cycle job list did not load.") from error
    require_jobs_page(page)


def collect_page(page):
    for script in ("export-fields.js", "content_helpers/bootstrapContent.js"):
        source = (ROOT / script).read_text(encoding="utf-8")
        page.evaluate(f"() => {{\n{source}\n}}")
    return page.evaluate("""() => {
        const options = {includeBasicInfo: true};
        for (const {option, group} of WWExportFields) {
            options[option] = group !== 'Hiring history';
        }
        return createJobsCollector()(options, 120);
    }""")


def write_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def save_session_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    file = NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=".auth-state-", suffix=".tmp", delete=False
    )
    temporary_path = Path(file.name)
    try:
        with file:
            json.dump(state, file)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def login(args, playwright):
    with closing(playwright.chromium.launch(headless=False)) as browser:
        context = browser.new_context()
        context.new_page().goto(ORIGIN, wait_until="domcontentloaded")
        input("Sign in and reach the WaterlooWorks Dashboard, then press Enter here. ")
        open_jobs_list(context.new_page())
        save_session_state(args.data_dir / "auth-state.json", context.storage_state())
    print("Full-Cycle jobs page verified. Browser session saved.")
    return 0


def collect(args, playwright):
    from playwright.sync_api import Error

    started = datetime.now(timezone.utc)
    start = perf_counter()
    report = {
        "started_at": started.isoformat(),
        "source_url": JOBS_URL,
        "scope": args.scope or ("interactive_filters" if args.interactive else "page_defaults"),
    }
    export = None
    session_path = args.data_dir / "auth-state.json"
    try:
        if not session_path.is_file():
            raise CollectionError("login_required", "Sign in with python -m wwjobs login and try again.")
        with closing(playwright.chromium.launch(headless=not args.interactive)) as browser:
            context = browser.new_context(storage_state=session_path)
            page = context.new_page()
            open_jobs_list(page)
            report["browser_and_page_ms"] = round((perf_counter() - start) * 1000)
            if args.interactive:
                page = select_jobs_page(context, "Set the desired filters, then press Enter here. ")
            result = collect_page(page)
            report.update(result["report"])
            require_jobs_page(page)
            export = {"total_jobs": len(result["jobs"]), "posting_ids": result["postingIds"], "jobs": result["jobs"]}
    except CollectionError as error:
        report.update(list_complete=False, error=error.code, message=str(error))
    except (Error, OSError, EOFError, json.JSONDecodeError) as error:
        export = None
        report.update(list_complete=False, error="capture_failed", message=str(error).split("\n", 1)[0])

    if export is None:
        report["status"] = "failed"
    elif not report["list_complete"] or report["detail_failures"]:
        report["status"] = "partial"
    else:
        report["status"] = "complete"
    report["elapsed_ms"] = round((perf_counter() - start) * 1000)
    output = args.data_dir / "captures" / started.strftime("%Y%m%dT%H%M%S%fZ")
    output.mkdir(parents=True)
    if export is not None:
        write_json(output / "jobs.json", export)
    write_json(output / "report.json", report)
    if report.get("message"):
        print(report["message"], file=sys.stderr)
    return output, report


def sync(args, playwright):
    args.db.parent.mkdir(parents=True, exist_ok=True)
    with closing(jobdb.connect(args.db)) as conn:
        if conn.execute("PRAGMA user_version").fetchone()[0] != jobdb.SCHEMA_VERSION:
            jobdb.initialize(conn)
        output, report = collect(args, playwright)
        name = f"capture-{output.name}"
        try:
            result = jobdb.import_capture(conn, output, name, args.scope)
        except (ValueError, OSError, sqlite3.Error) as error:
            print(f"Capture: {output}", file=sys.stderr)
            jobdb.import_capture(conn, output, name, args.scope, import_error=str(error))
            raise
    jobdb.write_json({**result, "capture_directory": str(output.resolve())})
    return EXIT_CODES[report["status"]]


def status(args):
    if not args.db.is_file():
        jobdb.write_json({"scope": args.scope, "last_attempt": None, "last_update": None})
        return 0
    with closing(jobdb.connect(args.db)) as conn:
        if conn.execute("PRAGMA user_version").fetchone()[0] != jobdb.SCHEMA_VERSION:
            raise ValueError("Run sync or initialize the database to upgrade it.")
        conn.execute("BEGIN")
        jobdb.write_json(jobdb.capture_status(conn, args.scope))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Collect WaterlooWorks Full-Cycle postings locally.")
    parser.add_argument(
        "--data-dir", type=Path, default=ROOT / ".wwjobs", help="Session state and capture directory"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login", help="Open a dedicated browser for manual sign-in")
    for name, help_text in (
        ("collect", "Collect the current Full-Cycle results"),
        ("sync", "Collect postings and import the capture into SQLite"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--interactive", action="store_true", help="Set filters in an open browser")
        command.add_argument("--scope", required=name == "sync", help="Name for the account, board, term and filters")
        if name == "sync":
            command.add_argument("--db", type=Path, default=jobdb.DEFAULT_DB)
    status_command = commands.add_parser("status", help="Show the latest attempt and database update for a scope")
    status_command.add_argument("--scope", required=True)
    status_command.add_argument("--db", type=Path, default=jobdb.DEFAULT_DB)
    args = parser.parse_args()
    if args.command in ("sync", "status") and not args.scope.strip():
        parser.error("--scope must be nonempty")

    if args.command == "status":
        try:
            return status(args)
        except (ValueError, OSError, sqlite3.Error) as error:
            print(f"Error: {error}", file=sys.stderr)
            return 1

    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        parser.exit(1, "Install Playwright with `python -m pip install -r wwjobs/requirements.txt`.\n")
    try:
        with sync_playwright() as playwright:
            if args.command == "login":
                return login(args, playwright)
            if args.command == "sync":
                return sync(args, playwright)
            output, report = collect(args, playwright)
            print(f"{report['status']}: {output}")
            return EXIT_CODES[report["status"]]
    except (CollectionError, Error, OSError, EOFError, ValueError, sqlite3.Error) as error:
        print(f"{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
