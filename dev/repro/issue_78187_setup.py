#!/usr/bin/env python3
"""Set up a local reproduction of https://github.com/metabase/metabase/issues/78187

    Remapping won't work if you do advanced RLS w/ questions that cherry pick fields

Drives the Metabase REST API against a locally running (EE, token with `sandboxes`)
instance and creates, on the Sample Database:

  1. q1: native question `select * from people where state = {{state_param}}`
     (saved in the admin's personal collection)
  2. q2: native question `select orders.* from orders left join people ... where
     people.state = {{state_param}}` (admin's personal collection)
  3. a `sandboxed` permissions group
  4. a user sandy@example.com (password: see --user-password) in that group with
     login attribute state=CA
  5. permissions: All Users blocked on the Sample Database; `sandboxed` group gets
     sandboxed (RLS) view-data on People (via q1) and Orders (via q2) + query
     builder access, and unrestricted view-data + query builder on Products
  6. remaps orders.user_id -> people.name and orders.product_id -> products.title
     (FK "external" remapping)
  7. an MBQL question joining Orders + People + Products that cherry-picks fields
     (orders.user_id, orders.product_id, people.state, products.category), saved
     in Our analytics

Repro after running this:
  - log in as sandy@example.com / <--user-password>
  - browse the Orders table: remapping works
  - open the "Repro 78187 ..." question: remapping is broken, console shows
    "Invalid remapped_from" errors

Usage:
  python3 dev/repro/issue_78187_setup.py \
      --host http://localhost:3060 \
      --admin-email you@example.com --admin-password yourpassword
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

DEFAULT_USER_EMAIL = "sandy@example.com"


class Client:
    def __init__(self, host):
        self.host = host.rstrip("/")
        self.session = None

    def request(self, method, path, body=None, expect_error=False):
        url = self.host + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.session:
            req.add_header("X-Metabase-Session", self.session)
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            if expect_error:
                return {"_status": e.code, "_body": raw}
            print(f"\nERROR: {method} {path} -> HTTP {e.code}\n{raw[:2000]}")
            sys.exit(1)

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, body=None, expect_error=False):
        return self.request("POST", path, body, expect_error)

    def put(self, path, body=None):
        return self.request("PUT", path, body)

    def login(self, email, password):
        resp = self.post("/api/session", {"username": email, "password": password})
        self.session = resp["id"]


def find_field(table, *names):
    wanted = [n.lower() for n in names]
    for f in table["fields"]:
        if f["name"].lower() in wanted:
            return f
    raise SystemExit(f"Could not find field {names} in table {table['name']}")


def find_card_by_name(mb, name):
    q = urllib.parse.quote(name)
    resp = mb.get(f"/api/search?q={q}&models=card&archived=false")
    for item in resp.get("data", []):
        if item["name"] == name and item["model"] == "card":
            return item["id"]
    return None


def ensure_card(mb, payload):
    existing = find_card_by_name(mb, payload["name"])
    if existing:
        print(f"  - card '{payload['name']}' already exists (id {existing}), updating")
        mb.put(f"/api/card/{existing}", payload)
        return existing
    card = mb.post("/api/card", payload)
    print(f"  - created card '{payload['name']}' (id {card['id']})")
    return card["id"]


def native_state_card(name, sql, database_id, collection_id):
    return {
        "name": name,
        "collection_id": collection_id,
        "display": "table",
        "visualization_settings": {},
        "dataset_query": {
            "type": "native",
            "database": database_id,
            "native": {
                "query": sql,
                "template-tags": {
                    "state_param": {
                        "id": str(uuid.uuid4()),
                        "name": "state_param",
                        "display-name": "State param",
                        "type": "text",
                    }
                },
            },
        },
    }


def diagnose(mb, args):
    """Print the stored permissions/sandbox state and what the sandboxed user can see."""
    dbs = mb.get("/api/database")["data"]
    sample = next((d for d in dbs if d["name"] == "Sample Database"), None)
    if not sample:
        raise SystemExit("No 'Sample Database' found (as admin!)")
    db_id = sample["id"]

    groups = mb.get("/api/permissions/group")
    by_name = {g["name"]: g for g in groups}
    gid = by_name.get("sandboxed", {}).get("id")
    all_users_id = by_name["All Users"]["id"]
    print(f"Sample Database id: {db_id}; group ids: sandboxed={gid}, All Users={all_users_id}")

    graph = mb.get("/api/permissions/graph")
    for label, g in (("All Users", all_users_id), ("sandboxed", gid)):
        slice_ = graph.get("groups", {}).get(str(g), {}).get(str(db_id))
        print(f"\n--- graph[{label}][db {db_id}] ---")
        print(json.dumps(slice_, indent=2, sort_keys=True))

    print("\n--- sandboxes (GET /api/mt/gtap) ---")
    print(json.dumps(mb.get("/api/mt/gtap"), indent=2))

    found = mb.get(f"/api/user?query={urllib.parse.quote(args.user_email)}")
    user = next((u for u in found["data"] if u["email"] == args.user_email), None)
    print(f"\n--- user {args.user_email} ---")
    if user:
        print(json.dumps({k: user.get(k) for k in ("id", "group_ids", "login_attributes", "is_active")}, indent=2))
    else:
        print("NOT FOUND")

    print(f"\nLogging in as {args.user_email} ...")
    sandy = Client(args.host)
    sandy.login(args.user_email, args.user_password)

    sdbs = sandy.get("/api/database")["data"]
    print(f"databases visible: {[(d['id'], d['name']) for d in sdbs]}")

    schemas = sandy.request("GET", f"/api/database/{db_id}/schemas", expect_error=True)
    print(f"GET /api/database/{db_id}/schemas -> {schemas}")

    meta = sandy.request("GET", f"/api/database/{db_id}/metadata", expect_error=True)
    if isinstance(meta, dict) and meta.get("_status"):
        print(f"GET /api/database/{db_id}/metadata -> HTTP {meta['_status']}: {meta['_body'][:300]}")
    else:
        print(f"metadata tables visible: {[t['name'] for t in meta.get('tables', [])]}")

    admin_meta = mb.get(f"/api/database/{db_id}/metadata")
    tables = {t["name"].lower(): t for t in admin_meta["tables"]}
    if "orders" in tables:
        qm = sandy.request("GET", f"/api/table/{tables['orders']['id']}/query_metadata", expect_error=True)
        if isinstance(qm, dict) and qm.get("_status"):
            print(f"orders query_metadata -> HTTP {qm['_status']}: {qm['_body'][:300]}")
        else:
            print(f"orders query_metadata -> ok ({len(qm.get('fields', []))} fields)")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="http://localhost:3060")
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--user-email", default=DEFAULT_USER_EMAIL)
    ap.add_argument("--user-password", default="sandbox-repro-78187")
    ap.add_argument("--diagnose", action="store_true",
                    help="Don't change anything; print stored perms/sandbox state and what the sandboxed user sees")
    args = ap.parse_args()

    mb = Client(args.host)
    print(f"Logging in to {args.host} as {args.admin_email} ...")
    mb.login(args.admin_email, args.admin_password)

    if args.diagnose:
        diagnose(mb, args)
        return

    props = mb.get("/api/session/properties")
    features = props.get("token-features") or {}
    missing = [f for f in ("sandboxes", "advanced_permissions") if not features.get(f)]
    if missing:
        raise SystemExit(
            f"This instance's token is missing premium features {missing}; "
            "sandboxing/RLS and block permissions need an EE token (MB_PREMIUM_EMBEDDING_TOKEN)."
        )

    # ------------------------------------------------------------------ database
    dbs = mb.get("/api/database")["data"]
    sample = next((d for d in dbs if d["name"] == "Sample Database"), None)
    if not sample:
        raise SystemExit("No 'Sample Database' found on this instance.")
    db_id = sample["id"]
    print(f"Sample Database id: {db_id}")

    meta = mb.get(f"/api/database/{db_id}/metadata")
    tables = {t["name"].lower(): t for t in meta["tables"]}
    orders, people, products = tables["orders"], tables["people"], tables["products"]
    schema = orders.get("schema") or "PUBLIC"

    orders_user_id = find_field(orders, "user_id")
    orders_product_id = find_field(orders, "product_id")
    people_id = find_field(people, "id")
    people_state = find_field(people, "state")
    people_name = find_field(people, "name")
    products_id = find_field(products, "id")
    products_title = find_field(products, "title")
    products_category = find_field(products, "category")

    # ------------------------------------------------------- q1/q2 (RLS questions)
    personal_collection = mb.get("/api/user/current")["personal_collection_id"]
    print("Creating RLS questions in admin personal collection ...")
    q1_id = ensure_card(
        mb,
        native_state_card(
            "Repro 78187 q1 - People by state (RLS)",
            "select * from people where state = {{state_param}}",
            db_id,
            personal_collection,
        ),
    )
    q2_id = ensure_card(
        mb,
        native_state_card(
            "Repro 78187 q2 - Orders by people.state (RLS)",
            "select orders.* from orders left join people on people.id = orders.user_id "
            "where people.state = {{state_param}}",
            db_id,
            personal_collection,
        ),
    )

    # ------------------------------------------------------------------ group
    groups = mb.get("/api/permissions/group")
    group = next((g for g in groups if g["name"] == "sandboxed"), None)
    if group:
        print(f"Group 'sandboxed' already exists (id {group['id']})")
    else:
        group = mb.post("/api/permissions/group", {"name": "sandboxed"})
        print(f"Created group 'sandboxed' (id {group['id']})")
    group_id = group["id"]
    all_users = next(g for g in groups if g["name"] == "All Users")

    # ------------------------------------------------------------------ user
    resp = mb.post(
        "/api/user",
        {
            "first_name": "Sandy",
            "last_name": "Boxed",
            "email": args.user_email,
            "password": args.user_password,
            "login_attributes": {"state": "CA"},
        },
        expect_error=True,
    )
    if isinstance(resp, dict) and resp.get("_status"):
        # probably already exists; find and update
        found = mb.get(f"/api/user?query={urllib.parse.quote(args.user_email)}&include_deactivated=true")
        user = next((u for u in found["data"] if u["email"] == args.user_email), None)
        if not user:
            raise SystemExit(f"Could not create or find user {args.user_email}: {resp}")
        user_id = user["id"]
        if not user.get("is_active", True):
            mb.put(f"/api/user/{user_id}/reactivate")
        mb.put(f"/api/user/{user_id}", {"login_attributes": {"state": "CA"}})
        mb.put(f"/api/user/{user_id}/password", {"password": args.user_password})
        print(f"User {args.user_email} already existed (id {user_id}); attributes + password reset")
    else:
        user_id = resp["id"]
        print(f"Created user {args.user_email} (id {user_id})")

    memberships = mb.get(f"/api/permissions/group/{group_id}")
    if not any(m["user_id"] == user_id for m in memberships.get("members", [])):
        mb.post("/api/permissions/membership", {"group_id": group_id, "user_id": user_id})
        print(f"Added user {user_id} to group 'sandboxed'")

    # ------------------------------------------------------------- permissions
    print("Updating permissions graph (block All Users; sandbox the group) ...")
    graph = mb.get("/api/permissions/graph")

    other_table_ids = [
        t["id"]
        for t in meta["tables"]
        if t["id"] not in (orders["id"], people["id"], products["id"])
    ]
    view_data = {
        schema: {
            str(orders["id"]): "sandboxed",
            str(people["id"]): "sandboxed",
            str(products["id"]): "unrestricted",
            **{str(tid): "blocked" for tid in other_table_ids},
        }
    }
    create_queries = {
        schema: {
            str(orders["id"]): "query-builder",
            str(people["id"]): "query-builder",
            str(products["id"]): "query-builder",
            **{str(tid): "no" for tid in other_table_ids},
        }
    }

    state_target = ["variable", ["template-tag", "state_param"]]
    new_graph = {
        "revision": graph["revision"],
        "groups": {
            str(all_users["id"]): {
                str(db_id): {"view-data": "blocked", "create-queries": "no"}
            },
            str(group_id): {
                str(db_id): {"view-data": view_data, "create-queries": create_queries}
            },
        },
        "sandboxes": [
            {
                "table_id": people["id"],
                "group_id": group_id,
                "card_id": q1_id,
                "attribute_remappings": {"state": state_target},
            },
            {
                "table_id": orders["id"],
                "group_id": group_id,
                "card_id": q2_id,
                "attribute_remappings": {"state": state_target},
            },
        ],
    }
    mb.put("/api/permissions/graph", new_graph)
    print("Permissions + sandboxes (RLS) saved.")

    # ------------------------------------------------------------- remappings
    print("Setting FK remappings on orders.user_id and orders.product_id ...")
    mb.post(
        f"/api/field/{orders_user_id['id']}/dimension",
        {"type": "external", "name": "User ID", "human_readable_field_id": people_name["id"]},
    )
    mb.post(
        f"/api/field/{orders_product_id['id']}/dimension",
        {"type": "external", "name": "Product ID", "human_readable_field_id": products_title["id"]},
    )

    # ----------------------------------------------- final cherry-picked question
    print("Creating the Orders + People + Products question (cherry-picked fields) ...")
    people_alias = "People - User"
    products_alias = "Products"
    final_query = {
        "type": "query",
        "database": db_id,
        "query": {
            "source-table": orders["id"],
            "joins": [
                {
                    "alias": people_alias,
                    "source-table": people["id"],
                    "fields": [["field", people_state["id"], {"join-alias": people_alias}]],
                    "condition": [
                        "=",
                        ["field", orders_user_id["id"], None],
                        ["field", people_id["id"], {"join-alias": people_alias}],
                    ],
                },
                {
                    "alias": products_alias,
                    "source-table": products["id"],
                    "fields": [["field", products_category["id"], {"join-alias": products_alias}]],
                    "condition": [
                        "=",
                        ["field", orders_product_id["id"], None],
                        ["field", products_id["id"], {"join-alias": products_alias}],
                    ],
                },
            ],
            "fields": [
                ["field", orders_user_id["id"], None],
                ["field", orders_product_id["id"], None],
            ],
        },
    }
    final_id = ensure_card(
        mb,
        {
            "name": "Repro 78187 - Orders + People + Products (cherry-picked fields)",
            "collection_id": None,  # Our analytics
            "display": "table",
            "visualization_settings": {},
            "dataset_query": final_query,
        },
    )

    # ------------------------------------------------------------- verification
    print("\nVerifying as the sandboxed user ...")
    sandy = Client(args.host)
    sandy.login(args.user_email, args.user_password)
    result = sandy.post(f"/api/card/{final_id}/query")
    status = result.get("status")
    cols = result.get("data", {}).get("cols", [])
    rows = result.get("data", {}).get("rows", [])
    print(f"  query status: {status}, rows: {len(rows)}")
    for c in cols:
        extra = []
        if c.get("remapped_to"):
            extra.append(f"remapped_to={c['remapped_to']}")
        if c.get("remapped_from"):
            extra.append(f"remapped_from={c['remapped_from']}")
        print(f"  col: {c.get('display_name')!r} name={c.get('name')!r} {' '.join(extra)}")
    names = {c.get("name") for c in cols}
    dangling = [
        c.get("remapped_to") for c in cols if c.get("remapped_to") and c["remapped_to"] not in names
    ]
    if dangling:
        print(f"\n  BUG REPRODUCED on the backend side: remapped_to points at missing column(s): {dangling}")
    print(
        "\nDone. Now open {host} in a browser, log in as {email} / {pw},\n"
        "1) click the Orders table (Browse data) -> remapping works;\n"
        "2) open the question 'Repro 78187 - Orders + People + Products (cherry-picked fields)'\n"
        "   -> remapping broken, browser console logs 'Invalid remapped_from'.".format(
            host=args.host, email=args.user_email, pw=args.user_password
        )
    )


if __name__ == "__main__":
    main()
