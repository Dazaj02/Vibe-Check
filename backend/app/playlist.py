from __future__ import annotations

from typing import Callable, List, Optional

from .models import Node, Song


class DoublyLinkedPlaylist:
    def __init__(self) -> None:
        self.head: Optional[Node] = None
        self.tail: Optional[Node] = None
        self.current: Optional[Node] = None
        self.size: int = 0

    def insert_start(self, song: Song) -> Node:
        new_node = Node(song)
        if self.head is None:
            self.head = new_node
            self.tail = new_node
            self.current = new_node
        else:
            new_node.next = self.head
            self.head.prev = new_node
            self.head = new_node
        self.size += 1
        return new_node

    def insert_end(self, song: Song) -> Node:
        new_node = Node(song)
        if self.tail is None:
            self.head = new_node
            self.tail = new_node
            self.current = new_node
        else:
            new_node.prev = self.tail
            self.tail.next = new_node
            self.tail = new_node
        self.size += 1
        return new_node

    def remove_by_title(self, title: str) -> Optional[Song]:
        cursor = self.head
        target = title.lower()
        while cursor is not None:
            if cursor.song.title.lower() == target:
                if cursor.prev is not None:
                    cursor.prev.next = cursor.next
                else:
                    self.head = cursor.next

                if cursor.next is not None:
                    cursor.next.prev = cursor.prev
                else:
                    self.tail = cursor.prev

                if self.current is cursor:
                    self.current = cursor.next or cursor.prev

                self.size -= 1
                return cursor.song
            cursor = cursor.next
        return None

    def find(self, title: str) -> Optional[Node]:
        cursor = self.head
        target = title.lower()
        while cursor is not None:
            if cursor.song.title.lower() == target:
                return cursor
            cursor = cursor.next
        return None

    def to_nodes(self) -> List[Node]:
        nodes: List[Node] = []
        cursor = self.head
        while cursor is not None:
            nodes.append(cursor)
            cursor = cursor.next
        return nodes

    def to_songs(self) -> List[Song]:
        return [node.song for node in self.to_nodes()]

    def sort_by(self, key: Callable[[Song], str]) -> None:
        nodes = self.to_nodes()
        if len(nodes) < 2:
            return

        current_title = self.current.song.title if self.current is not None else None
        nodes.sort(key=lambda node: key(node.song).lower())

        for i, node in enumerate(nodes):
            node.prev = nodes[i - 1] if i > 0 else None
            node.next = nodes[i + 1] if i < len(nodes) - 1 else None

        self.head = nodes[0]
        self.tail = nodes[-1]
        self.current = self.find(current_title) if current_title else self.head

    def next_song(self) -> Optional[Song]:
        if self.current is None:
            return None
        if self.current.next is not None:
            self.current = self.current.next
        elif self.head is not None:
            # Wrap around to the beginning
            self.current = self.head
        return self.current.song

    def previous_song(self) -> Optional[Song]:
        if self.current is None:
            return None
        if self.current.prev is not None:
            self.current = self.current.prev
        elif self.tail is not None:
            # Wrap around to the end
            self.current = self.tail
        return self.current.song

    def modulate_current_pitch(self, delta: float) -> Optional[float]:
        if self.current is None:
            return None
        updated = round(self.current.song.pitch + delta, 2)
        updated = max(0.5, min(2.0, updated))
        self.current.song.pitch = updated
        return updated

    def reset_current_pitch(self) -> Optional[float]:
        if self.current is None:
            return None
        self.current.song.pitch = 1.0
        return 1.0

    def download_current(self) -> str:
        if self.current is None:
            return "No song available to package and download."
        song = self.current.song
        return (
            f"Packaging '{song.title}' by {song.artist} "
            f"(duration {song.duration}, pitch x{song.pitch:.2f})... Download complete."
        )
