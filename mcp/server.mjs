#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_INFO = {
  name: "toggl-track",
  version: "0.1.0",
};

const DEFAULT_FOCUS_BASE_URL = "https://focus.toggl.com/api";
const DEFAULT_TRACK_V9_BASE_URL = "https://api.track.toggl.com/api/v9";
const CONFIGURED_BASE_URL = (process.env.TOGGL_TRACK_BASE_URL || process.env.TOGGL_FOCUS_BASE_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.TOGGL_TRACK_API_KEY || process.env.TOGGL_FOCUS_API_KEY || "";
const ORGANIZATION_ID = process.env.TOGGL_TRACK_ORGANIZATION_ID || process.env.TOGGL_FOCUS_ORGANIZATION_ID || "";
const WORKSPACE_ID = process.env.TOGGL_TRACK_WORKSPACE_ID || process.env.TOGGL_FOCUS_WORKSPACE_ID || "";
const REQUESTED_API_MODE = (process.env.TOGGL_TRACK_API_MODE || "auto").toLowerCase();
const API_MODE = resolveApiMode();
const BASE_URL = resolveBaseUrl();

const PROJECT_FILTER_FIELDS = [
  "page",
  "per_page",
  "order_by",
  "pinned",
  "archived",
  "completed",
  "private",
  "name",
  "client_id",
  "creator_id",
  "tag_id",
  "parent_project_id",
  "assignee_user_id",
  "project_id",
  "user_id",
  "include_rates",
  "include_rollover",
  "include_idle_recurring_templates",
  "include_drafts",
  "start_date",
  "end_date",
  "cf_filter",
];

const TIME_ENTRY_LIST_FILTER_FIELDS = [
  "date_from",
  "date_to",
  "task_id",
  "status_id",
  "type",
  "page",
  "per_page",
  "order_by",
  "archived",
  "time_block_id",
  "include_taskless",
];

const TIME_ENTRY_CREATE_FIELDS = [
  "billable",
  "calendar_event_id",
  "description",
  "duration",
  "planned_at",
  "planned_duration",
  "planned_start",
  "project_id",
  "start",
  "time_block_id",
  "tracked_at",
  "type",
  "user_id",
];

const TIME_ENTRY_PATCH_FIELDS = [
  "billable",
  "description",
  "duration",
  "planned_at",
  "planned_duration",
  "planned_start",
  "project_id",
  "reset_billable_to_default",
  "start",
  "task_id",
  "time_block_id",
  "tracked_at",
  "type",
];

const TRACK_V9_PROJECT_FILTER_FIELDS = [
  "active",
  "since",
  "billable",
  "user_ids",
  "client_ids",
  "group_ids",
  "project_ids",
  "statuses",
  "name",
  "page",
  "sort_field",
  "sort_order",
  "only_templates",
  "only_me",
  "only_editable",
  "per_page",
  "sort_pinned",
  "search",
];

const TRACK_V9_TAG_FILTER_FIELDS = [
  "page",
  "per_page",
  "search",
];

const TRACK_V9_TIME_ENTRY_CREATE_FIELDS = [
  "billable",
  "description",
  "duration",
  "project_id",
  "start",
  "stop",
  "tag_ids",
  "tags",
  "task_id",
  "user_id",
  "workspace_id",
];

const TRACK_V9_TIME_ENTRY_PUT_FIELDS = [
  "billable",
  "description",
  "duration",
  "duronly",
  "project_id",
  "start",
  "stop",
  "tag_action",
  "tag_ids",
  "tags",
  "task_id",
  "user_id",
  "workspace_id",
];

const jsonSchema = {
  numberId: { type: "integer", minimum: 1 },
  nullableString: { anyOf: [{ type: "string" }, { type: "null" }] },
  nullableInteger: { anyOf: [{ type: "integer" }, { type: "null" }] },
  dateTime: {
    type: "string",
    description: "RFC 3339 / ISO 8601 timestamp, preferably UTC.",
  },
};

const tools = [
  {
    name: "toggl_track_get_config",
    description: "Show the Toggl Track MCP server configuration without revealing the API key.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: getConfig,
  },
  {
    name: "toggl_track_list_projects",
    description: "List projects in the configured Toggl Track workspace.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 200 },
        order_by: arrayOfStrings("Sort fields accepted by Toggl Track."),
        name: { type: "string", description: "Filter by project or client name." },
        archived: { type: "boolean", description: "true = archived only, false = active only." },
        completed: { type: "boolean", description: "true = completed only, false = incomplete only." },
        private: { type: "boolean" },
        pinned: { type: "boolean" },
        client_id: arrayOfIntegers("Filter by client IDs."),
        project_id: arrayOfIntegers("Filter by project IDs."),
        user_id: arrayOfIntegers("Return projects accessible by these users."),
        include_rates: { type: "boolean" },
        include_rollover: { type: "boolean" },
        include_idle_recurring_templates: { type: "boolean" },
        include_drafts: { type: "boolean" },
        start_date: { type: "string", description: "Project overlap range start date, YYYY-MM-DD." },
        end_date: { type: "string", description: "Project overlap range end date, YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    handler: listProjects,
  },
  {
    name: "toggl_track_get_project",
    description: "Get a Toggl Track project by ID from the configured workspace.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: jsonSchema.numberId,
      },
      required: ["project_id"],
      additionalProperties: false,
    },
    handler: getProject,
  },
  {
    name: "toggl_track_list_tags",
    description: "List tags in the configured Toggl Track workspace.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 200 },
        search: { type: "string", description: "Search by tag name." },
      },
      additionalProperties: false,
    },
    handler: listTags,
  },
  {
    name: "toggl_track_create_tag",
    description: "Create a tag in the configured Toggl Track workspace. This causes an external side effect.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tag name." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: createTag,
  },
  {
    name: "toggl_track_update_tag",
    description: "Rename a tag in the configured Toggl Track workspace. This causes an external side effect.",
    inputSchema: {
      type: "object",
      properties: {
        tag_id: jsonSchema.numberId,
        name: { type: "string", description: "New tag name." },
      },
      required: ["tag_id", "name"],
      additionalProperties: false,
    },
    handler: updateTag,
  },
  {
    name: "toggl_track_delete_tag",
    description: "Delete a tag from the configured Toggl Track workspace. This causes an external side effect.",
    inputSchema: {
      type: "object",
      properties: {
        tag_id: jsonSchema.numberId,
      },
      required: ["tag_id"],
      additionalProperties: false,
    },
    handler: deleteTag,
  },
  {
    name: "toggl_track_list_time_entries",
    description: "List Toggl Track time entries in the configured workspace for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "Required start date/time filter." },
        date_to: { type: "string", description: "Required end date/time filter." },
        task_id: jsonSchema.numberId,
        status_id: jsonSchema.numberId,
        type: timeEntryTypeSchema(),
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 200 },
        order_by: arrayOfStrings("Sort fields accepted by Toggl Track."),
        archived: { type: "boolean" },
        time_block_id: jsonSchema.numberId,
        include_taskless: {
          type: "boolean",
          description: "Include taskless entries. Defaults to true in this plugin.",
        },
      },
      required: ["date_from", "date_to"],
      additionalProperties: false,
    },
    handler: listTimeEntries,
  },
  {
    name: "toggl_track_get_time_entry",
    description: "Get a Toggl Track time entry by ID. Optionally pass task_id for task-scoped entries.",
    inputSchema: {
      type: "object",
      properties: {
        time_entry_id: jsonSchema.numberId,
        task_id: jsonSchema.numberId,
      },
      required: ["time_entry_id"],
      additionalProperties: false,
    },
    handler: getTimeEntry,
  },
  {
    name: "toggl_track_create_time_entry",
    description: "Create a taskless or task-scoped Toggl time entry. This causes an external side effect and should only run from an approved execution plan.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          ...jsonSchema.numberId,
          description: "When provided, creates the entry under this task. Otherwise creates a taskless entry.",
        },
        type: timeEntryTypeSchema(),
        description: { type: "string" },
        duration: { type: "integer", minimum: 0, description: "Duration in seconds." },
        start: jsonSchema.dateTime,
        stop: jsonSchema.dateTime,
        tracked_at: jsonSchema.dateTime,
        planned_at: jsonSchema.dateTime,
        planned_duration: { type: "integer", minimum: 0, description: "Planned duration in seconds." },
        planned_start: jsonSchema.dateTime,
        project_id: jsonSchema.numberId,
        billable: { type: "boolean" },
        tag_ids: arrayOfIntegers("Tag IDs to attach to the new time entry."),
        tags: arrayOfStrings("Tag names to attach to the new time entry. Toggl may create missing tags automatically."),
        calendar_event_id: jsonSchema.numberId,
        time_block_id: jsonSchema.numberId,
        user_id: jsonSchema.numberId,
      },
      additionalProperties: false,
    },
    handler: createTimeEntry,
  },
  {
    name: "toggl_track_update_time_entry",
    description: "Patch a Toggl time entry. Send only fields that should change. This causes an external side effect and should only run from an approved execution plan.",
    inputSchema: {
      type: "object",
      properties: {
        time_entry_id: jsonSchema.numberId,
        task_id: {
          ...jsonSchema.numberId,
          description: "Optional path task ID for task-scoped entries.",
        },
        type: timeEntryTypeSchema(),
        description: jsonSchema.nullableString,
        duration: { type: "integer", minimum: 0, description: "Duration in seconds." },
        start: { anyOf: [jsonSchema.dateTime, { type: "null" }] },
        stop: { anyOf: [jsonSchema.dateTime, { type: "null" }] },
        tracked_at: { anyOf: [jsonSchema.dateTime, { type: "null" }] },
        planned_at: { anyOf: [jsonSchema.dateTime, { type: "null" }] },
        planned_duration: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        planned_start: { anyOf: [jsonSchema.dateTime, { type: "null" }] },
        project_id: jsonSchema.nullableInteger,
        billable: { type: "boolean" },
        reset_billable_to_default: { type: "boolean" },
        time_block_id: jsonSchema.nullableInteger,
        tag_action: tagActionSchema(),
        tag_ids: arrayOfIntegers("Tag IDs to add or delete. Requires tag_action."),
        tags: arrayOfStrings("Tag names to add or delete. Requires tag_action. Toggl may create missing tags automatically when adding."),
        new_task_id: {
          ...jsonSchema.nullableInteger,
          description: "New task_id payload value. Use null to make taskless if Toggl allows it.",
        },
      },
      required: ["time_entry_id"],
      additionalProperties: false,
    },
    handler: updateTimeEntry,
  },
  {
    name: "toggl_track_update_time_entry_tags",
    description: "Add or delete tags on a Toggl Track time entry. This causes an external side effect.",
    inputSchema: {
      type: "object",
      properties: {
        time_entry_id: jsonSchema.numberId,
        tag_action: tagActionSchema(),
        tag_ids: arrayOfIntegers("Tag IDs to add or delete."),
        tags: arrayOfStrings("Tag names to add or delete. Toggl may create missing tags automatically when adding."),
      },
      required: ["time_entry_id", "tag_action"],
      additionalProperties: false,
    },
    handler: updateTimeEntryTags,
  },
  {
    name: "toggl_track_update_time_entries_tags",
    description: "Add or delete tags on multiple Toggl Track time entries. Applies one request per entry and causes external side effects.",
    inputSchema: {
      type: "object",
      properties: {
        time_entry_ids: {
          type: "array",
          items: jsonSchema.numberId,
          minItems: 1,
          maxItems: 100,
          description: "Time entry IDs to update.",
        },
        tag_action: tagActionSchema(),
        tag_ids: arrayOfIntegers("Tag IDs to add or delete."),
        tags: arrayOfStrings("Tag names to add or delete. Toggl may create missing tags automatically when adding."),
      },
      required: ["time_entry_ids", "tag_action"],
      additionalProperties: false,
    },
    handler: updateTimeEntriesTags,
  },
  {
    name: "toggl_track_archive_time_entry",
    description: "Archive a Toggl Focus time entry. Optionally pass task_id for task-scoped entries. This causes an external side effect.",
    inputSchema: {
      type: "object",
      properties: {
        time_entry_id: jsonSchema.numberId,
        task_id: jsonSchema.numberId,
      },
      required: ["time_entry_id"],
      additionalProperties: false,
    },
    handler: archiveTimeEntry,
  },
  {
    name: "toggl_track_restore_time_entry",
    description: "Restore a Toggl Focus time entry. Optionally pass task_id for task-scoped entries. This causes an external side effect.",
    inputSchema: {
      type: "object",
      properties: {
        time_entry_id: jsonSchema.numberId,
        task_id: jsonSchema.numberId,
      },
      required: ["time_entry_id"],
      additionalProperties: false,
    },
    handler: restoreTimeEntry,
  },
];

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

