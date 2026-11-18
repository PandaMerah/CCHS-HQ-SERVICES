# HQ Meeting Rooms Persistence Root-Cause & Fix Report (R2)

## 1. Root Cause Summary

Edited HQ meeting room names and details previously reverted back to the 5-room default template (`HQ Main Boardroom`, `Discussion Room A (CareHub)`, `Discussion Room B (Clinical)`, `Townhall & Training Suite`, `Focus Pod 1 (Telehealth / PMI)`) after a `git` update and server restart due to **four compounding faults**:

1. **Runtime mutations written directly into git-tracked `CCHSMeetingDashboard/data.json` (`api/data.js`):**
   - `SEED_FILE` pointed to `path.join(process.cwd(), 'CCHSMeetingDashboard', 'data.json')`, which is tracked in Git with the 5 default rooms.
   - `writeState()` previously executed `fs.writeFileSync(SEED_FILE, ...)` on every mutation. Any `git pull` / `git checkout` / `git reset` or fresh deployment overwrote `CCHSMeetingDashboard/data.json` back to the tracked 5-room template.
2. **Volatile / stale `os.tmpdir()/cchs_hq_state.json` caching (`api/data.js`):**
   - `readState()` checked `os.tmpdir()/cchs_hq_state.json` before `SEED_FILE`. On ephemeral serverless deployments (Vercel `/tmp`), cold starts lost `/tmp` and fell back to git-tracked `SEED_FILE`; locally, a stale `cchs_hq_state.json` in `os.tmpdir()` retained the 5 default rooms and masked updates across runs.
3. **No cold-start hydration from Firebase Realtime Database (`api/data.js`):**
   - While `api/data.js` mirrored outbound writes to Firebase RTDB (`PUT /rooms.json`), `readState()` never fetched `/rooms.json`, `/bookings.json`, `/config.json`, `/departments.json`, `/remoteDisplay.json`, or `/history.json` on cold start. Live Firebase RTDB already held customized rooms (`Vision Room`, `Empower Room`, `Impact Room`, `Inspire Room`), which were ignored when the server started without local state.
4. **Unversioned client polling & full-state overwrites (`public/shared/cloud-store.js` & `api/data.js`):**
   - `cloud-store.js` polled `GET /api/data` every 1500ms and only protected local room edits for 5 seconds (`lastLocalMutationAt`), after which stale server seed rooms could overwrite customized rooms.
   - Unrelated meeting actions (`submitDepartmentUpdate`, `saveAdminConfig`, `resetMeetingSession`, `resetToInitialSeed`) called `saveFullState()`, posting the entire client state (including `rooms` and `bookings`) to `POST /api/data` and attempting `set(ref(db, "/"), currentState)`.

---

## 2. Verified Environment Evidence

- **Git-tracked seed template:** `CCHSMeetingDashboard/data.json` contains the 5 default rooms (`boardroom-main`, `discussion-a`, `discussion-b`, `townhall-hub`, `pod-telehealth`).
- **Live Firebase RTDB accessibility:** Direct `GET` requests return `HTTP 401 Permission denied` for `/.json` and `/roomsMeta.json`, while node-level endpoints (`/rooms.json`, `/bookings.json`, `/config.json`, `/departments.json`, `/remoteDisplay.json`, `/history.json`) return `HTTP 200` with live data.
- **Static & server routing (`server.js`, `vercel.json`):** `server.js` serves static assets exclusively from `public/`, so `<repo_root>/data/runtime-state.json` is never exposed over HTTP.

---

## 3. Implemented Persistence Architecture

### 3.1 Decoupled Git-Ignored Runtime Store (`.gitignore`, `api/data.js`)
- `CCHSMeetingDashboard/data.json` (`SEED_FILE`) is now **strictly read-only** and used solely as a last-resort initial fallback template.
- `.gitignore` excludes `data/` and `data/runtime-state.json`.
- `api/data.js` resolves the runtime persistence file from `process.env.CCHS_RUNTIME_STATE_PATH` or `<cwd>/data/runtime-state.json`, writing atomically via temporary file + rename (`writeAtomicFile`), and **only** falling back to `path.join(os.tmpdir(), 'cchs_hq_runtime_state.json')` when the filesystem is read-only (`EROFS` / `EACCES` / `EPERM`, such as Vercel's `/var/task`). Legacy `os.tmpdir()/cchs_hq_state.json` is no longer read or written.

### 3.2 Concurrent-Safe Firebase RTDB Cold-Start Hydration (`api/data.js`)
- When no runtime state file exists yet on disk (and `CCHS_DISABLE_FIREBASE_HYDRATION !== '1'` and `FIREBASE_DATABASE_URL !== 'disabled'`), `readStateAsync()` deduplicates concurrent cold starts via `hydrationPromise` and fetches `/rooms.json`, `/bookings.json`, `/config.json`, `/departments.json`, `/remoteDisplay.json`, and `/history.json` in parallel with a strict **2500ms** per-request timeout.
- Hydrated Firebase rooms receive `roomsUpdatedAt = maxRoomTs || 1` and `roomsMeta = { updatedAt, source: 'firebase' }`, outranking seed rooms (`0`).

### 3.3 Monotonic `roomsUpdatedAt` / `roomsMeta` & Targeted Payloads (`api/data.js`, `public/shared/cloud-store.js`)
- Because Firebase RTDB rules reject arbitrary new top-level nodes like `/roomsMeta.json` (`401`), `saveMeetingRooms()` stamps each room inside `/rooms` with `updatedAt: now` and tracks `roomsUpdatedAt` / `roomsMeta` in runtime state and `localStorage`.
- `SAVE_ROOMS` (admin-authenticated) stamps `roomsUpdatedAt = Math.max(Date.now(), payload.roomsUpdatedAt || 0, (current.roomsUpdatedAt || 0) + 1)` and `roomsMeta = { updatedAt, source: 'admin' }`.
- `mergeIncomingState()` and `onValue(roomsRef)` in `cloud-store.js` reject stale snapshots with lower `roomsUpdatedAt` and never push `localRoomsTs === 0` seed rooms back to Firebase.
- `submitDepartmentUpdate`, `saveAdminConfig`, `resetMeetingSession`, and `resetToInitialSeed` now use targeted atomic actions (`SUBMIT_DEPARTMENT_UPDATE`, `SAVE_ADMIN_CONFIG`, `RESET_MEETING_SESSION`, `RESET_TO_INITIAL_SEED`) and targeted Firebase node writes (`config`, `departments`, `history`), never overwriting `rooms` or `bookings`.
- Fallback full-state `POST /api/data` rejects unauthenticated writes to `rooms` / `bookings` / `config` / `remoteDisplay` and protects `current.rooms` unless `incomingRoomsTs > existingRoomsTs`.

---

## 4. Verification Procedure

1. Start the server (`node server.js`) and authenticate via `/api/auth` to obtain an admin Bearer token.
2. Save custom rooms via `POST /api/data` (`__action: "SAVE_ROOMS"`).
3. Verify `CCHSMeetingDashboard/data.json` remains byte-for-byte unmodified (`git diff -- CCHSMeetingDashboard/data.json` is empty) while `data/runtime-state.json` (or `CCHS_RUNTIME_STATE_PATH`) contains the custom rooms with `roomsMeta.source === "admin"`.
4. Simulate a `git` update by touching/restoring `CCHSMeetingDashboard/data.json` and restarting the server (`node server.js`).
5. Fetch `GET /api/data`, perform `SUBMIT_DEPARTMENT_UPDATE` and `SAVE_ADMIN_CONFIG`, and verify the custom room names, floors, capacities, and amenities persist intact.
