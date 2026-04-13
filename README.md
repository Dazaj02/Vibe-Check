# Doubly Linked Music Player

Full-stack project in English with a Python backend and a React + TypeScript frontend. The player is powered by a doubly linked list and includes real audio playback, pitch modulation, and a full-page reactive audio visualizer background.

## Project Structure

- `backend/`: FastAPI API with the doubly linked list implementation.
- `frontend/`: React + TypeScript UI.
- `render.yaml`: deployment blueprint for Render.

## Data Structure (OOP)

### `Song`

Attributes:

- `title`
- `artist`
- `duration`
- `pitch`
- `audio_url`

### `Node`

Each node stores:

- `song: Song`
- `next: Node | None`
- `prev: Node | None`

### `DoublyLinkedPlaylist`

Internal pointers:

- `head`
- `tail`
- `current` (currently playing song)
- `size`

Implemented operations:

- `insert_start`
- `insert_end`
- `remove_by_title`
- `find`
- `sort_by`
- `next_song`
- `previous_song`
- `modulate_current_pitch`
- `reset_current_pitch`
- `download_current`

## Why Doubly Linked Pointers Matter

With a doubly linked list, each node has direct access to both neighbors.

- Moving forward is `current = current.next`
- Moving backward is `current = current.prev`

This makes backward navigation constant-time from the current position. In a singly linked list, moving backward typically requires scanning again from the head to find the previous node.

## Frontend + Structure Integration

The backend list is the source of truth. Every UI action calls an API endpoint that mutates the linked list, then returns the new playlist state.

- UI buttons call list operations (`next`, `previous`, insert, delete, sort, pitch).
- The frontend re-renders `current` and all songs based on API state.
- The app uses the active audio stream with `AnalyserNode` and paints a live canvas background that pulses with track frequency data.

## M3U Import Support

The backend starts with an empty playlist. You can import tracks from an M3U playlist using:

- `POST /playlist/import-m3u`

Request body:

```json
{
  "content": "#EXTM3U\n#EXTINF:245,Artist - Song Title\nhttps://example.com/song.mp3",
  "insert_at_start": false,
  "clear_existing": true
}
```

Behavior:

- Parses `#EXTINF` metadata when available.
- Uses URL as fallback title if metadata is missing.
- Can replace the full playlist (`clear_existing: true`) or append.

## Reliable Playback for Any Song URL

The backend exposes `GET /stream?url=<encoded_source>` and the frontend plays through this endpoint.

Why this helps:

- Reduces browser CORS playback failures for remote audio hosts.
- Keeps one consistent audio origin from your backend/frontend domain.
- Works for direct links in M3U and manual track insertion.

Recommendation for "any song":

- Prefer direct audio links (`.mp3`, `.ogg`, `.wav`, `.m4a`) over pages.
- Import from M3U playlists that already contain streamable media URLs.
- If a source blocks server-side fetches, use legally accessible providers/APIs.

## Run Locally

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend proxies `/api` to `http://localhost:8000`.

## Branches and Deploy Targets

- `backend` branch: FastAPI API for Render deployment.
- `frontend` branch: React app for Vercel deployment.

## Backend Deployment (Render)

Use folder `backend/` with these settings:

- Runtime: Python
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Optional files already included:

- `backend/Procfile`
- `backend/runtime.txt`

## Frontend Deployment (Vercel)

Use folder `frontend/` with these settings:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Root directory: `frontend`

Set this environment variable in Vercel:

- `VITE_API_URL=https://<your-render-backend>.onrender.com`

`frontend/vercel.json` is included for SPA rewrite routing.

## End-to-End Manual Test Steps

1. Start backend locally:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

2. In another terminal, start frontend:

```bash
cd frontend
npm install
npm run dev
```

3. Open the Vite URL and verify:

- Use the `Import M3U` section to load songs.
- `Play` starts audio.
- Background visualizer glows and reacts to rhythm.
- `Next` and `Previous` update current song and pointer labels.
- `Pitch +` / `Pitch -` change playback speed and API pitch state.
- `Sort by Title` and `Sort by Artist` reorder the list.
- `Remove` deletes selected song safely.
- `Download Current` returns packaging message.

4. API verification (optional):

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/playlist`