function startStdioServer() {
  process.stdin.setEncoding("utf8");

  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        handleLine(line);
      }
    }
  });

  process.stdin.on("end", () => {
    const line = buffer.trim();
    if (line) {
      handleLine(line);
    }
  });

  process.on("uncaughtException", (error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });

  process.on("unhandledRejection", (error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

async function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    console.error(`Ignoring invalid JSON-RPC message: ${error.message}`);
    return;
  }

  if (!request || typeof request !== "object") {
    return;
  }

  if (!("id" in request)) {
    if (request.method !== "notifications/initialized") {
      console.error(`Received notification ${request.method || "<unknown>"}`);
    }
    return;
  }

  try {
    const result = await dispatch(request.method, request.params || {});
    send({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: toJsonRpcError(error),
    });
  }
}

export async function dispatch(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      };
    case "tools/call":
      return callTool(params);
    default:
      throw new McpError(-32601, `Method not found: ${method}`);
  }
}

async function callTool(params) {
  const toolName = params?.name;
  const args = params?.arguments || {};
  const tool = toolMap.get(toolName);
  if (!tool) {
    throw new McpError(-32602, `Unknown tool: ${toolName}`);
  }

  try {
    const result = await tool.handler(args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(formatToolError(error), null, 2),
        },
      ],
    };
  }
}

