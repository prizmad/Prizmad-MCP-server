# Security Policy

## Reporting a vulnerability

If you have found a security issue with the Prizmad MCP server, the remote endpoint at `https://prizmad.com/api/mcp`, the OAuth implementation, or any other Prizmad surface — please **do not** open a public GitHub issue. Email **<security@prizmad.com>** instead.

We try to acknowledge reports within 48 hours and ship fixes as quickly as the severity warrants.

## In scope

- The remote MCP server (`prizmad.com/api/mcp`) and its tools.
- The OAuth 2.1 endpoints (`/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/consent`) and well-known metadata.
- The npm-published stdio bridge (`@prizmad/mcp-server`) and source in this repository.
- The REST API at `/api/v1/*`.

## Out of scope

- Issues caused by deliberately misusing your own account (e.g. burning tokens by repeatedly calling `create_video`).
- Rate-limit responses from upstream providers.
- Findings that require physical access to the machine running the stdio bridge.

## Bug bounty

We do not currently run a formal bug bounty, but we recognise good reports publicly (with the reporter's permission) and prioritise security issues over feature work.
