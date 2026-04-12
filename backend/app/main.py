from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import Song
from .playlist import DoublyLinkedPlaylist
from .schemas import PitchChange, PlaylistState, SongCreate, SongResponse, SortRequest


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


def seed_real_tracks() -> None:
    if playlist.size > 0:
        return
    initial = [
        Song(
            title="Nocturne Op. 9 No. 2",
            artist="Frederic Chopin",
            duration="04:38",
            pitch=1.0,
            audio_url="https://upload.wikimedia.org/wikipedia/commons/4/45/Fr%C3%A9d%C3%A9ric_Chopin_-_Nocturne_Op._9_No._2.ogg",
        ),
        Song(
            title="Fur Elise",
            artist="Ludwig van Beethoven",
            duration="02:53",
            pitch=1.0,
            audio_url="https://upload.wikimedia.org/wikipedia/commons/7/7b/Fur_Elise.ogg",
        ),
        Song(
            title="Eine kleine Nachtmusik",
            artist="Wolfgang Amadeus Mozart",
            duration="05:35",
            pitch=1.0,
            audio_url="https://upload.wikimedia.org/wikipedia/commons/4/47/Eine_Kleine_Nachtmusik_%28by_Karajan%29.ogg",
        ),
    ]
    for song in initial:
        playlist.insert_end(song)


@app.on_event("startup")
def on_startup() -> None:
    seed_real_tracks()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/playlist", response_model=PlaylistState)
def list_playlist() -> PlaylistState:
    return get_state()


@app.post("/playlist/start", response_model=PlaylistState)
def add_song_start(payload: SongCreate) -> PlaylistState:
    playlist.insert_start(Song(**payload.model_dump()))
    return get_state()


@app.post("/playlist/end", response_model=PlaylistState)
def add_song_end(payload: SongCreate) -> PlaylistState:
    playlist.insert_end(Song(**payload.model_dump()))
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
def download_current() -> dict[str, str]:
    return {"message": playlist.download_current()}