function getConfig() {
  return {
    apiMode: API_MODE,
    baseUrl: BASE_URL,
    organizationId: ORGANIZATION_ID || null,
    workspaceId: WORKSPACE_ID || null,
    hasApiKey: Boolean(API_KEY),
    apiKeyKind: API_KEY.startsWith("toggl_sk_") ? "toggl-2-api-key" : "track-v9-api-token",
  };
}

async function listProjects(args) {
  assertConfigured();

  if (API_MODE === "track-v9") {
    const query = pick(args, TRACK_V9_PROJECT_FILTER_FIELDS);
    if (hasOwn(args, "project_id")) {
      query.project_ids = args.project_id;
    }
    if (hasOwn(args, "client_id")) {
      query.client_ids = args.client_id;
    }
    if (hasOwn(args, "archived")) {
      query.active = !args.archived;
    }

    return togglRequest("GET", trackWorkspacePath("/projects"), { query });
  }

  const query = pick(args, PROJECT_FILTER_FIELDS);
  return togglRequest("GET", workspacePath("/projects"), { query });
}

async function getProject(args) {
  assertConfigured();
  assertPositiveInteger(args.project_id, "project_id");

  if (API_MODE === "track-v9") {
    return togglRequest("GET", trackWorkspacePath(`/projects/${args.project_id}`));
  }

  return togglRequest("GET", workspacePath(`/projects/${args.project_id}`));
}

