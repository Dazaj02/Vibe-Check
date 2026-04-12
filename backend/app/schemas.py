from pydantic import BaseModel, Field


class SongCreate(BaseModel):
    title: str = Field(min_length=1)
    artist: str = Field(min_length=1)
    duration: str = Field(pattern=r"^\d{1,2}:\d{2}$")
    pitch: float = Field(default=1.0, ge=0.5, le=2.0)
    audio_url: str = Field(min_length=1)


class SongResponse(BaseModel):
    title: str
    artist: str
    duration: str
    pitch: float
    audio_url: str


class PlaylistState(BaseModel):
    songs: list[SongResponse]
    current: SongResponse | None


class PitchChange(BaseModel):
    delta: float


class SortRequest(BaseModel):
    by: str
