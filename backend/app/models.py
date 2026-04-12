from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class Song:
    title: str
    artist: str
    duration: str
    pitch: float = 1.0
    audio_url: str = ""


class Node:
    def __init__(self, song: Song) -> None:
        self.song = song
        self.next: Optional[Node] = None
        self.prev: Optional[Node] = None
