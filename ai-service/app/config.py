"""Load local .env without exposing secrets; process variables take precedence."""
import os
from pathlib import Path
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]


def settings():
    return {**dotenv_values(ROOT / '.env'), **os.environ}
