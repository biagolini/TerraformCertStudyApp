#!/bin/bash
exec python -m gunicorn -b :${PORT:-8000} -w 1 --timeout 30 app:app
