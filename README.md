# Toggl MCP Server

Small single-user MCP server for Toggl time tracking. It exposes a stateless
Streamable HTTP endpoint at `/mcp` for Codex Gateway and can also run over
`stdio` for local development.

The server supports both:

- Toggl Track API v9 with the profile API token; and
- Toggl Focus with a `toggl_sk_...` API key.

`TOGGL_TRACK_API_MODE=auto` selects Focus for a `toggl_sk_` key and Track v9
otherwise. This keeps one MCP contract for both API variants.

## Tools

Read tools:

- `toggl_track_get_config`
- `toggl_track_list_projects`
- `toggl_track_get_project`
- `toggl_track_list_tags` (Track v9)
- `toggl_track_list_time_entries`
- `toggl_track_get_time_entry`

Write tools:

- `toggl_track_create_time_entry`
- `toggl_track_update_time_entry`
- `toggl_track_archive_time_entry` and `toggl_track_restore_time_entry` (Focus)
- `toggl_track_create_tag`, `toggl_track_update_tag`, and `toggl_track_delete_tag` (Track v9)
- `toggl_track_update_time_entry_tags` and `toggl_track_update_time_entries_tags` (Track v9)

The server intentionally does not create or delete workspaces, projects,
clients, users, or organizations. Track v9 time-entry deletion is not exposed;
agents can correct an entry instead of irreversibly deleting it.

## Configuration

| Variable | Required | Meaning |
|---|---:|---|
| `TOGGL_TRACK_API_KEY` | yes | Toggl Track profile API token or Focus `toggl_sk_...` key |
| `TOGGL_TRACK_ORGANIZATION_ID` | Focus only | Organization containing the selected workspace |
| `TOGGL_TRACK_WORKSPACE_ID` | yes | Workspace to which every operation is confined |
| `TOGGL_TRACK_API_MODE` | no | `auto` (default), `track-v9`, or `focus` |
| `TOGGL_TRACK_BASE_URL` | no | Defaults to the official API URL selected by the mode |
| `PORT` | no | HTTP port, default `8080` |

For normal Toggl Track, find the profile API token at
<https://track.toggl.com/profile>. Do not commit the token or place it in an
MCP URL/header. The container sends Track tokens using Basic authentication as
`<token>:api_token`; Focus keys use Bearer authentication.

## Container deployment

Build and publish:

```powershell
docker build -t registry.tichymichal.net/mcp-toggl-track:latest .
docker push registry.tichymichal.net/mcp-toggl-track:latest
```

Keep the container on the private Gateway network and do not publish its port.
The HTTP transport has no separate MCP API key. Gateway API-key/project grants
are the authorization boundary; the Toggl token only authenticates the server
to Toggl.

Register it in Codex Gateway as:

| Field | Value |
|---|---|
| Name | `Toggl` |
| Transport | `HTTP` |
| URL | `http://toggl-mcp:8080/mcp` |
| Execution mode | `Gateway` |
| Environment headers | none |

Grant read tools to planning when it needs to inspect existing entries and
projects. Grant write tools only to execution behind Samwise plan approval.

## Development

No npm dependencies are required.

```powershell
npm test
npm run start:http
```

The health endpoint is `GET /health`. The MCP endpoint accepts JSON-RPC `POST`
requests at `/mcp`.

API behavior follows the current [Toggl Track API documentation](https://engineering.toggl.com/docs/).
