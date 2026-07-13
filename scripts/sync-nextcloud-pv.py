#!/usr/bin/env python3
"""Imports new PV PDFs dropped in Nextcloud (CSE - Documents/PV/<year>/*.pdf, user
cse_admin) into the CSE site's document library. Runs on the VPS host (not inside a
container) since it shells out to `docker cp` to read Nextcloud's data volume, and
calls the CSE site's own admin API to publish. Meant to run on a daily cron.
"""
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

NEXTCLOUD_CONTAINER = os.environ.get("SYNC_NEXTCLOUD_CONTAINER", "nextcloud_app")
NEXTCLOUD_PV_PATH = os.environ.get(
    "SYNC_NEXTCLOUD_PV_PATH", "/var/www/html/data/cse_admin/files/CSE - Documents/PV"
)
SITE_URL = os.environ.get("SYNC_SITE_URL", "https://portail.cse-sns-security.fr")
SYNC_EMAIL = os.environ.get("SYNC_ADMIN_EMAIL")
SYNC_PASSWORD = os.environ.get("SYNC_ADMIN_PASSWORD")
SCRIPT_DIR = Path(__file__).resolve().parent
STATE_FILE = Path(
    os.environ.get("SYNC_STATE_FILE", SCRIPT_DIR.parent / "data" / "nextcloud-pv-sync-state.json")
)

MONTHS_FR = [
    "janvier", "fevrier", "mars", "avril", "mai", "juin",
    "juillet", "aout", "septembre", "octobre", "novembre", "decembre"
]


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"imported": {}}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n")


def extract_date(file_name):
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", file_name)
    return match.group(0) if match else ""


def format_french_date(iso_date):
    try:
        date = datetime.strptime(iso_date, "%Y-%m-%d")
    except ValueError:
        return iso_date
    return f"{date.day} {MONTHS_FR[date.month - 1]} {date.year}"


def login():
    payload = json.dumps({"email": SYNC_EMAIL, "password": SYNC_PASSWORD}).encode()
    request = urllib.request.Request(
        f"{SITE_URL}/api/admin/login",
        data=payload,
        headers={"Content-Type": "application/json", "Origin": SITE_URL},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        cookie = response.headers.get("Set-Cookie")
        if not cookie:
            raise RuntimeError("login succeeded but no session cookie was returned")
        return cookie.split(";")[0]


def logout(cookie):
    request = urllib.request.Request(
        f"{SITE_URL}/api/admin/logout",
        data=b"",
        headers={"Origin": SITE_URL, "Cookie": cookie},
        method="POST",
    )
    try:
        urllib.request.urlopen(request)
    except Exception:
        pass


def upload_document(cookie, title, file_name, data_bytes, published_at):
    payload = json.dumps({
        "title": title,
        "fileName": file_name,
        "dataBase64": base64.b64encode(data_bytes).decode("ascii"),
        "kind": "pv",
        "visibility": "public",
        "publishedAt": published_at,
    }).encode()
    request = urllib.request.Request(
        f"{SITE_URL}/api/admin/documents",
        data=payload,
        headers={"Content-Type": "application/json", "Origin": SITE_URL, "Cookie": cookie},
        method="POST",
    )
    try:
        urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        raise RuntimeError(f'upload failed for "{file_name}": HTTP {error.code} {body}') from error


def main():
    if not SYNC_EMAIL or not SYNC_PASSWORD:
        print("SYNC_ADMIN_EMAIL and SYNC_ADMIN_PASSWORD must be set.", file=sys.stderr)
        sys.exit(1)

    state = load_state()
    tmp_dir = Path(tempfile.mkdtemp(prefix="cse-pv-sync-"))
    try:
        subprocess.run(
            ["docker", "cp", f"{NEXTCLOUD_CONTAINER}:{NEXTCLOUD_PV_PATH}", str(tmp_dir)],
            check=True,
        )
        pv_root = tmp_dir / "PV"
        pending = []
        for year_dir in sorted(p for p in pv_root.iterdir() if p.is_dir()):
            pdf_paths = sorted(list(year_dir.glob("*.pdf")) + list(year_dir.glob("*.PDF")))
            for pdf_path in pdf_paths:
                data_bytes = pdf_path.read_bytes()
                file_hash = hashlib.sha256(data_bytes).hexdigest()
                if file_hash in state["imported"]:
                    continue
                published_at = extract_date(pdf_path.name) or f"{year_dir.name}-01-01"
                pending.append((pdf_path.name, data_bytes, file_hash, published_at))

        if not pending:
            print("Nextcloud PV sync: nothing new.")
            return

        cookie = login()
        try:
            for file_name, data_bytes, file_hash, published_at in pending:
                title = f"PV CSE - {format_french_date(published_at)}"
                upload_document(cookie, title, file_name, data_bytes, published_at)
                state["imported"][file_hash] = {
                    "fileName": file_name,
                    "publishedAt": published_at,
                    "importedAt": datetime.now(timezone.utc).isoformat(),
                }
                print(f"Imported: {file_name} ({published_at})")
        finally:
            logout(cookie)

        save_state(state)
        print(f"Nextcloud PV sync: imported {len(pending)} new PV(s).")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