async function listTags(args) {
  assertConfigured();
  assertTrackV9TagSupport();

  const query = pick(args, TRACK_V9_TAG_FILTER_FIELDS);
  return togglRequest("GET", trackWorkspacePath("/tags"), { query });
}

async function createTag(args) {
  assertConfigured();
  assertTrackV9TagSupport();
  requireNonEmptyString(args.name, "name");

  return togglRequest("POST", trackWorkspacePath("/tags"), { body: { name: args.name } });
}

async function updateTag(args) {
  assertConfigured();
  assertTrackV9TagSupport();
  assertPositiveInteger(args.tag_id, "tag_id");
  requireNonEmptyString(args.name, "name");

  return togglRequest("PUT", trackWorkspacePath(`/tags/${args.tag_id}`), { body: { name: args.name } });
}

async function deleteTag(args) {
  assertConfigured();
  assertTrackV9TagSupport();
  assertPositiveInteger(args.tag_id, "tag_id");

  return togglRequest("DELETE", trackWorkspacePath(`/tags/${args.tag_id}`));
}

async function listTimeEntries(args) {
  assertConfigured();
  requireNonEmptyString(args.date_from, "date_from");
  requireNonEmptyString(args.date_to, "date_to");

  if (API_MODE === "track-v9") {
    const query = {
      start_date: args.date_from,
      end_date: args.date_to,
    };

    const result = await togglRequest("GET", "/me/time_entries", { query });
    return filterTrackV9TimeEntries(result, args);
  }

  const query = pick(args, TIME_ENTRY_LIST_FILTER_FIELDS);
  if (!hasOwn(args, "include_taskless")) {
    query.include_taskless = true;
  }

  return togglRequest("GET", workspacePath("/time-entries"), { query });
}

