"""
wsgi.py
─────────────────────────────────────────────────────────────────────────────
Production entry point: `gunicorn wsgi:app`.

The corpus is loaded and the vector matrix built once, here at import time, so
the cost is paid during worker startup rather than on the first user request.
app.py deliberately exposes only the `create_app` factory — tests build their
own instances with stubbed dependencies, and a module-level app there would
have loaded the real 3 MB corpus on every import.
─────────────────────────────────────────────────────────────────────────────
"""

from app import create_app

app = create_app()
