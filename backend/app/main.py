from __future__ import annotations

import re
import base64
import io
from urllib.parse import quote, unquote

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from mutagen import File as MutagenFile

from .models import Song
from .playlist import DoublyLinkedPlaylist
from .schemas import M3UImportRequest, PitchChange, PlaylistState, SongCreate, SongResponse, SortRequest


app = FastAPI(title="Doubly Linked Music Player API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

playlist = DoublyLinkedPlaylist()


def to_response(song: Song) -> SongResponse:
    return SongResponse(
        title=song.title,
        artist=song.artist,
        duration=song.duration,
        pitch=song.pitch,
        audio_url=song.audio_url,
    )


def get_state() -> PlaylistState:
    songs = [to_response(song) for song in playlist.to_songs()]
    current = to_response(playlist.current.song) if playlist.current is not None else None
    return PlaylistState(songs=songs, current=current)


def proxied_url(url: str) -> str:
    if url.startswith("/stream?url="):
        return url
    return f"/stream?url={quote(url, safe='')}"


def parse_m3u_content(content: str) -> list[Song]:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    songs: list[Song] = []
    pending_meta: tuple[int | None, str, str] | None = None

    for line in lines:
        if line.startswith("#EXTM3U"):
            continue

        if line.startswith("#EXTINF:"):
            metadata = line[len("#EXTINF:") :]
            duration_value: int | None = None
            title = "Unknown Title"
            artist = "Unknown Artist"

            if "," in metadata:
                left, right = metadata.split(",", 1)
                duration_text = left.strip()
                if re.fullmatch(r"-?\d+", duration_text):
                    parsed_duration = int(duration_text)
                    duration_value = parsed_duration if parsed_duration >= 0 else None

                display = right.strip()
                if " - " in display:
                    artist, title = [value.strip() for value in display.split(" - ", 1)]
                else:
                    title = display

            pending_meta = (duration_value, artist, title)
            continue

        if line.startswith("#"):
            continue

        audio_url = line
        duration = "00:00"
        artist = "Unknown Artist"
        title = audio_url.rsplit("/", 1)[-1]

        if pending_meta is not None:
            seconds, artist, title = pending_meta
            if seconds is not None:
                duration = f"{seconds // 60:02d}:{seconds % 60:02d}"
            pending_meta = None

        songs.append(
            Song(
                title=title,
                artist=artist,
                duration=duration,
                pitch=1.0,
                audio_url=proxied_url(audio_url),
            )
        )

    return songs


def clear_playlist() -> None:
    playlist.head = None
    playlist.tail = None
    playlist.current = None
    playlist.size = 0


@app.on_event("startup")
def on_startup() -> None:
    return


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/playlist", response_model=PlaylistState)
def list_playlist() -> PlaylistState:
    return get_state()


@app.post("/playlist/start", response_model=PlaylistState)
def add_song_start(payload: SongCreate) -> PlaylistState:
    song_data = payload.model_dump()
    song_data["audio_url"] = proxied_url(song_data["audio_url"])
    playlist.insert_start(Song(**song_data))
    return get_state()


@app.post("/playlist/end", response_model=PlaylistState)
def add_song_end(payload: SongCreate) -> PlaylistState:
    song_data = payload.model_dump()
    song_data["audio_url"] = proxied_url(song_data["audio_url"])
    playlist.insert_end(Song(**song_data))
    return get_state()


@app.post("/playlist/import-m3u", response_model=PlaylistState)
def import_m3u(payload: M3UImportRequest) -> PlaylistState:
    songs = parse_m3u_content(payload.content)
    if not songs:
        raise HTTPException(status_code=400, detail="No playable entries found in M3U content")

    if payload.clear_existing:
        clear_playlist()

    if payload.insert_at_start:
        for song in reversed(songs):
            playlist.insert_start(song)
    else:
        for song in songs:
            playlist.insert_end(song)

    return get_state()


@app.get("/stream")
async def stream_audio(url: str, request: Request):
    decoded_url = unquote(url)
    if not decoded_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Only http/https audio URLs are supported")

    client = httpx.AsyncClient(follow_redirects=True, timeout=60.0)
    outbound_headers: dict[str, str] = {}
    range_header = request.headers.get("range")
    if range_header:
        outbound_headers["Range"] = range_header

    try:
        upstream_request = client.build_request("GET", decoded_url, headers=outbound_headers)
        upstream_response = await client.send(upstream_request, stream=True)
        upstream_response.raise_for_status()
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Audio fetch failed: {exc}") from exc

    passthrough_headers: dict[str, str] = {}
    for header_name in ("content-type", "content-length", "accept-ranges", "content-range", "cache-control"):
        header_value = upstream_response.headers.get(header_name)
        if header_value:
            passthrough_headers[header_name] = header_value

    return StreamingResponse(
        upstream_response.aiter_bytes(),
        status_code=upstream_response.status_code,
        headers=passthrough_headers,
        media_type=upstream_response.headers.get("content-type", "audio/mpeg"),
        background=BackgroundTask(client.aclose),
    )


@app.post("/playlist/upload-local", response_model=PlaylistState)
async def upload_local_files(files: list[UploadFile] = File(...)) -> PlaylistState:
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    
    for file in files:
        if not file.filename or not file.content_type or not file.content_type.startswith("audio/"):
            continue
        
        # Read file content
        contents = await file.read()
        if not contents:
            continue
        
        # Extract metadata
        title = file.filename.rsplit(".", 1)[0]
        artist = "Local Upload"
        duration = "00:00"
        
        try:
            file_bytes = io.BytesIO(contents)
            audio_file = MutagenFile(file_bytes)
            if audio_file is not None and audio_file.info is not None:
                duration_seconds = int(audio_file.info.length)
                duration = f"{duration_seconds // 60:02d}:{duration_seconds % 60:02d}"
                
                # Try to extract title and artist from metadata
                if audio_file.tags:
                    if isinstance(audio_file.tags, dict):
                        title_list = audio_file.tags.get("title", [file.filename.rsplit(".", 1)[0]])
                        artist_list = audio_file.tags.get("artist", ["Local Upload"])
                        title = title_list[0] if title_list else title
                        artist = artist_list[0] if artist_list else artist
        except Exception:
            # If metadata extraction fails, use defaults
            pass
        
        # Create data URL from file content
        file_data_url = f"data:audio/{file.content_type.split('/')[-1]};base64,{base64.b64encode(contents).decode()}"
        
        # Add song to playlist
        song = Song(
            title=title,
            artist=artist,
            duration=duration,
            pitch=1.0,
            audio_url=file_data_url,
        )
        playlist.insert_end(song)
    
    return get_state()


@app.delete("/playlist/{title}", response_model=PlaylistState)
def delete_song(title: str) -> PlaylistState:
    removed = playlist.remove_by_title(title)
    if removed is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return get_state()


@app.post("/playlist/sort", response_model=PlaylistState)
def sort_playlist(payload: SortRequest) -> PlaylistState:
    valid = {"title", "artist"}
    key_name = payload.by.lower()
    if key_name not in valid:
        raise HTTPException(status_code=400, detail="Sort key must be 'title' or 'artist'")
    playlist.sort_by(lambda song: getattr(song, key_name))
    return get_state()


@app.post("/player/next", response_model=PlaylistState)
def go_next() -> PlaylistState:
    playlist.next_song()
    return get_state()


@app.post("/player/previous", response_model=PlaylistState)
def go_previous() -> PlaylistState:
    playlist.previous_song()
    return get_state()


@app.post("/player/select/{title}", response_model=PlaylistState)
def select_current(title: str) -> PlaylistState:
    node = playlist.find(title)
    if node is None:
        raise HTTPException(status_code=404, detail="Song not found")
    playlist.current = node
    return get_state()


@app.post("/player/pitch", response_model=PlaylistState)
def change_pitch(payload: PitchChange) -> PlaylistState:
    updated = playlist.modulate_current_pitch(payload.delta)
    if updated is None:
        raise HTTPException(status_code=400, detail="No current song")
    return get_state()


@app.post("/player/pitch/reset", response_model=PlaylistState)
def reset_pitch() -> PlaylistState:
    updated = playlist.reset_current_pitch()
    if updated is None:
        raise HTTPException(status_code=400, detail="No current song")
    return get_state()


@app.get("/player/download")
async def download_current(request: Request):
    if playlist.current is None:
        raise HTTPException(status_code=404, detail="No song available to download.")
    
    song = playlist.current.song
    audio_url = song.audio_url
    
    # Validate that the URL is properly formatted
    if not audio_url.startswith(('http://', 'https://')):
        raise HTTPException(status_code=400, detail="Invalid audio URL format.")
    
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream('GET', audio_url, follow_redirects=True) as response:
                if response.status_code != 200:
                    raise HTTPException(status_code=response.status_code, detail="Failed to fetch audio from source.")
                
                # Create a filename from the song
                safe_title = re.sub(r'[^\w\s-]', '', song.title).strip()
                safe_artist = re.sub(r'[^\w\s-]', '', song.artist).strip()
                filename = f"{safe_artist}_{safe_title}.mp3"
                
                return StreamingResponse(
                    response.aiter_bytes(),
                    media_type="audio/mpeg",
                    headers={"Content-Disposition": f"attachment; filename={filename}"}
                )
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Failed to download audio: {str(e)}")