async function getTimeEntry(args) {
  assertConfigured();
  assertPositiveInteger(args.time_entry_id, "time_entry_id");

  if (API_MODE === "track-v9") {
    return togglRequest("GET", `/me/time_entries/${encodeURIComponent(args.time_entry_id)}`);
  }

  const path = timeEntryPath(args, "");
  return togglRequest("GET", path);
}

async function createTimeEntry(args) {
  assertConfigured();

  if (API_MODE === "track-v9") {
    validateOptionalTagFields(args);

    const body = pick(args, TRACK_V9_TIME_ENTRY_CREATE_FIELDS);
    body.created_with = body.created_with || "codex-toggl-track";
    body.workspace_id = Number(body.workspace_id || WORKSPACE_ID);

    if (hasOwn(args, "time_block_id")) {
      body.time_block_id = args.time_block_id;
    }

    return togglRequest("POST", trackWorkspacePath("/time_entries"), { body });
  }

  requireTimeEntryType(args.type);

  if (hasTagFields(args)) {
    assertTrackV9TagSupport();
  }

  const body = pick(args, TIME_ENTRY_CREATE_FIELDS);
  const path = hasOwn(args, "task_id")
    ? taskTimeEntriesPath(args.task_id)
    : workspacePath("/time-entries");

  return togglRequest("POST", path, { body });
}

async function updateTimeEntry(args) {
  assertConfigured();
  assertPositiveInteger(args.time_entry_id, "time_entry_id");

  if (API_MODE === "track-v9") {
    return updateTrackV9TimeEntryViaPut(args);
  }

  const normalized = { ...args };
  if (hasOwn(normalized, "new_task_id")) {
    normalized.task_id = normalized.new_task_id;
  } else {
    delete normalized.task_id;
  }
  delete normalized.new_task_id;
  delete normalized.time_entry_id;

  if (hasTimeEntryTagMutationFields(normalized)) {
    assertTrackV9TagSupport();
  }

  if (hasOwn(normalized, "type")) {
    requireTimeEntryType(normalized.type);
  }

  const body = pick(normalized, TIME_ENTRY_PATCH_FIELDS);
  if (!Object.keys(body).length) {
    throw new McpError(-32602, "At least one editable field must be provided.");
  }

  const path = timeEntryPath(args, "");
  return togglRequest("PATCH", path, { body });
}

async function updateTimeEntryTags(args) {
  assertConfigured();
  assertTrackV9TagSupport();
  assertPositiveInteger(args.time_entry_id, "time_entry_id");
  requireTagMutation(args);

  return updateTrackV9TimeEntryViaPut(args);
}

async function updateTimeEntriesTags(args) {
  assertConfigured();
  assertTrackV9TagSupport();
  requireTagMutation(args);
  assertArrayOfPositiveIntegers(args.time_entry_ids, "time_entry_ids");

  const success = [];
  const failure = [];
  for (const timeEntryId of args.time_entry_ids) {
    try {
      await updateTrackV9TimeEntryViaPut({
        time_entry_id: timeEntryId,
        tag_action: args.tag_action,
        tag_ids: args.tag_ids,
        tags: args.tags,
      });
      success.push(timeEntryId);
    } catch (error) {
      failure.push({
        id: timeEntryId,
        message: error?.message || String(error),
        ...(error instanceof TogglApiError ? { status: error.status, body: error.body } : {}),
      });
    }
  }

  return { success, failure };
}

async function archiveTimeEntry(args) {
  assertConfigured();
  assertPositiveInteger(args.time_entry_id, "time_entry_id");

  if (API_MODE === "track-v9") {
    throw new McpError(-32602, "Archiving/restoring time entries is not available in Toggl Track v9. Delete is intentionally not exposed by this plugin.");
  }

  return togglRequest("POST", timeEntryPath(args, "/archive"));
}

async function restoreTimeEntry(args) {
  assertConfigured();
  assertPositiveInteger(args.time_entry_id, "time_entry_id");

  if (API_MODE === "track-v9") {
    throw new McpError(-32602, "Archiving/restoring time entries is not available in Toggl Track v9.");
  }

  return togglRequest("PATCH", timeEntryPath(args, "/restore"));
}

