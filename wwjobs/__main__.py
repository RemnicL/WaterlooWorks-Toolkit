import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://waterlooworks.uwaterloo.ca"
JOBS_PATH = "/myAccount/co-op/full/jobs.htm"
JOBS_URL = ORIGIN + JOBS_PATH


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


def run(args, playwright):
    started = datetime.now(timezone.utc)
    start = perf_counter()
    report = {"started_at": started.isoformat(), "source_url": JOBS_URL}
    export = None
    try:
        context = playwright.chromium.launch_persistent_context(
            args.data_dir / "profile", headless=not (args.command == "login" or args.interactive)
        )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            if args.command == "login":
                page.goto(ORIGIN, wait_until="domcontentloaded")
                select_jobs_page(context, "Sign in, open Full-Cycle jobs, then press Enter here. ")
                print("Full-Cycle jobs page opened. Browser session saved.")
                return 0
            response = page.goto(JOBS_URL, wait_until="domcontentloaded")
            require_jobs_page(page, response)
            report["browser_and_page_ms"] = round((perf_counter() - start) * 1000)
            if args.interactive:
                page = select_jobs_page(context, "Set the desired filters, then press Enter here. ")
            report["scope"] = args.scope or ("interactive_filters" if args.interactive else "page_defaults")
            result = collect_page(page)
            report.update(result["report"])
            require_jobs_page(page)
            export = {"total_jobs": len(result["jobs"]), "posting_ids": result["postingIds"], "jobs": result["jobs"]}
        finally:
            context.close()
    except CollectionError as error:
        if args.command == "login":
            raise
        report.update(list_complete=False, error=error.code, message=str(error))

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
    print(f"{report['status']}: {output}")
    return {"complete": 0, "failed": 1, "partial": 2}[report["status"]]


def main():
    parser = argparse.ArgumentParser(description="Collect WaterlooWorks Full-Cycle postings locally.")
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".wwjobs", help="Browser profile and capture directory")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login", help="Open a dedicated browser for manual sign-in")
    collect = commands.add_parser("collect", help="Collect the current Full-Cycle results")
    collect.add_argument("--interactive", action="store_true", help="Open a window to set filters before collecting")
    collect.add_argument("--scope", help="Label the selected scope in the report")
    args = parser.parse_args()

    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        parser.exit(1, "Install Playwright with `python -m pip install -r wwjobs/requirements.txt`.\n")
    try:
        with sync_playwright() as playwright:
            return run(args, playwright)
    except (CollectionError, Error, OSError, EOFError) as error:
        print(f"{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
