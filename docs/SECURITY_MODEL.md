# VITROS Security Model

## Client-Safe vs Server-Only Configuration

### Client-Safe (VITE_ prefix — bundled into browser)
| Variable | Purpose |
|---|---|
| `VITE_CONVEX_URL` | Convex deployment URL |
| `VITE_SUPABASE_URL` | Supabase project URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous/public key (RLS-protected) |
| `VITE_IS_PREVIEW` | Preview mode flag |

### Server-Only (no VITE_ prefix — never in browser)
| Variable | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Full admin access to Supabase — bypasses RLS |
| `OPENAI_API_KEY` | Private OpenAI API key for OCR/AI |
| `AUTH_PRIVATE_KEY` | Convex auth RSA key |
| `JWT_PRIVATE_KEY` | Convex JWT signing key |
| `CONVEX_DEPLOY_KEY` | Convex deployment key |

## Architecture

### Data Flow
```
Browser → Convex SDK → Convex Server → Supabase REST API (service_role)
                                     → OpenAI API (private key)
```

### Authentication
- Convex Auth (`@convex-dev/auth`) with Password provider
- Auth tokens passed automatically via Convex SDK
- `getAuthUserId(ctx)` validates identity server-side

### Authorization
- Server-side capability checks via `convex/authGuard.ts`
- Roles: `superuser`, `engineer`, `viewer`
- Capabilities: `inventory.read`, `inventory.write`, `inventory.admin`, `ai.ocr`, `rem.read`, `rem.write`
- All privileged mutations require authenticated identity + capability check

### Supabase Access Pattern
- **Reads**: Browser uses anon key (RLS-protected) or Convex raw HTTP for Convex-native data
- **Writes**: Browser calls Convex actions → server uses service_role key
- Service role key is never exposed to browser code

### AI/OCR Access Pattern
- Browser sends image data to Convex action
- Convex server calls OpenAI API with private key
- Sanitized errors returned to browser
- Image size/type limits enforced server-side

## Remaining Gaps Before Production

1. **RLS policies** must be verified/enforced on Supabase tables — current anon-key reads assume RLS is appropriately configured
2. **Credential rotation** — Supabase service_role key and OpenAI key should be rotated after merge
3. **Rate limiting** — No rate limiting on Convex actions yet
4. **Audit logging** — Server-side audit trail for authorization decisions not yet implemented
5. **Session management** — Convex Auth sessions should be configured with appropriate expiry