async function togglRequest(method, apiPath, options = {}) {
  const url = new URL(BASE_URL + apiPath);
  appendQuery(url, options.query || {});

  const headers = {
    Accept: "application/json",
  };

  if (API_MODE === "track-v9") {
    headers.Authorization = `Basic ${Buffer.from(`${API_KEY}:api_token`, "utf8").toString("base64")}`;
  } else {
    headers.Authorization = `Bearer ${API_KEY}`;
  }

  const requestOptions = {
    method,
    headers,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, requestOptions);
  const responseText = await response.text();
  const parsed = parseJsonMaybe(responseText);

  if (!response.ok) {
    throw new TogglApiError(response, parsed ?? responseText);
  }

  if (response.status === 204 || responseText.length === 0) {
    return {
      ok: true,
      status: response.status,
    };
  }

  return parsed ?? responseText;
}

function workspacePath(suffix) {
  return `/organizations/${encodeURIComponent(ORGANIZATION_ID)}/workspaces/${encodeURIComponent(WORKSPACE_ID)}${suffix}`;
}

function trackWorkspacePath(suffix) {
  return `/workspaces/${encodeURIComponent(WORKSPACE_ID)}${suffix}`;
}

function taskTimeEntriesPath(taskId) {
  assertPositiveInteger(taskId, "task_id");
  return workspacePath(`/tasks/${encodeURIComponent(taskId)}/time-entries`);
}

function timeEntryPath(args, suffix) {
  const timeEntryId = encodeURIComponent(args.time_entry_id);
  if (hasOwn(args, "task_id") && args.task_id !== undefined && args.task_id !== null) {
    return `${taskTimeEntriesPath(args.task_id)}/${timeEntryId}${suffix}`;
  }

  return workspacePath(`/time-entries/${timeEntryId}${suffix}`);
}

function appendQuery(url, query) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }

    url.searchParams.append(key, String(value));
  }
}

function pick(source, fields) {
  const result = {};
  for (const field of fields) {
    if (hasOwn(source, field) && source[field] !== undefined) {
      result[field] = source[field];
    }
  }
  return result;
}

function resolveApiMode() {
  if (REQUESTED_API_MODE === "focus" || REQUESTED_API_MODE === "toggl-2") {
    return "focus";
  }

  if (REQUESTED_API_MODE === "track-v9" || REQUESTED_API_MODE === "track") {
    return "track-v9";
  }

  return API_KEY.startsWith("toggl_sk_") ? "focus" : "track-v9";
}

function resolveBaseUrl() {
  if (API_MODE === "track-v9") {
    if (!CONFIGURED_BASE_URL || CONFIGURED_BASE_URL === DEFAULT_FOCUS_BASE_URL) {
      return DEFAULT_TRACK_V9_BASE_URL;
    }

    return CONFIGURED_BASE_URL;
  }

  return CONFIGURED_BASE_URL || DEFAULT_FOCUS_BASE_URL;
}

function filterTrackV9TimeEntries(entries, args) {
  if (!Array.isArray(entries)) {
    return entries;
  }

  return entries.filter((entry) => {
    if (hasOwn(args, "task_id") && entry.task_id !== args.task_id && entry.tid !== args.task_id) {
      return false;
    }

    if (hasOwn(args, "include_taskless") && args.include_taskless === false && !entry.task_id && !entry.tid) {
      return false;
    }

    return true;
  });
}

