# TODO MOVE TO AUTOEVALS IMPORT
# https://github.com/braintrustdata/braintrust/issues/218

import json
import sqlite3

from .cache import CACHE_PATH

OAI_CACHE = CACHE_PATH / "oai.sqlite"

_CONN = None


def open_cache():
    global _CONN
    if _CONN is None:
        _CONN = sqlite3.connect(OAI_CACHE)
        _CONN.execute("CREATE TABLE IF NOT EXISTS cache (params text, response text)")
    return _CONN


def run_cached_request(Completion=None, **kwargs):
    if Completion is None:
        # OpenAI is very slow to import, so we only do it if we need it
        import openai

        Completion = openai.Completion

    param_key = json.dumps(kwargs)
    conn = open_cache()
    cursor = conn.cursor()
    resp = cursor.execute("""SELECT response FROM "cache" WHERE params=?""", [param_key]).fetchone()
    if resp:
        return json.loads(resp[0])

    resp = Completion.create(**kwargs).to_dict()

    cursor.execute("""INSERT INTO "cache" VALUES (?, ?)""", [param_key, json.dumps(resp)])
    conn.commit()

    return resp
