from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


AvatarId = Literal["lia", "asuna"]
BatchStatus = Literal["queued", "translating", "done", "error"]


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    avatar: AvatarId = "lia"


class RoomFinish(BaseModel):
    duration_seconds: int = Field(default=0, ge=0, le=604800)


class BatchCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class BatchUpdate(BaseModel):
    status: BatchStatus
    error_message: str | None = Field(default=None, max_length=2000)


class BatchOut(BaseModel):
    id: UUID
    room_id: UUID
    sequence: int
    text: str
    word_count: int
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class RoomOut(BaseModel):
    id: UUID
    name: str
    avatar: str
    status: str
    started_at: datetime | None
    ended_at: datetime | None
    duration_seconds: int
    created_at: datetime
    updated_at: datetime
    batch_count: int = 0


class RoomDetail(RoomOut):
    batches: list[BatchOut]