function updateTrackV9TimeEntryViaPut(args) {
  const normalized = { ...args };
  if (hasOwn(normalized, "new_task_id")) {
    normalized.task_id = normalized.new_task_id;
  }

  if (hasOwn(normalized, "tag_action") || hasOwn(normalized, "tag_ids") || hasOwn(normalized, "tags")) {
    requireTagMutation(normalized);
  }

  const body = pick(normalized, TRACK_V9_TIME_ENTRY_PUT_FIELDS);
  body.workspace_id = Number(body.workspace_id || WORKSPACE_ID);

  if (!Object.keys(body).some((field) => field !== "workspace_id")) {
    throw new McpError(-32602, "At least one editable field must be provided.");
  }

  return togglRequest("PUT", trackWorkspacePath(`/time_entries/${normalized.time_entry_id}`), { body });
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasTagFields(args) {
  return hasOwn(args, "tag_ids") || hasOwn(args, "tags");
}

function hasTimeEntryTagMutationFields(args) {
  return hasOwn(args, "tag_action") || hasTagFields(args);
}

function assertConfigured() {
  if (!API_KEY) {
    throw new McpError(-32000, "TOGGL_TRACK_API_KEY is not configured.");
  }
  if (!WORKSPACE_ID) {
    throw new McpError(-32000, "TOGGL_TRACK_WORKSPACE_ID must be configured.");
  }
  if (API_MODE === "focus" && !ORGANIZATION_ID) {
    throw new McpError(-32000, "TOGGL_TRACK_ORGANIZATION_ID must be configured for Toggl Focus.");
  }
}

function assertTrackV9TagSupport() {
  if (API_MODE !== "track-v9") {
    throw new McpError(-32602, "Tag tools are currently implemented for Toggl Track API v9 only.");
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new McpError(-32602, `${name} must be a positive integer.`);
  }
}

function assertArrayOfPositiveIntegers(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new McpError(-32602, `${name} must be a non-empty array.`);
  }

  for (const item of value) {
    assertPositiveInteger(item, name);
  }
}

function assertArrayOfNonEmptyStrings(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new McpError(-32602, `${name} must be a non-empty array.`);
  }

  for (const item of value) {
    requireNonEmptyString(item, name);
  }
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpError(-32602, `${name} must be a non-empty string.`);
  }
}

function requireTagAction(value) {
  if (value !== "add" && value !== "delete") {
    throw new McpError(-32602, 'tag_action must be either "add" or "delete".');
  }
}

function requireTagMutation(args) {
  requireTagAction(args.tag_action);

  const hasTagIds = hasOwn(args, "tag_ids") && args.tag_ids !== undefined && args.tag_ids !== null;
  const hasTags = hasOwn(args, "tags") && args.tags !== undefined && args.tags !== null;
  if (!hasTagIds && !hasTags) {
    throw new McpError(-32602, "Provide at least one of tag_ids or tags.");
  }

  if (hasTagIds) {
    assertArrayOfPositiveIntegers(args.tag_ids, "tag_ids");
  }
  if (hasTags) {
    assertArrayOfNonEmptyStrings(args.tags, "tags");
  }
}

function validateOptionalTagFields(args) {
  if (hasOwn(args, "tag_ids") && args.tag_ids !== undefined && args.tag_ids !== null) {
    assertArrayOfPositiveIntegers(args.tag_ids, "tag_ids");
  }
  if (hasOwn(args, "tags") && args.tags !== undefined && args.tags !== null) {
    assertArrayOfNonEmptyStrings(args.tags, "tags");
  }
}

function requireTimeEntryType(value) {
  if (value !== "activity" && value !== "break") {
    throw new McpError(-32602, "type must be either 'activity' or 'break'.");
  }
}

function arrayOfStrings(description) {
  return {
    type: "array",
    items: { type: "string" },
    description,
  };
}

function arrayOfIntegers(description) {
  return {
    type: "array",
    items: { type: "integer" },
    description,
  };
}

function timeEntryTypeSchema() {
  return {
    type: "string",
    enum: ["activity", "break"],
  };
}

function tagActionSchema() {
  return {
    type: "string",
    enum: ["add", "delete"],
    description: 'Use "add" to attach tags or "delete" to remove them.',
  };
}

function parseJsonMaybe(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toJsonRpcError(error) {
  if (error instanceof McpError) {
    return {
      code: error.code,
      message: error.message,
      data: error.data,
    };
  }

  return {
    code: -32603,
    message: error?.message || "Internal server error",
  };
}

function formatToolError(error) {
  if (error instanceof TogglApiError) {
    return {
      error: "Toggl API request failed",
      status: error.status,
      statusText: error.statusText,
      quotaRemaining: error.quotaRemaining,
      quotaResetsIn: error.quotaResetsIn,
      body: error.body,
    };
  }

  return {
    error: error?.message || String(error),
  };
}

class McpError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

class TogglApiError extends Error {
  constructor(response, body) {
    super(`Toggl API ${response.status} ${response.statusText}`);
    this.name = "TogglApiError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.quotaRemaining = response.headers.get("x-toggl-quota-remaining");
    this.quotaResetsIn = response.headers.get("x-toggl-quota-resets-in");
    this.body = body;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startStdioServer();
}
