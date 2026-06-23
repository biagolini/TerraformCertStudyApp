"""Cert Study Assistant — CRUD Lambda for DynamoDB user data."""

import base64
import json
import os

import boto3
from boto3.dynamodb.conditions import Key
from flask import Flask, Response, request

TABLE_NAME = os.environ.get("TABLE_NAME", "cert-stud-data")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

app = Flask(__name__)


def _user_pk():
    """Extract userId from JWT token (already validated by API Gateway Cognito authorizer)."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        # Decode JWT payload (no verification needed — API Gateway already validated)
        payload = token.split(".")[1]
        # Add padding
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += "=" * padding
        decoded = json.loads(base64.b64decode(payload))
        sub = decoded.get("sub", "")
        if not sub:
            return None
        return f"USER#{sub}"
    except Exception:
        return None


def _json(data, status=200):
    return Response(json.dumps(data), status=status, mimetype="application/json",
                    headers={"Access-Control-Allow-Origin": "*"})


def _error(msg, status=400):
    return _json({"error": msg}, status)


@app.route("/data", methods=["GET"])
def get_all():
    """Return all user data grouped by entity type."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    resp = table.query(KeyConditionExpression=Key("pk").eq(pk))
    items = resp.get("Items", [])

    result = {"packs": [], "questions": [], "scripts": [], "settings": None}
    for item in items:
        sk = item["sk"]
        data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
        if sk == "SETTINGS":
            result["settings"] = data
        elif sk.startswith("PACK#"):
            result["packs"].append(data)
        elif sk.startswith("QUESTION#"):
            result["questions"].append(data)
        elif sk.startswith("SCRIPT#"):
            result["scripts"].append(data)

    return _json(result)


@app.route("/data", methods=["PUT"])
def put_all():
    """Batch write all entities (used for sync/migration)."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    body = request.get_json(force=True) or {}

    with table.batch_writer() as batch:
        if body.get("settings"):
            batch.put_item(Item={"pk": pk, "sk": "SETTINGS", "data": json.dumps(body["settings"])})

        for pack in body.get("packs", []):
            if pack.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"PACK#{pack['id']}", "data": json.dumps(pack)})

        for q in body.get("questions", []):
            if q.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"QUESTION#{q['id']}", "data": json.dumps(q)})

        for s in body.get("scripts", []):
            if s.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"SCRIPT#{s['id']}", "data": json.dumps(s)})

    return _json({"ok": True})


@app.route("/data/settings", methods=["PUT"])
def put_settings():
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    table.put_item(Item={"pk": pk, "sk": "SETTINGS", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/packs/<item_id>", methods=["PUT"])
def put_pack(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    table.put_item(Item={"pk": pk, "sk": f"PACK#{item_id}", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/questions/<item_id>", methods=["PUT"])
def put_question(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    table.put_item(Item={"pk": pk, "sk": f"QUESTION#{item_id}", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/scripts/<item_id>", methods=["PUT"])
def put_script(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    table.put_item(Item={"pk": pk, "sk": f"SCRIPT#{item_id}", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/packs/<item_id>", methods=["DELETE"])
def delete_pack(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    table.delete_item(Key={"pk": pk, "sk": f"PACK#{item_id}"})
    return _json({"ok": True})


@app.route("/data/questions/<item_id>", methods=["DELETE"])
def delete_question(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    table.delete_item(Key={"pk": pk, "sk": f"QUESTION#{item_id}"})
    return _json({"ok": True})


@app.route("/data/scripts/<item_id>", methods=["DELETE"])
def delete_script(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    table.delete_item(Key={"pk": pk, "sk": f"SCRIPT#{item_id}"})
    return _json({"ok": True})


@app.route("/", methods=["GET"])
def health():
    return "OK"
